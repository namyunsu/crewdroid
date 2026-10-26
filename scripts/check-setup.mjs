// usage: node scripts/check-setup.mjs -> `crewdroid setup` claims (FR-26):
// (a) this machine's SDK: every step present, nothing downloaded, exit 0, < 30 s
// (b) --dry-run into an empty temp dir: 5 steps, missing ones have sizes, temp dir still empty
// (c) --only cmdline-tools,platform-tools --yes: platform-tools/adb version runs
// (d) non-interactive without --yes: exit 1 mentioning --yes
// Downloads ~160 MB (cmdline-tools + platform-tools) in (c).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = (args) => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "setup", ...args, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 900000 });
const must = (ok, msg) => { if (!ok) throw new Error(msg); };
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "crew-setup-")); dirs.push(d); return d; };

try {
  let t = Date.now();
  let r = cli([]);
  must(r.status === 0, `(a) exit ${r.status}: ${r.stdout}${r.stderr}`);
  let o = JSON.parse(r.stdout);
  must(o.steps.length === 5 && o.steps.every((s) => s.status === "present"), `(a) not all present: ${r.stdout}`);
  must(Date.now() - t < 30000, `(a) took ${Date.now() - t} ms`);

  const t1 = tmp();
  r = cli(["--sdk", t1, "--dry-run"]);
  must(r.status === 0, `(b) exit ${r.status}: ${r.stdout}${r.stderr}`);
  o = JSON.parse(r.stdout);
  // the jdk step is `present` when the machine already has a JDK >= 17; every other step must be missing with a size
  must(o.steps.length === 5, `(b) steps: ${r.stdout}`);
  for (const s of o.steps) must(s.status === "present" ? s.step === "jdk" : s.status === "missing" && s.downloadBytes > 0, `(b) ${s.step}: ${JSON.stringify(s)}`);
  must(readdirSync(t1).length === 0, `(b) dry-run wrote into ${t1}`);

  const t2 = tmp();
  r = cli(["--sdk", t2, "--only", "cmdline-tools,platform-tools", "--yes"]);
  must(r.status === 0, `(c) exit ${r.status}: ${r.stdout}${r.stderr}`);
  const adb = join(t2, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  must(existsSync(adb), `(c) ${adb} missing`);
  const v = spawnSync(adb, ["version"], { encoding: "utf8" });
  must(v.status === 0 && /Android Debug Bridge/.test(v.stdout), `(c) adb version: ${v.stdout}${v.stderr}`);

  const t3 = tmp();
  r = cli(["--sdk", t3, "--only", "platform-tools"]);
  must(r.status === 1 && /--yes/.test(r.stdout + r.stderr), `(d) exit ${r.status}: ${r.stdout}${r.stderr}`);
  must(readdirSync(t3).length === 0, `(d) wrote into ${t3}`);

  console.log("OK: setup claims hold (present, dry-run, install, --yes required)");
} catch (e) {
  console.error("FAIL:", e.message);
  process.exitCode = 1;
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
