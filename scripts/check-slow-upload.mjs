// T33 verify: node scripts/check-slow-upload.mjs [--base-port 5580] [--runs 3] [--out file]
// 1 device, clean sample server on a free port, `net slow`, a 2 MB photo through the probe app: CrewProbe SYNCED within 120 s
// and exactly 1 server row for the key, 3 times; then once more with a fold mid-upload (staying on slow, ADR 0006).
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";
import { startApp } from "../sample/server/app.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, runs: { type: "string", default: "3" } } });
const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const crew = (...args) => new Promise((ok, fail) => execFile(process.execPath, ["--import", "tsx", cli, ...args], { windowsHide: true }, (e, out, err) => (e ? fail(new Error(err || String(e))) : ok(out.trim()))));
const bc = (serial, action, ...extras) => adb(serial, ["shell", "am", "broadcast", "--include-stopped-packages", "-n", `${PKG}/.SampleReceiver`, "-a", `dev.crewdroid.sample.${action}`, ...extras]);
const log = async (serial) => (await adb(serial, ["logcat", "-d", "-s", "CrewProbe:I"]).catch(() => "")).split(/\r?\n/).map((l) => l.replace(/^.*?CrewProbe\s*:\s*/, "").trim()).filter(Boolean);
const grep = async (serial, re) => (await log(serial)).filter((l) => re.test(l));
async function until(what, fn, timeoutS) {
  for (let i = 0; i < timeoutS; i++) { const r = await fn(); if (r) return r; await sleep(1000); }
  throw new Error(`timeout ${timeoutS}s waiting for ${what}`);
}
const freePort = () => new Promise((ok) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

let server;
try {
  await down();
  const sport = await freePort();
  server = await startApp({ port: sport, dir: mkdtempSync(join(tmpdir(), "crewslow-")) });
  const exported = () => fetch(`http://127.0.0.1:${sport}/export`).then((r) => r.json());
  const r = await up(1, Number(v["base-port"]), ["fold5-main"]); // fold5-main so the last run can fold
  const a = r.devices[0].serial;
  await crew("net", a, "online");
  await adb(a, ["install", "-r", probeApk()], 120000);
  await adb(a, ["logcat", "-G", "16M"]); await adb(a, ["logcat", "-c"]);
  await adb(a, ["shell", "svc", "power", "stayon", "true"]);
  await adb(a, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`]);
  await until("OUTBOX", () => grep(a, /^OUTBOX \d+$/).then((x) => x.length), 60);
  await crew("net", a, "slow");
  // Switching to slow makes Android drop and re-create the cellular network; upload only once the host answers a TCP connect.
  const tn = Date.now();
  await until("host reachable after net slow", async () => (await adb(a, ["shell", `nc -w 3 10.0.2.2 ${sport} </dev/null >/dev/null 2>&1; echo rc=$?`]).catch(() => "")).includes("rc=0"), 120);
  console.log(`host reachable ${((Date.now() - tn) / 1000).toFixed(1)} s after net slow`);

  const total = Number(v.runs) + 1;
  for (let i = 1; i <= total; i++) {
    const fold = i === total, id = `${a}-slow${i}`;
    const t0 = Date.now();
    await bc(a, "PHOTO", "--es", "id", id, "--ei", "size", String(2097152), "--es", "server", `http://10.0.2.2:${sport}`);
    const key = (await until(`SAVED ${id}`, async () => (await grep(a, new RegExp(`^SAVED ${id} `)))[0], 60)).split(" ")[2];
    if (fold) { await sleep(5000); await crew("fold", a); }
    let synced = null;
    try { synced = await until(`SYNCED ${id}`, () => grep(a, new RegExp(`^SYNCED ${id} `)).then((x) => x.length), 120); } catch {}
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    await sleep(2000);
    console.log(`tc after run ${i}: ${(await adb(a, ["shell", "tc -s qdisc show dev eth0"])).replace(/s+/g, " ")}`);
    const rows = (await exported()).uploads.filter((u) => u.key === key).length;
    const lines = (await grep(a, new RegExp(` ${id} `))).join(" | ");
    claim(!!synced && rows === 1, `run ${i}${fold ? " (fold mid-upload)" : ""}: 2 MB on slow, SYNCED ${synced ? "yes" : "no"} after ${secs} s, ${rows} server row(s); app lines: ${lines}`);
    if (fold) await crew("unfold", a).catch(() => {});
  }
} catch (e) {
  claim(false, `error: ${e.message}`);
} finally {
  server?.close();
  await down().catch(() => {});
  console.log(errs.length ? `FAIL: ${errs.length} claim(s)` : "OK: 2 MB upload finishes on net slow");
  process.exit(errs.length ? 1 : 0);
}
