import { exec, execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { adb } from "./adb.ts";
import { apk } from "./apk.ts";
import { readLog } from "./judge.ts";
import { screen } from "./screen.ts";
import { sleep } from "./snapshot.ts";

// T55: scenario schema v2 (any app) and its per-iteration actions. The probe app's hooks live behind "preset": "probe".
const range = z.tuple([z.number().int().min(0), z.number().int().min(0)]).refine(([a, b]) => a <= b, "[lo, hi] needs lo <= hi");
const network = z.strictObject({ states: z.array(z.enum(["airplane", "nodata", "slow", "flaky"])).min(1), badMs: range, onlineMs: range });
const extra = z.union([z.string(), z.number().int(), z.boolean()]);
export const actionSchema = z.union([
  z.strictObject({ maestro: z.string().min(1), env: z.record(z.string(), z.string()).optional() }),
  z.strictObject({ intent: z.strictObject({ action: z.string().optional(), component: z.string().optional(), data: z.string().optional(), type: z.string().optional(), extras: z.record(z.string(), extra).optional() }) }),
  z.strictObject({ adb: z.array(z.string()).min(1) }),
], { error: "unknown action: use {maestro: \"flow.yaml\", env?}, {intent: {action?, component?, data?, type?, extras?}} or {adb: [\"shell\", ...]}" });
export type Action = z.infer<typeof actionSchema>;

const probeSchema = z.strictObject({
  name: z.string(), about: z.string().optional(), preset: z.literal("probe"), repeat: z.number().int().min(1), delayMs: range,
  photoBytes: z.number().int().min(1), records: z.array(z.string()).min(1), network, drainTimeoutS: z.number().int().min(1), rules: z.string(),
});
const appSchema = z.strictObject({
  name: z.string(), about: z.string().optional(),
  app: z.strictObject({ apk: z.string().optional(), package: z.string().regex(/^[\w.]+$/, "package name like com.example.app") }),
  devices: z.strictObject({ count: z.number().int().min(1).max(6).optional(), profiles: z.array(z.string()).min(1).optional(), api: z.union([z.literal(31), z.literal(34), z.literal(36), z.literal("latest")]).optional() }).optional(),
  repeat: z.number().int().min(1), delayMs: range, network: network.optional(),
  setup: z.array(actionSchema).optional(), // once per device before the loop (log in, pick a server); a failure stops the run
  actions: z.array(actionSchema).min(1), // every iteration runs these in order, seeded pause after each
  drain: z.union([
    z.strictObject({ idleSeconds: z.number().min(1), timeoutSeconds: z.number().min(1).optional() }),
    z.strictObject({ logPattern: z.string().min(1), timeoutSeconds: z.number().min(1).optional() }),
    z.strictObject({ waitText: z.string().min(1), timeoutSeconds: z.number().min(1).optional() }),
  ], { error: "drain is one of {idleSeconds}, {logPattern} or {waitText} (each with optional timeoutSeconds)" }).optional(),
  server: z.strictObject({ target: z.url({ protocol: /^http$/, error: "server.target must be http://host:port (the backend as the host sees it)" }), proxyPort: z.number().int().min(1024).optional() }).optional(),
  rules: z.string().optional(), // default: judge/proxy.rules.json on the proxy log
  source: z.string().optional(), // server data (/export URL or JSON file) for table rules; only used when given
});
export type ProbeScenario = z.infer<typeof probeSchema>;
export type AppScenario = z.infer<typeof appSchema> & { dir: string };
export const PROXY_RULES = join(import.meta.dirname, "..", "judge", "proxy.rules.json");

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(top)"}: ${i.message}`).join("; ");

// Parse + check a scenario file without touching a device: bad JSON, unknown action/field, missing file -> throws (exit 1).
export function loadScenario(file: string): ({ kind: "probe" } & ProbeScenario) | ({ kind: "app" } & AppScenario) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const dir = dirname(resolve(file));
  const at = (p: string) => (isAbsolute(p) ? p : resolve(dir, p));
  const need = (p: string, what: string) => { if (!existsSync(at(p))) throw new Error(`${file}: ${what} not found: ${at(p)}`); };
  if (raw?.preset !== undefined && raw.preset !== "probe") throw new Error(`${file}: unknown preset '${raw.preset}' (only "probe")`);
  if (raw?.preset === "probe") {
    const r = probeSchema.safeParse(raw);
    if (!r.success) throw new Error(`${file}: ${issues(r.error)}`);
    need(r.data.rules, "rules");
    return { kind: "probe", ...r.data };
  }
  const r = appSchema.safeParse(raw);
  if (!r.success) throw new Error(`${file}: ${issues(r.error)}`);
  const sc = r.data;
  if (sc.app.apk) need(sc.app.apk, "app.apk");
  for (const a of [...(sc.setup ?? []), ...sc.actions]) if ("maestro" in a) need(a.maestro, "maestro flow");
  if (sc.rules) need(sc.rules, "rules");
  if (!sc.server && !sc.source) throw new Error(`${file}: nothing to judge: give server.target (proxy log) or source (/export URL or JSON file)`);
  if (!sc.server && (!sc.drain || "idleSeconds" in sc.drain)) throw new Error(`${file}: drain idleSeconds watches the proxy log: give server.target, or drain {logPattern} / {waitText}`);
  if (!sc.server && !sc.rules) throw new Error(`${file}: without server.target the default proxy rules have no log: give rules`);
  return { kind: "app", ...sc, dir };
}

