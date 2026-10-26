// T44 verify: node scripts/hero/render.mjs && node scripts/check-hero.mjs
// 15 s hero motion graphic. Boots 3 mixed devices (storyboard.json `profiles`), captures real `shot` PNGs of the sample app, takes
// 4 frames of docs/demo/vibe.gif, reads the measured numbers from docs/measurements at render time, then steps the page's virtual
// clock (seek(t), 30 fps x 15 s) in headless Chromium, screenshots every frame at 960x540 and encodes a 15 fps GIF with ffmpeg.
// Writes docs/demo/hero.gif, docs/demo/hero-poster.png (final frame), docs/measurements/hero.json.
// --captures <dir>: keep the shots there; a later run with the same dir reuses them (shots.json) instead of booting devices.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { chromium } from "playwright";
import { PKG, probeApk, sleep } from "../../src/snapshot.ts";
import { down } from "../../src/up.ts";

const run = promisify(execFile);
const root = join(import.meta.dirname, "../..");
const here = import.meta.dirname;
const { values: v } = parseArgs({ options: { captures: { type: "string" } } });
const sb = JSON.parse(readFileSync(join(here, "storyboard.json"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "crewhero-"));
const ff = (bin, args) => run(bin, args, { windowsHide: true, maxBuffer: 2 ** 26 }).then((r) => r.stdout.trim());
const read = (f) => readFileSync(join(root, "docs/measurements", f), "utf8");
const grab = (f, re) => { const m = read(f).match(re); if (!m) throw new Error(`${f}: no match for ${re}`); return m; };

// Measured numbers, never typed by hand.
const numbers = {
  ready: Number(grab("single.md", /^\| mean \| [\d.]+ \| ([\d.]+) \|/m)[1]), // 1-device ready (s), mean of the cold runs
  loop: JSON.parse(read("demo-vibe.json")).loopSeconds, // vibe loop up..down (s)
  ram: grab("ram.md", /\*\*\d+ MiB \(([\d.]+) GB\)\*\*/)[1], // 3 devices idle, private WS + shared PSS
  disk: grab("slim.md", /^\| \*\*합계\*\* \| [^|]+ \| \*\*[\d.]+ GiB \(([\d.]+) GB\)\*\*/m)[1], // 3 images + 3 base AVDs, idle
};

async function cli(args) {
  const { stdout } = await run(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), args[0], "--json", ...args.slice(1)], { cwd: root, timeout: 900000, windowsHide: true, maxBuffer: 2 ** 26 });
  return JSON.parse(stdout);
}

// Real captures of the sample app on 3 different screens / Android versions.
let shots;
const capDir = v.captures ?? work;
if (existsSync(join(capDir, "shots.json"))) shots = JSON.parse(readFileSync(join(capDir, "shots.json"), "utf8"));
else {
  mkdirSync(capDir, { recursive: true });
  await down(); // makes this process the lock owner; the CLI children inherit CREWDROID_OWNER
  try {
    const { devices } = await cli(["up", "--count", "3", "--profiles", sb.profiles.join(",")]);
    await cli(["install", "all", probeApk()]);
    shots = [];
    for (const [i, d] of devices.entries()) {
      await cli(["launch", d.serial, PKG, "--restart"]);
      await sleep(3000);
      const s = await cli(["shot", d.serial, join(capDir, `shot${i}.png`)]);
      shots.push({ file: `shot${i}.png`, serial: d.serial, api: d.api, profile: d.profile, width: s.width, height: s.height });
    }
    writeFileSync(join(capDir, "shots.json"), JSON.stringify(shots, null, 2));
  } finally {
    await down();
  }
}

