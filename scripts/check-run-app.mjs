// T55 verify: node scripts/check-run-app.mjs [--base-port 5580] [--skip-probe]
// 1. Schema errors (unknown action, missing field, missing flow) -> `run` exits 1 and no emulator starts.
// 2. Non-demo app: DAVx5 (F-Droid release APK, CardDAV sync) + a local Radicale server, scenarios/davx5-contacts.json on
//    3 mixed devices: its own Maestro flows, adb contact edits, network faults, proxy judge -> a verdict. No probe package in its log.
//    Twice: network faults only, then also 30 % of write answers dropped by the proxy (--lose-acks 0.3).
// 3. Probe preset still works: photo-upload.json finds violations on the BUGGY sample server and passes on the clean one.
// Needs: python (Radicale goes into a venv under %TEMP%), maestro on PATH, network for the first download.
// Writes docs/measurements/run-app.json (the non-demo report).
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { startApp } from "../sample/server/app.ts";
import { CREW_RE, listProcesses } from "../src/platform.ts";
import { claimEmulators, down } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, "skip-probe": { type: "boolean", default: false } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
const run = (args, extra = {}) => new Promise((done) => {
  const p = execFile(process.execPath, [cli, ...args], { cwd: root, windowsHide: true, maxBuffer: 64 << 20, ...extra }, (e, out, err) => done({ code: e ? (e.code ?? 1) : 0, out: `${out}\n${err}` }));
  p.stdout.pipe(process.stdout); p.stderr.pipe(process.stderr);
});
claimEmulators(); // the `run` children inherit this run's lock (src/up.ts)

// ---- 1. schema errors: exit 1 before any device boots ----
const tmp = mkdtempSync(join(tmpdir(), "crewrunapp-"));
const base = { name: "bad", app: { package: "com.example.app" }, repeat: 1, delayMs: [0, 1], server: { target: "http://127.0.0.1:9" } };
for (const [what, sc] of [["unknown action", { ...base, actions: [{ tap: "Save" }] }], ["missing field (actions)", base], ["missing flow file", { ...base, actions: [{ maestro: "nope.yaml" }] }]]) {
  const f = join(tmp, `${what.replace(/\W+/g, "-")}.json`);
  writeFileSync(f, JSON.stringify(sc));
  const t0 = Date.now();
  const r = await run(["run", f, "--base-port", v["base-port"]]);
  const crew = await listProcesses(CREW_RE);
  ok(r.code === 1 && crew.length === 0, `${what}: exit ${r.code} in ${Date.now() - t0} ms, ${crew.length} emulators started`);
}

// ---- 2. non-demo app: DAVx5 + Radicale ----
const cache = join(root, ".cache");
mkdirSync(cache, { recursive: true });
const apk = join(cache, "davx5.apk");
const APK_URL = "https://f-droid.org/repo/at.bitfire.davdroid_405210002.apk"; // DAVx5 4.5.21-ose, F-Droid build
const APK_SHA256 = "41cf9832d97c31e3fc694e5c66b38990dec3312936cc336141714db07259081b";
if (!existsSync(apk)) {
  console.log(`downloading ${APK_URL}`);
  const r = await fetch(APK_URL);
  if (!r.ok) throw new Error(`GET ${APK_URL} -> ${r.status}`);
  writeFileSync(apk, Buffer.from(await r.arrayBuffer()));
}
const sha = createHash("sha256").update(readFileSync(apk)).digest("hex");
if (sha !== APK_SHA256) throw new Error(`${apk}: sha256 ${sha}, expected ${APK_SHA256} (delete it to download again)`);