// T77: `run --apk --flow --server` with no scenario file. Builds the JSON a user would write (paths relative to `dir`) and
// parses it with the same schema, so runScenario sees exactly what loadScenario returns for that file saved in `dir`.
export interface RunFlags { apk?: string; flows?: string[]; setupFlow?: string; server?: string; count?: number; repeat?: number; network?: boolean }
export async function flagScenario(f: RunFlags, dir = process.cwd(), readPackage = async (p: string) => (await apk(p)).package): Promise<{ kind: "app" } & AppScenario> {
  const rel = (flag: string, p: string) => {
    if (!existsSync(resolve(dir, p))) throw new Error(`${flag}: file not found: ${resolve(dir, p)}`);
    return relative(dir, resolve(dir, p)).split(sep).join("/");
  };
  if (!f.apk) throw new Error("--apk <file.apk> required");
  const apkPath = rel("--apk", f.apk);
  if (!f.flows?.length) throw new Error("--flow <flow.yaml> required (repeat --flow for more steps)");
  const flows = f.flows.map((x) => rel("--flow", x)), setup = f.setupFlow && rel("--setup-flow", f.setupFlow);
  if (!f.server) throw new Error("--server http://host:port required (your backend as the host sees it)");
  const pkg = await readPackage(resolve(dir, apkPath));
  const r = appSchema.safeParse({
    name: pkg, about: "built from run flags (crewdroid run --apk --flow --server)",
    app: { apk: apkPath, package: pkg }, devices: { count: f.count ?? 3 }, repeat: f.repeat ?? 5, delayMs: [1000, 4000],
    ...(f.network === false ? {} : { network: { states: ["airplane", "nodata", "slow", "flaky"], badMs: [5000, 12000], onlineMs: [2000, 6000] } }),
    server: { target: f.server }, ...(setup ? { setup: [{ maestro: setup }] } : {}),
    actions: flows.map((m) => ({ maestro: m })), drain: { idleSeconds: 20 },
  });
  const flag: Record<string, string> = { "server.target": "--server", "devices.count": "--count", repeat: "--repeat" };
  if (!r.success) throw new Error(`run flags: ${issues(r.error).replace(/(server\.target|devices\.count|repeat): /g, (_, k) => `${flag[k]}: `)}`);
  return { kind: "app", ...r.data, dir };
}
// `--print-scenario`: the scenario file for these flags (save it in `dir`, then `run <file>` loads the same object).
export const scenarioFile = ({ kind, dir, ...sc }: { kind: "app" } & AppScenario) => JSON.stringify(sc, null, 2);

// "{serial}", "{device}" (0-based index), "{iter}" (0-based; -1 in setup) in env values, intent fields and adb args.
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(serial|device|iter)\}/g, (_, k) => String(v[k]));

