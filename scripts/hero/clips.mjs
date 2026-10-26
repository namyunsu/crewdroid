// T48 verify: node scripts/hero/clips.mjs (boots 3 devices: s24ultra@34, fold5-main@34, flip7-main@36; ~6 min)
// Real footage of the Field Notes demo app (demo-app/) for the intro video. Builds the APK, starts the sample server, boots 3 devices
// with `up`, turns on show_touches, and drives everything with crewdroid commands while src/record.ts records the screens.
// Each clip is cut "to the effect": idle stretches (no pixel change) longer than 0.4 s keep only 0.2 s on each side, then the clip
// is sped up if it is still over 7.5 s. Every command keeps its real start time and its time inside the clip.
// Writes docs/demo/clips/{boot,agent,offline,fold,dark}.mp4, docs/demo/clips/main-<profile>.png (layout + contrast check input),
// docs/measurements/hero-clips.json. Clips over 2 MB are listed in docs/demo/clips/.gitignore.
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { adb } from "../../src/adb.ts";
import { screenSize } from "../../src/input.ts";
import { record } from "../../src/record.ts";
import { sleep } from "../../src/snapshot.ts";
import { down } from "../../src/up.ts";
import { startApp } from "../../sample/server/app.ts";

const run = promisify(execFile);
const root = join(import.meta.dirname, "../..");
const out = join(root, "docs/demo/clips");
const work = mkdtempSync(join(tmpdir(), "crewclips-"));
const PKG = "dev.crewdroid.demo", PORT = 5596, FPS = 30, H = 720, CROP = 58; // CROP: screenrecord --bugreport timestamp line (app keeps 24 dp free there)
const PROFILES = ["s24ultra", "fold5-main", "flip7-main"];
const ff = (bin, args) => run(bin, args, { windowsHide: true, maxBuffer: 2 ** 30, encoding: bin === "ffmpeg" ? "buffer" : "utf8" }).then((r) => r.stdout);
const secs = async (f) => Number(String(await ff("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).trim());
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;

async function cli(args) {
  const { stdout } = await run(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), args[0], "--json", ...args.slice(1)], { cwd: root, timeout: 900000, windowsHide: true, maxBuffer: 2 ** 26 });
  return JSON.parse(stdout);
}

// 1. APK (built with the probe's Gradle wrapper)
execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["-p", join(root, "demo-app"), "assembleDebug", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });
const apk = join(root, "demo-app/build/outputs/apk/debug/crewdroid-demo-debug.apk");

// Per-frame change flags of a video: frame i "changed" when >= 2 pixels of a 128x72 grey copy moved by more than 10 levels.
async function changes(file) {
  const raw = await ff("ffmpeg", ["-loglevel", "error", "-i", file, "-vf", `fps=${FPS},scale=128:72,format=gray`, "-f", "rawvideo", "-"]);
  const n = 128 * 72, frames = raw.length / n, flags = [false];
  const diff = (a, b) => { let c = 0; for (let k = 0; k < n; k++) if (Math.abs(raw[a * n + k] - raw[b * n + k]) > 10) c++; return c; };
  for (let i = 1; i < frames; i++) flags.push(diff(i, i - 1) >= 2);
  return { flags, firstLast: diff(0, frames - 1) };
}

// Frame times (ms of device elapsed realtime) from screenrecord's winscope metadata v2:
// "#VV1NSC0PET1ME2#", u32 version, i64 realtime-elapsed offset (ns), u32 frame count, u64 elapsed-realtime ns per frame.
function frameTimes(file) {
  const b = readFileSync(file), i = b.indexOf("#VV1NSC0PET1ME2#");
  if (i < 0) throw new Error(`${file}: no winscope frame times`);
  const n = b.readUInt32LE(i + 28);
  return Array.from({ length: n }, (_, k) => Number(b.readBigUInt64LE(i + 32 + 8 * k)) / 1e6);
}

// Every 1 s window (step 0.25 s) holds at least one changed frame.
const throughout = (flags) => {
  for (let s = 0; s + FPS <= flags.length; s += FPS / 4) if (!flags.slice(s, s + FPS).some(Boolean)) return false;
  return flags.length >= FPS;
};

