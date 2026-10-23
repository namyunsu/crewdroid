// T09 verify: node scripts/check-offline.mjs [--base-port 5580] [--server-port 5599] [--out file]
// Boots 2 mixed emulators and drives the sample app's outbox only through adb broadcasts (see probe-app Sample.kt):
// offline save -> restart offline -> online sync, an upload cut mid-transfer, a lost ack (deduped by the idempotency key),
// and two devices editing one record while one is offline (exactly one CONFLICT line). Exit 0 only if every claim holds.
import { execFile } from "node:child_process";
import { createServer, request } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";
import { startApp } from "../sample/server/app.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, "server-port": { type: "string", default: "5599" }, out: { type: "string" } } });
const sport = Number(v["server-port"]), pport = sport - 2;
const URL_ = `http://10.0.2.2:${sport}`, PROXY = `http://10.0.2.2:${pport}`;
const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const errs = [];
const claim = (ok, text) => { say(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const net = (serial, state) => new Promise((ok, fail) => execFile(process.execPath, [cli, "net", serial, state], { windowsHide: true }, (e, out, err) => (e ? fail(new Error(err || String(e))) : ok(out))));
const bc = (serial, action, ...extras) => adb(serial, ["shell", "am", "broadcast", "--include-stopped-packages", "-n", `${PKG}/.SampleReceiver`, "-a", `dev.crewdroid.sample.${action}`, ...extras]);
const launch = (serial) => adb(serial, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`]);
// CrewProbe lines without the logcat prefix, e.g. "SAVED emulator-5580-p1 <uuid>"
const log = async (serial) => (await adb(serial, ["logcat", "-d", "-s", "CrewProbe:I"]).catch(() => "")).split(/\r?\n/).map((l) => l.replace(/^.*?CrewProbe\s*:\s*/, "").trim()).filter(Boolean);
const grep = async (serial, re) => (await log(serial)).filter((l) => re.test(l));
async function until(what, fn, timeoutS = 90) {
  for (let i = 0; i < timeoutS; i++) { const r = await fn(); if (r) return r; await sleep(1000); }
  throw new Error(`timeout ${timeoutS}s waiting for ${what}`);
}
const exported = () => fetch(`http://127.0.0.1:${sport}/export`).then((r) => r.json());
const keyOf = async (serial, id) => (await until(`SAVED ${id}`, async () => (await grep(serial, new RegExp(`^SAVED ${id} `)))[0])).split(" ")[2];

// Proxy in front of the server: when armed, the next /upload reaches the server (row stored) but its response is dropped.
let armed = false; const dropped = [];
const proxy = createServer((req, res) => {
  const drop = armed && req.url === "/upload";
  if (drop) armed = false;
  const fwd = request({ host: "127.0.0.1", port: sport, method: req.method, path: req.url, headers: req.headers }, (r) => {
    if (!drop) { res.writeHead(r.statusCode, r.headers); r.pipe(res); return; }
    dropped.push(req.headers["idempotency-key"]);
    r.resume(); r.on("end", () => req.socket.destroy());
  });
  fwd.on("error", () => res.destroy());
  req.pipe(fwd);
});

let server;
try {
  await down();
  server = await startApp({ port: sport, dir: mkdtempSync(join(tmpdir(), "crewoffline-")) });
  await new Promise((ok) => proxy.listen(pport, "0.0.0.0", ok));
  const r = await up(2, Number(v["base-port"]));
  const [a, b] = r.devices;
  const s0 = a.serial, s1 = b.serial;
  claim(a.profile !== b.profile && a.api !== b.api, `mixed devices: ${r.devices.map((d) => `${d.serial}=${d.profile}/API${d.api}`).join(", ")}`);
  for (const s of [s0, s1]) {
    await net(s, "online");
    await adb(s, ["install", "-r", probeApk()], 120000); // snapshot may hold an older probe build
    await adb(s, ["logcat", "-G", "16M"]); await adb(s, ["logcat", "-c"]);
    await adb(s, ["shell", "svc", "power", "stayon", "true"]);
    await launch(s);
    await until(`${s} OUTBOX`, () => grep(s, /^OUTBOX \d+$/).then((x) => x.length));
  }

  // 1) offline save (airplane on one, nodata on the other)
  await net(s0, "airplane"); await net(s1, "nodata"); await sleep(3000);
  const want = new Map(); // key -> id, every upload the server must end up with exactly once
  for (const s of [s0, s1]) for (const p of ["p1", "p2"]) await bc(s, "PHOTO", "--es", "id", `${s}-${p}`, "--ei", "size", "65536", "--es", "server", URL_);
  for (const s of [s0, s1]) for (const p of ["p1", "p2"]) want.set(await keyOf(s, `${s}-${p}`), `${s}-${p}`);
  for (const s of [s0, s1]) await until(`${s} RETRY while offline`, () => grep(s, new RegExp(`^RETRY ${s}-p1 `)).then((x) => x.length));
  await sleep(5000);
  claim((await exported()).uploads.length === 0, `offline: 4 photos saved locally (${[...want.values()].join(",")}), server has 0 uploads, each device retried`);

  // 2) restart while offline: force-stop + relaunch keeps the outbox
  for (const s of [s0, s1]) {
    const n = (await grep(s, /^OUTBOX /)).length;
    await adb(s, ["shell", "am", "force-stop", PKG]); await launch(s);
    const o = await until(`${s} OUTBOX after restart`, async () => { const x = await grep(s, /^OUTBOX /); return x.length > n && x[x.length - 1]; });
    claim(o === "OUTBOX 2", `${s} restarted offline, outbox survived: '${o}'`);
  }
  claim((await exported()).uploads.length === 0, "still offline after restart: server has 0 uploads");

  // 3) back online -> exactly the saved rows
  for (const s of [s0, s1]) await net(s, "online");
  await until("4 uploads on server", async () => (await exported()).uploads.length >= 4);
  await sleep(3000);
  let ex = await exported();
  const keys = ex.uploads.map((u) => u.key);
  claim(keys.length === 4 && [...want.keys()].every((k) => keys.includes(k)), `online: server has exactly the 4 saved uploads (${keys.length} rows)`);

  // 4) upload cut mid-transfer (slow, then nodata after 3 s) is retried once the network returns
  await net(s0, "slow"); await sleep(1000);
  await bc(s0, "PHOTO", "--es", "id", `${s0}-p3`, "--ei", "size", "1048576", "--es", "server", URL_);
  const k3 = await keyOf(s0, `${s0}-p3`); want.set(k3, `${s0}-p3`);
  await sleep(3000); await net(s0, "nodata");
  const cut = await until("RETRY p3", async () => (await grep(s0, new RegExp(`^RETRY ${s0}-p3 `)))[0], 60);
  claim((await exported()).uploads.every((u) => u.key !== k3), `cut mid-transfer: '${cut}', server kept no partial row`);
  await net(s0, "online");
  await until("SYNCED p3", () => grep(s0, new RegExp(`^SYNCED ${s0}-p3 `)).then((x) => x.length), 120);
  claim((await exported()).uploads.filter((u) => u.key === k3).length === 1, `cut upload retried after reconnect: 1 row for key ${k3}`);

  // 5) lost ack: server stores the upload, the response is dropped, the retry reuses the key -> still one row
  armed = true;
  await bc(s1, "PHOTO", "--es", "id", `${s1}-p4`, "--ei", "size", "65536", "--es", "server", PROXY);
  const k4 = await keyOf(s1, `${s1}-p4`); want.set(k4, `${s1}-p4`);
  await until("SYNCED p4", () => grep(s1, new RegExp(`^SYNCED ${s1}-p4 `)).then((x) => x.length));
  ex = await exported();
  const acks4 = ex.acks.filter((x) => x.key === k4);
  const retry4 = await grep(s1, new RegExp(`^RETRY ${s1}-p4 `));
  claim(dropped.includes(k4) && retry4.length >= 1 && ex.uploads.filter((u) => u.key === k4).length === 1 && acks4.length === 2 && acks4[0].id === acks4[1].id,
    `lost ack: response dropped, app retried ('${retry4[0]}'), server deduped by key: 1 row, ${acks4.length} acks with the same id`);

  // 6) same record edited on both devices while s1 is offline -> one CONFLICT on s1
  const seed = await fetch(`http://127.0.0.1:${sport}/records/r1`, { method: "PUT", body: JSON.stringify({ version: 0, value: "seed", clientId: "host" }) }).then((x) => x.json());
  for (const s of [s0, s1]) {
    const n = (await grep(s, /^READ ok/)).length;
    await bc(s, "READ", "--es", "server", URL_);
    await until(`${s} READ`, async () => (await grep(s, /^READ ok/)).length > n);
  }
  await net(s1, "nodata"); await sleep(3000);
  await bc(s1, "EDIT", "--es", "id", "r1", "--es", "value", "from-s1", "--es", "server", URL_);
  await until("s1 EDIT retried offline", () => grep(s1, /^RETRY r1 /).then((x) => x.length));
  await bc(s0, "EDIT", "--es", "id", "r1", "--es", "value", "from-s0", "--es", "server", URL_);
  await until("s0 EDIT synced", () => grep(s0, /^SYNCED r1 /).then((x) => x.length));
  await net(s1, "online");
  await until("CONFLICT on s1", () => grep(s1, /^CONFLICT r1\b/).then((x) => x.length));
  await sleep(5000);
  const conflicts = [...(await grep(s0, /^CONFLICT /)), ...(await grep(s1, /^CONFLICT /))];
  ex = await exported();
  const r1 = ex.records.find((x) => x.id === "r1");
  claim(conflicts.length === 1 && /^CONFLICT r1 /.test(conflicts[0]), `concurrent edit: exactly one CONFLICT line: '${conflicts.join(" | ")}' (seed v${seed.version})`);
  claim(r1?.version === 2 && r1.value === "from-s0" && ex.writes.filter((w) => w.id === "r1").length === 2, `server kept the online edit: r1 v${r1?.version} '${r1?.value}', ${ex.writes.filter((w) => w.id === "r1").length} writes (seed + s0)`);

  // final: every saved upload exactly once, nothing else
  const fk = ex.uploads.map((u) => u.key);
  claim(fk.length === want.size && new Set(fk).size === fk.length && [...want.keys()].every((k) => fk.includes(k)), `final: server has exactly the ${want.size} expected uploads, no duplicates (${fk.length} rows)`);
  for (const s of [s0, s1]) say(`--- ${s} CrewProbe log\n${(await log(s)).join("\n")}`);
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  proxy.close(); server?.close();
  await down().catch(() => {});
  if (v.out) writeFileSync(v.out, lines.join("\n") + "\n");
  say(errs.length ? `FAIL: ${errs.length} claim(s)` : "OK: offline outbox claims hold");
  process.exit(errs.length ? 1 : 0);
}
