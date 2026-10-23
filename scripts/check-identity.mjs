// usage: node scripts/check-identity.mjs <identity.json>
// Exit 0 only if: every clone reported all 6 values (no read errors), and after the `distinct` step every value is unique
// except those listed in the UNCHANGEABLE set (documented in docs/measurements/identity.md).
import { readFileSync } from "node:fs";
const UNCHANGEABLE = ["roSerialno", "roBootSerialno"];
const d = JSON.parse(readFileSync(process.argv[2], "utf8"));
const KEYS = ["androidId", "appAndroidId", "roSerialno", "roBootSerialno", "wifiMac", "hostname"];
const errs = [];
for (const [name, rows] of [["before", d.before], ["after", d.after ?? d.before]]) {
  if (rows.length !== d.count) errs.push(`${name}: ${rows.length} rows, want ${d.count}`);
  for (const r of rows) for (const k of KEYS) if (typeof r[k] !== "string" || r[k].startsWith("(")) errs.push(`${name} ${r.serial} ${k}: unreadable '${r[k]}'`);
}
for (const k of KEYS.filter((k) => !UNCHANGEABLE.includes(k)))
  if (new Set((d.after ?? d.before).map((r) => r[k])).size < d.count) errs.push(`still not distinct: ${k}`);
if (errs.length) { console.error("FAIL:\n" + errs.join("\n")); process.exit(1); }
console.log(`OK: ${d.count} clones, collisions before=[${d.collisions}], unchangeable=[${d.stillSame}]`);