// 4 frames of the recorded vibe loop, spread over its body (the last 2 s are the tail card).
const vibeGif = join(root, "docs/demo/vibe.gif");
const vibeLen = Number(await ff("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", vibeGif]));
const vibe = [];
for (let i = 0; i < 4; i++) {
  const f = join(work, `vibe${i}.png`);
  await ff("ffmpeg", ["-y", "-loglevel", "error", "-ss", (((vibeLen - 2) * (i + 0.6)) / 4).toFixed(2), "-i", vibeGif, "-frames:v", "1", "-vf", "crop=iw:ih*0.95:0:ih*0.05", f]); // crop: drop the recorder's timestamp line at the top
  vibe.push(pathToFileURL(f).href);
}

const HERO = { storyboard: sb, numbers, vibe, shots: shots.map((s) => ({ ...s, src: pathToFileURL(join(capDir, s.file)).href })) };
const browser = await chromium.launch();
let shown, layout = [];
try {
  const page = await browser.newPage({ viewport: { width: sb.width, height: sb.height } });
  await page.addInitScript((h) => { window.HERO = h; }, HERO);
  await page.goto(pathToFileURL(join(here, "index.html")).href);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  // Layout guard at every scene's middle: visible text >= 28 px and nothing outside the 960x540 frame.
  for (const s of sb.scenes) {
    await page.evaluate((t) => seek(t), (s.start + s.end) / 2);
    const bad = await page.evaluate(({ id, W, H }) => {
      const out = [];
      for (const e of document.getElementById(id).querySelectorAll("*")) {
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        if (!r.width || cs.opacity === "0" || (e.tagName === "IMG" && !e.classList.contains("on") && e.dataset.vibe)) continue;
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (own && parseFloat(cs.fontSize) < 28) out.push(`${e.tagName}.${e.className} font ${cs.fontSize}`);
        if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) out.push(`${e.tagName}.${e.className} out of frame ${JSON.stringify(r)}`);
      }
      return out;
    }, { id: s.id, W: sb.width, H: sb.height });
    layout.push({ scene: s.id, problems: bad });
  }
  const problems = layout.flatMap((l) => l.problems.map((p) => `${l.scene}: ${p}`));
  if (problems.length) throw new Error(`layout:\n${problems.join("\n")}`);
  const answer = sb.scenes.find((s) => s.id === "answer");
  await page.evaluate((t) => seek(t), answer.end - 0.1);
  shown = { ready: Number(await page.textContent("#counter")), readyText: (await page.textContent("#answer .ready")).trim() };

  const frames = Math.round(sb.seconds * sb.fps);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => seek(t), i / sb.fps);
    await page.screenshot({ path: join(work, `f${String(i).padStart(4, "0")}.png`) });
  }
  mkdirSync(join(root, "docs/demo"), { recursive: true });
  copyFileSync(join(work, `f${String(frames - 1).padStart(4, "0")}.png`), join(root, "docs/demo/hero-poster.png"));
} finally {
  await browser.close();
}

const gif = join(root, "docs/demo/hero.gif");
await ff("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(sb.fps), "-i", join(work, "f%04d.png"), "-filter_complex",
  `fps=${sb.gifFps},split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, gif]);
const [width, height] = (await ff("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", gif])).split(",").map(Number);
const out = {
  date: new Date().toISOString(),
  numbers, shown,
  sources: { ready: "docs/measurements/single.md (mean ready)", loop: "docs/measurements/demo-vibe.json loopSeconds", ram: "docs/measurements/ram.md", disk: "docs/measurements/slim.md" },
  captures: shots.map(({ serial, api, profile, width, height }) => ({ serial, api, profile, width, height })),
  layout,
  gif: { path: "docs/demo/hero.gif", width, height, fps: sb.gifFps, bytes: statSync(gif).size, seconds: Number(await ff("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", gif])) },
};
writeFileSync(join(root, "docs/measurements/hero.json"), JSON.stringify(out, null, 2) + "\n");
rmSync(work, { recursive: true, force: true });
console.log(`hero.gif ${out.gif.width}x${out.gif.height}, ${out.gif.seconds} s, ${out.gif.bytes} bytes; ready ${shown.ready} s (single.md ${numbers.ready}); captures ${out.captures.map((c) => `${c.profile}@API${c.api}`).join(", ")}`);
