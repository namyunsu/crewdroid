// T69 verify: node scripts/check-proxy.mjs [--server-port 5595] [--proxy-port 5590] [--skip-runs]
// 1. Overhead: the same client hits the sample server directly and through the proxy (alternating), per-request ms.
// 2. CLI on one device: `proxy start` points the system proxy at us, the UNMODIFIED probe app's requests show up in `proxy log`
//    under its serial; `proxy stop` clears the setting (next request goes direct); `down` stops a running proxy; a new clone
//    comes up without the setting.
// 3. Scenario: `crewdroid run scenarios/photo-upload.json --proxy --lose-acks 0.1` x seeds 1..3 x (BUGGY=1, clean) sample
//    server (unmodified), then `crewdroid judge --rules judge/proxy.rules.json --log`. Exit 0 only if every BUGGY seed shows
//    dupSuccess AND lostUpdate, every clean seed passes all four rules, and every run logged all 3 devices.
// Writes docs/measurements/proxy.json + proxy.md.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { startApp } from "../sample/server/app.ts";
import { adb } from "../src/adb.ts";
import { startProxy } from "../src/proxy.ts";
import { PKG, probeApk } from "../src/snapshot.ts";
import { claimEmulators, down } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "server-port": { type: "string", default: "5595" }, "proxy-port": { type: "string", default: "5590" }, "skip-runs": { type: "boolean", default: false } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const SP = Number(v["server-port"]), PP = Number(v["proxy-port"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const must = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const crew = (...args) => new Promise((ok) => {
  const p = execFile(process.execPath, [cli, ...args], { cwd: root, windowsHide: true, maxBuffer: 64 * 2 ** 20 }, (e, stdout) => ok({ code: e ? (e.code ?? 1) : 0, stdout }));
  p.stderr.pipe(process.stderr);
});
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
claimEmulators(); // children (`run`, `up`, `down`) inherit this lock

// ---- 1. overhead ----
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100; };
async function overhead(n = 400) {
  const dir = mkdtempSync(join(tmpdir(), "crewproxy-oh-"));
  const server = await startApp({ port: SP, dir: join(dir, "data"), host: "127.0.0.1" });
  const px = await startProxy({ target: `http://127.0.0.1:${SP}`, port: PP, devices: ["emulator-5580"], log: join(dir, "proxy.jsonl") });
  const body = Buffer.alloc(1024, 7);
  const send = (port, path, i) => new Promise((ok, no) => {
    const t0 = performance.now();
    const r = request({ host: "127.0.0.1", port, method: "POST", path, headers: { "x-client-id": "oh", "idempotency-key": `k${i}-${port}`, "content-length": body.length } }, (res) => { res.resume(); res.on("end", () => ok(performance.now() - t0)); });
    r.on("error", no); r.end(body);
  });
  const direct = [], via = [];
  for (let i = 0; i < 20; i++) { await send(SP, "/upload", i); await send(PP, `http://10.0.2.2:${SP}/upload`, i); } // warm-up
  for (let i = 0; i < n; i++) { direct.push(await send(SP, "/upload", 100 + i)); via.push(await send(PP, `http://10.0.2.2:${SP}/upload`, 100 + i)); }
  await px.close(); server.closeAllConnections(); await new Promise((ok) => server.close(ok));
  const r = { requests: n, bodyBytes: body.length, directMs: { p50: pct(direct, 0.5), p95: pct(direct, 0.95) }, proxyMs: { p50: pct(via, 0.5), p95: pct(via, 0.95) } };
  r.overheadMs = { p50: Math.round((r.proxyMs.p50 - r.directMs.p50) * 100) / 100, p95: Math.round((r.proxyMs.p95 - r.directMs.p95) * 100) / 100 };
  return r;
}
const oh = await overhead();
console.log(`overhead: direct p50 ${oh.directMs.p50} ms, via proxy p50 ${oh.proxyMs.p50} ms -> +${oh.overheadMs.p50} ms (p95 +${oh.overheadMs.p95} ms)`);

// ---- 2. CLI lifecycle on one device ----
const lifecycle = {};
{
  const dir = mkdtempSync(join(tmpdir(), "crewproxy-cli-"));
  const server = await startApp({ port: SP, dir: join(dir, "data") });
  try {
    const u = await crew("up", "--json");
    const serial = JSON.parse(u.stdout).devices[0].serial;
    const sh = (c) => adb(serial, ["shell", c]);
    const bc = (a, ...x) => adb(serial, ["shell", "am", "broadcast", "--include-stopped-packages", "-n", `${PKG}/.SampleReceiver`, "-a", `dev.crewdroid.sample.${a}`, ...x]);
    await adb(serial, ["install", "-r", probeApk()], 120000);
    const log = join(dir, "proxy.jsonl");
    const st = JSON.parse((await crew("proxy", "start", "--target", `http://127.0.0.1:${SP}`, "--port", String(PP), "--devices", serial, "--log", log, "--json")).stdout);
    lifecycle.setting = await sh("settings get global http_proxy");
    must(lifecycle.setting === `10.0.2.2:${PP}`, `proxy start sets ${serial} http_proxy (${lifecycle.setting})`);
    await sh(`am start -n ${PKG}/.ProbeActivity`); await sleep(3000);
    await bc("READ", "--es", "server", `http://10.0.2.2:${SP}`);
    await bc("PHOTO", "--es", "id", "cli-p1", "--ei", "size", "4096", "--es", "server", `http://10.0.2.2:${SP}`);
    await sleep(4000);
    const seen = JSON.parse((await crew("proxy", "log", "--json")).stdout).entries.filter((e) => e.device === serial && !e.host && e.method !== "CONNECT");
    lifecycle.logged = seen.map((e) => `${e.method} ${e.path} ${e.status}`);
    must(seen.some((e) => e.method === "GET" && e.path === "/export" && e.status === 200) && seen.some((e) => e.method === "POST" && e.path === "/upload" && e.status === 200 && e.key),
      `unmodified probe app's GET /export + POST /upload logged under ${serial}: ${lifecycle.logged.join(" | ")}`);
    const stop = JSON.parse((await crew("proxy", "stop", "--json")).stdout);
    lifecycle.afterStop = await sh("settings get global http_proxy");
    must(stop.cleared.includes(serial) && lifecycle.afterStop === ":0" && !alive(st.pid), `proxy stop clears the setting (${lifecycle.afterStop}) and ends pid ${st.pid}`);
    const before = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
    await sh("logcat -c"); await bc("READ", "--es", "server", `http://10.0.2.2:${SP}`); await sleep(3000);
    const read = await sh("logcat -d -s CrewProbe:I");
    lifecycle.directRead = /READ ok/.test(read);
    must(lifecycle.directRead && readFileSync(log, "utf8").split("\n").filter(Boolean).length === before, "after stop the app reaches the server directly (READ ok, no new log line)");
    const st2 = JSON.parse((await crew("proxy", "start", "--target", `http://127.0.0.1:${SP}`, "--port", String(PP), "--devices", serial, "--log", log, "--json")).stdout);
    await crew("down");
    must(!alive(st2.pid), `down stops a running proxy (pid ${st2.pid})`);
    const u2 = await crew("up", "--json");
    const s2 = JSON.parse(u2.stdout).devices[0].serial;
    lifecycle.freshClone = await adb(s2, ["shell", "settings get global http_proxy"]);
    must(lifecycle.freshClone === "null", `a new clone after down has no proxy setting (${lifecycle.freshClone}; -read-only disk)`);
  } finally {
    server.close();
    await crew("proxy", "stop");
    await down();
  }
}

// ---- 3. scenario runs ----
const runs = [];
if (!v["skip-runs"]) {
  for (const seed of [1, 2, 3]) {
    for (const buggy of [true, false]) {
      const dir = mkdtempSync(join(tmpdir(), "crewproxy-run-"));
      const out = join(dir, "report.json"), log = join(dir, "proxy.jsonl");
      const server = await startApp({ port: SP, dir: join(dir, "data"), buggy });
      const run = await crew("run", "scenarios/photo-upload.json", "--seed", String(seed), "--server-port", String(SP), "--proxy", String(PP), "--log", log, "--lose-acks", "0.1", "--out", out);
      server.close();
      let report;
      try { report = JSON.parse(readFileSync(out, "utf8")); } catch { report = { ok: false, error: `no report (exit ${run.code})`, judge: { violations: [] }, devices: [] }; }
      const j = await crew("judge", "--rules", "judge/proxy.rules.json", "--log", log, "--json");
      let verdict;
      try { verdict = JSON.parse(j.stdout); } catch { verdict = { ok: false, violations: [], error: j.stdout.slice(0, 300) }; }
      let entries = [];
      try { entries = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch {}
      const app = entries.filter((e) => !e.host && e.method !== "CONNECT");
      const count = (r) => verdict.violations.filter((x) => x.rule.startsWith(r)).length;
      const row = {
        buggy, seed, runExit: run.code, drained: report.drained, judgeExit: j.code,
        rules: { dupSuccess: count("dupSuccess"), lostUpdate: count("lostUpdate"), lostWrite: count("lostWrite"), idle: count("idle") },
        exportJudge: [...new Set(report.judge.violations.map((x) => x.rule))],
        devices: [...new Set(app.map((e) => e.device))].sort(),
        requests: app.length, writes: app.filter((e) => e.method !== "GET").length, cut: app.filter((e) => e.cut).length,
        failedNoAnswer: app.filter((e) => e.status === 0).length, systemPassThrough: entries.length - app.length,
        upstreamMs: { p50: pct(app.map((e) => e.ms), 0.5), p95: pct(app.map((e) => e.ms), 0.95) },
        wallSeconds: report.wallSeconds, sample: verdict.violations.slice(0, 2).map((x) => x.message),
      };
      runs.push(row);
      console.log(`== ${buggy ? "BUGGY" : "CLEAN"} seed=${seed} run=${run.code} drained=${row.drained} judge=${j.code} ${JSON.stringify(row.rules)} devices=${row.devices.length} requests=${row.requests} cut=${row.cut}`);
    }
  }
  await down().catch(() => {});
  for (const r of runs) {
    must(r.devices.length === 3, `${r.buggy ? "BUGGY" : "clean"} seed ${r.seed}: all 3 devices went through the proxy (${r.devices.join(",")})`);
    if (r.buggy) must(r.rules.dupSuccess > 0 && r.rules.lostUpdate > 0, `BUGGY seed ${r.seed}: dupSuccess (${r.rules.dupSuccess}) and lostUpdate (${r.rules.lostUpdate}) both fire`);
    else must(r.judgeExit === 0 && Object.values(r.rules).every((n) => n === 0) && r.drained === true, `clean seed ${r.seed}: all 4 log rules pass (judge exit ${r.judgeExit}), outbox drained`);
  }
}

writeFileSync(join(root, "docs/measurements/proxy.json"), JSON.stringify({ date: new Date().toISOString(), overhead: oh, lifecycle, runs }, null, 2) + "\n");
const rows = runs.map((r) => `| ${r.buggy ? "BUGGY=1" : "clean"} | ${r.seed} | ${r.drained} | ${r.judgeExit} | ${r.rules.dupSuccess} / ${r.rules.lostUpdate} / ${r.rules.lostWrite} / ${r.rules.idle} | ${r.exportJudge.join(", ") || "-"} | ${r.devices.length} | ${r.requests} (${r.writes} writes, ${r.cut} cut, ${r.failedNoAnswer} no answer) | ${r.systemPassThrough} | ${r.upstreamMs.p50} / ${r.upstreamMs.p95} | ${r.wallSeconds ?? "-"} |`);
writeFileSync(join(root, "docs/measurements/proxy.md"), `# Proxy judge (T69)

\`node scripts/check-proxy.mjs\`. Raw data: \`proxy.json\`. Measured ${new Date().toISOString().slice(0, 10)}.

## Overhead per request

Same host client, ${oh.requests} sequential \`POST /upload\` (${oh.bodyBytes} B body) to the sample server, direct and through the proxy, alternating.
The proxy buffers the request and the response (it needs both hashes) and appends one JSONL line per request.

| path | p50 ms | p95 ms |
|---|---|---|
| direct | ${oh.directMs.p50} | ${oh.directMs.p95} |
| through proxy | ${oh.proxyMs.p50} | ${oh.proxyMs.p95} |
| overhead | +${oh.overheadMs.p50} | +${oh.overheadMs.p95} |

## CLI on one device (system proxy, unmodified probe app)

- \`proxy start\` -> \`settings get global http_proxy\` = \`${lifecycle.setting}\`
- logged under the serial: ${(lifecycle.logged ?? []).map((x) => `\`${x}\``).join(", ")}
- \`proxy stop\` -> \`${lifecycle.afterStop}\`; next READ goes direct: ${lifecycle.directRead}
- new clone after \`down\` -> \`${lifecycle.freshClone}\`

## Scenario through the proxy

\`crewdroid run scenarios/photo-upload.json --seed N --proxy ${PP} --lose-acks 0.1\` (3 mixed devices, the app is not told about the proxy), then
\`crewdroid judge --rules judge/proxy.rules.json --log proxy.jsonl\`. \`--lose-acks 0.1\`: one write in ten gets its answer dropped after the server
committed it (the phone sees a reset and retries) — natural runs rarely hit that window (scenario.md: no duplicate in 6 BUGGY runs).

| server | seed | drained | judge exit | dupSuccess / lostUpdate / lostWrite / idle | /export judge (same run) | devices | app requests | OS pass-through | ms p50 / p95 (request start to server answer, incl. body upload) | wall s |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

${fails.length ? `FAILED: ${fails.join("; ")}` : "All checks passed."}
`);
console.log(fails.length ? `FAIL: ${fails.length} checks failed` : "OK: proxy judge catches BUGGY (dupSuccess + lostUpdate) and passes clean, overhead measured");
process.exit(fails.length ? 1 : 0);
