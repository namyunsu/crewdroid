// T63 verify: node scripts/check-wifi.mjs [--api 36] [--count N] [--server-port 5599] [--out file]
// T74: --count N (> 1) boots N mixed devices (`up --count N`) and only checks that `net <serial> wifi` gets Wi-Fi on every
// one of them (readback + probe); ADR 0009.
// Default (1 device): boots 1 emulator and proves the Wi-Fi / cellular / handover / metered claims with what the probe app sees
// (ConnectivityManager: "CrewProbe TRANSPORT wifi|cellular|none metered=<bool>") and a 2 MB upload to the sample server.
// Exit 0 only if every claim holds; always kills its emulator (down) at the end.
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { down, up, upDefaults } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";
import { startApp } from "../sample/server/app.ts";

const { values: v } = parseArgs({ options: { api: { type: "string" }, count: { type: "string", default: "1" }, "server-port": { type: "string", default: "5599" }, out: { type: "string" } } });
const sport = Number(v["server-port"]), count = Number(v.count), SIZE = 2 * 1048576;
const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const lines = [], errs = [];
const say = (s) => { lines.push(s); console.log(s); };
const claim = (ok, text) => { say(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const net = (serial, ...args) => new Promise((ok, fail) => execFile(process.execPath, [cli, "net", serial, ...args, "--json"], { windowsHide: true }, (e, out, err) => (e ? fail(new Error(err || String(e))) : ok(JSON.parse(out)))));
const start = (serial, extras) => adb(serial, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`, ...extras]);
async function probeLine(serial, re, waitS) {
  for (let i = 0; i < waitS; i++) {
    const line = (await adb(serial, ["logcat", "-d", "-s", "CrewProbe:I"]).catch(() => "")).split(/\r?\n/).find((l) => re.test(l));
    if (line) return line.slice(line.search(re)).trim();
    await sleep(1000);
  }
  return "(no result line)";
}
async function seen(serial) {
  await adb(serial, ["shell", "am", "force-stop", PKG]); await sleep(2000); // ADR 0005: stop, 2 s, start
  await adb(serial, ["logcat", "-c"]);
  await start(serial, ["--es", "check", "transport"]);
  return probeLine(serial, /TRANSPORT /, 20);
}

// T63: every single-device claim on one device
async function single(s) {
  const w = await net(s, "wifi");
  const tw = await seen(s);
  claim(w.transport.default === "wifi" && tw === "TRANSPORT wifi metered=false", `net wifi: readback ${JSON.stringify(w.transport)}, probe "${tw}"`);

  const c = await net(s, "cellular");
  const tc = await seen(s);
  claim(c.transport.default === "cellular" && /^TRANSPORT cellular /.test(tc), `net cellular: readback ${JSON.stringify(c.transport)}, probe "${tc}"`);

  const b = await net(s, "both");
  claim(b.transport.default === "wifi" && b.transport.connected.length === 2, `net both: readback ${JSON.stringify(b.transport)}`);

  await net(s, "wifi");
  const m = await net(s, "metered", "on");
  const tm = await seen(s);
  claim(m.transport.metered && tm === "TRANSPORT wifi metered=true", `metered on: readback ${JSON.stringify(m.transport)}, probe "${tm}"`);
  const mo = await net(s, "metered", "off");
  const tmo = await seen(s);
  claim(!mo.transport.metered && tmo === "TRANSPORT wifi metered=false", `metered off: readback ${JSON.stringify(mo.transport)}, probe "${tmo}"`);

  // slow applies to the chosen link (Wi-Fi): the 2 MB upload takes > 10 s, so the handover lands mid-transfer
  const sl = await net(s, "slow");
  claim(sl.link === "wifi" && sl.transport.default === "wifi", `slow on the chosen link: link ${sl.link}, readback ${JSON.stringify(sl.transport)}`);
  const key = `handover-${Date.now()}`;
  await adb(s, ["shell", "am", "force-stop", PKG]); await sleep(2000);
  await adb(s, ["logcat", "-c"]);
  const t0 = Date.now();
  await start(s, ["--es", "check", "upload", "--es", "url", `http://10.0.2.2:${sport}/upload`, "--ei", "size", String(SIZE), "--es", "key", key, "--es", "client", s]);
  await sleep(3000);
  const h = await net(s, "handover", "--to", "cellular");
  const hs = Math.round((Date.now() - t0) / 100) / 10;
  const up1 = await probeLine(s, /UPLOAD (ok|fail)/, 240);
  const th = await seen(s);
  claim(h.transport.default === "cellular" && /^TRANSPORT cellular /.test(th), `handover --to cellular (done ${hs} s after the upload started, switch ${h.settledSeconds} s): readback ${JSON.stringify(h.transport)}, probe "${th}"`);
  const stored = (await fetch(`http://127.0.0.1:${sport}/export`).then((x) => x.json())).uploads.filter((u) => u.key === key).length;
  const ok = /^UPLOAD ok/.test(up1); // probeLine() starts at "UPLOAD"
  claim(ok ? stored === 1 : stored <= 1, `upload during handover: probe "${up1}", server stored ${stored} (ok -> exactly 1, fail -> at most 1)`);

  // back to Wi-Fi with 2 s of no link in between
  const back = await net(s, "handover", "--to", "wifi", "--during", "2000");
  const tb = await seen(s);
  claim(back.transport.default === "wifi" && tb === "TRANSPORT wifi metered=false", `handover --to wifi --during 2000: readback ${JSON.stringify(back.transport)}, probe "${tb}"`);

  const bad = await net(s, "handover", "--to", "wifi").then(() => "exit 0", (e) => `exit 1: ${e.message.trim().split("\n").pop()}`);
  claim(bad.startsWith("exit 1"), `handover to the link already active fails: ${bad}`);
  const badMs = await net(s, "handover", "--during", "abc").then(() => "exit 0", (e) => `exit 1: ${e.message.trim().split("\n").pop()}`);
  claim(badMs.startsWith("exit 1") && /--during/.test(badMs), `handover --during abc is refused: ${badMs}`);
  await net(s, "online");
}

let server;
try {
  await down();
  server = await startApp({ port: sport, dir: mkdtempSync(join(tmpdir(), "crewwifi-")) });
  if (!(count >= 1)) throw new Error(`--count must be a number >= 1 (got ${v.count})`);
  // same devices as plain `crewdroid up [--api N]` / `up --count N [--api N]`
  const d = upDefaults({ api: v.api ? Number(v.api) : undefined, count: count > 1 ? count : undefined });
  const r = await up(d.count, 5580, d.names, false, { api: d.api });
  for (const x of r.devices) say(`device ${x.serial} API ${x.api} ${x.profile}`);
  await Promise.all(r.devices.map((x) => adb(x.serial, ["install", "-r", probeApk()], 120000)));
  if (count > 1) {
    // all at once, like an agent switching every device to Wi-Fi; each must get its own address
    const ws = await Promise.all(r.devices.map((x) => net(x.serial, "wifi").catch((e) => ({ error: e.message.trim().split("\n").pop() }))));
    for (const [i, x] of r.devices.entries()) {
      const tw = ws[i].error ? "(not checked)" : await seen(x.serial);
      claim(ws[i].transport?.default === "wifi" && tw === "TRANSPORT wifi metered=false", `${x.serial} API ${x.api} net wifi: ${ws[i].error ?? `readback ${JSON.stringify(ws[i].transport)}`}, probe "${tw}"`);
    }
  } else await single(r.devices[0].serial);
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  server?.close();
  await down().catch(() => {});
  if (v.out) writeFileSync(v.out, lines.join("\n") + "\n");
  say(errs.length ? `FAIL: ${errs.length} claim(s)` : "OK: wifi, cellular, handover and metered claims hold");
  process.exit(errs.length ? 1 : 0);
}
