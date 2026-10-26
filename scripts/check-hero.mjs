// T44 verify: node scripts/hero/render.mjs && node scripts/check-hero.mjs
// docs/demo/hero.gif: exists, <= 5 MB, 14-16 s, width >= 900; storyboard has 5 contiguous scenes covering 0-15 s; the GIF frame at
// the middle of every scene is not flat (top colour <= 90 %) and differs from the neighbouring scene's (> 10 % of pixels changed);
// the ready time shown in scene 2 equals the mean in docs/measurements/single.md (render.mjs writes what it showed to hero.json).
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = join(import.meta.dirname, "..");
const gif = join(root, "docs/demo/hero.gif");
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const probe = async (args) => (await run("ffprobe", ["-v", "error", ...args, gif], { windowsHide: true })).stdout.trim();

if (!existsSync(gif)) throw new Error("FAIL: docs/demo/hero.gif missing (run node scripts/hero/render.mjs)");
const bytes = statSync(gif).size;
const seconds = Number(await probe(["-show_entries", "format=duration", "-of", "csv=p=0"]));
const [W, H] = (await probe(["-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0"])).split(",").map(Number);
check(bytes <= 5 * 2 ** 20, `gif ${bytes} bytes > 5 MB`);
check(seconds >= 14 && seconds <= 16, `gif ${seconds} s not in 14-16 s`);
check(W >= 900, `gif width ${W} < 900`);

const sb = JSON.parse(readFileSync(join(root, "scripts/hero/storyboard.json"), "utf8"));
const sc = sb.scenes;
check(sc.length === 5, `storyboard has ${sc.length} scenes, want 5`);
check(sc[0]?.start === 0 && sc.at(-1)?.end === 15, "storyboard does not cover 0-15 s");
sc.forEach((s, i) => check(s.end > s.start && (i === 0 || s.start === sc[i - 1].end), `scene ${s.id} ${s.start}-${s.end} not contiguous`));

const frame = async (t) => (await run("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-i", gif, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", maxBuffer: 2 ** 26, windowsHide: true })).stdout;
const mids = [];
for (const s of sc) {
  const f = await frame((s.start + s.end) / 2);
  const counts = new Map();
  for (let p = 0; p < f.length; p += 3) { const k = (f[p] << 16) | (f[p + 1] << 8) | f[p + 2]; counts.set(k, (counts.get(k) ?? 0) + 1); }
  const top = Math.max(...counts.values()) / (f.length / 3);
  mids.push({ id: s.id, f, top });
  check(top <= 0.9, `scene ${s.id} middle frame is flat (top colour ${(top * 100).toFixed(1)} %)`);
}
const changed = (a, b) => { let n = 0; for (let p = 0; p < a.length; p += 3) if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 30) n++; return n / (a.length / 3); };
const diffs = mids.slice(1).map((m, i) => ({ pair: `${mids[i].id}->${m.id}`, changed: changed(mids[i].f, m.f) }));
for (const d of diffs) check(d.changed > 0.1, `${d.pair}: only ${(d.changed * 100).toFixed(1)} % pixels changed`);

const single = readFileSync(join(root, "docs/measurements/single.md"), "utf8").match(/^\| mean \| [\d.]+ \| ([\d.]+) \|/m);
const hero = JSON.parse(readFileSync(join(root, "docs/measurements/hero.json"), "utf8"));
check(single, "single.md has no mean row");
const ready = Number(single?.[1]);
check(hero.numbers?.ready === ready, `hero.json numbers.ready ${hero.numbers?.ready} != single.md ${ready}`);
check(hero.shown?.ready === ready && hero.shown?.readyText?.includes(String(ready)), `scene 2 showed ${JSON.stringify(hero.shown)}, single.md ${ready}`);

console.log(`gif ${W}x${H}, ${seconds} s, ${bytes} bytes; top colour ${mids.map((m) => `${m.id} ${(m.top * 100).toFixed(1)}%`).join(", ")}; changed ${diffs.map((d) => `${d.pair} ${(d.changed * 100).toFixed(1)}%`).join(", ")}; ready ${hero.shown?.ready} s`);
if (fails.length) { console.error(`FAIL:\n${fails.join("\n")}`); process.exit(1); }
console.log("OK: hero.gif claims hold");
