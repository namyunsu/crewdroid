// T13 verify: node scripts/check-demo-gif.mjs [--mvp docs/measurements/mvp.json] [--gif docs/demo/techs.gif]
// Reads gif.panels from mvp.json, decodes each panel of the GIF with ffmpeg and fails unless, in the second half of the GIF,
// the panel is not flat (luma range > 40) and differs from its first frame; and the 3 panels' w/h ratios are pairwise different.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const root = join(import.meta.dirname, "..");
const { values: v } = parseArgs({ options: { mvp: { type: "string", default: join(root, "docs/measurements/mvp.json") }, gif: { type: "string", default: join(root, "docs/demo/techs.gif") } } });
const fail = (m) => (console.error(`FAIL: ${m}`), process.exit(1));
const panels = JSON.parse(readFileSync(v.mvp, "utf8")).gif?.panels;
if (panels?.length !== 3) fail(`${v.mvp} has no gif.panels (3 expected)`);

// AI NOTE: the screenrecord --bugreport timestamp overlay sits in the top strip and changes every frame, so a black panel
// would look "live"; it is cropped away before measuring.
const TOP = 24;
const MIN_RANGE = 40; // luma 0..255
const MIN_DIFF = 0.02; // share of pixels that moved by > 24 luma vs the first frame
const problems = [];
let nFrames = 0;
const ratio = (p) => p.width / p.height;
for (const p of panels) {
  const h = p.height - TOP;
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", v.gif, "-vf", `crop=${p.width}:${h}:${p.x}:${TOP},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 2 ** 30 });
  if (r.status !== 0) fail(`ffmpeg: ${r.stderr}`);
  const size = p.width * h;
  const n = Math.floor(r.stdout.length / size);
  nFrames = n;
  const first = r.stdout.subarray(0, size);
  let live = 0;
  let total = 0;
  for (let i = Math.ceil(n / 2); i < n; i++) {
    const f = r.stdout.subarray(i * size, (i + 1) * size);
    let lo = 255, hi = 0, moved = 0;
    for (let k = 0; k < size; k++) { const y = f[k]; if (y < lo) lo = y; if (y > hi) hi = y; if (Math.abs(y - first[k]) > 24) moved++; }
    total++;
    if (hi - lo > MIN_RANGE && moved / size > MIN_DIFF) live++;
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
