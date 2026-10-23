// T14 verify: node scripts/check-render.mjs [--base-port 5580] [--window]
// `up --count 3` (mixed API 31/34/36) -> start the probe/sample app on each -> screencap -> fail if any image is >99 %
// one colour (ATD's debug.hwui.drawing_enabled=0 made every app frame black, ADR 0003) -> down. PNGs: docs/measurements/render-<serial>.png
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb, assertSerial } from "../src/adb.ts";
import { adbPath } from "../src/sdk.ts";
import { PKG, sleep } from "../src/snapshot.ts";
import { down, up } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, window: { type: "boolean", default: false } } });
const MAX_SHARE = 0.99;
const out = join(import.meta.dirname, "..", "docs/measurements");

// Share of the most common RGB colour in a PNG (decoded by ffmpeg, as check-demo-gif does).
function topShare(png) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: png, maxBuffer: 2 ** 30 });
  if (r.status !== 0 || !r.stdout.length) throw new Error(`ffmpeg could not decode screencap: ${r.stderr}`);
  const count = new Map();
  for (let i = 0; i < r.stdout.length; i += 3) { const k = r.stdout.readUIntBE(i, 3); count.set(k, (count.get(k) ?? 0) + 1); }
  const [rgb, n] = [...count].sort((a, b) => b[1] - a[1])[0];
  return { share: n / (r.stdout.length / 3), rgb: rgb.toString(16).padStart(6, "0"), colours: count.size };
}

const problems = [];
await down();
try {
  const u = await up(3, Number(v["base-port"]), undefined, v.window);
  for (const d of u.devices) {
    await adb(d.serial, ["shell", "am", "start", "-W", "-n", `${PKG}/.ProbeActivity`]);
    await sleep(3000);
    const png = spawnSync(adbPath(), ["-s", assertSerial(d.serial), "exec-out", "screencap", "-p"], { maxBuffer: 2 ** 28 }).stdout;
    writeFileSync(join(out, `render-${d.serial}.png`), png);
    const t = topShare(png);
    const ok = t.share <= MAX_SHARE;
    console.log(`${d.serial} ${d.profile} API ${d.api} ${d.wmSize.replace(/\s+/g, " ")}: top colour #${t.rgb} ${(t.share * 100).toFixed(1)} %, ${t.colours} colours ${ok ? "ok" : "FLAT"}`);
    if (!ok) problems.push(`${d.serial} (${d.profile}, API ${d.api}) is ${(t.share * 100).toFixed(1)} % #${t.rgb}`);
  }
} finally {
  await down();
}
if (problems.length) { console.error(`FAIL: ${problems.join("; ")}`); process.exit(1); }
console.log("OK: probe app renders on all 3 up devices (API 31/34/36)");
