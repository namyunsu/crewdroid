// T05 verify: node scripts/check-net.mjs --count 2 [--base-port 5580] [--server-port 5599] [--out file]
// Boots N emulators, then proves each net state with the probe app's 1MB upload to the sample server (10.0.2.2).
// Exit 0 only if every claim holds; always kills its emulators (down) at the end.
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { flakySchedule } from "../src/net.ts";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";
import { startApp } from "../sample/server/app.ts";

const { values: v } = parseArgs({ options: { count: { type: "string", default: "2" }, "base-port": { type: "string", default: "5580" }, "server-port": { type: "string", default: "5599" }, out: { type: "string" } } });
const SIZE = 1048576, sport = Number(v["server-port"]);
const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const errs = [];
const claim = (ok, text) => { say(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const net = (serial, state, ...x) => new Promise((ok, fail) => execFile(process.execPath, [cli, "net", serial, state, ...x], { windowsHide: true }, (e, out, err) => (e ? fail(new Error(err || String(e))) : ok(out))));

let n = 0;
// One probe upload; resolves { ok, ms, line }. `between` runs right after the start (for mid-transfer interrupts).
async function upload(serial, key = `k${Date.now()}-${n++}`, between, waitS = 240) {
  await adb(serial, ["shell", "am", "force-stop", PKG]);
  await adb(serial, ["logcat", "-c"]);
  await adb(serial, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`, "--es", "check", "upload", "--es", "url", `http://10.0.2.2:${sport}/upload`, "--ei", "size", String(SIZE), "--es", "key", key, "--es", "client", serial]);
  await between?.();
  for (let i = 0; i < waitS; i++) {
    const log = await adb(serial, ["logcat", "-d", "-s", "CrewProbe:I"]).catch(() => "");
    const line = log.split(/\r?\n/).find((l) => /UPLOAD (ok|fail)/.test(l));
    if (line) return { ok: / UPLOAD ok/.test(line), ms: Number(line.match(/ms=(\d+)/)?.[1]), key, line: line.slice(line.indexOf("UPLOAD")).trim() };
    await sleep(1000);
  }
  return { ok: false, ms: NaN, key, line: "(no result line)" };
}
const exported = () => fetch(`http://127.0.0.1:${sport}/export`).then((r) => r.json());

let server;
try {
  await down();
  server = await startApp({ port: sport, dir: mkdtempSync(join(tmpdir(), "crewnet-")) });
  const r = await up(Number(v.count), Number(v["base-port"]));
  const serials = r.devices.map((d) => d.serial);
  const s0 = serials[0];
  for (const s of serials) { await net(s, "online"); await adb(s, ["install", "-r", probeApk()], 120000); } // snapshot may hold an older probe build

  await upload(s0); // warm-up (JIT, DNS-less but first TLS-free connect)
  const base = await upload(s0);
  claim(base.ok, `online baseline ok in ${base.ms} ms (${base.line})`);

  for (const st of ["airplane", "nodata"]) {
    await net(s0, st);
    await sleep(3000);
    const u = await upload(s0, undefined, undefined, 60);
    claim(!u.ok, `${st}: upload fails (${u.line})`);
    await net(s0, "online"); await sleep(3000);
    const back = await upload(s0);
    claim(back.ok, `online after ${st}: upload ok in ${back.ms} ms`);
  }

  await net(s0, "slow"); await sleep(1000);
  const slow = await upload(s0);
  claim(slow.ok && slow.ms >= 5 * base.ms, `slow: upload ${slow.ms} ms >= 5 x online ${base.ms} ms = ${5 * base.ms} (${slow.line})`);

  // mid-transfer interrupt: slow upload, then nodata after 3 s; server must not keep it
  await net(s0, "slow"); await sleep(1000);
  const before = (await exported()).uploads.length;
  const key = `interrupt-${Date.now()}`;
  const cut = await upload(s0, key, async () => { await sleep(3000); await net(s0, "nodata"); }, 90);
  claim(!cut.ok && /UPLOAD fail/.test(cut.line), `interrupted mid-transfer: ${cut.line}`);
  const ex = await exported();
  claim(ex.uploads.length === before && !ex.uploads.some((u) => u.key === key) && !ex.acks.some((a) => a.key === key), `server kept no partial upload (uploads ${before} -> ${ex.uploads.length})`);
  await net(s0, "online"); await sleep(3000);

  // flaky on every device with the SAME seed: schedules must still differ per device, each device sees fail then success
  if (serials.length > 1) {
    const sc = serials.map((s) => JSON.stringify(flakySchedule(s, 7)));
    claim(new Set(sc).size === serials.length, `flaky schedules differ per device: ${serials.map((s, i) => `${s}=${flakySchedule(s, 7, 3).map((p) => (p.on ? "on" : "off") + p.ms).join(",")}`).join(" | ")}`);
  }
  for (const s of serials) await net(s, "flaky", "--seed", "7");
  await Promise.all(serials.map(async (s) => {
    const seq = [];
    for (let i = 0; i < 14; i++) {
      const u = await upload(s, undefined, undefined, 40);
      seq.push(u.ok ? "ok" : "fail");
      if (seq.includes("fail") && u.ok) break;
      await sleep(1000);
    }
    const f = seq.indexOf("fail");
    claim(f >= 0 && seq.indexOf("ok", f) > f, `flaky ${s}: attempts ${seq.join(",")} (a fail, then a later retry succeeded)`);
  }));
  for (const s of serials) await net(s, "online");
  await sleep(3000);
  const fin = await upload(s0);
  claim(fin.ok, `online after flaky: upload ok in ${fin.ms} ms`);
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  server?.close();
  await down().catch(() => {});
  if (v.out) writeFileSync(v.out, lines.join("\n") + "\n");
  say(errs.length ? `FAIL: ${errs.length} claim(s)` : "OK: all net claims hold");
  process.exit(errs.length ? 1 : 0);
}
