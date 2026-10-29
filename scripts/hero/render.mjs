// T50 verify: node scripts/hero/render.mjs && node scripts/check-hero.mjs
// 15 s hero from real recordings: docs/demo/clips/*.mp4 (recorded on real emulators by scripts/hero/clips.mjs, T48) + the
// commands in docs/measurements/hero-clips.json + measured numbers read at render time (single.md, agent-bench.json).
// No emulator is booted. Steps the page's virtual clock (seek(t), 30 fps x 15 s) in headless Chromium, screenshots every frame
// at 960x540, encodes docs/demo/hero.gif (15 fps; 12 fps if > 6 MB), docs/demo/hero.mp4 (H.264) and hero-poster.png (end card),
// and writes what it showed to docs/measurements/hero.json for check-hero.mjs.
import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";

const run = promisify(execFile);
const ff = (bin, args) => run(bin, args, { windowsHide: true, maxBuffer: 2 ** 26 }).then((r) => r.stdout.trim());
const root = join(import.meta.dirname, "../..");
const here = import.meta.dirname;
const demo = join(root, "docs/demo");
const meas = (f) => readFileSync(join(root, "docs/measurements", f), "utf8");
const grab = (f, re) => { const m = meas(f).match(re); if (!m) throw new Error(`${f}: no match for ${re}`); return m; };
const sb = JSON.parse(readFileSync(join(here, "storyboard.json"), "utf8"));
const CLIP_FPS = 30;

// Measured numbers, never typed by hand.
const bench = JSON.parse(meas("agent-bench.json"));
const robust = (k) => bench.robustness.every((r) => r[k].ok);
const numbers = {
  ready: Number(grab("single.md", /^\| mean \| [\d.]+ \| ([\d.]+) \|/m)[1]), // 1 device ready (s), mean of the cold runs
  ramMB: Number(grab("single.md", /RAM (\d+) MB working set/)[1]), // that one device idle
  stock: bench.firstDevice.stockSeconds, // stock emulator cold boot, same PC (T54)
  A: { tokens: bench.A.tokensPerTask, seconds: bench.A.secondsPerTask, robust: robust("A") },
  B: { tokens: bench.B.tokensPerTask, seconds: bench.B.secondsPerTask, robust: robust("B") },
  tokenRatio: Number(bench.ratio.tokens.toFixed(1)),
};
if (bench.ratio.seconds > 1.1 || bench.ratio.seconds < 1 / 1.1) throw new Error("agent-bench seconds are no longer a tie: re-read the message");

// Clips: frames at 30 fps as file URLs, plus size and commands from hero-clips.json.
const work = mkdtempSync(join(tmpdir(), "crewhero-"));
const hc = JSON.parse(meas("hero-clips.json"));
const clips = {}, frames = {};
for (const c of hc.clips) {
  const f = join(root, c.file), dir = join(work, c.name);
  mkdirSync(dir);
  const [width, height] = (await ff("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", f])).split(",").map(Number);
  await ff("ffmpeg", ["-y", "-loglevel", "error", "-i", f, "-vf", `fps=${CLIP_FPS}`, join(dir, "%04d.png")]);
  frames[c.name] = readdirSync(dir).sort().map((x) => pathToFileURL(join(dir, x)).href);
  clips[c.name] = { width, height, seconds: c.seconds, devices: c.devices, commands: c.commands };
}
const thumb = pathToFileURL(join(root, hc.shots.find((s) => s.profile === "s24ultra").file)).href;

