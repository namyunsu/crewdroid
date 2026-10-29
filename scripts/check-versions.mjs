// T68: one version everywhere. node scripts/check-versions.mjs [--tag vX.Y.Z]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const json = (p) => JSON.parse(read(p));
const ti = process.argv.indexOf("--tag");
const tag = ti > 0 ? process.argv[ti + 1] : undefined;
if (ti > 0 && !/^v\d+\.\d+\.\d+/.test(tag ?? "")) { console.error(`FAIL: --tag needs vX.Y.Z, got ${tag}`); process.exit(1); }

const server = json("server.json");
const found = {
  "package.json": json("package.json").version,
  ".claude-plugin/plugin.json": json(".claude-plugin/plugin.json").version,
  "server.json version": server.version,
  "server.json packages[0].version": server.packages?.[0]?.version,
  ...(tag ? { [`tag ${tag}`]: tag.slice(1) } : {}),
};
const want = found["package.json"];
const bad = Object.entries(found).filter(([, v]) => v !== want);
for (const [k, v] of Object.entries(found)) console.log(`${v === want ? "PASS" : "FAIL"} ${k}: ${v}`);

// docs/compat.md must list what src/compat.ts warns against (regex, not import: Node 22 cannot load .ts)
const src = read("src/compat.ts"), md = read("docs/compat.md");
const em = src.match(/emulator: "([\d.]+)"/)?.[1];
const imgs = Object.entries(JSON.parse(src.match(/images: (\{[^}]*\})/)[1].replace(/(\d+):/g, '"$1":')));
const compatOk = !!em && md.includes(`| emulator | ${em} `) && imgs.length === 3 && imgs.every(([a, r]) => md.includes(`| google_atd android-${a} (x86_64) | revision ${r} |`));
console.log(`${compatOk ? "PASS" : "FAIL"} docs/compat.md matches src/compat.ts VERIFIED`);

if (bad.length || !compatOk) { console.error(`FAIL: ${bad.length} version mismatches${compatOk ? "" : ", compat.md out of step"}`); process.exit(1); }
console.log(`OK: all versions agree (${want})`);