const venv = join(tmpdir(), "crewdroid-radicale");
const py = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const sh = (cmd, args) => new Promise((done, no) => execFile(cmd, args, { windowsHide: true, maxBuffer: 16 << 20 }, (e, out, err) => (e ? no(new Error(`${cmd} ${args.join(" ")}: ${err || e.message}`)) : done(out))));
if (!existsSync(py)) await sh(process.platform === "win32" ? "python" : "python3", ["-m", "venv", venv]);
await sh(py, ["-m", "pip", "install", "-q", "radicale==3.9.0"]);
const PORT = 5597;
const repeat = JSON.parse(readFileSync(join(root, "scenarios/davx5-contacts.json"), "utf8")).repeat;
// One run on a fresh Radicale store with one shared address book every device syncs (user "crew"; auth none takes any password).
async function davRun(label, extra) {
  const store = join(tmp, `radicale-${label}`);
  const radicale = spawn(py, ["-m", "radicale", "--server-hosts", `127.0.0.1:${PORT}`, "--storage-filesystem-folder", store, "--auth-type", "none"], { stdio: "ignore", windowsHide: true });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) { await new Promise((r) => setTimeout(r, 200)); up = await fetch(`http://127.0.0.1:${PORT}/`).then(() => true, () => false); }
    if (!up) throw new Error("radicale did not start");
    const mk = await fetch(`http://127.0.0.1:${PORT}/crew/contacts/`, { method: "MKCOL", headers: { authorization: "Basic " + Buffer.from("crew:crew").toString("base64"), "content-type": "application/xml" },
      body: '<?xml version="1.0"?><mkcol xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><set><prop><resourcetype><collection/><C:addressbook/></resourcetype><displayname>crew</displayname></prop></set></mkcol>' });
    if (mk.status !== 201) throw new Error(`MKCOL address book -> ${mk.status}`);
    const out = join(tmp, `davx5-${label}.json`);
    const r = await run(["run", "scenarios/davx5-contacts.json", "--seed", "1", "--base-port", v["base-port"], "--out", out, ...extra]);
    let rep;
    try { rep = JSON.parse(readFileSync(out, "utf8")); } catch { rep = undefined; }
    ok(!!rep && rep.devices.length === 3 && Array.isArray(rep.judge?.violations), `${label}: non-demo run finished on ${rep?.devices.length ?? 0} devices with a verdict (exit ${r.code}, ok=${rep?.ok}, ${rep?.judge?.violations.length ?? "-"} violations)`);
    ok(!/dev\.crewdroid\.(probe|sample)/.test(r.out + (rep ? JSON.stringify(rep) : "")), `${label}: no probe package in the non-demo run's log`);
    if (!rep) return undefined;
    ok(new Set(rep.devices.map((d) => d.api)).size > 1 && new Set(rep.devices.map((d) => d.profile)).size === 3, `${label}: mixed devices: ${rep.devices.map((d) => `${d.profile}/API${d.api}`).join(", ")}`);
    ok(rep.devices.every((d) => d.log.requests > 0), `${label}: every device's traffic went through the proxy: ${rep.devices.map((d) => d.log.requests).join("/")} requests`);
    ok(rep.devices.every((d) => d.network.length > 0), `${label}: every device had network faults`);
    // Second opinion from the server's own data (not a pass/fail: the proxy judge is the verdict): every contact the devices
    // added (`<serial> c<iter>`) should be stored exactly once.
    const book = join(store, "collection-root", "crew", "contacts");
    const names = existsSync(book) ? readdirSync(book).filter((f) => f.endsWith(".vcf")).map((f) => readFileSync(join(book, f), "utf8").match(/^FN:(.*)$/m)?.[1]?.trim()) : [];
    const want = rep.devices.flatMap((d) => Array.from({ length: repeat }, (_, i) => `${d.serial} c${i}`));
    const server = { stored: names.length, expected: want.length, missing: want.filter((n) => !names.includes(n)), duplicated: [...new Set(names.filter((n, i) => names.indexOf(n) !== i))] };
    console.log(`${label}: server kept ${server.stored} contacts of ${server.expected} added; missing ${server.missing.length}, duplicated ${server.duplicated.length}`);
    for (const x of rep.judge.violations) console.log(`  VIOLATION ${x.rule}: ${x.message}`);
    return { label, args: extra.filter((a) => !a.includes(tmp)), ...rep, file: "scenarios/davx5-contacts.json", proxy: rep.proxy && { ...rep.proxy, log: "(temp)" }, rules: "judge/carddav.rules.json", server };
  } finally { radicale.kill(); }
}
// Network faults only, then the same with 30 % of write answers dropped after the server committed them (T69 --lose-acks).
const reports = [await davRun("faults", []), await davRun("lost-acks", ["--proxy", "5590", "--log", join(tmp, "lost-acks.jsonl"), "--lose-acks", "0.3"])];
writeFileSync(join(root, "docs/measurements/run-app.json"), JSON.stringify(reports, null, 2) + "\n");

// ---- 3. probe preset unchanged ----
if (!v["skip-probe"]) {
  for (const buggy of [true, false]) {
    let got;
    for (const seed of buggy ? [1, 2] : [1]) { // one BUGGY seed can miss (check-scenario needs 2 of 3), so a second try
      const dir = mkdtempSync(join(tmpdir(), "crewprobe-"));
      const server = await startApp({ port: 5595, dir: join(dir, "data"), buggy });
      const f = join(dir, "r.json");
      const r = await run(["run", "scenarios/photo-upload.json", "--seed", String(seed), "--server-port", "5595", "--base-port", v["base-port"], "--out", f]);
      server.close();
      got = { code: r.code, rep: existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined, seed };
      if (!buggy || got.rep?.judge.violations.length) break;
    }
    const n = got.rep?.judge.violations.length ?? -1;
    ok(buggy ? n > 0 : got.code === 0 && got.rep?.ok, `probe preset ${buggy ? "BUGGY" : "clean"} seed ${got.seed}: exit ${got.code}, ${n} violations`);
  }
}
await down().catch(() => {});
console.log(fails.length ? `FAIL: ${fails.length} checks` : "OK: run drives any app (schema errors exit 1, non-demo verdict, probe preset holds)");
process.exit(fails.length ? 1 : 0);