// Maestro's Windows launcher is a .cmd: it runs through cmd.exe, so every argument is quoted for it.
// ponytail: cmd quoting covers spaces and quotes; a value with % or ^ would still be expanded by cmd.
const winQuote = (a: string) => (/^[\w.:/\\=-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
function maestro(serial: string, flow: string, env: Record<string, string>) {
  const args = ["test", "--device", serial, "--no-ansi", "--no-reinstall-driver", ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), flow];
  const win = process.platform === "win32";
  const done = (ok: () => void, no: (e: Error) => void) => (e: Error | null, out: string, err: string) => {
      if (!e) return ok();
      const lines = `${out}\n${err}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const tail = (lines.filter((l) => /FAILED|not found|offline|died|Error|Exception/i.test(l)).slice(0, 3).join(" | ") || lines.slice(-3).join(" | "));
      no(new Error(`maestro ${flow}: ${(e as any).code === "ENOENT" || /not recognized/.test(err) ? "maestro not on PATH (install: https://maestro.dev)" : tail || e.message}`));
  };
  const opt = { windowsHide: true, timeout: 300000, maxBuffer: 16 << 20 };
  return new Promise<void>((ok, no) => win
    ? exec(["maestro.cmd", ...args.map(winQuote)].join(" "), opt, done(ok, no))
    : execFile("maestro", args, opt, done(ok, no)));
}

export async function runAction(serial: string, a: Action, vars: Record<string, string | number>, dir: string): Promise<string> {
  if ("maestro" in a) {
    const env = Object.fromEntries(Object.entries({ CREW_SERIAL: "{serial}", CREW_DEVICE: "{device}", CREW_ITER: "{iter}", ...a.env }).map(([k, v]) => [k, fill(v, vars)]));
    await maestro(serial, isAbsolute(a.maestro) ? a.maestro : resolve(dir, a.maestro), env);
    return `maestro ${a.maestro}`;
  }
  if ("intent" in a) {
    const i = a.intent;
    const args = ["shell", "am", "start", "-W"];
    if (i.action) args.push("-a", fill(i.action, vars));
    if (i.data) args.push("-d", `'${fill(i.data, vars)}'`);
    if (i.type) args.push("-t", i.type);
    if (i.component) args.push("-n", fill(i.component, vars));
    for (const [k, v] of Object.entries(i.extras ?? {})) {
      args.push(typeof v === "boolean" ? "--ez" : typeof v === "number" ? "--ei" : "--es", k, typeof v === "string" ? `'${fill(v, vars).replace(/'/g, "'\\''")}'` : String(v));
    }
    const out = await adb(serial, args, 60000);
    if (/^Error|Exception/m.test(out)) throw new Error(`intent: ${out.split(/\r?\n/).find((l) => /Error|Exception/.test(l))}`);
    return `intent ${i.action ?? i.component}`;
  }
  await adb(serial, a.adb.map((x) => fill(x, vars)), 60000);
  return `adb ${a.adb.slice(0, 3).join(" ")}`;
}

// ---- drain: is this device done talking to the server? ----
const toServer = (e: { host?: string; method: string }) => !e.host && e.method !== "CONNECT"; // same filter as the log rules
export function lastRequest(log: string, device: string): number {
  if (!existsSync(log)) return 0;
  return Math.max(0, ...readLog(log).filter((e) => e.device === device && toServer(e)).map((e) => Date.parse(e.t)));
}
export const requestCount = (log: string, device: string) => (existsSync(log) ? readLog(log).filter((e) => e.device === device && toServer(e)).length : 0);

export async function drainDevice(serial: string, d: NonNullable<AppScenario["drain"]>, proxyLog?: string): Promise<{ drained: boolean; seconds: number }> {
  const t0 = Date.now(), until = t0 + (d.timeoutSeconds ?? 180) * 1000;
  const secs = () => Math.round((Date.now() - t0) / 1000);
  if ("logPattern" in d) await adb(serial, ["logcat", "-c"]);
  while (Date.now() < until) {
    if ("idleSeconds" in d) {
      // NOTE: idle counts from max(last request, drain start): right after the network comes back the app may not have
      // started its retry yet, so "no request so far" alone would end the drain too early.
      if (Date.now() - Math.max(lastRequest(proxyLog!, serial), t0) >= d.idleSeconds * 1000) return { drained: true, seconds: secs() };
    } else if ("logPattern" in d) {
      const re = new RegExp(d.logPattern);
      if ((await adb(serial, ["logcat", "-d"], 30000).catch(() => "")).split(/\r?\n/).some((l) => re.test(l))) return { drained: true, seconds: secs() };
    } else {
      const { nodes } = await screen(serial).catch(() => ({ nodes: [] as { text: string; desc: string }[] }));
      if (nodes.some((n) => n.text.includes(d.waitText) || n.desc.includes(d.waitText))) return { drained: true, seconds: secs() };
    }
    await sleep(2000);
  }
  return { drained: false, seconds: secs() };
}
