// T61/T66 verify: node scripts/check-coexist.mjs [--repeat 10] [--base-port 5580] [--no-write]
// Does crewdroid break mobile-mcp or Maestro on the same device? Per round: fresh `up` of 2 emulators, then 6 cases on the
// first (API 31 in the default mix, the slowest and the one with the ADR 0005 black-screen check):
//   a mobile-mcp mobile_list_elements_on_screen 1 s after `up`
//   b / c mobile-mcp 1 s / 5 s after `crewdroid screen`
//   d / e a full Maestro flow 1 s / 5 s after `crewdroid tap`
//   f a full Maestro flow while crewdroid screen, shot, net online, env battery run against the same device
// A case passes only when every tool in it succeeds. On a failure the device's logcat (UiAutomation, helper, Maestro,
// uiautomator lines) and the adb server pid before/after are kept as evidence. Writes docs/measurements/coexist.json and the
// table in coexist.md (text below the marker line is kept). Exit 0 only when every case passed in every round.
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";
import { startApp } from "../sample/server/app.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, repeat: { type: "string", default: "1" }, "no-write": { type: "boolean", default: false } } });
const ROUNDS = Number(v.repeat);
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const mcpServers = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers;
const MARK = "<!-- generated above by scripts/check-coexist.mjs; text below is kept -->";

// Minimal MCP stdio client (same as check-mcp.mjs): newline-delimited JSON-RPC, initialize + tools/call.
async function connect(name) {
  const s = mcpServers[name];
  // AI NOTE: shell:true so npx.cmd resolves on Windows; args are our own fixed strings.
  const p = spawn([s.command, ...s.args].join(" "), { shell: true, stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...s.env }, windowsHide: true });
  let buf = ""; let id = 0; const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("{")) continue;
      const m = JSON.parse(line); waiting.get(m.id)?.(m);
    }
  });
  const rpc = (method, params) => new Promise((ok, fail) => {
    const n = ++id, t = setTimeout(() => fail(new Error(`${name} ${method} timeout`)), 120000);
    waiting.set(n, (m) => { clearTimeout(t); ok(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "check-coexist", version: "0" } });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    async call(tool, args) {
      const r = await rpc("tools/call", { name: tool, arguments: args });
      return { error: !!r.error || !!r.result?.isError, text: r.error?.message ?? r.result.content.map((c) => c.text ?? "").join("\n") };
    },
    close: () => spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => p.kill()),
  };
}

// run a command to the end -> { code, out } (never rejects)
const sh = (cmd, args, opts = {}) => new Promise((ok) => {
  execFile(cmd, args, { windowsHide: true, cwd: root, shell: opts.shell, timeout: 240000, maxBuffer: 1 << 26 }, (e, out, err) => ok({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: `${out}\n${err}`.trim() }));
});
const crew = (...a) => sh(process.execPath, ["--import", "tsx", cli, ...a]);
const lastLine = (s) => s.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ").slice(0, 300);
const adbServerPid = async () => process.platform === "win32" ? ((await sh("tasklist", ["/FI", "IMAGENAME eq adb.exe", "/FO", "CSV", "/NH"])).out.match(/"adb\.exe","(\d+)"/)?.[1] ?? "none") : "n/a";
// who touched UiAutomation: helper take/release lines, "already registered", instrumentations started/crashed, uiautomator
// and why adb dropped the device: adbd's own transport lines and the guest kernel's allocation failure (T66-2)
const LOGCAT = /UiAutomation|already registered|CrewAgent|uiautomator|FATAL|Crash of app|Start proc .*(maestro|crewdroid\.agent)|lowmemorykiller.*Kill '(dev\.mobile\.maestro|dev\.crewdroid)|(Killing|has died).*dev\.mobile\.maestro|page allocation failure|adbd.*(connection terminated|offline)/i;

