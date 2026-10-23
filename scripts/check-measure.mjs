// usage: node scripts/check-measure.mjs <json> <n>  -> exit 0 only if n devices each have disk/boot/ram/cpu numbers
import { readFileSync } from "node:fs";
const [file, n] = process.argv.slice(2);
const d = JSON.parse(readFileSync(file, "utf8"));
const devs = d.devices ?? [];
const ok = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const bad = devs.filter((x) => !(ok(x.diskBytes) && ok(x.bootSeconds) && ok(x.ramMB) && typeof x.cpuPercent === "number" && Number.isFinite(x.cpuPercent) && x.cpuPercent >= 0));
if (devs.length !== Number(n) || bad.length) {
  console.error(`FAIL: want ${n} complete devices, got ${devs.length}, incomplete ${bad.length}`);
  process.exit(1);
}
console.log(`OK: ${devs.length} devices complete`);
