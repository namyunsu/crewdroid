// T29/T32 verify: node scripts/demo-gif.mjs [--seed 1] [--server-port 5595]
// Public demo: 3 mixed devices (s24ultra API 34, fold5-main API 34, flip7-main API 36) run scenarios/photo-upload.json against a
// BUGGY=1 sample server while their screens are recorded; the 3 recordings are sped up to fit, laid side by side, and a 3 s tail
// shows the judge summary. Writes docs/demo/demo.gif (<= 3 MB, 480 px high, <= 20 s, 8 fps) + docs/measurements/demo.json.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { startApp } from "../sample/server/app.ts";
import { record } from "../src/record.ts";
import { runScenario } from "../src/scenario.ts";
import { down } from "../src/up.ts";

const run = promisify(execFile);
const { values: v } = parseArgs({ options: { seed: { type: "string", default: "1" }, "server-port": { type: "string", default: "5595" } } });
const root = join(import.meta.dirname, "..");
const PROFILES = ["s24ultra", "fold5-main", "flip7-main"];
const H = 480, FPS = 8, TAIL = 3, BODY_MAX = 16; // body + tail stays <= 20 s even after GIF frame-delay rounding
const work = mkdtempSync(join(tmpdir(), "crewdemo-"));
const ff = (bin, args) => run(bin, args, { windowsHide: true, maxBuffer: 2 ** 26 }).then((r) => r.stdout.trim());
const dim = async (f) => (await ff("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", f])).split(",").map(Number);
const secs = async (f) => Number(await ff("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]));

await down();
const server = await startApp({ port: Number(v["server-port"]), dir: join(work, "data"), buggy: true });
let stop, videos = [], report;
try {
  report = await runScenario(join(root, "scenarios/photo-upload.json"), {
    count: 3, seed: Number(v.seed), serverPort: Number(v["server-port"]), profiles: PROFILES,
    onReady: (serials) => { stop = record(serials, work); },
    beforeDown: async () => { if (stop) videos = await stop().catch((e) => (console.error(`recording failed: ${e}`), [])); },
  });
} finally {
  server.close();
  await down();
}
if (videos.length !== 3) throw new Error(`expected 3 recordings, got ${videos.length}`);

const viol = report.judge.violations;
const summary = viol.length ? viol.slice(0, 4).map((x) => `VIOLATION ${x.rule} (${x.table}): ${x.rows.length} rows`).join("\n") : "PASS: no violations";
writeFileSync(join(work, "tail.txt"), `crewdroid judge\n${summary}\n`);

// Recordings run as long as the scenario (minutes): speed them up so body + tail fit in 20 s.
const longest = Math.max(...(await Promise.all(videos.map(secs))));
const speed = Math.max(1, longest / BODY_MAX);
// AI NOTE: frame 0 of a --bugreport recording is the "Android screenrecord" intro text ; drop it, keep the pts.
const scaled = videos.map((_, i) => `[${i}:v]select='gt(n,0)',setpts=PTS/${speed.toFixed(3)},fps=${FPS},scale=-2:${H}[v${i}]`).join(";");
const font = "C\\:/Windows/Fonts/consola.ttf";
// tail: the last frame is held for TAIL s and the judge text is drawn over the bottom of the 3 panels from the moment the hold starts
const hold = `tpad=stop_duration=${TAIL}:stop_mode=clone,drawtext=fontfile='${font}':textfile=tail.txt:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.85:boxborderw=14:x=(w-text_w)/2:y=h-text_h-40:enable='gte(t,${(longest / speed).toFixed(2)})'`;
const fc = `${scaled};[v0][v1][v2]hstack=inputs=3,${hold},split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer`;
mkdirSync(join(root, "docs/demo"), { recursive: true });
const gif = join(root, "docs/demo/demo.gif");
await run("ffmpeg", ["-y", "-loglevel", "error", ...videos.flatMap((f) => ["-i", f]), "-filter_complex", fc, gif], { windowsHide: true, maxBuffer: 2 ** 26, cwd: work });

let x = 0;
const panels = [];
for (const [i, f] of videos.entries()) {
  const [w0, h0] = await dim(f);
  const width = 2 * Math.round((H * w0) / h0 / 2);
  const d = report.devices[i];
  panels.push({ serial: d.serial, profile: d.profile, api: d.api, x, width, height: H });
  x += width;
}
if ((await dim(gif))[0] !== x) throw new Error(`panel widths ${x} != gif width`);
const out = {
  date: new Date().toISOString(), scenario: report.scenario, seed: report.seed, buggy: true, runOk: report.ok, drained: report.drained,
  judge: { ok: report.judge.ok, violations: viol.length, summary },
  devices: report.devices.map((d) => ({ serial: d.serial, profile: d.profile, api: d.api, screen: d.screen, log: d.log })),
  gif: { path: "docs/demo/demo.gif", height: H, fps: FPS, bytes: statSync(gif).size, seconds: await secs(gif), recordedSeconds: Math.round(longest), speed: Math.round(speed * 10) / 10, panels },
};
writeFileSync(join(root, "docs/measurements/demo.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`gif ${out.gif.bytes} bytes, ${out.gif.seconds} s (recording ${out.gif.recordedSeconds} s at ${out.gif.speed}x); judge: ${summary.replace(/\n/g, " | ")}`);
