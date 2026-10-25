// T26 verify: node scripts/check-skills.mjs [--base-port 5580] [--server-port 5595] [--static] [--out file]
// Static: every .agents/skills/*/SKILL.md keeps T25's frontmatter rules, is <= 150 lines, and names only `crewdroid <cmd>` that
// src/cli.ts implements. Then boots 1 device (API 34), installs the probe APK, starts a clean sample server and runs every
// ```bash verify``` block in Git Bash (set -eo pipefail) with $SERIAL $PKG $APK $SERVER_PORT exported; any non-zero exit fails. Downs.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { adbPath } from "../src/sdk.ts";
import { down, up } from "../src/up.ts";
import { PKG, probeApk } from "../src/snapshot.ts";
import { startApp } from "../sample/server/app.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, "server-port": { type: "string", default: "5595" }, static: { type: "boolean", default: false }, out: { type: "string" } } });
const root = join(import.meta.dirname, "..");
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const errs = [];
const claim = (ok, text) => { say(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };

// ---- static ----
const REQUIRED = ["android-triage", "android-screen", "android-permissions-intents", "android-apk", "android-perf", "android-offline-concurrency"];
const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const cmds = new Set([...readFileSync(join(root, "src/cli.ts"), "utf8").matchAll(/cmd === "([\w-]+)"/g)].map((m) => m[1]));
const skillsDir = join(root, ".agents/skills");
const dirs = readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory());
for (const d of REQUIRED) claim(dirs.includes(d), `skill ${d} exists`);
const blocks = []; // { skill, n, code }
for (const d of dirs) {
  const f = join(skillsDir, d, "SKILL.md");
  if (!existsSync(f)) { claim(false, `${d}/SKILL.md missing`); continue; }
  const text = readFileSync(f, "utf8");
  const bad = [];
  const n = text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
  if (n > 150) bad.push(`${n} lines > 150`);
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const keys = {};
  if (!m) bad.push("no frontmatter");
  else for (const l of m[1].split(/\r?\n/)) { const k = l.match(/^([\w-]+):\s*(.*)$/); if (k) keys[k[1]] = k[2]; }
  if (keys.name !== d) bad.push(`name "${keys.name}" != dir`);
  if (!keys.description || keys.description.length > 1024) bad.push("description missing or > 1024 chars");
  for (const k of Object.keys(keys)) if (!allowed.has(k)) bad.push(`non-portable field "${k}"`);
  // `crewdroid <cmd>` inside code (fenced blocks and inline spans) must be a real cli.ts command
  const code = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g)].map((x) => x[1] ?? x[2]).join("\n");
  for (const c of code.matchAll(/(?:^|[\s;|&(])crewdroid[ \t]+([a-z][\w-]*)/gm)) if (!cmds.has(c[1])) bad.push(`unknown command \`crewdroid ${c[1]}\``);
  const vb = [...text.matchAll(/```bash verify\r?\n([\s\S]*?)```/g)].map((x) => x[1]);
  vb.forEach((code, i) => blocks.push({ skill: d, n: i + 1, code }));
  if (REQUIRED.includes(d) && !vb.length) bad.push("no ```bash verify``` block");
  if (REQUIRED.includes(d) && !/what this cannot tell you/i.test(text)) bad.push('no "what this cannot tell you" line');
  claim(!bad.length, `${d}: ${n} lines, ${vb.length} verify blocks${bad.length ? " | " + bad.join("; ") : ""}`);
}

// Git Bash, not WSL's bash.exe: from $SHELL or next to git on PATH
function gitBash() {
  if (process.platform !== "win32") return "bash";
  const cands = [process.env.SHELL ?? ""];
  for (const g of spawnSync("where", ["git"], { encoding: "utf8" }).stdout.split(/\r?\n/).filter(Boolean))
    for (let p = dirname(g); p !== dirname(p); p = dirname(p)) cands.push(join(p, "bin", "bash.exe"));
  const b = cands.find((c) => /bash\.exe$/i.test(c) && existsSync(c));
  if (!b) throw new Error("Git Bash not found (needs git for Windows)");
  return b;
}

// One verify block -> { code, out }. `crewdroid` = this checkout's CLI; `adb` only with -s emulator-<port> (USB phone guard).
const PRELUDE = `set -eo pipefail
crewdroid() { node --import "$CREW_TSX" "$CREW_CLI" "$@"; }
adb() { if [ "$1" != "-s" ] || ! [[ "$2" =~ ^emulator-[0-9]+$ ]]; then echo "check-skills: adb needs -s emulator-<port>, got: $*" >&2; return 2; fi; "$CREW_ADB" "$@"; }
`;
function runBlock(bash, cwd, env, code) {
  return new Promise((ok) => {
    const p = spawn(bash, ["-c", PRELUDE + code], { cwd, env, windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill(), 300000);
    p.on("close", (c) => { clearTimeout(t); ok({ code: c ?? 1, out }); });
  });
}

let server, tmp;
if (!v.static) try {
  const bash = gitBash();
  await down();
  tmp = mkdtempSync(join(tmpdir(), "crewskills-"));
  const sport = Number(v["server-port"]);
  server = await startApp({ port: sport, dir: join(tmp, "server") });
  const r = await up(1, Number(v["base-port"]), ["s24ultra"]);
  const d = r.devices[0];
  claim(d.api === 34, `${d.serial} ${d.profile} API ${d.api}`);
  claim(/Success/.test(await adb(d.serial, ["install", "-r", probeApk()], 120000)), `probe APK installed`);
  const env = {
    ...process.env, SERIAL: d.serial, PKG, APK: probeApk(), SERVER_PORT: String(sport),
    CREW_CLI: join(root, "src", "cli.ts"), CREW_TSX: import.meta.resolve("tsx"), CREW_ADB: adbPath(),
    MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*", // Git Bash must not rewrite /data/... device paths into C:/Program Files/...
  };
  for (const b of blocks) {
    const cwd = join(tmp, b.skill);
    mkdirSync(cwd, { recursive: true }); // blocks of one skill share a cwd (triage.txt, rules.json ...)
    const t0 = Date.now(), res = await runBlock(bash, cwd, env, b.code);
    const tail = res.out.trim().split(/\r?\n/).slice(-6).map((l) => "    " + l).join("\n");
    claim(res.code === 0, `${b.skill} block ${b.n}: exit ${res.code} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n${tail}`);
  }
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  await down().catch(() => {});
  server?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}
say(errs.length ? `FAIL: ${errs.length} claim(s)` : `OK: ${dirs.length} skills hold${v.static ? " (static only)" : `, ${blocks.length} verify blocks ran on a crew device`}`);
if (v.out) writeFileSync(v.out, lines.join("\n") + "\n");
process.exit(errs.length ? 1 : 0);
