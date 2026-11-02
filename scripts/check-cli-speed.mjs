// T79 verify: the CLI starts fast (each command loads only its own module) and the README rows come from the installed path.
//   node scripts/check-cli-speed.mjs   (~1 min, no emulator; packs the package into a temp dir to time `npx crewdroid` vs `crewdroid`)
// Writes docs/measurements/cli-speed.json. Reads docs/measurements/single-vs-studio.json (scripts/measure-single.mjs, ~40 min).
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const RUNS = 6, LIMIT_MS = 246; // 246 = `node bin/crewdroid.mjs --version` before T79, same PC, median of 6

// median wall ms of `cmd args` (one untimed warm-up run first)
function time(cmd, args, opts = {}) {
  const once = () => {
    const t = performance.now();
    const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, ...opts });
    if (r.status !== 0 || !/\d+\.\d+\.\d+/.test(r.stdout)) throw new Error(`${cmd} ${args.join(" ")}: exit ${r.status} ${r.stdout}${r.stderr}`);
    return performance.now() - t;
  };
  once();
  return Math.round(median(Array.from({ length: RUNS }, once)));
}

// (1) startup, as in the T79 origin
const nodeMs = time(process.execPath, ["-e", "console.log('0.0.0')"]);
const binMs = time(process.execPath, [join(root, "bin", "crewdroid.mjs"), "--version"], { cwd: root });
const npxTsxMs = time("npx", ["tsx", "src/cli.ts", "--version"], { cwd: root, shell: true });
console.log(`--version median of ${RUNS}: node -e ${nodeMs} ms, node bin/crewdroid.mjs ${binMs} ms, npx tsx src/cli.ts ${npxTsxMs} ms`);
check(binMs < LIMIT_MS, `node bin/crewdroid.mjs --version ${binMs} ms, want < ${LIMIT_MS} ms`);
check(!/^import (?!type ).* from "\.\//m.test(read("src/cli.ts")),"src/cli.ts: command modules must be imported inside their branch, not at the top");

// (2) `npx crewdroid` vs an installed `crewdroid`: the packed package installed into a temp project
const dir = mkdtempSync(join(tmpdir(), "crewdroid-cli-speed-"));
let npxMs, installedMs;
try {
  execSync(`npm pack --ignore-scripts --pack-destination "${dir}"`, { cwd: root, stdio: "ignore" });
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  execSync(`npm init -y && npm install --no-audit --no-fund --prefer-offline "./${tgz}"`, { cwd: dir, stdio: "ignore" });
  installedMs = time(join(dir, "node_modules", ".bin", "crewdroid"), ["--version"], { cwd: dir, shell: true });
  npxMs = time("npx", ["crewdroid", "--version"], { cwd: dir, shell: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const extra = npxMs - installedMs;
console.log(`installed crewdroid --version ${installedMs} ms, npx crewdroid --version ${npxMs} ms (installed locally, no download): +${extra} ms per call`);
writeFileSync(join(root, "docs", "measurements", "cli-speed.json"), JSON.stringify({
  date: new Date().toISOString(), runs: RUNS, node: process.version, os: `${process.platform}`,
  versionMs: { nodeBare: nodeMs, crewdroidBin: binMs, npxTsxSrcCli: npxTsxMs, installedCrewdroid: installedMs, npxCrewdroid: npxMs, npxExtra: extra },
  method: "median wall ms of 6 runs after one warm-up. crewdroidBin = node bin/crewdroid.mjs --version in the checkout; installedCrewdroid = the node_modules/.bin/crewdroid shim of the packed package installed in a temp project; npxCrewdroid = npx crewdroid --version in that project (package already there, so no download; a first npx call also downloads)",
}, null, 2) + "\n");
if (extra > 200) {
  for (const f of ["README.md", "README.ko.md", ".agents/skills/crewdroid/SKILL.md"]) check(read(f).includes("npm i -g crewdroid"), `${f}: npx costs +${extra} ms per call; tell agents to \`npm i -g crewdroid\` or use MCP`);
}

// (3) single-vs-studio: the CLI rows are the installed path and beat the Studio column; the README shows them
const j = JSON.parse(read("docs/measurements/single-vs-studio.json"));
const s = j.studio.median, c = j.crewdroid.median;
check(!/npx tsx/.test(j.method.calls), "single-vs-studio.json: CLI rows still measured through npx tsx (re-run scripts/measure-single.mjs)");
check(typeof c.mcpReady === "number", "single-vs-studio.json: no MCP first screen read (mcpReady)");
check(c.screenMs < s.screenMs, `screen CLI ${c.screenMs} ms is not below Studio ${s.screenMs} ms`);
check(c.shotMs < s.shotMs, `shot CLI ${c.shotMs} ms is not below Studio ${s.shotMs} ms`);
for (const f of ["README.md", "README.ko.md"]) {
  const t = read(f);
  for (const v of [c.screenMs, c.shotMs]) check(t.includes(`${v} `) || t.includes(`${v}**`), `${f}: missing ${v} from single-vs-studio.json`);
  check(!t.includes("npx tsx src/cli.ts"), `${f}: the note under the table still describes the npx tsx path`);
}

if (fails.length) { console.error(fails.map((f) => "FAIL: " + f).join("\n")); process.exit(1); }
console.log(`OK: CLI starts in ${binMs} ms (< ${LIMIT_MS}), npx +${extra} ms, screen ${c.screenMs} < ${s.screenMs} ms and shot ${c.shotMs} < ${s.shotMs} ms vs Studio`);
