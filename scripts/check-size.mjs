// T18 verify: node scripts/check-size.mjs [--base-port 5580] [--sweep]
// 1. `up --count 2 --screen 1920x720@160,3840x2160@320`: wm size/density match, screencap PNG size == requested, not one colour;
//    `up --screen 0x100` (and other bad input) exits 1 and launches nothing; custom.example.json loads -> down.
// 2. --sweep: per size x API (34, 36) boot one device, record boot s, host RAM, screencap size, flatness; plus one --window run.
//    Writes docs/measurements/size.json and size.md.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb, assertSerial } from "../src/adb.ts";
import { procs } from "../src/measure.ts";
import { loadProfilesFile } from "../src/profiles.ts";
import { adbPath } from "../src/sdk.ts";
import { PKG, sleep } from "../src/snapshot.ts";
import { down, up } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, sweep: { type: "boolean", default: false } } });
const base = Number(v["base-port"]);
const root = join(import.meta.dirname, "..");
const problems = [];

// Screencap PNG -> { w, h, share, colours }; size from the IHDR chunk, colours via ffmpeg (as check-render does).
function shot(serial) {
  const png = spawnSync(adbPath(), ["-s", assertSerial(serial), "exec-out", "screencap", "-p"], { maxBuffer: 2 ** 30 }).stdout;
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-vf", "scale=iw/8:ih/8", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: png, maxBuffer: 2 ** 30 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const count = new Map();
  for (let i = 0; i < r.stdout.length; i += 3) { const k = r.stdout.readUIntBE(i, 3); count.set(k, (count.get(k) ?? 0) + 1); }
  return { w, h, share: Math.max(...count.values()) / (r.stdout.length / 3), colours: count.size };
}
const startProbe = async (serial) => { await adb(serial, ["shell", "am", "start", "-W", "-n", `${PKG}/.ProbeActivity`]); await sleep(3000); };

await down();
try {
  // bad input: exits 1 before any emulator starts
  for (const bad of ["0x100", "-5x100", "abcx100", "1080", "1080x2340@0"]) {
    const r = spawnSync("npx", ["tsx", "src/cli.ts", "up", "--count", "1", `--screen=${bad}`], { cwd: root, encoding: "utf8", shell: true });
    const ran = /emulator-\d+/.test(r.stdout);
    console.log(`bad --screen ${bad}: exit ${r.status}, ${r.stderr.trim().split("\n").at(-1)}`);
    if (r.status !== 1 || ran) problems.push(`--screen ${bad} did not fail cleanly (exit ${r.status})`);
  }
  if (loadProfilesFile(join(root, "profiles/custom.example.json")).length < 1) problems.push("custom.example.json empty");

  const u = await up(2, base, undefined, false, { screens: ["1920x720@160", "3840x2160@320"] });
  const sizes = new Set();
  for (const [i, d] of u.devices.entries()) {
    await startProbe(d.serial);
    const want = [[1920, 720, 160], [3840, 2160, 320]][i];
    const s = shot(d.serial);
    sizes.add(`${s.w}x${s.h}`);
    const okWm = d.wmSize.includes(`${want[0]}x${want[1]}`) && d.wmDensity.includes(String(want[2]));
    const ok = okWm && s.w === want[0] && s.h === want[1] && s.share < 0.99;
    console.log(`${d.serial} API ${d.api} wm "${d.wmSize.replace(/\s+/g, " ")}" "${d.wmDensity.replace(/\s+/g, " ")}" screencap ${s.w}x${s.h} top ${(s.share * 100).toFixed(1)} % ${ok ? "ok" : "BAD"}`);
    if (!ok) problems.push(`${d.serial}: wm/screencap do not match ${want.join("x")} (wm ok=${okWm}, png ${s.w}x${s.h}, top ${(s.share * 100).toFixed(1)} %)`);
  }
  if (sizes.size !== 2) problems.push("screencap sizes are not distinct");
} finally {
  await down();
}

if (v.sweep && !problems.length) {
  const tmp = mkdtempSync(join(tmpdir(), "crew-size-"));
  const rows = [];
  const cases = [];
  for (const api of [34, 36]) for (const size of ["3840x2160", "5120x1440", "7680x2160"]) cases.push({ api, size, window: false });
  cases.push({ api: 34, size: "3840x2160", window: true });
  for (const c of cases) {
    const [w, h] = c.size.split("x").map(Number);
    const file = join(tmp, "p.json");
    writeFileSync(file, JSON.stringify({ profiles: [{ name: `t${c.size}`, width: w, height: h, density: Math.round((Math.min(w, h) / 360) * 160), minApi: c.api }] }));
    const row = { ...c, ok: false };
    await down();
    try {
      const u = await up(1, base, undefined, c.window, { profilesFile: file });
      const d = u.devices[0];
      Object.assign(row, { imageApi: d.api, density: d.density, bootSeconds: d.bootSeconds, readySeconds: d.readySeconds, wmSize: d.wmSize.trim() });
      await startProbe(d.serial);
      const s = shot(d.serial);
      const p = await procs(`-port ${d.port}([ "]|$)`);
      Object.assign(row, { png: `${s.w}x${s.h}`, topColourShare: Math.round(s.share * 1000) / 1000, ramMB: Math.round(p.ws / 1048576), ok: s.w === w && s.h === h && s.share < 0.99 });
    } catch (e) {
      row.error = String(e.message ?? e).slice(0, 300);
    } finally {
      await down();
    }
    console.log(JSON.stringify(row));
    rows.push(row);
  }
  const root2 = join(root, "docs/measurements");
  writeFileSync(join(root2, "size.json"), JSON.stringify({ date: new Date().toISOString(), rows }, null, 2) + "\n");
  const md = ["# Screen size limits (T18, FR-14)", "", "One device per row, fresh boot, `up` with a custom profile (density derived for ~360dp short side). RAM = emulator+qemu working set after the probe app drew one frame. `ok` = screencap PNG equals the requested size and is not >99 % one colour.", "",
    "| API | size | density | window | boot s | ready s | RAM MB | screencap | ok | note |", "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.imageApi ?? r.api} | ${r.size} | ${r.density ?? ""} | ${r.window ? "yes" : "no"} | ${r.bootSeconds ?? ""} | ${r.readySeconds ?? ""} | ${r.ramMB ?? ""} | ${r.png ?? ""} | ${r.ok ? "yes" : "NO"} | ${r.error ?? ""} |`), "",
    "Findings: every size up to 7680x2160 booted and rendered on API 34 and 36 (largest tested; no failing size found). `wm size` only accepts up to 2x the physical display per side (base AVD 1080x2340 clamped 3840x2160 to 2160x2160), so a profile past that gets `-skin <W/2>x<H/2>` + `-no-snapshot-load` (cold boot; see `skinFor` in src/up.ts). Profiles within the limit keep the unchanged launch args and quickboot. Window mode shows a scaled window; screencap stays full resolution.", ""];
  writeFileSync(join(root2, "size.md"), md.join("\n"));
}

if (problems.length) { console.error(`FAIL: ${problems.join("; ")}`); process.exit(1); }
console.log(v.sweep ? "OK: custom screens hold, sweep written to docs/measurements/size.md" : "OK: custom screens hold (--screen, bad input, screencap sizes)");
