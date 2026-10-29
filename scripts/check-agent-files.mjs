// Verifies T25: agent-facing files. Formats: docs/source/research-ai-discoverability.md sections 2-3.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const errors = [];
const fail = (m) => errors.push(m);
const read = (p) => readFileSync(p, "utf8");
const json = (p) => JSON.parse(read(p));

// AGENTS.md: size cap and every cli.ts command named
if (!existsSync("AGENTS.md")) fail("AGENTS.md missing");
else {
  const agents = read("AGENTS.md");
  if (Buffer.byteLength(agents) > 32 * 1024) fail("AGENTS.md > 32 KiB");
  const cmds = [...new Set([...read("src/cli.ts").matchAll(/cmd === "([\w-]+)"/g)].map((m) => m[1]))];
  for (const c of cmds) if (!agents.includes("`" + c + "`")) fail(`AGENTS.md does not name command \`${c}\``);
  // Commands table: a row whose status is "planned" must not name a command the CLI already implements
  for (const row of agents.split(/\r?\n/).filter((l) => l.startsWith("| `"))) {
    const cells = row.split("|").map((s) => s.trim());
    for (const [, c] of cells[1].matchAll(/`([\w-]+)`/g))
      if (cells[cells.length - 2] === "planned" && cmds.includes(c)) fail(`AGENTS.md marks implemented command \`${c}\` as planned`);
  }
}

// CLAUDE.md first line
if (read("CLAUDE.md").split(/\r?\n/)[0] !== "@AGENTS.md") fail("CLAUDE.md line 1 is not @AGENTS.md");

// plugin.json
const banned = ["claude-", "anthropic-"];
const plugin = json(".claude-plugin/plugin.json");
if (plugin.name !== "crewdroid") fail("plugin.json name != crewdroid");
if (banned.some((p) => plugin.name.startsWith(p))) fail("plugin.json name has banned prefix");
if (plugin.version !== json("package.json").version) fail("plugin.json version != package.json version");
const root = (p) => p.replace("${CLAUDE_PLUGIN_ROOT}", ".");
for (const s of [].concat(plugin.skills ?? [])) if (!existsSync(root(s))) fail(`plugin.json path missing: ${s}`);
for (const [n, srv] of Object.entries(plugin.mcpServers ?? {}))
  for (const a of srv.args ?? []) if (a.includes("${CLAUDE_PLUGIN_ROOT}") && !existsSync(root(a))) fail(`mcpServers.${n} path missing: ${a}`);

// marketplace.json
const mp = json(".claude-plugin/marketplace.json");
if (mp.plugins?.[0]?.source !== "./") fail("marketplace.json plugins[0].source != ./");

// .mcp.json
if (!json(".mcp.json").mcpServers?.crewdroid) fail(".mcp.json has no crewdroid server");

// skills
const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const skillsDir = ".agents/skills";
for (const d of readdirSync(skillsDir).filter((d) => statSync(join(skillsDir, d)).isDirectory())) {
  const f = join(skillsDir, d, "SKILL.md");
  if (!existsSync(f)) { fail(`${f} missing`); continue; }
  const m = read(f).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { fail(`${f} has no frontmatter`); continue; }
  const keys = {};
  for (const line of m[1].split(/\r?\n/)) { const k = line.match(/^([\w-]+):\s*(.*)$/); if (k) keys[k[1]] = k[2]; }
  if (keys.name !== d) fail(`${f} name "${keys.name}" != dir "${d}"`);
  if (!keys.description || keys.description.length > 1024) fail(`${f} description missing or > 1024 chars`);
  for (const k of Object.keys(keys)) if (!allowed.has(k)) fail(`${f} has non-portable field "${k}"`);
}

// claude plugin validate --strict. Unavoidable exception: plugin root == repo root, so the validator always warns
// "CLAUDE.md at the plugin root is not loaded" (CLAUDE.md must stay for Claude Code). Any other warning/error fails.
const hasClaude = spawnSync("claude --version", { shell: true, encoding: "utf8" }).status === 0;
const v = hasClaude ? spawnSync("claude plugin validate --strict .", { shell: true, encoding: "utf8" }) : { status: 0 };
if (!hasClaude) console.log("validate --strict: skipped (claude CLI not installed, e.g. on CI)");
else if (v.status !== 0) {
  const j = JSON.parse(spawnSync("claude plugin validate --strict --json .", { shell: true, encoding: "utf8" }).stdout);
  const items = [j.manifest, ...j.contents].filter(Boolean);
  const bad = items.flatMap((i) => [...i.errors, ...i.warnings.filter((w) => !/^CLAUDE.md at the plugin root/.test(w.message))]);
  if (bad.length) fail("claude plugin validate --strict: " + bad.map((x) => x.message).join("; "));
  else console.log("validate --strict: only the known CLAUDE.md plugin-root warning (tolerated)");
} else console.log("validate --strict: clean");

if (errors.length) { console.error(errors.map((e) => "FAIL: " + e).join("\n")); process.exit(1); }
console.log("OK: agent files hold (AGENTS.md, CLAUDE.md import, plugin, marketplace, skills)");
