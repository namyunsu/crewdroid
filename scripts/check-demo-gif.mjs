// T13/T29 verify: node scripts/check-demo-gif.mjs [--mvp docs/measurements/demo.json] [--gif docs/demo/demo.gif] [--max-mb N] [--max-seconds N] (T29)
// Reads gif.panels from the demo JSON, decodes each panel of the GIF with ffmpeg and fails unless, in the second half of the GIF,
// the panel is not flat (luma range > 40, <= 90% of pixels in 2 adjacent luma buckets) and differs from its first frame; and the 3 panels' w/h ratios are pairwise different.
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const root = join(import.meta.dirname, "..");
const { values: v } = parseArgs({ options: { mvp: { type: "string", default: join(root, "docs/measurements/demo.json") }, gif: { type: "string", default: join(root, "docs/demo/demo.gif") }, "max-mb": { type: "string" }, "max-seconds": { type: "string" } } });
const fail = (m) => (console.error(`FAIL: ${m}`), process.exit(1));
const panels = JSON.parse(readFileSync(v.mvp, "utf8")).gif?.panels;
if (panels?.length !== 3) fail(`${v.mvp} has no gif.panels (3 expected)`);

// AI NOTE: the screenrecord --bugreport timestamp overlay sits in the top strip and changes every frame, so a black panel
// would look "live"; it is cropped away before measuring.
// The panel also has a dark status band (~38 px at 480 high); crop 10% of the height so only app content is measured.
const TOP_FRAC = 0.1;
const SIDE = 0.15; // each side is cropped too: panel edges can hold black bars that fake a luma range
const MAX_DOMINANT = 0.9; // blank grey panel ~0.99 of pixels in 2 adjacent luma buckets (16 levels), call UI ~0.6
const MIN_RANGE = 40; // luma 0..255
const MIN_DIFF = 0.02; // share of pixels that moved by > 24 luma vs the first frame
const problems = [];
if (v["max-mb"]) { const mb = statSync(v.gif).size / 2 ** 20; if (mb > Number(v["max-mb"])) problems.push(`${v.gif} is ${mb.toFixed(2)} MB (max ${v["max-mb"]})`); }
if (v["max-seconds"]) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", v.gif]);
  const sec = Number(String(r.stdout).trim());
  if (!(sec <= Number(v["max-seconds"]))) problems.push(`${v.gif} lasts ${sec} s (max ${v["max-seconds"]})`);
}
let nFrames = 0;
const ratio = (p) => p.width / p.height;
for (const p of panels) {
  const TOP = Math.max(40, Math.round(p.height * TOP_FRAC));
  const h = p.height - TOP;
  const cx = Math.round(p.width * SIDE);
  const w = p.width - 2 * cx;
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", v.gif, "-vf", `crop=${w}:${h}:${p.x + cx}:${TOP},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 2 ** 30 });
  if (r.status !== 0) fail(`ffmpeg: ${r.stderr}`);
  const size = w * h;
  const n = Math.floor(r.stdout.length / size);
  nFrames = n;
  const first = r.stdout.subarray(0, size);
  let live = 0;
  let total = 0;
  for (let i = Math.ceil(n / 2); i < n; i++) {
    const f = r.stdout.subarray(i * size, (i + 1) * size);
    let lo = 255, hi = 0, moved = 0;
    const bins = new Array(16).fill(0);
    for (let k = 0; k < size; k++) { const y = f[k]; if (y < lo) lo = y; if (y > hi) hi = y; bins[y >> 4]++; if (Math.abs(y - first[k]) > 24) moved++; }
    total++;
    if (hi - lo > MIN_RANGE && moved / size > MIN_DIFF && Math.max(...bins.map((c, j) => c + (bins[j + 1] ?? 0))) / size <= MAX_DOMINANT) live++;
  }
  const ok = total > 0 && live / total >= 0.5;
  console.log(`${p.serial} ${p.profile} API ${p.api} x=${p.x} ${p.width}x${p.height}: ${live}/${total} second-half frames live ${ok ? "ok" : "NOT LIVE"}`);
  if (!ok) problems.push(`${p.serial} (${p.profile}, API ${p.api}) is not live`);
}
for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
  if (Math.abs(ratio(panels[i]) - ratio(panels[j])) < 0.01) problems.push(`${panels[i].serial} and ${panels[j].serial} have the same w/h ratio`);
}
if (problems.length) fail(problems.join("; "));
console.log(`OK: demo GIF has 3 live panels (${nFrames} frames)`);
