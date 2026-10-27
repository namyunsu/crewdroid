// Hero v2 (15 s): real recordings from docs/demo/clips (made by scripts/hero/clips.mjs on real emulators) + real CLI output.
// usage: node scripts/hero2/render.mjs -> docs/demo/hero.gif, docs/demo/hero.mp4, docs/demo/hero-poster.png
// No emulator needed: the clips and docs/measurements/hero2-judge.txt are the inputs.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";

const run = promisify(execFile);
const ff = (bin, args) => run(bin, args, { windowsHide: true, maxBuffer: 2 ** 26 }).then((r) => r.stdout.trim());
const root = join(import.meta.dirname, "../..");
const demo = join(root, "docs/demo");
const outDir = process.env.HERO_OUT || demo; // render somewhere else first to look at it
const W = 960, H = 540, FPS = 30, LEN = 15, CLIP_FPS = 15;
const scenes = [
  { id: "s1", start: 0, end: 2.0 }, { id: "s2", start: 2.0, end: 5.0 }, { id: "s3", start: 5.0, end: 9.0 },
  { id: "s4", start: 9.0, end: 11.8 }, { id: "s5", start: 11.8, end: 13.5 }, { id: "s6", start: 13.5, end: 15 },
];
const work = mkdtempSync(join(tmpdir(), "crewhero2-"));

// Clip frames at 15 fps as file URLs.
const frames = {};
for (const c of ["boot", "offline", "fold", "dark"]) {
  const dir = join(work, c); mkdirSync(dir);
  await ff("ffmpeg", ["-y", "-loglevel", "error", "-i", join(demo, "clips", `${c}.mp4`), "-vf", `fps=${CLIP_FPS}`, join(dir, "%04d.png")]);
  frames[c] = readdirSync(dir).sort().map((f) => pathToFileURL(join(dir, f)).href);
}
const clips = JSON.parse(readFileSync(join(root, "docs/measurements/hero-clips.json"), "utf8")).clips;
const clip = (n) => clips.find((c) => c.name === n);
const offline = clip("offline").commands.map((c) => ({ cmd: c.cmd, atSeconds: c.atSeconds }));
const sceneLen = (id) => { const s = scenes.find((x) => x.id === id); return s.end - s.start; };
const rate = { offline: clip("offline").seconds / (sceneLen("s3") - 0.2), fold: clip("fold").seconds / sceneLen("s5"), dark: clip("dark").seconds / sceneLen("s5") };
const devices = JSON.parse(readFileSync(join(root, "docs/measurements/hero-clips.json"), "utf8")).devices
  .map((d) => `${d.serial}  ${d.profile.padEnd(10)} API ${d.api}`);
const out = readFileSync(join(root, "docs/measurements/hero2-judge.txt"), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
const judge = out.filter((l) => l.startsWith("VIOLATION")).slice(0, 3);
const fail = out.find((l) => l.startsWith("FAIL"));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.addInitScript((h) => { window.HERO2 = h; }, { scenes, frames, fps: CLIP_FPS, offline, rate, devices, judge, fail });
  await page.goto(pathToFileURL(join(import.meta.dirname, "index.html")).href);
  const shots = join(work, "out"); mkdirSync(shots);
  for (let i = 0; i < FPS * LEN; i++) {
    await page.evaluate((t) => window.seek(t), i / FPS);
    await page.evaluate(() => Promise.all([...document.images].filter((x) => x.src).map((x) => x.decode().catch(() => {}))));
    await page.screenshot({ path: join(shots, `${String(i).padStart(4, "0")}.png`) });
  }
  const seq = join(shots, "%04d.png");
  await ff("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", seq, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart", join(outDir, "hero.mp4")]);
  await ff("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", seq, "-vf", "fps=15,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", join(outDir, "hero.gif")]);
  await ff("ffmpeg", ["-y", "-loglevel", "error", "-i", join(shots, `${String(FPS * LEN - 1).padStart(4, "0")}.png`), join(outDir, "hero-poster.png")]);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
for (const f of ["hero.gif", "hero.mp4", "hero-poster.png"]) console.log(f, (statSync(join(outDir, f)).size / 1048576).toFixed(2), "MB");
