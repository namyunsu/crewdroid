// T16 verify: node scripts/check-ram.mjs [--count 3] [--max-mb 4300] [--base-port 5580] [--idle-seconds 60] [--out file]
// `up --count N` (mixed profiles + APIs, re-prepares base snapshots if the avd.ts KNOBS changed) -> idle -> per emulator
// process Private Bytes, private / shared working set and shared PSS (src/measure.ts memStats) -> down.
// total = sum of private working set + shared PSS (a page shared by clones counts once); oldWs = T01's sum of WorkingSet64.
// Writes docs/measurements/ram.json (or --out). Exit 0 only if N devices were measured and total <= --max-mb MiB.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { KNOBS } from "../src/avd.ts";
import { memStats } from "../src/measure.ts";
import { down, up } from "../src/up.ts";

const { values: v } = parseArgs({ options: { count: { type: "string", default: "3" }, "max-mb": { type: "string", default: "4300" }, "base-port": { type: "string", default: "5580" }, "idle-seconds": { type: "string", default: "60" }, out: { type: "string" } } });
const root = join(import.meta.dirname, "..");
const MB = (b) => Math.round(b / 2 ** 20);
const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);

let devices;
await down();
try {
  const u = await up(Number(v.count), Number(v["base-port"]));
  await new Promise((r) => setTimeout(r, Number(v["idle-seconds"]) * 1000));
  devices = await Promise.all(u.devices.map(async (d) => {
    const procs = await memStats(`-port ${d.port}([ "]|$)`);
    return {
      serial: d.serial, profile: d.profile, api: d.api, bootSeconds: d.bootSeconds,
      privateBytesMB: MB(sum(procs, "privateBytes")), privateWsMB: MB(sum(procs, "privateWs")), sharedWsMB: MB(sum(procs, "sharedWs")),
      sharedPssMB: MB(sum(procs, "sharedPss")), oldWsMB: MB(sum(procs, "ws")),
      procs: procs.map((p) => ({ name: p.name, privateBytesMB: MB(p.privateBytes), wsMB: MB(p.ws), privateWsMB: MB(p.privateWs), sharedWsMB: MB(p.sharedWs), sharedPssMB: MB(p.sharedPss) })),
    };
  }));
} finally {
  await down();
}
const total = { totalMB: sum(devices, "privateWsMB") + sum(devices, "sharedPssMB"), privateWsMB: sum(devices, "privateWsMB"), sharedPssMB: sum(devices, "sharedPssMB"), sharedWsMB: sum(devices, "sharedWsMB"), privateBytesMB: sum(devices, "privateBytesMB"), oldWsMB: sum(devices, "oldWsMB") };
const max = Number(v["max-mb"]);
const report = { date: new Date().toISOString(), knobs: KNOBS, idleSeconds: Number(v["idle-seconds"]), maxMB: max, total, devices, ok: devices.length === Number(v.count) && total.totalMB <= max };
writeFileSync(v.out ?? join(root, "docs/measurements/ram.json"), JSON.stringify(report, null, 2) + "\n");
for (const d of devices) console.log(`${d.serial} ${d.profile}@API${d.api} boot ${d.bootSeconds}s: privateWs ${d.privateWsMB} + sharedPss ${d.sharedPssMB} MB (sharedWs ${d.sharedWsMB}, Private Bytes ${d.privateBytesMB}, old WS ${d.oldWsMB})`);
console.log(`knobs ${JSON.stringify(KNOBS)}`);
console.log(`total ${total.totalMB} MiB (${(total.totalMB * 2 ** 20 / 1e9).toFixed(2)} GB); Private Bytes ${total.privateBytesMB} MiB; old WS sum ${total.oldWsMB} MiB`);
if (!report.ok) { console.error(`FAIL: ${devices.length}/${v.count} devices, total ${total.totalMB} MiB > ${max} MiB?`); process.exit(1); }
console.log(`OK: ${devices.length} devices host RAM ${total.totalMB} MiB <= ${max} MiB (old WS ${total.oldWsMB} MiB)`);
