// T50 verify: node scripts/hero/render.mjs && node scripts/check-hero.mjs
// docs/demo/hero.gif: 14-16 s, <= 6 MB, >= 720 px wide; hero.mp4: H.264, < 3 MB, 14-16 s; hero-poster.png exists. Storyboard has
// 6 contiguous scenes over 0-15 s. In scenes 2-5 the device area (hero.json deviceArea, from render.mjs) at 25 %, 50 % and 75 % of
// the scene differs pairwise (> 5 % of its pixels), i.e. motion inside the scene. Scene 3's terminal lines equal hero-clips.json's
// agent commands; the ready time equals single.md's mean; the agent numbers equal agent-bench.json.
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = join(import.meta.dirname, "..");
const demo = (f) => join(root, "docs/demo", f);
const meas = (f) => readFileSync(join(root, "docs/measurements", f), "utf8");
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const probe = async (f, args) => (await run("ffprobe", ["-v", "error", ...args, f], { windowsHide: true })).stdout.trim();

for (const f of ["hero.gif", "hero.mp4", "hero-poster.png"]) if (!existsSync(demo(f))) throw new Error(`FAIL: docs/demo/${f} missing (run node scripts/hero/render.mjs)`);
const gif = demo("hero.gif"), mp4 = demo("hero.mp4");
const info = async (f) => {
  const [codec, w, h] = (await probe(f, ["-select_streams", "v", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0"])).split(",");
  return { codec, w: Number(w), h: Number(h), bytes: statSync(f).size, s: Number(await probe(f, ["-show_entries", "format=duration", "-of", "csv=p=0"])) };
};
const G = await info(gif), M = await info(mp4);
check(G.bytes <= 6 * 2 ** 20, `gif ${G.bytes} bytes > 6 MB`);
check(G.s >= 14 && G.s <= 16, `gif ${G.s} s not in 14-16 s`);
check(G.w >= 720, `gif width ${G.w} < 720`);
check(M.codec === "h264", `mp4 codec ${M.codec}, want h264`);
check(M.bytes < 3 * 2 ** 20, `mp4 ${M.bytes} bytes >= 3 MB`);
check(M.s >= 14 && M.s <= 16, `mp4 ${M.s} s not in 14-16 s`);

const sb = JSON.parse(readFileSync(join(root, "scripts/hero/storyboard.json"), "utf8"));
const sc = sb.scenes;
check(sc.length === 6, `storyboard has ${sc.length} scenes, want 6`);
check(sc[0]?.start === 0 && sc.at(-1)?.end === 15, "storyboard does not cover 0-15 s");
sc.forEach((s, i) => check(s.end > s.start && (i === 0 || s.start === sc[i - 1].end), `scene ${s.id} ${s.start}-${s.end} not contiguous`));

const hero = JSON.parse(meas("hero.json"));
const scale = G.w / sb.width;
const crop = async (t, [x1, y1, x2, y2]) => {
  const [x, y, w, h] = [x1, y1, x2 - x1, y2 - y1].map((v) => Math.round(v * scale));
  return (await run("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-i", gif, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 2 ** 26, windowsHide: true })).stdout;
};
const changed = (a, b) => { let n = 0; for (let p = 0; p < a.length; p += 3) if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 30) n++; return n / (a.length / 3); };
const motion = [];
for (const s of sc.slice(1, 5)) {
  const area = hero.deviceArea?.[s.id];
  if (!area) { check(false, `hero.json has no device area for scene ${s.id}`); continue; }
  const f = await Promise.all([0.25, 0.5, 0.75].map((q) => crop(s.start + (s.end - s.start) * q, area)));
  const d = [[0, 1], [1, 2], [0, 2]].map(([i, j]) => changed(f[i], f[j]));
  motion.push(`${s.id} ${d.map((x) => (x * 100).toFixed(0)).join("/")}%`);
  d.forEach((x, k) => check(x > 0.05, `scene ${s.id}: device area frames ${["25-50", "50-75", "25-75"][k]} % differ by only ${(x * 100).toFixed(1)} %`));
}

const clips = JSON.parse(meas("hero-clips.json")).clips;
const want = clips.find((c) => c.name === "agent").commands.map((c) => c.cmd);
check(JSON.stringify(hero.shown?.agentLines) === JSON.stringify(want), `scene 3 terminal ${JSON.stringify(hero.shown?.agentLines)} != hero-clips.json ${JSON.stringify(want)}`);
const ready = Number(meas("single.md").match(/^\| mean \| [\d.]+ \| ([\d.]+) \|/m)?.[1]);
check(ready > 0, "single.md has no mean row");
check(hero.numbers?.ready === ready && hero.shown?.ready === ready, `ready: hero.json ${hero.numbers?.ready}, shown ${hero.shown?.ready}, single.md ${ready}`);
check(hero.shown?.end?.includes(`${ready} s`), `end card stats "${hero.shown?.end}" lack ${ready} s`);
const bench = JSON.parse(meas("agent-bench.json"));
check(hero.shown?.stock === bench.firstDevice.stockSeconds, `stock ${hero.shown?.stock} != agent-bench.json ${bench.firstDevice.stockSeconds}`);
for (const k of ["A", "B"]) {
  const t = bench[k].tokensPerTask.toLocaleString("en-US"), s = bench[k].secondsPerTask.toFixed(1);
  check(hero.shown?.[k]?.tokens === t && hero.shown?.[k]?.seconds === s, `scene 3 ${k} shows ${JSON.stringify(hero.shown?.[k])}, agent-bench.json ${t} tokens ${s} s`);
}

console.log(`gif ${G.w}x${G.h}, ${G.s} s, ${G.bytes} bytes; mp4 ${M.codec} ${M.s} s, ${M.bytes} bytes; device-area change ${motion.join(", ")}; ready ${hero.shown?.ready} s; tokens A ${hero.shown?.A?.tokens} B ${hero.shown?.B?.tokens}`);
if (fails.length) { console.error(`FAIL:\n${fails.join("\n")}`); process.exit(1); }
console.log("OK: hero.gif claims hold");
