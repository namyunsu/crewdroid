// T21 verify: node scripts/check-app.mjs [--base-port 5580] [--idle-seconds 30] [--out file]
// Boots 2 mixed devices (API 34 s24ultra + API 36 flip7-main); on each: every `crewdroid app` command, read back by separate adb calls and by
// the probe app's logcat lines (LINK, TRIM). Replaces the T21 row of docs/measurements/features.md. Always downs its emulators.
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { procs } from "../src/measure.ts";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, "idle-seconds": { type: "string", default: "30" }, out: { type: "string" } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const errs = [];
const claim = (ok, text) => { say(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
// one CLI call -> { code, json, err }; typed as a user would: app <serial> <pkg> <what> [args]
const crew = (...args) => new Promise((ok) => execFile(process.execPath, ["--import", "tsx", cli, "app", ...args, "--json"], { cwd: root, windowsHide: true, maxBuffer: 64 << 20 }, (e, out, err) => {
  let json = null;
  try { json = JSON.parse(out || err); } catch { json = null; }
  ok({ code: e ? e.code ?? 1 : 0, json, err: String(err).trim().slice(0, 300) });
}));
const sh = (s, cmd) => adb(s, ["shell", cmd]);
const outbox = async (s) => Number((await sh(s, `run-as ${PKG} sh -c 'ls files/outbox 2>/dev/null | wc -l'`)).trim());
// fresh app process that logs one line, then the logcat line matching re (null if none within 15 s)
async function logLine(s, startArgs, re) {
  await adb(s, ["logcat", "-c"]);
  await sh(s, `am force-stop ${PKG}`);
  await sleep(2000); // API 31 relaunch black screen (ADR 0005): force-stop, wait, start
  await startArgs();
  for (let i = 0; i < 15; i++) {
    const m = (await adb(s, ["logcat", "-d", "-s", "CrewProbe:I"]).catch(() => "")).match(re);
    if (m) return m;
    await sleep(1000);
  }
  return null;
}
const link = (s, uri) => logLine(s, () => sh(s, `am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d '${uri}' 2>&1`), new RegExp(`LINK ${uri.replace(/[.?]/g, "\\$&")}\\s*$`, "m"));
// a queued photo that cannot upload (port 1): data in the app's files/outbox
async function queue(s, id) {
  await sh(s, `am start -n ${PKG}/.ProbeActivity`); // plain launch = sample screen, starts the outbox
  await sleep(1500);
  await sh(s, `am broadcast --include-stopped-packages -n ${PKG}/.SampleReceiver -a dev.crewdroid.sample.PHOTO --es id ${id} --ei size 2000 --es server http://10.0.2.2:1`);
  for (let i = 0; i < 10 && (await outbox(s)) < 2; i++) await sleep(500); // .json + .bin
}

async function idle(ports, sec) {
  const re = (p) => `-port ${p}([ "]|$)`;
  const a = await Promise.all(ports.map((p) => procs(re(p)))), t0 = Date.now();
  await sleep(sec * 1000);
  const b = await Promise.all(ports.map((p) => procs(re(p))));
  const wall = (Date.now() - t0) / 1000, sum = (xs, k) => xs.reduce((n, x) => n + x[k], 0);
  return { ramMB: Math.round(sum(b, "ws") / 1048576), cpuPercent: Math.round(((sum(b, "cpu") - sum(a, "cpu")) / wall) * 1000) / 10 };
}
const availKB = async (s) => Number((await sh(s, "df -k /data")).trim().split(/\r?\n/).at(-1).trim().split(/\s+/)[3]);

try {
  await down();
  const r = await up(2, Number(v["base-port"]), ["s24ultra", "flip7-main"]);
  const ports = r.devices.map((x) => x.port), mix = r.devices.map((x) => `${x.profile}@${x.api}`).join(", ");
  for (const x of r.devices) {
    await adb(x.serial, ["install", "-r", "-g", probeApk()], 120000);
    await sh(x.serial, `am force-stop ${PKG}`);
  }
  await sleep(60000); // CPU is still high right after boot
  const before = await idle(ports, Number(v["idle-seconds"]));

  // invalid input: exit 1 before any adb call (the serial does not exist)
  for (const [args, re] of [[["emulator-59999", PKG, "perm", "grant", "bogus"], /bad permission/], [["emulator-59999", PKG, "pressure", "standby", "nap"], /bucket/], [["emulator-59999", PKG, "fill-storage", "lots"], /GB/], [["5580", PKG, "clear"], /emulator-<port>/]]) {
    const e = await crew(...args);
    claim(e.code === 1 && re.test(e.json?.error ?? ""), `app ${args.join(" ")}: exit ${e.code} ${e.json?.error}`);
  }

  for (const d of r.devices) {
    const s = d.serial, tag = `${s} ${d.profile} API ${d.api}`;
    const ok = async (args, check) => {
      const c = await crew(s, PKG, ...args);
      claim(c.code === 0 && check(c.json), `${tag} app ${args.join(" ")}: ${c.code === 0 ? JSON.stringify(c.json).slice(0, 300) : c.json?.error ?? c.err}`);
      return c.json;
    };
    const fails = async (args, re) => {
      const c = await crew(s, PKG, ...args);
      claim(c.code === 1 && re.test(c.json?.error ?? ""), `${tag} app ${args.join(" ")} fails: exit ${c.code} ${c.json?.error}`);
    };
    const granted = async (p) => new RegExp(`${p}: granted=true`).test(await sh(s, `dumpsys package ${PKG}`));

    // permissions: grant -> show granted=true -> revoke -> false, checked against dumpsys by a separate call
    await ok(["perm", "revoke", "CAMERA"], (j) => j.permissions[0].granted === false);
    claim(!(await granted("android.permission.CAMERA")), `${tag} dumpsys: CAMERA granted=false`);
    await ok(["perm", "show", "CAMERA"], (j) => j.permissions[0].granted === false);
    await ok(["perm", "grant", "android.permission.CAMERA"], (j) => j.permissions[0].granted === true);
    await ok(["perm", "show"], (j) => j.permissions.find((p) => p.name === "android.permission.CAMERA")?.granted === true && j.permissions.length >= 3);
    claim(await granted("android.permission.CAMERA"), `${tag} dumpsys: CAMERA granted=true`);
    await fails(["perm", "grant", "READ_CONTACTS"], /not requested/);

    // deep link and App Link
    await fails(["open", "foo://nobody/z"], /No Activity found/);
    claim(!!(await link(s, "crewdroid://probe/x")), `${tag} open crewdroid://probe/x -> probe logs LINK`);
    await sh(s, `am force-stop ${PKG}`);
    await ok(["open", "crewdroid://probe/pkg", "--pkg"], (j) => j.started === true);
    await ok(["links", "reset"], (j) => j.domains["probe.crewdroid.example"] === "none");
    await ok(["links", "force", "probe.crewdroid.example"], (j) => j.state === "approved");
    claim(!!(await link(s, "https://probe.crewdroid.example/y")), `${tag} open https://probe.crewdroid.example/y after links force -> probe logs LINK`);
    await ok(["links", "show"], (j) => j.domains["probe.crewdroid.example"] === "approved");
    claim(/probe\.crewdroid\.example: approved/.test(await sh(s, `pm get-app-links ${PKG}`)), `${tag} pm get-app-links says approved`);
    await ok(["links", "reset"], (j) => j.domains["probe.crewdroid.example"] === "none");
    await fails(["links", "force", "not.declared.example"], /not declared/);

    // data: clear empties the outbox; backup + clear + restore brings it back
    await queue(s, "chk-clear");
    claim((await outbox(s)) >= 2, `${tag} outbox has files before clear`);
    await ok(["clear"], (j) => j.filesLeft === 0);
    claim((await outbox(s)) === 0, `${tag} outbox dir empty after clear (run-as ls)`);
    await queue(s, "chk-backup");
    const n = await outbox(s);
    await ok(["backup"], (j) => j.sets.length >= 1);
    await ok(["clear"], (j) => j.filesLeft === 0);
    claim((await outbox(s)) === 0, `${tag} outbox empty before restore`);
    await ok(["restore"], (j) => j.restored === true);
    const m = await outbox(s);
    claim(m === n, `${tag} outbox has ${n} files again after restore (got ${m})`);
    await sh(s, `am force-stop ${PKG}`);

    // pressure
    await ok(["pressure", "doze"], (j) => j.deep === "IDLE");
    claim((await sh(s, "dumpsys deviceidle get deep")).trim() === "IDLE", `${tag} dumpsys deviceidle get deep = IDLE`);
    await ok(["pressure", "standby", "rare"], (j) => j.code === 40);
    claim((await sh(s, `am get-standby-bucket ${PKG}`)).trim() === "40", `${tag} am get-standby-bucket = 40`);
    await ok(["pressure", "standby", "restricted"], (j) => j.code === 45);
    await ok(["pressure", "bg-restrict"], (j) => j.runAnyInBackground === "ignore");
    claim(/ignore/.test(await sh(s, `appops get ${PKG} RUN_ANY_IN_BACKGROUND`)), `${tag} appops RUN_ANY_IN_BACKGROUND ignore`);
    await ok(["pressure", "battery-saver"], (j) => j.lowPower === "1");
    claim((await sh(s, "settings get global low_power")).trim() === "1", `${tag} settings low_power = 1`);
    await ok(["pressure", "reset"], (j) => j.deep === "ACTIVE" && j.bucket === 10 && j.runAnyInBackground !== "ignore" && j.lowPower === "0");
    claim((await sh(s, "dumpsys deviceidle get deep")).trim() === "ACTIVE" && (await sh(s, "settings get global low_power")).trim() === "0", `${tag} reset undone on the device`);
    await fails(["pressure", "trim", "COMPLETE"], /Unknown process/); // app stopped
    const tr = await logLine(s, async () => { await sh(s, `am start -n ${PKG}/.ProbeActivity`); await sleep(2500); await crew(s, PKG, "pressure", "trim", "RUNNING_CRITICAL"); }, /TRIM 15\s*$/m);
    claim(!!tr, `${tag} pressure trim RUNNING_CRITICAL -> probe onTrimMemory logs TRIM 15`);
    await sh(s, `am force-stop ${PKG}`);

    // storage
    const a0 = await availKB(s);
    await ok(["fill-storage", "2"], (j) => j.filledMB >= 1900);
    const a1 = await availKB(s);
    claim(a0 - a1 >= 2 * 1024 * 1024 * 0.95, `${tag} df /data dropped ${((a0 - a1) / 1048576).toFixed(2)} GB (>= 1.9)`);
    await ok(["fill-storage", "free"], (j) => j.freedMB >= 1900);
    const a2 = await availKB(s);
    claim(a2 - a1 >= 2 * 1024 * 1024 * 0.95, `${tag} df /data restored by ${((a2 - a1) / 1048576).toFixed(2)} GB`);
    await fails(["fill-storage", "90"], /cannot fill/);
    claim((await availKB(s)) >= a2 - 2048, `${tag} failed fill left no partial file`);
  }

  await sleep(10000);
  const after = await idle(ports, Number(v["idle-seconds"]));
  say(`idle after: ram=${after.ramMB}MB cpu=${after.cpuPercent}%`);
  const f = join(root, "docs", "measurements", "features.md");
  const dRam = Math.round(((after.ramMB - before.ramMB) / before.ramMB) * 1000) / 10;
  const row = `| ${new Date().toISOString().slice(0, 10)} | T21 app | 2 (${mix}) | ${v["idle-seconds"]} | ${before.ramMB} -> ${after.ramMB} | ${dRam >= 0 ? "+" : ""}${dRam} % | ${before.cpuPercent} -> ${after.cpuPercent} | no daemon; after = after every app command ran (perm/open/links/clear/backup/restore/pressure/fill-storage) |`;
  // one T21 row: a rerun replaces it
  const keep = readFileSync(f, "utf8").split(/\r?\n/).filter((l) => !l.includes("| T21 app |"));
  while (keep.at(-1) === "") keep.pop();
  writeFileSync(f, keep.join("\n") + "\n" + row + "\n");
  say(`idle RAM delta ${dRam >= 0 ? "+" : ""}${dRam} % (T21 row written to docs/measurements/features.md)`);
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  await down().catch(() => {});
  if (v.out) writeFileSync(v.out, lines.join("\n") + "\n");
  say(errs.length ? `FAIL: ${errs.length} claim(s)` : "OK: app claims hold");
  process.exit(errs.length ? 1 : 0);
}