const cases = []; // { round, name, ok, ms, error?, detail? }
let target, roundT0;
async function measure(round, name, fn) { // fn -> { ok, error?, detail? }
  const t0 = Date.now(), pid0 = await adbServerPid();
  let r;
  try { r = await fn(); } catch (e) { r = { ok: false, error: String(e.message ?? e) }; }
  const c = { round, name, ok: !!r.ok, ms: Date.now() - t0, error: r.ok ? undefined : (r.error || "failed"), detail: r.detail };
  if (!c.ok) {
    const pid1 = await adbServerPid();
    const log = await adb(target, ["logcat", "-b", "all", "-d", "-v", "time", "-t", "20000"], 60000).catch((e) => `logcat failed: ${e.message}`);
    c.evidence = { adbServerPid: pid0 === pid1 ? pid0 : `${pid0} -> ${pid1} (adb server restarted)`, state: await adb(target, ["get-state"], 10000).catch((e) => e.message), forwards: await adb(target, ["forward", "--list"]).catch((e) => e.message), logcat: log.split(/\r?\n/).filter((l) => LOGCAT.test(l)).slice(-60) };
  }
  cases.push(c);
  console.log(`${c.ok ? "ok  " : "FAIL"} r${round} ${name} ${c.ms} ms${c.detail ? " " + c.detail : ""}${c.error ? " -- " + c.error : ""}`);
  if (c.evidence) console.log(`     evidence: adb server ${c.evidence.adbServerPid}, state ${c.evidence.state}, forwards ${c.evidence.forwards.replace(/\s+/g, " ")}\n     ${c.evidence.logcat.join("\n     ")}`);
}

let server, mobile, ranAll = false;
try {
  if ((await sh("maestro", ["--version"], { shell: true })).code !== 0) throw new Error("maestro not found (scoop install maestro)");
  server = await startApp({ port: 5599, dir: mkdtempSync(join(tmpdir(), "crewcoexist-")) });
  mobile = await connect("mobile-mcp");
  const elements = async () => {
    const x = await mobile.call("mobile_list_elements_on_screen", { device: target });
    return { ok: !x.error && x.text.length > 0, error: x.error ? x.text.slice(0, 300) : "" };
  };
  const screen = async () => { const s = await crew("screen", target, "--json"); return { ok: s.code === 0, error: s.code ? lastLine(s.out) : "", via: s.out.match(/"via":\s*"(\w+)"/)?.[1], black: s.out.match(/"blackRelaunch":\s*\{[^}]*"black":\s*true[^}]*\}/)?.[0].replace(/\s+/g, "") }; };
  const maestro = () => sh("maestro", ["test", "--device", target, "flows/probe-upload.yaml"], { shell: true }).then((m) => ({ ok: m.code === 0, error: m.code ? (m.out.split(/\r?\n/).filter((l) => /FAILED|Error|Exception|not connected|\.maestro[\\/]tests/.test(l) && !/^\s+at /.test(l)).slice(0, 4).join(" | ").slice(0, 400) || lastLine(m.out)) : "" }));

  for (let round = 1; round <= ROUNDS; round++) {
    await down();
    const r = await up(2, Number(v["base-port"]));
    target = r.devices[0].serial; roundT0 = Date.now();
    console.log(`round ${round}/${ROUNDS}: booted ${r.devices.map((d) => `${d.serial}=${d.profile}/API${d.api}`).join(", ")}; target ${target}`);

    await sleep(1000);
    await measure(round, "a mobile-mcp 1s after up", elements);

    await adb(target, ["install", "-r", probeApk()], 120000);
    await adb(target, ["shell", "pm", "grant", PKG, "android.permission.CAMERA"]);
    await adb(target, ["logcat", "-c"]).catch(() => {});

    await sleep(2000);
    await screen();
    await sleep(1000);
    await measure(round, "b mobile-mcp 1s after crewdroid screen", elements);

    await sleep(2000);
    await screen();
    await sleep(5000);
    await measure(round, "c mobile-mcp 5s after crewdroid screen", elements);

    await sleep(2000);
    await crew("tap", target, "10", "10");
    await sleep(1000);
    await measure(round, "d maestro 1s after crewdroid tap", maestro);

    await sleep(2000);
    await crew("tap", target, "10", "10");
    await sleep(5000);
    await measure(round, "e maestro 5s after crewdroid tap", maestro);

    await sleep(2000);
    await measure(round, "f maestro flow while crewdroid screen, shot, net, env run", async () => {
      let flowEnd = 0;
      const f0 = Date.now(), flow = maestro().then((m) => { flowEnd = Date.now(); return m; });
      await sleep(3000); // Maestro has connected and is starting its driver / the flow
      const steps = [];
      const step = async (name, fn) => { const t = Date.now() - f0, x = await fn(); steps.push({ name, ...x, at: Date.now(), span: `${name} ${t}-${Date.now() - f0} ms` }); };
      await step("screen", screen);
      await step("shot", async () => { const s = await crew("shot", target, join(tmpdir(), `crewcoexist-${target}.png`), "--json"); return { ok: s.code === 0, error: s.code ? lastLine(s.out) : "" }; });
      await step("net", async () => { const s = await crew("net", target, "online", "--json"); return { ok: s.code === 0, error: s.code ? lastLine(s.out) : "" }; });
      await step("env", async () => { const s = await crew("env", target, "battery", "80", "--json"); return { ok: s.code === 0, error: s.code ? lastLine(s.out) : "" }; });
      const m = await flow;
      const during = steps.filter((s) => !flowEnd || s.at <= flowEnd).length;
      // and the helper is usable again once Maestro is gone (a failed UiAutomation connect must not leave it stuck). A helper
      // that exited (503) or was killed (low memory) is restarted by the first command's fallback, so the second must use it.
      let after = await screen();
      if (after.via !== "helper") after = await screen();
      if (after.via !== "helper") steps.push({ name: "screen after the flow", ok: false, error: `via ${after.via}: ${after.error}` });
      const bad = steps.filter((s) => !s.ok);
      return {
        ok: m.ok && !bad.length,
        detail: `(screen via ${steps[0].via ?? "?"}, after the flow via ${after.via}; ${during}/4 crewdroid commands finished before the flow ended at ${flowEnd - f0} ms: ${steps.slice(0, 4).map((s) => s.span).join(", ")}${steps[0].black ? `; screen blackRelaunch ${steps[0].black}` : ""})`,
        error: [...(m.ok ? [] : [`maestro: ${m.error}`]), ...bad.map((s) => `${s.name}: ${s.error}`)].join("; "),
      };
    });
  }
  ranAll = cases.length === 6 * ROUNDS;
} catch (e) {
  console.error("could not run: " + (e.stack ?? e));
} finally {
  mobile?.close();
  await server?.close?.();
  await down().catch((e) => console.error("down failed: " + e.message));
}

