// T36 verify: node scripts/check-single.mjs [--idle-seconds 60]
// `up --json` (no flags) -> exactly 1 device, s24ultra, newest installed google_atd API <= 36; `devices --json` shows it booted;
// `up --api 31` after `down` -> API 31; `up --api 99` exits 1 listing the installed APIs; 3 cold runs of `up` timed to
// sys.boot_completed and to ready + idle host RAM/CPU of the one device -> docs/measurements/single.md. Boots its own emulator, then down.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { procs } from "../src/measure.ts";
import { atdImages } from "../src/profiles.ts";

const { values: v } = parseArgs({ options: { "idle-seconds": { type: "string", default: "60" } } });
const root = join(import.meta.dirname, "..");
process.env.CREWDROID_OWNER = String(process.pid); // children share this process's emulator lock
const cli = (...a) => { const r = spawnSync("npx", ["tsx", "src/cli.ts", ...a, "--json"], { cwd: root, encoding: "utf8", shell: true }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const errs = [];
const want = (c, m) => { if (!c) errs.push(m); };
const installed = atdImages().map((x) => x.api);
const newest = Math.max(...installed.filter((a) => a <= 36));
const upOnce = () => {
  cli("down");
  const t = Date.now();
  const r = cli("up");
  const wall = Math.round((Date.now() - t) / 100) / 10;
  if (r.code !== 0) throw new Error(`up exited ${r.code}: ${r.err || r.out}`);
  return { ...JSON.parse(r.out), wall };
};

const runs = [];
try {
  for (let i = 0; i < 3; i++) {
    const r = upOnce(), d = r.devices[0];
    want(r.devices.length === 1, `run ${i + 1}: want 1 device, got ${r.devices.length}`);
    want(d.profile === "s24ultra", `run ${i + 1}: profile ${d.profile}`);
    want(d.api === newest && [34, 36].includes(d.api), `run ${i + 1}: API ${d.api}, want newest installed <= 36 (${newest}) and 34|36`);
    runs.push({ boot: d.bootSeconds, ready: d.readySeconds, wall: r.wall, api: d.api });
    if (i === 0) {
      const dv = JSON.parse(cli("devices").out);
      want(dv.length === 1 && dv[0].booted === true && dv[0].profile.split(",").includes("s24ultra") && dv[0].api === d.api, `devices: ${JSON.stringify(dv)}`);
    }
  }
  // idle RAM/CPU of the run-3 device (still running)
  const idle = Number(v["idle-seconds"]);
  const re = `-port 5580([ "]|$)`;
  const a = await procs(re), w0 = Date.now();
  await new Promise((r) => setTimeout(r, idle * 1000));
  const b = await procs(re);
  const ramMB = Math.round(b.ws / 1048576), cpuPercent = Math.round(((b.cpu - a.cpu) / ((Date.now() - w0) / 1000)) * 1000) / 10;

  cli("down");
  const r31 = cli("up", "--api", "31");
  const d31 = r31.code === 0 ? JSON.parse(r31.out).devices : [];
  want(d31.length === 1 && d31[0].api === 31, `up --api 31: ${r31.code} ${r31.out.slice(0, 200)}`);
  cli("down");
  const bad = cli("up", "--api", "99");
  want(bad.code === 1 && installed.every((x) => (bad.out + bad.err).includes(String(x))), `up --api 99: exit ${bad.code}, out ${bad.out}${bad.err}`);

  const avg = (k) => Math.round((runs.reduce((s, x) => s + x[k], 0) / runs.length) * 10) / 10;
  writeFileSync(join(root, "docs", "measurements", "single.md"), [
    "# Single-device `up` (FR-27)", "",
    `Date: ${new Date().toISOString().slice(0, 10)}. \`crewdroid up\` with no flags = 1 device, s24ultra, newest installed google_atd API <= 36 (API ${newest}; installed: ${installed.join(", ")}). Each run is cold: \`down\` first, snapshot already prepared.`, "",
    "| Run | boot (s, to sys.boot_completed) | ready (s, after wm size/density + identity) | wall incl. node start (s) |", "|---|---|---|---|",
    ...runs.map((x, i) => `| ${i + 1} | ${x.boot} | ${x.ready} | ${x.wall} |`),
    `| mean | ${avg("boot")} | ${avg("ready")} | ${avg("wall")} |`, "",
    `Idle host cost of the one device (run 3, ${idle} s idle): RAM ${ramMB} MB working set, CPU ${cpuPercent}% of one core.`, "",
    `Other checks: \`devices\` shows it booted; \`up --api 31\` -> API 31; \`up --api 99\` exits 1 listing the installed APIs (${installed.join(", ")}).`, "",
  ].join("\n"));
} catch (e) {
  errs.push(String(e.message ?? e));
} finally {
  cli("down");
}
if (errs.length) { console.error("FAIL:\n" + errs.join("\n")); process.exit(1); }
console.log(`OK: single-device up holds (s24ultra API ${newest}, 3 cold runs ${runs.map((x) => x.ready + "s").join("/")} ready)`);
