// T58 verify: node scripts/ci-smoke.mjs  (same flow in GitHub Actions and on a dev PC)
// setup --yes --images 34 -> up -> install + launch the probe -> shot (PNG not flat) -> screen (has nodes) -> logs has a CrewProbe line -> down.
// Prints the ready time. Always downs the emulator it started. Env: CI_SMOKE_PNG=<file> keeps the screenshot there (CI artifact).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { PKG, probeApk } from "../src/snapshot.ts";
import { buildHelper, helperApk } from "../src/helper.ts";

const root = join(import.meta.dirname, "..");
const win = process.platform === "win32";
const tmp = mkdtempSync(join(tmpdir(), "crewci-"));
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };

// one CLI call; stdout is JSON (the CLI may print WARN lines to stderr)
function cli(...args) {
  const out = execFileSync(process.execPath, [join(root, "bin", "crewdroid.mjs"), args[0], "--json", ...args.slice(1)], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, timeout: 20 * 60000, stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out.slice(out.search(/[{[]/)));
}

// APKs are build outputs (not tracked): build the missing ones with the probe's Gradle wrapper (JDK 17 + an Android SDK with platform 35)
function buildProbe() {
  execFileSync(join(root, "probe-app", win ? "gradlew.bat" : "gradlew"), ["assembleDebug", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: win });
}

// a flat screenshot (all black / one colour) inflates to very few distinct byte values
function pngDistinct(file) {
  const b = readFileSync(file);
  if (b.subarray(1, 4).toString() !== "PNG") return 0;
  const idat = [];
  for (let o = 8; o + 8 <= b.length;) {
    const len = b.readUInt32BE(o), type = b.toString("latin1", o + 4, o + 8);
    if (type === "IDAT") idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  return new Set(inflateSync(Buffer.concat(idat))).size;
}

let upped = false;
try {
  if (!existsSync(probeApk())) buildProbe();
  if (!existsSync(helperApk())) buildHelper();

  const s = cli("setup", "--yes", "--images", "34");
  claim(s.steps.every((x) => ["present", "installed"].includes(x.status)), `setup: ${s.steps.map((x) => `${x.step}=${x.status}`).join(" ")}`);

  upped = true;
  const u = cli("up", "--api", "34"); // the only image CI installs
  const d = u.devices?.[0];
  claim(!!d?.serial, `up -> ${d?.serial} ${d?.profile} API ${d?.api}`);
  console.log(`ready time: ${d?.readySeconds} s (boot ${d?.bootSeconds} s)`);
  if (!d?.serial) throw new Error("no device");
  const serial = d.serial;

  const ins = cli("install", serial, probeApk());
  claim(ins.ok === true, `install probe: ${ins.results?.map((x) => x.result).join(" ")}`);
  const la = cli("launch", serial, PKG, "--restart", "--", "--es", "check", "form"); // the form check shows a screen
  claim(la.crashed === false, `launch probe: crashed=${la.crashed} totalTime=${la.totalTime}`);
  await new Promise((ok) => setTimeout(ok, 2000));
  const png = join(tmp, "shot.png");
  const sh = cli("shot", serial, png);
  const distinct = pngDistinct(png);
  claim(sh.bytes > 1000 && distinct >= 8, `shot ${sh.width}x${sh.height} ${sh.bytes} bytes, ${distinct} distinct byte values (>= 8 = not flat)`);
  if (process.env.CI_SMOKE_PNG) copyFileSync(png, process.env.CI_SMOKE_PNG);

  const sc = cli("screen", serial);
  claim(sc.nodes?.length > 0, `screen: ${sc.nodes?.length} nodes, focus ${sc.focus}`);

  cli("launch", serial, PKG, "--restart", "--", "--es", "check", "id"); // logs one "CrewProbe ID ok ..." line
  await new Promise((ok) => setTimeout(ok, 2000));
  const lg = cli("logs", serial, PKG, "--since", "1m");
  const probe = lg.lines?.filter((l) => l.tag === "CrewProbe") ?? [];
  claim(probe.length > 0, `logs: ${probe.length} CrewProbe lines, e.g. ${JSON.stringify(probe[0]?.message)}`);
} catch (e) {
  claim(false, `error: ${e.message}`);
  // the emulator's own log is the only evidence when a device never shows up in adb
  for (const f of readdirSync(tmpdir()).filter((f) => /^crewdroid-.*\.log$/.test(f))) console.log(`--- ${f} (last 60 lines)\n${readFileSync(join(tmpdir(), f), "utf8").split("\n").slice(-60).join("\n")}`);
} finally {
  if (upped) {
    try { cli("down"); claim(true, "down"); } catch (e) { claim(false, `down failed: ${e.message}`); }
  }
  rmSync(tmp, { recursive: true, force: true });
}
if (errs.length) { console.log(`FAIL: ${errs.length} claims failed`); process.exit(1); }
console.log("OK: ci smoke flow holds (setup, up, shot, screen, install, launch, logs, down)");
