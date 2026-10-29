// T19 verify: node scripts/check-fold.mjs [--base-port 5580] [--server-port 5599]
// up fold5-main + flip6-cover; `crewdroid unfold|fold` each; the sample app logs `CONFIG <w>x<h>` for both screens and
// screencap follows; a photo upload started (slow network) before a fold completes exactly once on the server; down.
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb, assertSerial } from "../src/adb.ts";
import { loadProfiles } from "../src/profiles.ts";
import { adbPath } from "../src/sdk.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";
import { down, up } from "../src/up.ts";
import { startApp } from "../sample/server/app.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, "server-port": { type: "string", default: "5599" } } });
const sport = Number(v["server-port"]);
const URL_ = `http://10.0.2.2:${sport}`;
const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const crew = (...args) => new Promise((ok, fail) => execFile(process.execPath, ["--import", "tsx", cli, ...args], { windowsHide: true }, (e, out, err) => (e ? fail(new Error(err || String(e))) : ok(out.trim()))));
const bc = (serial, action, ...extras) => adb(serial, ["shell", "am", "broadcast", "--include-stopped-packages", "-n", `${PKG}/.SampleReceiver`, "-a", `dev.crewdroid.sample.${action}`, ...extras]);
const log = async (serial) => (await adb(serial, ["logcat", "-d", "-s", "CrewProbe:I"]).catch(() => "")).split(/\r?\n/).map((l) => l.replace(/^.*?CrewProbe\s*:\s*/, "").trim()).filter(Boolean);
const grep = async (serial, re) => (await log(serial)).filter((l) => re.test(l));
async function until(what, fn, timeoutS = 60) {
  for (let i = 0; i < timeoutS; i++) { const r = await fn(); if (r) return r; await sleep(1000); }
  throw new Error(`timeout ${timeoutS}s waiting for ${what}`);
}
const pngSize = (serial) => { const p = spawnSync(adbPath(), ["-s", assertSerial(serial), "exec-out", "screencap", "-p"], { maxBuffer: 2 ** 30 }).stdout; return `${p.readUInt32BE(16)}x${p.readUInt32BE(20)}`; };
const exported = () => fetch(`http://127.0.0.1:${sport}/export`).then((r) => r.json());
const pair = (name) => loadProfiles().find((p) => p.name === name).fold;
const px = (s) => `${s.width}x${s.height}`;

let server;
try {
  await down();
  server = await startApp({ port: sport, dir: mkdtempSync(join(tmpdir(), "crewfold-")) });
  const r = await up(2, Number(v["base-port"]), ["fold5-main", "flip6-cover"]);
  for (const d of r.devices) {
    await crew("net", d.serial, "online");
    await adb(d.serial, ["install", "-r", probeApk()], 120000); // snapshot may hold an older probe build
    await adb(d.serial, ["logcat", "-G", "16M"]); await adb(d.serial, ["logcat", "-c"]);
    await adb(d.serial, ["shell", "svc", "power", "stayon", "true"]);
    await adb(d.serial, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`]);
    await until(`${d.serial} OUTBOX`, () => grep(d.serial, /^OUTBOX \d+$/).then((x) => x.length));
  }

  // 1) each device: switch to the other screen and back; CONFIG line + screencap size for both screens
  for (const d of r.devices) {
    const f = pair(d.profile);
    const order = d.profile.endsWith("-cover") ? ["unfold", "fold"] : ["fold", "unfold"];
    for (const cmd of order) {
      const want = px(cmd === "fold" ? f.cover : f.main);
      const n = (await grep(d.serial, /^CONFIG /)).length;
      const out = await crew(cmd, d.serial);
      const cfg = await until(`${d.serial} CONFIG after ${cmd}`, async () => { const x = await grep(d.serial, /^CONFIG /); return x.length > n && x.at(-1); }, 30);
      await sleep(1500);
      const png = pngSize(d.serial);
      claim(cfg === `CONFIG ${want}` && png === want, `${d.serial} ${d.profile} API ${d.api} ${cmd}: '${out}', app '${cfg}', screencap ${png} (want ${want})`);
    }
  }

  // 2) fold during an upload: slow network, 1 MB photo (~9 s), fold 3 s after SAVED, then back online; exactly one row on the server.
  // NOTE: left on slow, a 2 MB upload showed no SYNCED within 120 s (cause not checked, ADR 0006).
  const a = r.devices[0].serial, id = `${a}-fold`;
  await crew("net", a, "slow"); await sleep(1000);
  await bc(a, "PHOTO", "--es", "id", id, "--ei", "size", String(1048576), "--es", "server", URL_);
  const key = (await until(`SAVED ${id}`, async () => (await grep(a, new RegExp(`^SAVED ${id} `)))[0])).split(" ")[2];
  await sleep(3000);
  const before = (await exported()).uploads.filter((u) => u.key === key).length;
  const synced0 = (await grep(a, new RegExp(`^SYNCED ${id} `))).length;
  await crew("fold", a);
  const cfg = await until(`${a} CONFIG during upload`, async () => (await grep(a, /^CONFIG /)).at(-1) === `CONFIG ${px(pair(r.devices[0].profile).cover)}`, 30);
  claim(before === 0 && synced0 === 0 && cfg, `fold while uploading: server had ${before} rows and app no SYNCED when folded`);
  await crew("net", a, "online");
  await until(`SYNCED ${id}`, () => grep(a, new RegExp(`^SYNCED ${id} `)).then((x) => x.length), 120)
    .catch(async (e) => { throw new Error(`${e.message}; app lines: ${(await grep(a, new RegExp(` ${id} `))).join(" | ")}`); });
  await sleep(3000);
  const rows = (await exported()).uploads.filter((u) => u.key === key).length;
  const lines = await grep(a, new RegExp(`^(SYNCED|RETRY|DROPPED) ${id} `));
  claim(rows === 1 && lines.filter((l) => l.startsWith("SYNCED")).length === 1, `upload across fold completed once: ${rows} row for key ${key}; app lines: ${lines.join(" | ")}`);
} catch (e) {
  claim(false, `error: ${e.message}`);
} finally {
  server?.close();
  await down().catch(() => {});
  console.log(errs.length ? `FAIL: ${errs.length} claim(s)` : "OK: fold/unfold claims hold");
  process.exit(errs.length ? 1 : 0);
}
