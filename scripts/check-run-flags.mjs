// T77 verify: node scripts/check-run-flags.mjs [--base-port 5580] [--server-port 5596]
// `run` with flags only (no scenario file) on the Field Notes demo app (demo-app/, not the probe app) and the sample server:
// 1. bad flags exit 1 before any emulator boots; --print-scenario prints a scenario and boots nothing.
// 2. run --apk <demo apk> --flow flows/demo-new-note.yaml --server http://127.0.0.1:<port> --count 2 --repeat 3
//    --profiles s24ultra,fold5-main --lose-acks 0.3 against the clean sample server -> exit 0, 0 violations; against BUGGY=1 -> exit 1, >= 1 violation
//    (one BUGGY seed can miss the timing, so a second seed is tried, as in check-run-app.mjs).
// Needs: maestro on PATH, JDK 17 for the Gradle build.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { startApp } from "../sample/server/app.ts";
import { CREW_RE, listProcesses } from "../src/platform.ts";
import { claimEmulators, down } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, "server-port": { type: "string", default: "5596" } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const SP = Number(v["server-port"]);
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
const run = (args) => new Promise((done) => {
  const p = execFile(process.execPath, ["--import", "tsx", cli, ...args], { cwd: root, windowsHide: true, maxBuffer: 64 << 20 }, (e, out, err) => done({ code: e ? (e.code ?? 1) : 0, out, err }));
  p.stderr.pipe(process.stderr);
});

execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["-p", join(root, "demo-app"), "assembleDebug", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });
const apk = "demo-app/build/outputs/apk/debug/crewdroid-demo-debug.apk", flow = "flows/demo-new-note.yaml";
const flags = ["--apk", apk, "--flow", flow, "--server", `http://127.0.0.1:${SP}`, "--count", "2", "--repeat", "3"];
// AI NOTE: the mixed default put device 0 on the s22 / API 31 clone; there the flow failed in 3 of 3 T77 trials (Maestro
// "device offline" twice, "New note" not on screen yet once), the API 31 low-memory limit docs/adr/0007-agent-helper.md and
// davx5-contacts.json already skip. Two non-31 profiles keep the check about the flags, not that limit.
const devs = ["--profiles", "s24ultra,fold5-main"];
// AI NOTE: every note has its own id and idempotency key, so the BUGGY server differs from the clean one only when a write
// is sent again after the server stored it. Network faults alone made that happen in 1 of 3 BUGGY runs (T77); --lose-acks 0.3
// drops 30 % of write answers after the commit (as check-proxy.mjs / check-run-app.mjs do): clean replays the first answer
// (0 violations), BUGGY stores a second version (dupSuccess).
const lossy = ["--lose-acks", "0.3"];
claimEmulators(); // the `run` children inherit this run's lock (src/up.ts)

// ---- 1. flag errors and --print-scenario: nothing boots ----
for (const [what, args, re] of [
  ["missing apk", ["--apk", "nope.apk", "--flow", flow, "--server", "http://127.0.0.1:1"], /--apk: file not found/],
  ["missing flow", ["--apk", apk, "--flow", "nope.yaml", "--server", "http://127.0.0.1:1"], /--flow: file not found/],
  ["no --server", ["--apk", apk, "--flow", flow], /--server/],
  ["scenario file with --apk", ["scenarios/photo-upload.json", "--apk", apk], /not both/],
]) {
  const r = await run(["run", ...args, "--base-port", v["base-port"]]);
  const crew = await listProcesses(CREW_RE);
  ok(r.code === 1 && re.test(r.err) && crew.length === 0, `${what}: exit ${r.code}, names the flag (${r.err.trim().split("\n").at(-1)}), ${crew.length} emulators`);
}
const pr = await run(["run", ...flags, "--print-scenario"]);
const printed = pr.code === 0 ? JSON.parse(pr.out) : {};
ok(pr.code === 0 && printed.app?.package === "dev.crewdroid.demo" && printed.actions?.[0]?.maestro === flow && (await listProcesses(CREW_RE)).length === 0,
  `--print-scenario: exit ${pr.code}, package ${printed.app?.package} read from the APK, no emulator`);

// ---- 2. the real run: clean passes, BUGGY is caught ----
for (const buggy of [false, true]) {
  let got;
  for (const seed of buggy ? [1, 2] : [1]) {
    const dir = mkdtempSync(join(tmpdir(), "crewflags-"));
    const server = await startApp({ port: SP, dir: join(dir, "data"), buggy });
    const f = join(dir, "report.json");
    const t0 = Date.now();
    const r = await run(["run", ...flags, ...devs, ...lossy, "--seed", String(seed), "--base-port", v["base-port"], "--out", f]);
    server.close();
    process.stdout.write(r.out);
    const rep = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;
    got = { buggy, seed, code: r.code, rep, n: rep?.judge.violations.length ?? -1, s: Math.round((Date.now() - t0) / 1000) };
    console.log(`== ${buggy ? "BUGGY" : "CLEAN"} seed=${seed} exit=${r.code} ok=${rep?.ok} drained=${rep?.drained} violations=${got.n} (${[...new Set(rep?.judge.violations.map((x) => x.rule) ?? [])].join(", ")}) requests=${rep?.devices.map((d) => d.log.requests).join("/")} actionsFailed=${rep?.devices.map((d) => d.log.actionsFailed).join("/")} ${got.s}s`);
    if (!buggy || got.n > 0) break;
  }
  const reqs = got.rep?.devices.every((d) => d.log.requests > 0);
  ok(buggy ? got.code === 1 && got.n > 0 : got.code === 0 && got.n === 0 && got.rep?.ok, `${buggy ? "BUGGY" : "clean"} seed ${got.seed}: exit ${got.code}, ${got.n} violations, app ${got.rep?.app}`);
  ok(got.rep?.app === "dev.crewdroid.demo" && reqs, `${buggy ? "BUGGY" : "clean"}: every device reached the server through the proxy (requests ${got.rep?.devices.map((d) => d.log.requests).join("/")})`);
}
await down().catch(() => {});
console.log(fails.length ? `FAIL: ${fails.length} checks` : "OK: run by flags catches BUGGY and passes clean on the demo app");
process.exit(fails.length ? 1 : 0);