const HERO = { storyboard: sb, numbers, clips, frames, clipFps: CLIP_FPS, thumb };
const browser = await chromium.launch();
const out = join(work, "out");
mkdirSync(out);
let shown, layout = [], deviceArea = {};
try {
  const page = await browser.newPage({ viewport: { width: sb.width, height: sb.height } });
  await page.addInitScript((h) => { window.HERO = h; }, HERO);
  await page.goto(pathToFileURL(join(here, "index.html")).href);
  const at = async (t) => {
    await page.evaluate((x) => window.seek(x), t);
    await page.evaluate(() => Promise.all([...document.images].filter((i) => i.src).map((i) => i.decode().catch(() => {}))));
  };
  // Layout guard at 25 / 50 / 75 % of every scene: visible text >= 28 px, no text or device frame outside the frame (the blurred title backdrop may bleed), no text line overflowing
  // its box. The same points give each scene's device area (union of the device frames) for check-hero.mjs.
  for (const s of sb.scenes) {
    const problems = new Set();
    for (const q of [0.25, 0.5, 0.75]) {
      await at(s.start + (s.end - s.start) * q);
      const r = await page.evaluate(({ id, W, H }) => {
        const bad = [], devs = [];
        for (const e of document.getElementById(id).querySelectorAll("*")) {
          const b = e.getBoundingClientRect(), cs = getComputedStyle(e);
          if (!b.width || cs.opacity === "0") continue;
          if (e.classList.contains("dev")) devs.push([b.left, b.top, b.right, b.bottom]);
          const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (own && parseFloat(cs.fontSize) < 28) bad.push(`${e.tagName}#${e.id}.${e.className} font ${cs.fontSize}`);
          if ((own || e.classList.contains("dev")) && (b.left < -0.5 || b.top < -0.5 || b.right > W + 0.5 || b.bottom > H + 0.5)) bad.push(`${e.tagName}#${e.id}.${e.className} out of frame`);
          if (own && e.scrollWidth > e.clientWidth + 1 && cs.whiteSpace !== "pre-wrap") bad.push(`${e.tagName}#${e.id}.${e.className} text overflows its box`);
        }
        return { bad, devs };
      }, { id: s.id, W: sb.width, H: sb.height });
      r.bad.forEach((p) => problems.add(p));
      if (r.devs.length) {
        for (const d of r.devs) {
          const a = deviceArea[s.id] ?? [Infinity, Infinity, -Infinity, -Infinity];
          deviceArea[s.id] = [Math.floor(Math.min(a[0], d[0])), Math.floor(Math.min(a[1], d[1])), Math.ceil(Math.max(a[2], d[2])), Math.ceil(Math.max(a[3], d[3]))];
        }
      }
    }
    layout.push({ scene: s.id, problems: [...problems] });
  }
  const problems = layout.flatMap((l) => l.problems.map((p) => `${l.scene}: ${p}`));
  if (problems.length) throw new Error(`layout:\n${problems.join("\n")}`);

  const up = sb.scenes.find((s) => s.id === "up"), agent = sb.scenes.find((s) => s.id === "agent");
  await at(up.end - 0.1);
  shown = { ready: Number(await page.textContent("#counter")), stock: Number(await page.textContent("#stockv")) };
  await at(agent.end - 0.1);
  Object.assign(shown, {
    agentLines: await page.$$eval("#agentterm p", (ps) => ps.map((p) => p.textContent)),
    agentLit: await page.$$eval("#agentterm p", (ps) => ps.map((p) => p.className)),
    A: { tokens: await page.textContent("#atok"), seconds: await page.textContent("#asec") },
    B: { tokens: await page.textContent("#btok"), seconds: await page.textContent("#bsec") },
    end: (await page.textContent("#stats")).trim(),
  });

  const n = Math.round(sb.seconds * sb.fps);
  for (let i = 0; i < n; i++) {
    await at(i / sb.fps);
    await page.screenshot({ path: join(out, `${String(i).padStart(4, "0")}.png`) });
  }
  copyFileSync(join(out, `${String(n - 1).padStart(4, "0")}.png`), join(demo, "hero-poster.png"));
} finally {
  await browser.close();
}

const seq = join(out, "%04d.png"), gif = join(demo, "hero.gif"), mp4 = join(demo, "hero.mp4");
await ff("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(sb.fps), "-i", seq, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "24", "-preset", "slow", "-movflags", "+faststart", mp4]);
const encodeGif = (fps) => ff("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(sb.fps), "-i", seq, "-filter_complex",
  `fps=${fps},split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, gif]);
let gifFps = sb.gifFps;
await encodeGif(gifFps);
if (statSync(gif).size > 6 * 2 ** 20) await encodeGif((gifFps = 12)); // spec: drop to 12 fps, never below 720 px wide
const probe = async (f) => {
  const [w, h] = (await ff("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", f])).split(",").map(Number);
  return { width: w, height: h, bytes: statSync(f).size, seconds: Number(await ff("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])) };
};
const res = {
  date: new Date().toISOString(),
  message: sb.message,
  numbers, shown, deviceArea,
  sources: {
    ready: "docs/measurements/single.md (mean ready, 1 device)", ramMB: "docs/measurements/single.md (idle working set, 1 device)",
    stock: "docs/measurements/agent-bench.json firstDevice.stockSeconds (stock emulator cold boot)",
    A: "docs/measurements/agent-bench.json A (tree path)", B: "docs/measurements/agent-bench.json B (screenshot path)",
    robust: "docs/measurements/agent-bench.json robustness (fold/flip)", clips: "docs/measurements/hero-clips.json",
  },
  layout,
  gif: { path: "docs/demo/hero.gif", fps: gifFps, ...(await probe(gif)) },
  mp4: { path: "docs/demo/hero.mp4", ...(await probe(mp4)) },
};
writeFileSync(join(root, "docs/measurements/hero.json"), JSON.stringify(res, null, 2) + "\n");
rmSync(work, { recursive: true, force: true });
console.log(`hero.gif ${res.gif.width}x${res.gif.height} ${res.gif.fps} fps, ${res.gif.seconds} s, ${res.gif.bytes} bytes; hero.mp4 ${res.mp4.bytes} bytes; ready ${shown.ready} s vs stock ${shown.stock} s; tokens A ${shown.A.tokens} / B ${shown.B.tokens}`);
