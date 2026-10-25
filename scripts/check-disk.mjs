// T15 verify: node scripts/check-disk.mjs [--max-gb 8] [--base-port 5580]
// Real allocation (GetCompressedFileSizeW) of the 3 google_atd images + their crew base AVDs, idle and with
// `up --count 3` running (adds the -read-only clones' temp overlays), then down. Exit 0 only if the running total
// <= --max-gb GiB and the mean boot time is within 20 % of T04 (docs/measurements/after.json).
// Writes docs/measurements/disk.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { diskUse } from "../src/slim.ts";
import { down, up } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "max-gb": { type: "string", default: "8" }, "base-port": { type: "string", default: "5580" } } });
const root = join(import.meta.dirname, "..");
const GiB = (b) => +(b / 2 ** 30).toFixed(2);
const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;

const idle = await diskUse();
let running, devices;
await down();
try {
  const u = await up(3, Number(v["base-port"]));
  devices = u.devices.map((d) => ({ serial: d.serial, profile: d.profile, api: d.api, bootSeconds: d.bootSeconds }));
  running = await diskUse();
} finally {
  await down();
}
const t04 = JSON.parse(readFileSync(join(root, "docs/measurements/after.json"), "utf8")).devices.map((d) => d.bootSeconds);
const boot = { t04Mean: +mean(t04).toFixed(2), mean: +mean(devices.map((d) => d.bootSeconds)).toFixed(2) };
const max = Number(v["max-gb"]);
const errs = [];
if (running.images.length !== 3) errs.push(`want 3 google_atd images, got ${running.images.length}`);
if (GiB(running.totalBytes) > max) errs.push(`running total ${GiB(running.totalBytes)} GiB > ${max} GiB`);
if (boot.mean > boot.t04Mean * 1.2) errs.push(`mean boot ${boot.mean}s > T04 ${boot.t04Mean}s + 20 %`);
const report = { date: new Date().toISOString(), maxGiB: max, idle, running, devices, boot, ok: !errs.length };
writeFileSync(join(root, "docs/measurements/disk.json"), JSON.stringify(report, null, 2) + "\n");
for (const [k, d] of [["idle", idle], ["running", running]]) {
  console.log(`${k}: ${d.images.map((x) => `${x.image} image ${GiB(x.imageBytes)} + AVD ${GiB(x.avdBytes)}`).join(", ")}, temp ${GiB(d.tempBytes)} = ${GiB(d.totalBytes)} GiB (${(d.totalBytes / 1e9).toFixed(2)} GB)`);
}
console.log(`boot mean ${boot.mean}s (T04 ${boot.t04Mean}s)`);
if (errs.length) { console.error("FAIL:\n" + errs.join("\n")); process.exit(1); }
console.log(`OK: 3 images + 3 base AVDs + 3 running clones = ${GiB(running.totalBytes)} GiB <= ${max} GiB, boot ${boot.mean}s`);
