// T59: export the allowlist (public-files.json) of this checkout into <out> as the public mirror and commit it there.
// node scripts/release-public.mjs --out <dir> [--fresh] [--message "..."] [--push]
// Run it on `main` with a clean tree. It never pushes unless --push; this wave never uses --push (the user pushes).
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const root = join(import.meta.dirname, "..");
const { values: opt } = parseArgs({ options: { out: { type: "string" }, fresh: { type: "boolean" }, message: { type: "string" }, push: { type: "boolean" } } });
const die = (msg) => { console.error("FAIL: " + msg); process.exit(1); };
if (!opt.out) die('usage: node scripts/release-public.mjs --out <dir> [--fresh] [--message "..."] [--push]');
const out = resolve(opt.out);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// (1) allowlist -> files
if (git(root, "status", "--porcelain", "--untracked-files=no")) die("tracked files are modified; commit first (the export must match a commit)");
const cfg = JSON.parse(readFileSync(join(root, "public-files.json"), "utf8"));
const re = (p) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + (p.endsWith("/") ? "" : "$"));
const inc = cfg.include.map(re), exc = cfg.exclude.map(re);
const stage = (f) => inc.some((r) => r.test(f)) && !exc.some((r) => r.test(f));
const modes = new Map(git(root, "ls-files", "-s").split("\n").map((l) => [l.split("\t")[1], l.slice(0, 6)]));
const files = [...modes.keys()].filter(stage);

// (2) target tree: a worktree of the `public` remote's main, or a fresh root commit
if (existsSync(out) && readdirSync(out).length) die(`${out} is not empty`);
let url = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).repository.url.replace(/^git\+/, "");
if (opt.fresh) {
  mkdirSync(out, { recursive: true });
  git(out, "init", "-q", "-b", "main");
} else {
  url = git(root, "remote", "get-url", "public");
  git(root, "fetch", "-q", "public", "main");
  git(root, "worktree", "add", "-q", "-B", "public-export", out, "public/main");
  for (const e of readdirSync(out)) if (e !== ".git") rmSync(join(out, e), { recursive: true, force: true });
}
for (const f of files) {
  mkdirSync(dirname(join(out, f)), { recursive: true });
  if (f === ".gitignore") // AI NOTE: the private repo ignores its autopilot state folder; the public one has no such folder and must not name it
    writeFileSync(join(out, f), readFileSync(join(root, f), "utf8").split("\n").filter((l) => !/\.ai-log|autopilot state/.test(l)).join("\n"));
  else copyFileSync(join(root, f), join(out, f));
}
writeFileSync(join(out, "CLAUDE.md"), "@AGENTS.md\n");
git(out, "add", "-A");
for (const f of files) if (modes.get(f) === "100755") git(out, "update-index", "--chmod=+x", f);

// (3) checks (fail = exit 1, nothing committed)
const staged = git(out, "ls-files").split("\n").filter(Boolean);
const outside = staged.filter((f) => f !== "CLAUDE.md" && !stage(f));
if (outside.length) die("files outside the allowlist: " + outside.join(", "));
// AI NOTE: PC name, account local part, local paths, the agent-log folder, the removed private app. check-public.mjs holds the same patterns as data, so it is the one exempt file.
const FORBIDDEN = [/NYS/, /jjkng/, /D:[\\/]workspace/i, /C:[\\/]Users[\\/]/i, /\.ai-log/, /private-app/i];
const BINARY = /\.(png|gif|mp4|jar|apk)$/i;
const leaks = [];
for (const f of staged) {
  for (const r of FORBIDDEN) {
    if (r.test(f)) leaks.push(`path ${f} ~ ${r}`);
    if (f !== "scripts/check-public.mjs" && !BINARY.test(f) && r.test(readFileSync(join(out, f), "utf8"))) leaks.push(`content ${f} ~ ${r}`);
  }
}
if (leaks.length) die("scrub:\n  " + leaks.join("\n  "));
console.log(`scrub: ${staged.length} files, no forbidden path or content`);
// npm pack + `npx crewdroid --help` from the tarball + README links + server.json, all inside the export (needs its own node_modules for prepack)
execSync("npm ci --prefer-offline --no-audit --no-fund", { cwd: out, stdio: "inherit" });
try { execFileSync(process.execPath, ["scripts/check-public.mjs"], { cwd: out, stdio: "inherit" }); } catch { die("check-public.mjs failed inside the export"); }

// (4) commit
const version = JSON.parse(readFileSync(join(out, "package.json"), "utf8")).version;
const title = /^## (?:\[([^\]]+)\]|(.+))$/m.exec(readFileSync(join(out, "CHANGELOG.md"), "utf8")); // newest section = first heading
const message = opt.message ?? `crewdroid ${version}: ${title?.[1] ?? title?.[2] ?? "release"}`;
if (!git(root, "config", "user.name") || !git(root, "config", "user.email")) die("git user.name / user.email are not configured");
git(out, "config", "user.name", git(root, "config", "user.name"));
git(out, "config", "user.email", git(root, "config", "user.email"));
git(out, "commit", "-q", "-m", message);
console.log(`committed in ${out}: ${message}`);
const push = opt.fresh ? `git -C "${out}" push --force ${url} HEAD:main` : `git -C "${out}" push public HEAD:main`;
if (opt.push) { console.log("pushing: " + push); execSync(push, { stdio: "inherit" }); }
else console.log("push it yourself (this script did not):\n  " + push);
