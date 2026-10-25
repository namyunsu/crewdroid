// T28 verify: node scripts/check-surface.mjs [--base-port 5580]
// `up` s22 (lands on API 31) + s24ultra (API 34) -> install the probe -> `check=surface` (SurfaceView, green + moving white
// square) three ways per device, screencap cropped to the bounds the probe logs ("CrewProbe SURFACE l,t,r,b"):
//   canvas / gl: force-stop, wait 2 s, start (lockCanvas / GLSurfaceView) -> must not be one colour on any device;
//   gl -S:       `am start -S` while the previous instance is on screen -> one colour is allowed only on a device that up()
//                flagged relaunchBlack AND printed its WARN line for (ADR 0005).
// -> down. PNGs: .ai-log/evidence/T28-surface-<serial>-<step>.png
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb, assertSerial } from "../src/adb.ts";
import { perf } from "../src/perf.ts";
import { adbPath } from "../src/sdk.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";
import { down, up } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" } } });
const MAX_SHARE = 0.99;
const out = join(import.meta.dirname, "..", ".ai-log/evidence");
mkdirSync(out, { recursive: true });

// Share of the most common RGB colour inside crop [l,t,r,b] of a PNG (ffmpeg decode, as check-render does).
function cropStats(png, [l, t, r, b]) {
  const res = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", `crop=${r - l}:${b - t}:${l}:${t}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: png, maxBuffer: 2 ** 30 });
  if (res.status !== 0 || !res.stdout.length) throw new Error(`ffmpeg could not crop screencap: ${res.stderr}`);
  const count = new Map();
  for (let i = 0; i < res.stdout.length; i += 3) { const k = res.stdout.readUIntBE(i, 3); count.set(k, (count.get(k) ?? 0) + 1); }
  const [rgb, n] = [...count].sort((a, c) => c[1] - a[1])[0];
  return { share: n / (res.stdout.length / 3), rgb: rgb.toString(16).padStart(6, "0"), colours: count.size };
}

// Launches check=surface, waits for its SURFACE line, screencaps, returns crop stats.
async function shot(d, step, startArgs, extra) {
  await adb(d.serial, ["logcat", "-c"]);
  await adb(d.serial, ["shell", "am", "start", "-W", ...startArgs, "-n", `${PKG}/.ProbeActivity`, "--es", "check", "surface", ...extra], 60000);
  return grab(d, step);
}

// Waits for the SURFACE line of an already launched check=surface, screencaps, returns crop stats.
async function grab(d, step) {
  let bounds;
  for (let i = 0; i < 20 && !bounds; i++) {
    await sleep(500);
    const m = (await adb(d.serial, ["logcat", "-d", "-s", "CrewProbe:I"])).match(/SURFACE (\d+),(\d+),(\d+),(\d+)/);
    if (m) bounds = m.slice(1).map(Number);
  }
  if (!bounds) throw new Error(`${d.serial} ${step}: no CrewProbe SURFACE line`);
  await sleep(3000);
  const png = spawnSync(adbPath(), ["-s", assertSerial(d.serial), "exec-out", "screencap", "-p"], { maxBuffer: 2 ** 28 }).stdout;
  writeFileSync(join(out, step === "perf" ? `T31-perf-${d.serial}.png` : `T28-surface-${d.serial}-${step}.png`), png);
  return { bounds, ...cropStats(png, bounds) };
}

// capture up()'s stderr so the WARN lines can be checked
const warns = [];
const write = process.stderr.write.bind(process.stderr);
process.stderr.write = (s, ...a) => { warns.push(...String(s).split(/\r?\n/).filter((l) => l.startsWith("WARN "))); return write(s, ...a); };

const problems = [];
let excused = 0;
await down();
try {
  const u = await up(2, Number(v["base-port"]), ["s22", "s24ultra"]);
  process.stderr.write = write;
  if (!u.devices.some((d) => d.api === 31) || !u.devices.some((d) => d.api === 34)) throw new Error(`need API 31 + 34, got ${u.devices.map((d) => d.api)}`);
  for (const d of u.devices) {
    await adb(d.serial, ["install", "-r", probeApk()], 120000);
    const warned = warns.some((w) => w.startsWith(`WARN ${d.serial} API ${d.api}:`) && w.includes("ADR 0005"));
    for (const [step, startArgs, extra] of [["canvas", [], []], ["gl", [], ["--es", "mode", "gl"]], ["gl-S", ["-S"], ["--es", "mode", "gl"]]]) {
      if (!startArgs.length) { await adb(d.serial, ["shell", "am", "force-stop", PKG]); await sleep(2000); }
      const s = await shot(d, step, startArgs, extra);
      const flat = s.share > MAX_SHARE;
      const ok = !flat || (step === "gl-S" && d.relaunchBlack && warned);
      console.log(`${d.serial} ${d.profile} API ${d.api} relaunchBlack=${d.relaunchBlack} warned=${warned} ${step} bounds ${s.bounds.join(",")}: top #${s.rgb} ${(s.share * 100).toFixed(1)} %, ${s.colours} colours ${flat ? (ok ? "FLAT (flagged + WARN, ADR 0005)" : "FLAT") : "ok"}`);
      if (!ok) problems.push(`${d.serial} (API ${d.api}) ${step}: SurfaceView crop is ${(s.share * 100).toFixed(1)} % #${s.rgb}`);
      if (flat && ok) excused++;
    }
    // T31: perf's cold start (force-stop, 2 s, start; no -S) must draw on every device, API 31 included. No excuse here.
    await adb(d.serial, ["logcat", "-c"]);
    const pf = await perf(d.serial, PKG, ".ProbeActivity", ["--es", "check", "surface"]);
    console.log(`${d.serial} perf cold start TotalTime=${pf.start.totalTime} ms`);
    const s = await grab(d, "perf");
    const flat = s.share > MAX_SHARE;
    console.log(`${d.serial} ${d.profile} API ${d.api} perf bounds ${s.bounds.join(",")}: top #${s.rgb} ${(s.share * 100).toFixed(1)} %, ${s.colours} colours ${flat ? "FLAT" : "ok"}`);
    if (flat) problems.push(`${d.serial} (API ${d.api}) perf: SurfaceView crop is ${(s.share * 100).toFixed(1)} % #${s.rgb}`);
  }
} finally {
  process.stderr.write = write;
  await down();
}
if (problems.length) { console.error(`FAIL: ${problems.join("; ")}`); process.exit(1); }
console.log(`OK: SurfaceView (canvas + GL) renders on API 31 and 34; ${excused} flat relaunch shot(s) on relaunchBlack devices with WARN (ADR 0005)`);
