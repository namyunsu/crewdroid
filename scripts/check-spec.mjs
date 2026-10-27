// T64 verify: node scripts/check-spec.mjs  (boots its own emulators, then down)
// `up --ram 128` / `up --cores 999` exit 1 before launch; `up` default = today's KNOBS (2 cores, ramMB of the image);
// `up --cores 4 --ram 2048` -> guest nproc 4, MemTotal within 10 % of 2048 MB, on its own base snapshot (prepared on first
// use, loaded on the next run); `up --count 2 --profiles s24ultra,a16-lowend` -> each device its own spec; `devices` shows
// cores/RAM. Ready time per spec + the spec AVD's disk cost -> the measured section of docs/measurements/spec.md.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adb } from "../src/adb.ts";
import { avdHome, avdName, ramMB } from "../src/avd.ts";
import { allocBytes } from "../src/platform.ts";

const root = join(import.meta.dirname, "..");
process.env.CREWDROID_OWNER = String(process.pid); // children share this process's emulator lock
const cli = (...a) => { const t = Date.now(); const r = spawnSync("npx", ["tsx", "src/cli.ts", ...a, "--json"], { cwd: root, encoding: "utf8", shell: true }); return { code: r.status, out: r.stdout, err: r.stderr, wall: Math.round((Date.now() - t) / 100) / 10 }; };
const errs = [];
const want = (c, m) => { if (!c) errs.push(m); };
const rows = [];
const snapLog = (d) => { try { return readFileSync(join(tmpdir(), `crewdroid-${d.avd}-${d.port}.log`), "utf8"); } catch { return ""; } };
const snapLoad = (t) => { const m = t.match(/loaded snapshot '[^']+' using (\d+) ms/); return m ? `${m[1] / 1000} s` : /starting from scratch/.test(t) ? "cold (snapshot not loaded)" : "?"; };

// guest view of one device: nproc + MemTotal (MB), checked against what up() reported
async function guest(d, label) {
  const nproc = Number(await adb(d.serial, ["shell", "nproc"]));
  const memMB = Math.round(Number((await adb(d.serial, ["shell", "grep MemTotal /proc/meminfo"])).match(/(\d+)/)[1]) / 1024);
  want(nproc === d.cores, `${label} ${d.serial}: nproc ${nproc} != ${d.cores}`);
  want(Math.abs(memMB - d.ramMB) <= d.ramMB * 0.1, `${label} ${d.serial}: MemTotal ${memMB} MB not within 10 % of ${d.ramMB} MB`);
  return { nproc, memMB };
}
async function upRun(label, ...a) {
  cli("down");
  const r = cli("up", ...a);
  if (r.code !== 0) throw new Error(`${label}: up exited ${r.code}: ${r.err || r.out}`);
  const devs = JSON.parse(r.out).devices;
  const dv = JSON.parse(cli("devices").out);
  for (const d of devs) {
    const g = await guest(d, label);
    const shown = dv.find((x) => x.serial === d.serial);
    want(shown?.cores === d.cores && shown?.ramMB === d.ramMB, `${label}: devices shows ${JSON.stringify(shown)} for ${d.serial}, want ${d.cores} cores ${d.ramMB} MB`);
    rows.push({ label, d, g, wall: r.wall });
  }
  cli("down"); // the emulator log is complete only after the emulator exits
  for (const x of rows.filter((x) => x.label === label)) x.load = snapLoad(snapLog(x.d));
  return devs;
}

try {
  // limits: exit 1 with the reason, nothing launched
  for (const [flag, v, re] of [["--ram", "128", /at least \d+ MB/], ["--cores", "999", /host logical CPUs/]]) {
    const r = cli("up", flag, v);
    want(r.code === 1 && re.test(r.err), `up ${flag} ${v}: exit ${r.code}, ${r.err.trim()}`);
    want(JSON.parse(cli("devices").out).length === 0, `up ${flag} ${v}: an emulator was launched`);
    rows.push({ label: `up ${flag} ${v}`, reject: `exit ${r.code} in ${r.wall} s: ${JSON.parse(r.err.trim().split("\n").at(-1)).error}` });
  }
  // default: today's KNOBS
  const [d0] = await upRun("up (default)");
  want(d0.cores === 2 && d0.ramMB === ramMB(d0.image) && d0.avd === avdName(d0.image), `default: ${d0.avd} ${d0.cores} cores ${d0.ramMB} MB, want ${avdName(d0.image)} 2 cores ${ramMB(d0.image)} MB`);
  // custom spec: first run prepares its base snapshot, the second loads it
  const specAvd = avdName(d0.image, { cores: 4, ramMB: 2048 });
  const fresh = !existsSync(join(avdHome(), `${specAvd}.avd`, "crewdroid-slim.json"));
  const [d1] = await upRun("up --cores 4 --ram 2048 (1st)", "--cores", "4", "--ram", "2048");
  want(d1.cores === 4 && d1.ramMB === 2048 && d1.avd === specAvd, `--cores 4 --ram 2048: ${d1.avd} ${d1.cores}/${d1.ramMB}`);
  await upRun("up --cores 4 --ram 2048 (2nd)", "--cores", "4", "--ram", "2048");
  const second = rows.find((x) => x.label.endsWith("(2nd)"));
  want(/^\d/.test(second.load), `2nd --cores 4 --ram 2048 run did not load its snapshot: ${second.load}`);
  // mixed profiles with different specs
  const mixed = await upRun("up --count 2 --profiles s24ultra,a16-lowend", "--count", "2", "--profiles", "s24ultra,a16-lowend");
  want(mixed[0].cores === 2 && mixed[0].ramMB === ramMB(mixed[0].image) && mixed[1].cores === 4 && mixed[1].ramMB === 2048, `mixed: ${mixed.map((d) => `${d.profile} ${d.cores}/${d.ramMB}`)}`);

  const specDirs = [...new Set(rows.filter((x) => x.d && x.d.avd !== avdName(x.d.image)).map((x) => x.d.avd))];
  const bytes = await allocBytes(specDirs.map((a) => join(avdHome(), `${a}.avd`)));
  const md = join(root, "docs", "measurements", "spec.md");
  const head = readFileSync(md, "utf8").split("\n## Measured by scripts/check-spec.mjs")[0].trimEnd();
  writeFileSync(md, [head, "", "## Measured by scripts/check-spec.mjs", "",
    `Date: ${new Date().toISOString().slice(0, 10)}. Each run starts after \`down\`. Wall = whole \`up\` command incl. node start and, on a first use, \`prepare\` of the spec's base snapshot${fresh ? "" : " (already prepared before this run)"}.`, "",
    "| Run | device | profile | API | AVD | cores / RAM asked | guest nproc / MemTotal | snapshot load | boot (s) | ready (s) | wall (s) |", "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.filter((x) => x.d).map((x) => `| ${x.label} | ${x.d.serial} | ${x.d.profile} | ${x.d.api} | ${x.d.avd} | ${x.d.cores} / ${x.d.ramMB} MB | ${x.g.nproc} / ${x.g.memMB} MB | ${x.load} | ${x.d.bootSeconds} | ${x.d.readySeconds} | ${x.wall} |`), "",
    "Rejected before launch:", "", ...rows.filter((x) => x.reject).map((x) => `- \`${x.label}\`: ${x.reject}`), "",
    "Disk cost of each spec base AVD (allocated, after `prepare` compressed it):", "", ...specDirs.map((a, i) => `- ${a}: ${(bytes[i] / 2 ** 20).toFixed(0)} MiB`), "",
  ].join("\n"));
} catch (e) {
  errs.push(String(e.message ?? e));
} finally {
  cli("down");
}
if (errs.length) { console.error("FAIL:\n" + errs.join("\n")); process.exit(1); }
console.log(`OK: spec claims hold (${rows.filter((x) => x.d).map((x) => `${x.d.profile} ${x.d.cores}c/${x.d.ramMB}MB ready ${x.d.readySeconds}s`).join(", ")})`);
