// T41 verify: node scripts/demo-vibe.mjs
// Public vibe-coding demo: 1 device (`up`), its screen recorded while the loop runs through the CLI (install -> launch check=form ->
// type -> tap Send -> swipe); each step is burned in as a caption, a 2 s tail card shows the measured loop time (up .. down).
// Writes docs/demo/vibe.gif (<= 3 MB, <= 25 s, 480 px high, 8 fps) + docs/measurements/demo-vibe.json.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { record } from "../src/record.ts";
import { PKG, probeApk } from "../src/snapshot.ts";
import { down } from "../src/up.ts";

const run = promisify(execFile);
const root = join(import.meta.dirname, "..");
const H = 480, FPS = 8, TAIL = 2, BODY_MAX = 21; // body + tail stays <= 25 s even after GIF frame-delay rounding
const work = mkdtempSync(join(tmpdir(), "crewvibedemo-"));
const ff = (bin, args, opts = {}) => run(bin, args, { windowsHide: true, maxBuffer: 2 ** 26, ...opts }).then((r) => r.stdout.trim());
const dim = async (f) => (await ff("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", f])).split(",").map(Number);
const secs = async (f) => Number(await ff("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]));

const steps = [];
// One CLI call, timed; `caption` (shown in the GIF) is the command an agent would type. t0/t1 are ms since epoch.
async function cli(name, args, caption) {
  const t0 = Date.now();
  const out = await ff(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), args[0], "--json", ...args.slice(1)], { cwd: root, timeout: 900000, env: process.env });
  const t1 = Date.now();
  steps.push({ step: name, caption, seconds: Math.round((t1 - t0) / 100) / 10, t0, t1 });
  return JSON.parse(out);
}

await down(); // also makes this process the lock owner; the CLI children inherit CREWDROID_OWNER
let serial, rec0, rec1, video, upInfo;
try {
  upInfo = await cli("up", ["up"], "crewdroid up");
  serial = upInfo.devices[0].serial;
  rec0 = Date.now();
  const stop = record([serial], work);
  await cli("install", ["install", serial, probeApk()], "crewdroid install app.apk");
  const l = await cli("launch", ["launch", serial, PKG, "--restart", "--", "--es", "check", "form"], "crewdroid launch --restart");
  if (l.crashed) throw new Error("probe crashed on launch");
  await cli("type", ["type", serial, "hello", "--into", "name"], 'crewdroid type "hello"');
  await cli("tap", ["tap", serial, "--text", "Send"], "crewdroid tap --text Send");
  await cli("swipe", ["swipe", serial, "up"], "crewdroid swipe up");
  rec1 = Date.now();
  [video] = await stop();
  await cli("down", ["down"], "crewdroid down");
} finally {
  await down(); // no-op after a clean run; kills what we started when a step failed
}
const loopSeconds = Math.round(steps.reduce((a, s) => a + s.seconds, 0));

// Captions: recording starts a little after rec0; the mp4 length tells how much (stop time - length), so shift the step times by that.
const length = await secs(video);
const lag = (rec1 - rec0) / 1000 - length;
const speed = Math.max(1, length / BODY_MAX);
const cap = steps.filter((s) => s.t0 >= rec0 && s.step !== "down");
const t = (ms) => (((ms - rec0) / 1000 - lag) / speed).toFixed(2);
cap.forEach((s, i) => writeFileSync(join(work, `c${i}.txt`), s.caption));
writeFileSync(join(work, "tail.txt"), `crewdroid loop\nup -> down ${loopSeconds} s\n`);
const font = "C\\:/Windows/Fonts/consola.ttf";
const box = "fontcolor=white:box=1:boxcolor=black@0.85:boxborderw=8";
// each caption stays until the next one starts (the last until the tail card)
const drawCaps = cap.map((s, i) => `drawtext=fontfile='${font}':textfile=c${i}.txt:fontsize=14:${box}:x=(w-text_w)/2:y=h-text_h-24:enable='between(t,${t(s.t0)},${i + 1 < cap.length ? t(cap[i + 1].t0) : (length / speed + 1).toFixed(2)})'`);
const tail = `tpad=stop_duration=${TAIL}:stop_mode=clone,drawtext=fontfile='${font}':textfile=tail.txt:fontsize=20:${box}:boxborderw=12:x=(w-text_w)/2:y=h/2:enable='gte(t,${(length / speed).toFixed(2)})'`;
// AI NOTE: frame 0 of a --bugreport recording is the "Android screenrecord" intro text; drop it, keep the pts.
const fc = `[0:v]select='gt(n,0)',setpts=PTS/${speed.toFixed(3)},fps=${FPS},scale=-2:${H},${[...drawCaps, tail].join(",")},split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer`;
mkdirSync(join(root, "docs/demo"), { recursive: true });
const gif = join(root, "docs/demo/vibe.gif");
await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-filter_complex", fc, gif], { windowsHide: true, maxBuffer: 2 ** 26, cwd: work });

const [w0, h0] = await dim(video);
const width = 2 * Math.round((H * w0) / h0 / 2);
if ((await dim(gif))[0] !== width) throw new Error(`panel width ${width} != gif width`);
const d = upInfo.devices[0];
const out = {
  date: new Date().toISOString(), loopSeconds,
  device: { serial: d.serial, profile: d.profile, api: d.api },
  steps: steps.map(({ step, seconds }) => ({ step, seconds })),
  gif: { path: "docs/demo/vibe.gif", height: H, fps: FPS, bytes: statSync(gif).size, seconds: await secs(gif), recordedSeconds: Math.round(length), speed: Math.round(speed * 10) / 10, panels: [{ serial: d.serial, profile: d.profile, api: d.api, x: 0, width, height: H }] },
};
writeFileSync(join(root, "docs/measurements/demo-vibe.json"), JSON.stringify(out, null, 2) + "\n");
rmSync(work, { recursive: true, force: true });
console.log(`gif ${out.gif.bytes} bytes, ${out.gif.seconds} s (recording ${out.gif.recordedSeconds} s at ${out.gif.speed}x); loop up..down ${loopSeconds} s: ${out.steps.map((s) => `${s.step} ${s.seconds}s`).join(", ")}`);
