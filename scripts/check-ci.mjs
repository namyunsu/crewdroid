// T58 verify (static): node scripts/check-ci.mjs
// Parses .github/workflows/ci.yml with a small subset parser (maps, lists, [a, b], | blocks; no anchors) and asserts the claims.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };

const scalar = (s) => {
  s = s.trim();
  if (s.startsWith("[")) return s.slice(1, -1).split(",").filter((x) => x.trim()).map(scalar);
  if (/^(['"]).*\1$/.test(s)) return s.slice(1, -1);
  return /^\d+$/.test(s) ? Number(s) : s;
};
function parse(text) {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() && !l.trim().startsWith("#"));
  let i = 0;
  const ind = (l) => l.length - l.trimStart().length;
  function block(indent) {
    if (lines[i].trimStart().startsWith("- ")) {
      const arr = [];
      while (i < lines.length && ind(lines[i]) === indent && lines[i].trimStart().startsWith("- ")) {
        lines[i] = " ".repeat(indent + 2) + lines[i].trimStart().slice(2); // "- k: v" becomes a map line two columns deeper
        if (/^\s*[^\s:][^:]*:(\s|$)/.test(lines[i]) && !/^\s*['"]/.test(lines[i])) arr.push(block(indent + 2)); else arr.push(scalar(lines[i++]));
      }
      return arr;
    }
    const obj = {};
    while (i < lines.length && ind(lines[i]) === indent && !lines[i].trimStart().startsWith("- ")) {
      const m = lines[i++].trim().match(/^([^:]+?):\s*(.*)$/);
      const [, k, v] = m;
      if (v === "|") { const parts = []; while (i < lines.length && ind(lines[i]) > indent) parts.push(lines[i++].trim()); obj[k] = parts.join("\n"); }
      else if (v) obj[k] = scalar(v);
      else obj[k] = i < lines.length && ind(lines[i]) > indent ? block(ind(lines[i])) : i < lines.length && ind(lines[i]) === indent && lines[i].trimStart().startsWith("- ") ? block(indent) : "";
    }
    return obj;
  }
  return block(0);
}

const file = join(root, ".github", "workflows", "ci.yml");
claim(existsSync(file), "ci.yml exists");
const ci = parse(readFileSync(file, "utf8"));

const on = ci.on ?? {};
claim(Object.keys(on).sort().join() === "pull_request,push", `triggers are only push and pull_request: ${Object.keys(on)}`);
claim(String(on.push?.branches) === "main", `push only on main: ${on.push?.branches}`);
claim(!/ai\//.test(JSON.stringify(on)), "no ai/** branch trigger");
claim(["push", "pull_request"].every((t) => on[t]?.["paths-ignore"]?.includes("docs/**")), "both triggers paths-ignore docs/**");

const jobs = ci.jobs ?? {};
claim(["test", "emulator-smoke"].every((j) => jobs[j]), `jobs: ${Object.keys(jobs)}`);
for (const [n, j] of Object.entries(jobs)) claim(j.if === "github.repository == 'namyunsu/crewdroid'", `job ${n} has the repository guard`);

const m = jobs.test?.strategy?.matrix ?? {};
claim(["windows-latest", "macos-latest", "ubuntu-latest"].every((o) => m.os?.includes(o)), `test matrix os: ${m.os}`);
claim(m.node?.includes(22) && m.node?.includes(24), `test matrix node: ${m.node}`);
const runs = (j) => (j?.steps ?? []).map((s) => s.run ?? "").join("\n");
claim(["npm ci", "npx tsc --noEmit", "npm test"].every((c) => runs(jobs.test).includes(c)), "test runs npm ci, tsc --noEmit, npm test");

const smoke = jobs["emulator-smoke"] ?? {};
claim(smoke["runs-on"] === "ubuntu-latest", "emulator-smoke runs on ubuntu-latest");
claim(runs(smoke).includes("kvm") && runs(smoke).includes("udevadm"), "emulator-smoke enables KVM with the udev rule");
claim((smoke.steps ?? []).some((s) => String(s.uses).startsWith("actions/cache@")), "emulator-smoke caches the SDK dir");
claim((smoke.steps ?? []).some((s) => String(s.uses).startsWith("actions/upload-artifact@")), "emulator-smoke uploads the screenshot");

// every repo script a step calls exists
const called = [...new Set([...JSON.stringify(ci).matchAll(/\b((?:scripts|src|bin)\/[\w./-]+\.(?:mjs|ts))/g)].map((x) => x[1]))];
claim(called.length > 0 && called.every((f) => existsSync(join(root, f))), `scripts called exist: ${called.join(", ")}`);

const readme = readFileSync(join(root, "README.md"), "utf8");
claim(readme.includes("actions/workflows/ci.yml/badge.svg"), "README has the CI badge");
// Linux/macOS runners execute ./gradlew straight from the checkout, so git must store it as executable.
claim(execFileSync("git", ["ls-files", "-s", "probe-app/gradlew"], { cwd: root, encoding: "utf8" }).startsWith("100755"), "probe-app/gradlew is stored executable (100755)");

// T68: ci checks versions and skill files; release.yml is tag-only, OIDC, no token secret
claim(runs(jobs.test).includes("node scripts/check-versions.mjs"), "test job runs check-versions");
claim(jobs.skills?.if === "github.repository == 'namyunsu/crewdroid'" && runs(jobs.skills).includes("scripts/check-agent-files.mjs"), "skills job runs check-agent-files");
const relText = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
const rel = parse(relText);
claim(Object.keys(rel.on ?? {}).join() === "push" && String(rel.on.push?.tags) === "v*", `release triggers only on push of tags v*: ${Object.keys(rel.on ?? {})}`);
claim(!/schedule|workflow_dispatch/.test(relText), "release has no schedule or manual trigger");
claim(rel.jobs?.publish?.if === "github.repository == 'namyunsu/crewdroid'", "release job has the repository guard");
claim(String(rel.jobs?.publish?.permissions?.["id-token"]) === "write", "release has id-token: write");
claim(!/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/.test(relText), "release uses no token secret");
const relRun = runs(rel.jobs?.publish);
const at = (s) => relRun.indexOf(s);
claim([at("check-versions.mjs --tag"), at("npm ci"), at("tsc --noEmit"), at("npm test"), at("npm publish --provenance --access public"), at("login github-oidc"), at("mcp-publisher publish")].every((x, i, a) => x >= 0 && (i === 0 || x > a[i - 1])), "release steps in order: check-versions --tag, npm ci, tsc, test, publish --provenance, github-oidc login, mcp-publisher publish");
claim(/MCP_PUBLISHER_VERSION: \d+\.\d+\.\d+/.test(relText), "mcp-publisher version is pinned");

if (errs.length) { console.log(`FAIL: ${errs.length} claims failed`); process.exit(1); }
console.log("OK: ci workflow claims hold");
