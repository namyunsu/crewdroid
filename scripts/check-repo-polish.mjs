// T65 verify: node scripts/check-repo-polish.mjs && node scripts/check-public.mjs
// No emulator. Community files exist, issue forms have their required fields, every crewdroid command / npm script / check script
// named in CONTRIBUTING and examples exists, examples/judge-your-api exits 1 on the buggy export and 0 on the clean one,
// docs/demo/social-preview.png is 1280x640 and < 1 MB, and check-public.mjs passes.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const fails = [];
const check = (cond, msg) => { if (!cond) { fails.push(msg); console.error("FAIL: " + msg); } };

// (1) files exist
const FILES = ["CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", ".github/PULL_REQUEST_TEMPLATE.md", ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/bug.yml", ".github/ISSUE_TEMPLATE/feature.yml", ".github/ISSUE_TEMPLATE/my-app-report.yml",
  "examples/judge-your-api/README.md", "examples/judge-your-api/rules.json", "examples/judge-your-api/export-buggy.json", "examples/judge-your-api/export-clean.json",
  "examples/maestro-with-network-faults/README.md", "examples/maestro-with-network-faults/flow.yaml", "examples/maestro-with-network-faults/run.mjs", "examples/maestro-with-network-faults/rules.json",
  "examples/triage-a-crash/README.md", "scripts/social-preview.mjs", "docs/demo/social-preview.png"];
for (const f of FILES) check(existsSync(join(root, f)), `missing file: ${f}`);
check(/Contributor Covenant/.test(read("CODE_OF_CONDUCT.md")) && /version 2\.1/.test(read("CODE_OF_CONDUCT.md")) && /github\.com\/namyunsu/.test(read("CODE_OF_CONDUCT.md")), "CODE_OF_CONDUCT: Contributor Covenant 2.1 with the GitHub profile as contact");
check(/security advisor/i.test(read("SECURITY.md")), "SECURITY: points to GitHub security advisories");

// (2) issue forms: no YAML parser in the dependencies, so read the fixed shape these files use (top-level keys, `- type:` blocks)
const REQUIRED = { "bug.yml": ["os", "emulator", "command", "output", "expected", "actual"], "feature.yml": ["problem", "idea"], "my-app-report.yml": ["app-type", "found", "missing"] };
for (const [file, ids] of Object.entries(REQUIRED)) {
  const t = read(`.github/ISSUE_TEMPLATE/${file}`);
  check(/^name: \S/m.test(t) && /^description: \S/m.test(t) && /^body:\s*$/m.test(t), `${file}: needs name, description, body`);
  const blocks = t.split(/\n  - type: /).slice(1);
  for (const id of ids) {
    const b = blocks.find((x) => new RegExp(`^\\s+id: ${id}$`, "m").test(x));
    check(!!b, `${file}: no field with id ${id}`);
    if (b) check(/label: \S/.test(b) && /required: true/.test(b), `${file}: field ${id} needs a label and required: true`);
  }
  check(!/\t/.test(t), `${file}: tab character`);
}
check(/blank_issues_enabled: false/.test(read(".github/ISSUE_TEMPLATE/config.yml")), "config.yml: blank_issues_enabled: false");
check(/What/.test(read(".github/PULL_REQUEST_TEMPLATE.md")) && /Checks run/.test(read(".github/PULL_REQUEST_TEMPLATE.md")), "PR template: what / checks run");

// (3) every command named in code spans exists
const COMMANDS = new Set(/const COMMANDS = "([^"]+)"/.exec(read("src/cli.ts"))[1].split(/,\s*/));
const scripts = JSON.parse(read("package.json")).scripts;
const docs = ["CONTRIBUTING.md", "examples/judge-your-api/README.md", "examples/maestro-with-network-faults/README.md", "examples/triage-a-crash/README.md"];
let seen = 0;
for (const f of docs) {
  // code = ```bash blocks + inline `spans`; untagged blocks are captured output and may hold any text
  const code = [...read(f).matchAll(/```(?:bash|sh|shell)\n([\s\S]*?)```|`([^`\n]+)`/g)].map((m) => m[1] ?? m[2]).join("\n");
  for (const m of code.matchAll(/(?:npx crewdroid|crewdroid|src\/cli\.ts)[ \t]+([a-z][\w-]*)/g)) {
    seen++;
    check(COMMANDS.has(m[1]), `${f}: unknown crewdroid command "${m[1]}"`);
  }
  for (const m of code.matchAll(/npm run ([\w:-]+)/g)) check(!!scripts[m[1]], `${f}: no npm script "${m[1]}"`);
  for (const m of code.matchAll(/scripts\/([\w-]+\.mjs)/g)) check(existsSync(join(root, "scripts", m[1])), `${f}: no script scripts/${m[1]}`);
}
const run = read("examples/maestro-with-network-faults/run.mjs");
for (const m of run.matchAll(/crew\("([a-z]+)"/g)) { seen++; check(COMMANDS.has(m[1]), `run.mjs: unknown crewdroid command "${m[1]}"`); }
console.log(`commands: ${seen} references checked against ${COMMANDS.size} commands`);

// (4) examples/judge-your-api
const judgeIt = (exp) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "judge", "--rules", "examples/judge-your-api/rules.json", "--source", `examples/judge-your-api/export-${exp}.json`], { cwd: root, encoding: "utf8" });
const buggy = judgeIt("buggy"), clean = judgeIt("clean");
check(buggy.status === 1 && /FAIL: 3 violations/.test(buggy.stdout), `judge-your-api buggy: want exit 1 and 3 violations, got exit ${buggy.status}: ${buggy.stdout.trim().split("\n").pop()}`);
check(clean.status === 0 && /OK: 3 rules, 0 violations/.test(clean.stdout), `judge-your-api clean: want exit 0, got exit ${clean.status}: ${clean.stdout.trim()}`);

// (5) social preview: PNG header carries the size
const png = readFileSync(join(root, "docs/demo/social-preview.png"));
check(png.subarray(1, 4).toString() === "PNG" && png.readUInt32BE(16) === 1280 && png.readUInt32BE(20) === 640, "social-preview.png is not 1280x640");
check(png.length < 1024 * 1024, `social-preview.png is ${png.length} bytes (limit 1 MB)`);

// (6) example outputs must be real captures: a leftover CAPTURE-PENDING marker fails
for (const d of ["maestro-with-network-faults", "triage-a-crash"]) check(!read(`examples/${d}/README.md`).includes("CAPTURE-PENDING"), `examples/${d}/README.md: output not captured yet (CAPTURE-PENDING)`);

// (7) public-release checks
try { execFileSync(process.execPath, ["scripts/check-public.mjs"], { cwd: root, stdio: "pipe" }); } catch (e) { check(false, "check-public.mjs failed:\n" + String(e.stdout) + String(e.stderr)); }

if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log("OK: repo polish checks passed");
