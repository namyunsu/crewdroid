// T27 verify: the repo is ready to go public (scrub, LICENSE, README, npx from tarball, server.json).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const fails = [];
const check = (cond, msg) => { if (!cond) { fails.push(msg); console.error("FAIL: " + msg); } };

// (1) scrub
const FORBIDDEN = [/NYS/, /jjkng/, /C:\/Users\//, /C:\\Users\\/, /D:\/workspace/, /D:\\workspace/, /R3CT\w+/];
// AI NOTE: these hold the patterns themselves, fake serials used as negative test input, or the private agent notes (CLAUDE.md, never packed; T25 reduces it to `@AGENTS.md`, release.md tells the user to decide).
const SCRUB_SKIP = new Set(["scripts/check-public.mjs", "test/adb.test.ts", "scripts/check-mcp-server.mjs", "CLAUDE.md"]);
const files = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean)
  .filter((f) => !f.startsWith("docs/") && !f.startsWith(".ai-log/") && !SCRUB_SKIP.has(f) && !f.endsWith(".jar"));
for (const f of files) {
  if (!existsSync(join(root, f))) continue; // staged rename / deletion
  const text = read(f);
  for (const re of FORBIDDEN) if (re.test(text)) check(false, `scrub: ${f} matches ${re}`);
}
console.log(`scrub: ${files.length} files checked`);

// (2) LICENSE
check(existsSync(join(root, "LICENSE")) && /^MIT License/.test(read("LICENSE")) && /Copyright \(c\) 2026 Yunsu Nam/.test(read("LICENSE")), "LICENSE is MIT, copyright 2026 Yunsu Nam");

// (3) README
const readme = read("README.md");
check(readme.includes("npx crewdroid up --count 3"), "README: install line `npx crewdroid up --count 3`");
check(/"mcpServers"[\s\S]*"crewdroid"[\s\S]*"-y", "crewdroid", "mcp"/.test(readme), "README: mcpServers block with npx -y crewdroid mcp");
check(/\| Disk \|[^\n]*24\.7 GiB[^\n]*6\.99 GiB/.test(readme), "README: numbers table (disk)"); // boot row dropped 2026-10-27: snapshot boot != ready, misleading
check(/!\[[^\]]*\]\(docs\/demo\/hero\.gif\)/.test(readme), "README: hero image docs/demo/hero.gif");
for (const m of readme.matchAll(/\]\((?!https?:|cursor:|#)([^)]+)\)/g)) {
  if (m[1] !== "AGENTS.md") check(existsSync(join(root, m[1])), `README: link target exists: ${m[1]}`); // AGENTS.md is T25's
}

// (4) tarball works with npx
const tmp = mkdtempSync(join(tmpdir(), "crewdroid-pack-"));
try {
  const tgz = execSync(`npm pack --silent --pack-destination "${tmp}"`, { cwd: root, encoding: "utf8" }).trim().split("\n").pop();
  const inst = join(tmp, "inst");
  mkdirSync(inst);
  execSync("npm init -y", { cwd: inst, stdio: "ignore" });
  execSync(`npm i --prefer-offline --no-audit --no-fund "${join(tmp, tgz)}"`, { cwd: inst, stdio: "ignore" });
  const help = execSync("npx crewdroid --help", { cwd: inst, encoding: "utf8" });
  check(/\bup\b/.test(help) && /\bmcp\b/.test(help), "npx crewdroid --help lists up and mcp");
  console.log("npx crewdroid --help:\n" + help.trim());
} catch (e) {
  check(false, "npm pack / install / npx: " + e.message.split("\n")[0]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// (5) server.json
const pkg = JSON.parse(read("package.json")), srv = JSON.parse(read("server.json"));
check(pkg.private !== true, "package.json is not private");
check(srv.name === pkg.mcpName, "server.json name == mcpName");
check(srv.version === pkg.version, "server.json version == package.json version");
check(srv.packages?.[0]?.identifier === pkg.name, "server.json packages[0].identifier == package name");
check(srv.packages?.[0]?.version === pkg.version && srv.packages?.[0]?.transport?.type === "stdio", "server.json package version and stdio transport");

if (fails.length) { console.error(`\n${fails.length} check(s) failed`); process.exit(1); }
console.log("OK: public-release checks passed");