// Frame ranges to keep: idle runs > 12 frames keep 6 at each end; the lead-in keeps 9 frames, the tail 15.
function keep(flags) {
  const ranges = [], n = flags.length;
  const first = flags.indexOf(true), last = flags.lastIndexOf(true);
  if (first < 0) throw new Error("recording never changes");
  let i = Math.max(0, first - 9);
  while (i <= last) {
    let j = i; while (j <= last && (flags[j] || j === i)) j++; // active run [i, j)
    let k = j; while (k <= last && !flags[k]) k++; // idle run [j, k)
    ranges.push([i, j - 1]);
    if (k - j > 12) { ranges.push([j, j + 5]); ranges.push([k - 6, k - 1]); } else if (k > j) ranges.push([j, k - 1]);
    i = k;
  }
  ranges.push([last + 1, Math.min(n - 1, last + 15)]);
  return ranges.filter(([a, b]) => b >= a);
}

// Records `serials` while steps run; returns the trimmed clip's record for hero-clips.json.
async function clip(name, serials, steps, meta = {}) {
  const dir = join(work, name);
  mkdirSync(dir);
  const stop = record(serials, dir);
  await sleep(1500); // screenrecord starting
  // Anchor: a touch dot on every screen gives each recording a first real frame at a known time (a static screen yields none).
  await Promise.all(serials.map(async (s) => { const { width } = await screenSize(s); await adb(s, ["shell", `input tap ${Math.round(width / 2)} 20`]); }));
  await sleep(800);
  const cmds = [];
  for (const [device, args, wait = 0] of steps) {
    const t0 = Date.now();
    let note;
    // AI NOTE: flip7-main@36 has 860 MB guest RAM and swaps right after boot (load ~17), so `am start -W` can give up
    // ("Status: timeout", 18-26 s) while the app still comes up; the clip keeps recording and the JSON says so.
    await cli(args).catch((e) => { if (args[0] === "launch" && /Status: timeout/.test(e.stderr)) note = "am start -W timed out; the app came up later"; else throw e; });
    cmds.push({ cmd: `crewdroid ${args.join(" ")}`, device, t0, t1: Date.now(), ...(note ? { note } : {}) });
    if (wait) await sleep(wait);
  }
  await sleep(2000);
  const tStop = Date.now();
  const files = await stop();
  // AI NOTE: screenrecord only writes a frame when the screen changes, so an mp4 neither starts nor ends at the record call;
  // its winscope metadata has each frame's device elapsed-realtime, mapped to host time through /proc/uptime (same clock).
  const host = await Promise.all(serials.map(async (s, i) => {
    const h0 = Date.now(), up = parseFloat(await adb(s, ["shell", "cat /proc/uptime"])), h1 = Date.now();
    const boot = (h0 + h1) / 2 - up * 1000, ts = frameTimes(files[i]);
    return { f0: boot + ts[0], f1: boot + (ts[1] ?? ts[0]) }; // f0: recorder intro frame (pts 0), f1: first real frame
  }));
  const realStart = Math.max(...host.map((h) => h.f1)), len = (tStop - realStart) / 1000;
  // Composite at FPS on the real timeline: hold frames (fps), cut to realStart, crop the timestamp line, H px high, 24 px gaps.
  const parts = files.map((f, i) => `[${i}:v]fps=${FPS},trim=start=${((realStart - host[i].f0) / 1000).toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=60,crop=iw:ih-${CROP}:0:${CROP},scale=-2:${H},setsar=1[v${i}]`);
  const gap = (i) => `[v${i}]pad=iw+24:ih:0:0:color=0x101412[p${i}]`;
  const chain = files.length === 1 ? `${parts[0]};[v0]null[c]`
    : `${parts.join(";")};${files.slice(0, -1).map((_, i) => gap(i)).join(";")};${files.map((_, i) => (i < files.length - 1 ? `[p${i}]` : `[v${i}]`)).join("")}hstack=${files.length}[c]`;
  const inter = join(dir, "inter.mp4");
  await ff("ffmpeg", ["-y", "-loglevel", "error", ...files.flatMap((f) => ["-i", f]), "-filter_complex", chain, "-map", "[c]", "-t", len.toFixed(2), "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", inter]);
  const { flags } = await changes(inter);
  const ranges = keep(flags);
  const kept = ranges.reduce((a, [x, y]) => a + y - x + 1, 0);
  const speed = Math.max(1, kept / FPS / 7.5);
  const sel = ranges.map(([a, b]) => `between(n,${a},${b})`).join("+");
  const mp4 = join(out, `${name}.mp4`);
  await ff("ffmpeg", ["-y", "-loglevel", "error", "-i", inter, "-vf", `select='${sel}',setpts=N/${FPS}/TB/${speed.toFixed(4)},fps=${FPS}`, "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
  // real time -> clip time: frames kept before that moment
  const at = (t) => { const f = Math.round(((t - realStart) / 1000) * FPS); let c = 0; for (const [a, b] of ranges) c += Math.max(0, Math.min(b, f - 1) - a + 1); return r2(c / FPS / speed); };
  const done = await changes(mp4);
  const widths = await Promise.all(files.map(async (f) => String(await ff("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", f])).trim()));
  let x = 0;
  const panels = serials.map((s, i) => { const [w, h] = widths[i].split(",").map(Number); const pw = 2 * Math.round((H * w) / (h - CROP) / 2); const p = { ...devs[s], x, width: pw }; x += pw + 24; return p; });
  return {
    name, file: `docs/demo/clips/${name}.mp4`, seconds: r2(await secs(mp4)), bytes: statSync(mp4).size, height: H, fps: FPS,
    devices: panels, recordedSeconds: r1(len), keptSeconds: r2(kept / FPS), speed: r2(speed),
    changesThroughout: throughout(done.flags), firstLastDiffer: done.firstLast > 50,
    commands: cmds.map((c) => ({ cmd: c.cmd, device: c.device, atSeconds: at(c.t0), effectSeconds: at(c.t1), realSeconds: r1((c.t0 - realStart) / 1000), tookSeconds: r1((c.t1 - c.t0) / 1000), ...(c.note ? { note: c.note } : {}) })),
    ...meta,
  };
}

// WCAG contrast of two [r,g,b]
const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Main screen check on one device: every text node inside the screen (not touching the left/right edge), and its text colour vs
// its background >= 4.5:1 measured on the `shot` PNG (background = most common colour in the node's box, text = the colour
// covering >= 1 % of the box that contrasts most with it). Nodes cut by the bottom edge are scrolled list rows, counted apart.
async function check(serial, profile) {
  const png = join(out, `main-${profile}.png`);
  const { width: W, height: Hh } = await cli(["shot", serial, png]);
  const { nodes } = await cli(["screen", serial]);
  const rgb = await ff("ffmpeg", ["-loglevel", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const texts = nodes.filter((n) => n.text.trim());
  const clipped = [], low = [], rows = [];
  let scrolledOff = 0, min = Infinity;
  for (const n of texts) {
    const [l, t, r, b] = n.bounds;
    if (b >= Hh - 1) { scrolledOff++; continue; }
    if (l <= 0 || t < 0 || r >= W || r <= l || b <= t) { clipped.push({ text: n.text, bounds: n.bounds }); continue; }
    const count = new Map();
    for (let y = t; y < b; y++) for (let x = l; x < r; x++) { const o = (y * W + x) * 3; const k = (rgb[o] << 16) | (rgb[o + 1] << 8) | rgb[o + 2]; count.set(k, (count.get(k) ?? 0) + 1); }
    const px = (k) => [k >> 16, (k >> 8) & 255, k & 255];
    const sorted = [...count].sort((p, q) => q[1] - p[1]);
    const bg = px(sorted[0][0]);
    const total = (r - l) * (b - t);
    const best = Math.max(...sorted.filter(([, c]) => c >= total * 0.01).map(([k]) => ratio(px(k), bg)));
    min = Math.min(min, best);
    rows.push({ text: n.text, ratio: r2(best) });
    if (best < 4.5) low.push({ text: n.text, ratio: r2(best) });
  }
  return { profile, serial, file: `docs/demo/clips/main-${profile}.png`, width: W, height: Hh, textNodes: texts.length, scrolledOff, clipped, lowContrast: low, minContrast: r2(min), ratios: rows };
}

mkdirSync(out, { recursive: true });
const server = await startApp({ port: PORT, dir: join(work, "server") });
const devs = {};
let result;
await down(); // makes this process the lock owner; the CLI children inherit CREWDROID_OWNER
try {
  const upT0 = Date.now();
  const upr = await cli(["up", "--count", "3", "--profiles", PROFILES.join(",")]);
  const upSeconds = r1((Date.now() - upT0) / 1000);
  for (const d of upr.devices) devs[d.serial] = { serial: d.serial, profile: d.profile, api: d.api };
  if (upr.devices.some((d) => d.api === 31)) throw new Error("API 31 assigned; clips avoid it (ADR 0005)");
  const by = (p) => upr.devices.find((d) => d.profile === p).serial;
  const [phone, fold, flip] = PROFILES.map(by);
  await cli(["install", "all", apk]);
  for (const s of Object.keys(devs)) await adb(s, ["shell", "settings put system show_touches 1"]);
  // AI NOTE: right after `up` the 860 MB flip7-main@36 swaps (load 12-21 for ~2.5 min): launches took 6-26 s and its screenrecord
  // once never wrote a file. Wait until every device's 1-min load is < 5 (measured: ~3 min), at most 5 min.
  const settleT0 = Date.now();
  for (const s of Object.keys(devs)) {
    while (parseFloat(await adb(s, ["shell", "cat /proc/loadavg"])) >= 5 && Date.now() - settleT0 < 300000) await sleep(10000);
  }
  const settleSeconds = r1((Date.now() - settleT0) / 1000);
  const extras = ["--", "--es", "server", `http://10.0.2.2:${PORT}`];
  // AI NOTE: the first launch right after install took 19-20 s on flip7-main@36 (am start -W timed out once); warm each device
  // once, then stop it, so the boot clip shows a normal cold start of an installed app.
  for (const s of Object.keys(devs)) await cli(["launch", s, PKG, ...extras]).catch((e) => console.error(`warm-up ${s}: ${String(e.stderr || e.message).slice(0, 200)}`));
  await sleep(5000);
  for (const s of Object.keys(devs)) await adb(s, ["shell", `am force-stop ${PKG}`]);
  await sleep(2000);

  // (a) boot: the 3 screens from ready (after `up`) to the app's first frame, launched one after the other.
  const boot = await clip("boot", [phone, fold, flip], [phone, fold, flip].map((s) => [s, ["launch", s, PKG, ...extras], s === flip ? 3000 : 0]), {
    up: { cmd: `crewdroid up --count 3 --profiles ${PROFILES.join(",")}`, seconds: upSeconds, readySeconds: Object.fromEntries(upr.devices.map((d) => [d.profile, d.readySeconds])), settleSeconds },
  });
  boot.note = "Footage starts once `up` has returned: before that the headless screens are black (identity restart). `up` times are in `up`.";
  await sleep(3000);
  const shots = [];
  for (const p of PROFILES) shots.push(await check(by(p), p));

  // (b) agent: one device, add a note.
  const agent = await clip("agent", [phone], [[phone, ["tap", phone, "--text", "New note"], 600], [phone, ["type", phone, "Fix pump #3"]], [phone, ["tap", phone, "--text", "Save"], 1500]]);
  await sleep(2500); // the other devices pull it
  // (c) offline: phone offline adds a note (pending), flip stays synced; back online -> both show it.
  const offline = await clip("offline", [phone, flip], [
    [phone, ["net", phone, "airplane"]], [phone, ["tap", phone, "--text", "New note"], 600], [phone, ["type", phone, "Valve 7 replaced"]],
    [phone, ["tap", phone, "--text", "Save"], 1500], [phone, ["net", phone, "online"], 3500],
  ]);
  // (d) fold: Fold5 folds to the cover screen (1 column) and unfolds to the main screen (2 columns).
  const foldC = await clip("fold", [fold], [[fold, ["fold", fold], 800], [fold, ["swipe", fold, "up"], 800], [fold, ["unfold", fold], 800], [fold, ["swipe", fold, "down"], 800]]);
  // (e) dark: Flip7 switches to dark mode, scrolls, pulls to refresh.
  const dark = await clip("dark", [flip], [[flip, ["env", flip, "dark", "on"], 800], [flip, ["swipe", flip, "up"], 600], [flip, ["swipe", flip, "down"], 300], [flip, ["swipe", flip, "down"], 1200]]);

  const clips = [boot, agent, offline, foldC, dark];
  const big = clips.filter((c) => c.bytes > 2 * 1024 * 1024);
  for (const c of clips) c.gitIgnored = big.includes(c);
  writeFileSync(join(out, ".gitignore"), big.map((c) => `${c.name}.mp4\n`).join(""));
  result = {
    date: new Date().toISOString(), app: { pkg: PKG, source: "demo-app/" }, server: `sample/server on :${PORT} (PUT /records/:id, GET /export)`,
    devices: Object.values(devs), clips, shots,
    layoutOk: shots.every((s) => s.clipped.length === 0 && s.textNodes > 5),
    contrastOk: shots.every((s) => s.lowContrast.length === 0),
  };
  writeFileSync(join(root, "docs/measurements/hero-clips.json"), JSON.stringify(result, null, 2) + "\n");
} finally {
  await down();
  server.close();
}
rmSync(work, { recursive: true, force: true });
for (const c of result.clips) console.log(`${c.name}: ${c.seconds} s (recorded ${c.recordedSeconds} s, kept ${c.keptSeconds} s, x${c.speed}), ${c.bytes} bytes, changesThroughout=${c.changesThroughout}, firstLastDiffer=${c.firstLastDiffer}`);
for (const s of result.shots) console.log(`${s.profile}: ${s.textNodes} text nodes, clipped ${s.clipped.length}, min contrast ${s.minContrast}`);
console.log(`layoutOk=${result.layoutOk} contrastOk=${result.contrastOk}`);
