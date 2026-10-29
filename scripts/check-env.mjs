// T20 verify: node scripts/check-env.mjs [--base-port 5580] [--idle-seconds 30] [--out file]
// Boots 2 mixed devices (API 34 s24ultra + API 36 flip7-main); on each: every `crewdroid env` command, its read-back, and the probe app's
// `check=env` ENV log line. Writes the 2-device idle RAM/CPU before/after row to docs/measurements/features.md (replaces its own T20 row on rerun). Always downs its emulators.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
// one CLI call -> { code, json, err }; the env args are typed as a user would
const crew = (...args) => new Promise((ok) => execFile(process.execPath, ["--import", "tsx", cli, "env", ...args, "--json"], { cwd: root, windowsHide: true, maxBuffer: 64 << 20 }, (e, out, err) => {
  let json = null;
  try { json = JSON.parse(out || err); } catch { json = null; }
  ok({ code: e ? e.code ?? 1 : 0, json, err: String(err).trim().slice(0, 300) });
}));

// ENV line of the probe app, launched fresh so it reads the state after the change
async function probeEnv(serial) {
  await adb(serial, ["logcat", "-c"]);
  await adb(serial, ["shell", "am", "force-stop", PKG]);
  await sleep(2000); // API 31 relaunch black screen (ADR 0005): force-stop, wait, start
  await adb(serial, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`, "--es", "check", "env"]);
  for (let i = 0, seen = 0; i < 25; i++) {
    const out = await adb(serial, ["logcat", "-d", "-s", "CrewProbe:I"]).catch(() => "");
    const all = [...out.matchAll(/ENV dark=(\w+) font=([\d.]+) rot=(\d) battery=(\d+) loc=(\S+)/g)];
    if (all.length && ++seen > 3) { // a rotation change recreates the activity: the last line is the settled one
      const m = all.at(-1);
      return { dark: m[1] === "true", font: Number(m[2]), rot: Number(m[3]), battery: Number(m[4]), loc: m[5] };
    }
    await sleep(1000);
  }
  return null;
}

async function idle(ports, sec) {
  const re = (p) => `-port ${p}([ "]|$)`;
  const a = await Promise.all(ports.map((p) => procs(re(p)))), t0 = Date.now();
  await sleep(sec * 1000);
  const b = await Promise.all(ports.map((p) => procs(re(p))));
  const wall = (Date.now() - t0) / 1000, sum = (xs, k) => xs.reduce((n, x) => n + x[k], 0);
  return { ramMB: Math.round(sum(b, "ws") / 1048576), cpuPercent: Math.round(((sum(b, "cpu") - sum(a, "cpu")) / wall) * 1000) / 10 };
}

try {
  await down();
  const r = await up(2, Number(v["base-port"]), ["s24ultra", "flip7-main"]);
  const ports = r.devices.map((x) => x.port), mix = r.devices.map((x) => `${x.profile}@${x.api}`).join(", ");
  for (const x of r.devices) {
    await adb(x.serial, ["install", "-r", "-g", probeApk()], 120000); // -g: location permission for check=env
    await adb(x.serial, ["shell", "am", "force-stop", PKG]);
  }
  await sleep(60000); // CPU is still high right after boot
  const before = await idle(ports, Number(v["idle-seconds"]));

  // invalid input: exit 1 before any adb call (the serial does not exist)
  for (const [args, re] of [[["emulator-59999", "battery", "150"], /battery level/], [["emulator-59999", "rotate", "9"], /rotation/], [["5580", "show"], /emulator-<port>/]]) {
    const e = await crew(...args);
    claim(e.code === 1 && re.test(e.json?.error ?? ""), `env ${args.join(" ")}: exit ${e.code} ${e.json?.error}`);
  }

  for (const d of r.devices) {
    const s = d.serial, tag = `${s} ${d.profile} API ${d.api}`;
    const ok = async (args, check) => {
      const c = await crew(s, ...args);
      claim(c.code === 0 && check(c.json), `${tag} env ${args.join(" ")}: ${c.code === 0 ? JSON.stringify(c.json) : c.json?.error ?? c.err}`);
    };
    await ok(["geo", "126.978", "37.5665", "30"], (j) => j.locationEnabled === true && j.lat === 37.5665);
    await ok(["battery", "37", "unplugged"], (j) => j.level === 37 && j.ac === false);
    await ok(["rotate", "1"], (j) => j.userRotation === 1);
    await ok(["sensor", "acceleration", "0:9.81:0"], (j) => j.acceleration === "0:9.81:0");
    await ok(["dark", "on"], (j) => j.dark === true);
    await ok(["font", "1.3"], (j) => j.font === 1.3);
    await ok(["locale", PKG, "ko-KR,en"], (j) => j.locales.toLowerCase() === "ko-kr,en");
    await ok(["gsm", "data", "roaming"], (j) => j.state === "roaming");
    await ok(["gsm", "data", "on"], (j) => j.state === "home");
    const t0 = Date.now();
    await ok(["gsm", "signal", "15", "--hold", "12"], (j) => j.heldSeconds === 12 && Date.now() - t0 >= 11000);
    await ok(["sms", "01055556666", "hello from check-env"], (j) => j.received === true);
    await ok(["call", "01012341234"], (j) => j.callState === "ringing");
    await ok(["call", "01012341234", "accept"], (j) => j.callState === "offhook");
    await ok(["call", "01012341234", "cancel"], (j) => j.callState === "idle");

    // show reads every state back and agrees with what was set
    const sh = await crew(s, "show");
    const j = sh.json ?? {};
    claim(sh.code === 0 && j.dark === "yes" && j.font === 1.3 && j.rotation?.user === "1" && j.rotation?.auto === "0" && j.battery?.level === 37 && j.battery?.ac === false && j.acceleration === "0:9.81:0" && j.gsmData === "home" && j.call?.state === 0 && j.geo?.enabled === true,
      `${tag} env show: ${JSON.stringify(j).slice(0, 400)}`);

    // the probe app sees the same state (loc: the app requests a fix, which makes the emulator deliver the latest geo fix)
    const p = await probeEnv(s);
    const [lat, lon] = (p?.loc ?? "").split(",").map(Number);
    claim(!!p && p.dark === true && p.font === 1.3 && p.rot === 1 && p.battery === 37 && Math.abs(lat - 37.5665) < 1e-3 && Math.abs(lon - 126.978) < 1e-3, `${tag} probe ENV ${JSON.stringify(p)}`);

    // and the other way round, so the setters are not just echoing
    await crew(s, "dark", "off"); await crew(s, "font", "1.0"); await crew(s, "battery", "88", "ac");
    await ok(["rotate", "0"], (j) => j.userRotation === 0); // read back from settings and WindowManager inside the setter
    const q = await probeEnv(s);
    claim(!!q && q.dark === false && q.font === 1 && q.rot === 0 && q.battery === 88, `${tag} probe ENV after reset ${JSON.stringify(q)}`);

    // a new fix (negative longitude) reaches the app too
    const g = await crew(s, "geo", "-122.084", "37.422");
    const p2 = await probeEnv(s);
    const [la2, lo2] = (p2?.loc ?? "").split(",").map(Number);
    claim(g.code === 0 && Math.abs(la2 - 37.422) < 1e-3 && Math.abs(lo2 + 122.084) < 1e-3, `${tag} geo with negative longitude: probe loc ${p2?.loc}`);
  }

  await sleep(10000);
  const after = await idle(ports, Number(v["idle-seconds"]));
  say(`idle after: ram=${after.ramMB}MB cpu=${after.cpuPercent}%`);
  const f = join(root, "docs", "measurements", "features.md");
  if (!existsSync(f)) writeFileSync(f, "# Runtime features: idle cost\n\nOne row per Todo that adds a runtime command (lightness rule: no launch flag / AVD config / KNOBS change; idle RAM over +5 % -> opt-in). RAM = emulator+qemu working set, CPU = % of one host core over the idle window, probe app stopped.\n\n| date | Todo | devices | idle s | RAM before -> after (MB) | RAM delta | CPU before -> after (%) | note |\n|---|---|---|---|---|---|---|---|\n");
  const dRam = Math.round(((after.ramMB - before.ramMB) / before.ramMB) * 1000) / 10;
  const row = `| ${new Date().toISOString().slice(0, 10)} | T20 env | 2 (${mix}) | ${v["idle-seconds"]} | ${before.ramMB} -> ${after.ramMB} | ${dRam >= 0 ? "+" : ""}${dRam} % | ${before.cpuPercent} -> ${after.cpuPercent} | no daemon; after = after every env command ran (geo/battery/rotate/dark/font/locale/gsm/sms/call) |`;
  // one T20 row: a rerun replaces it
  const keep = readFileSync(f, "utf8").split(/\r?\n/).filter((l) => !l.includes("| T20 env |"));
  while (keep.at(-1) === "") keep.pop();
  writeFileSync(f, keep.join("\n") + "\n" + row + "\n");
  say(`idle RAM delta ${dRam >= 0 ? "+" : ""}${dRam} % (T20 row written to docs/measurements/features.md)`);
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  await down().catch(() => {});
  if (v.out) writeFileSync(v.out, lines.join("\n") + "\n");
  say(errs.length ? `FAIL: ${errs.length} claim(s)` : "OK: env claims hold");
  process.exit(errs.length ? 1 : 0);
}
