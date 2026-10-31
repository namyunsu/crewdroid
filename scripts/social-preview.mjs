// T65: node scripts/social-preview.mjs -> docs/demo/social-preview.png (1280x640, < 1 MB).
// Name, the positioning line and 3 real device captures (docs/demo/clips/main-*.png, from scripts/hero/clips.mjs), rendered in headless Chromium.
// Upload it by hand: GitHub repo Settings -> General -> Social preview.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = join(import.meta.dirname, "..");
const shot = (f) => "data:image/png;base64," + readFileSync(join(root, "docs/demo/clips", f)).toString("base64");
const devices = [["main-s24ultra.png", "Galaxy S24 Ultra"], ["main-fold5-main.png", "Galaxy Z Fold5"], ["main-flip7-main.png", "Galaxy Z Flip7"]];

// Contrast on #0b1220: #f3f6fb 17:1, #3ddc84 10:1, #b8c4d9 10:1. Text sizes >= 28 px except the 24 px device labels.
const html = `<!doctype html><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 1280px; height: 640px; overflow: hidden; display: flex; align-items: center; gap: 40px; padding: 0 48px;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #f3f6fb;
  background: radial-gradient(circle at 20% 10%, #1a2a48 0%, #0b1220 65%); }
.text { flex: 0 0 440px; }
h1 { font-size: 84px; font-weight: 800; letter-spacing: -2px; color: #3ddc84; }
p { margin-top: 28px; font-size: 32px; line-height: 1.35; }
.sub { margin-top: 24px; font-size: 28px; color: #b8c4d9; }
.devices { display: flex; align-items: center; gap: 22px; }
figure { text-align: center; }
img { display: block; height: 370px; border-radius: 22px; border: 3px solid #2b3b5c; }
figcaption { margin-top: 14px; font-size: 24px; color: #b8c4d9; }
</style><body>
<div class="text"><h1>crewdroid</h1>
<p>The Android emulator your AI agent drives on half the RAM.</p>
<div class="sub">Network, battery, location, screen and Android version, set per device.</div></div>
<div class="devices">${devices.map(([f, n]) => `<figure><img src="${shot(f)}"><figcaption>${n}</figcaption></figure>`).join("")}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
await page.setContent(html);
const out = join(root, "docs/demo/social-preview.png");
await page.screenshot({ path: out });
await browser.close();
console.log(`${out} ${(statSync(out).size / 1024).toFixed(0)} KB`);