const names = [...new Set(cases.map((c) => c.name))];
const summary = names.map((name) => {
  const xs = cases.filter((c) => c.name === name), ms = xs.map((c) => c.ms).sort((a, b) => a - b);
  return { name, passed: xs.filter((c) => c.ok).length, runs: xs.length, medianMs: ms[Math.floor(ms.length / 2)], maxMs: ms.at(-1), errors: [...new Set(xs.filter((c) => !c.ok).map((c) => c.error))] };
});
const allOk = ranAll && summary.every((s) => s.passed === ROUNDS);
if (ranAll && !v["no-write"]) {
  const date = new Date().toISOString();
  writeFileSync(join(root, "docs/measurements/coexist.json"), JSON.stringify({ date, rounds: ROUNDS, summary, cases }, null, 2) + "\n");
  const f = join(root, "docs/measurements/coexist.md");
  let kept = "";
  try { const old = readFileSync(f, "utf8"); kept = old.includes(MARK) ? old.slice(old.indexOf(MARK) + MARK.length) : ""; } catch {}
  const md = ["# crewdroid next to mobile-mcp and Maestro (T61, T66)", "",
    `${date.slice(0, 10)}, \`node scripts/check-coexist.mjs --repeat ${ROUNDS}\`: ${ROUNDS} rounds, each a fresh \`up\` of 2 emulators, cases on the first (${cases.length} results). Raw data with every round: \`coexist.json\`.`, "",
    "| Case | Passed | Median ms | Max ms | Errors |", "|---|---|---|---|---|",
    ...summary.map((s) => `| ${s.name} | ${s.passed}/${s.runs} | ${s.medianMs} | ${s.maxMs} | ${s.errors.join("; ").replace(/\|/g, "/").slice(0, 300)} |`), "",
    "Every result in run order (ms, x = failed):", "",
    "| Round | a | b | c | d | e | f |", "|---|---|---|---|---|---|---|",
    ...[...new Set(cases.map((c) => c.round))].map((rd) => `| ${rd} | ${cases.filter((c) => c.round === rd).map((c) => `${c.ms}${c.ok ? "" : " x"}`).join(" | ")} |`), "",
    MARK].join("\n");
  writeFileSync(f, md + (kept || "\n"));
  console.log("wrote docs/measurements/coexist.json and coexist.md");
}
for (const s of summary) console.log(`${s.passed === ROUNDS ? "PASS" : "FAIL"} ${s.name}: ${s.passed}/${s.runs}, median ${s.medianMs} ms, max ${s.maxMs} ms`);
console.log(allOk ? `OK: every coexistence case passed ${ROUNDS}/${ROUNDS}` : `FAIL: coexistence (${ranAll ? "some case below " + ROUNDS + "/" + ROUNDS : "could not run every case"})`);
process.exit(allOk ? 0 : 1);
