// T70: honest comparison baseline. 3 stock AVDs from the SAME google_atd images `up --count 3` uses (API 31, 34, 36 installed),
// plain avdmanager defaults (pixel_9, default RAM/cores), launched headless and fresh (-no-window, nothing else), measured like
// `crewdroid measure --up 3` (src/up.ts measureUp): 3 s launch stagger, disk = AVD dir + system image counted once,
// host RAM (working set) and idle CPU over the same 60 s window after all booted. Deletes its stock-atd-* AVDs at the end.
//   node scripts/measure-stock.mjs [--idle-seconds 60] [--base-port 5580] [--rounds 2]     (boots its own 3 emulators, ~3 min per round)
// Writes docs/measurements/baseline-atd.{json,md}.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { avdHome, imageDir, imagePackage } from "../src/avd.ts";
import { launchEmulator } from "../src/emulator.ts";
import { dirBytes, procs, waitBoot } from "../src/measure.ts";
import { allocBytes, killMatching, ramMethod } from "../src/platform.ts";
import { atdImages } from "../src/profiles.ts";
import { emulatorPath, sdkRoot } from "../src/sdk.ts";
import { sleep } from "../src/snapshot.ts";
import { claimEmulators, down } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "idle-seconds": { type: "string", default: "60" }, "base-port": { type: "string", default: "5580" }, rounds: { type: "string", default: "2" } } });
const IDLE = Number(v["idle-seconds"]), BASE = Number(v["base-port"]), ROUNDS = Number(v.rounds);
const out = join(import.meta.dirname, "..", "docs", "measurements");
const bat = (n) => join(sdkRoot(), "cmdline-tools", "latest", "bin", process.platform === "win32" ? `${n}.bat` : n);
const q = (s) => (process.platform === "win32" ? `"${s}"` : s);
const manager = (args, input = "no\n") => { const r = spawnSync(q(bat("avdmanager")), args.map(q), { shell: process.platform === "win32", input, encoding: "utf8", windowsHide: true }); return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") }; };
const re = (name) => `(^|[ @"])${name}([ "]|$)`;

const images = atdImages().filter((x) => x.api <= 36); // same three images `up --count 3` picks (assign() in src/profiles.ts)
if (images.length < 3) throw new Error(`need 3 google_atd images, have ${images.length}`);
const stock = images.slice(0, 3).map((x, i) => ({ ...x, avd: `stock-atd-${x.api}`, port: BASE + 2 * i, serial: `emulator-${BASE + 2 * i}` }));

claimEmulators(); // same lock as up/down; throws if another live run owns the emulators
await down(); // fresh: no crew-* instance running
async function round() {
const started = [];
try {
  for (const s of stock) {
    manager(["delete", "avd", "-n", s.avd]); // leftovers of an aborted run; only our own name
    const r = manager(["create", "avd", "-n", s.avd, "-k", imagePackage(s.image), "-d", "pixel_9", "--force"]);
    if (r.code !== 0) throw new Error(`avdmanager create ${s.avd}: ${r.out.slice(-400)}`);
  }
  for (const [i, s] of stock.entries()) {
    await launchEmulator(["-avd", s.avd, "-port", String(s.port), "-no-window"], join(tmpdir(), `crewdroid-${s.avd}.log`));
    s.t0 = Date.now(); started.push(s);
    if (i < stock.length - 1) await sleep(3000); // same stagger as up()
  }
  const boots = await Promise.all(stock.map((s) => waitBoot(s.serial, s.t0))); // stock has no extra ready steps: ready = boot_completed
  const before = await Promise.all(stock.map((s) => procs(re(s.avd))));
  const w0 = Date.now();
  await sleep(IDLE * 1000);
  const after = await Promise.all(stock.map((s) => procs(re(s.avd))));
  const wall = (Date.now() - w0) / 1000;
  const seen = new Set();
  const once = (dir) => (seen.has(dir) ? 0 : (seen.add(dir), dirBytes(dir)));
  const devices = stock.map((s, i) => {
    const avdDirBytes = once(join(avdHome(), `${s.avd}.avd`));
    return {
      avd: s.avd, serial: s.serial, image: s.image, api: s.api, avdDirBytes, diskBytes: avdDirBytes + once(imageDir(s.image)),
      bootSeconds: Math.round(boots[i] * 10) / 10, readySeconds: Math.round(boots[i] * 10) / 10,
      ramMB: Math.round(after[i].ws / 1048576), cpuPercent: Math.round(((after[i].cpu - before[i].cpu) / wall) * 1000) / 10,
    };
  });
  // same metric as crewdroid's number (slim.md): bytes really allocated (sparse holes / NTFS compression excluded), AVD dir + system image once
  const dirs = devices.map((d) => join(avdHome(), `${d.avd}.avd`)), imgs = [...new Set(devices.map((d) => imageDir(d.image)))];
  const al = await allocBytes([...dirs, ...imgs]);
  devices.forEach((d, i) => { d.allocAvdBytes = al[i]; });
  const allocTotal = al.reduce((a, x) => a + x, 0);
  const ver = spawnSync(emulatorPath(), ["-version"], { encoding: "utf8", windowsHide: true }).stdout.match(/version\s+(\S+)/)?.[1] ?? "unknown";
  return {
    date: new Date().toISOString(),
    pc: { cpuModel: cpus()[0].model, cores: cpus().length, ramGB: Math.round(totalmem() / 2 ** 30), os: `${process.platform} ${release()}` },
    emulatorVersion: ver, method: ramMethod(), idleSeconds: IDLE, flags: "-avd <name> -port <port> -no-window (nothing else)", device: "pixel_9 (avdmanager default RAM/cores)",
    diskTotalBytes: devices.reduce((a, d) => a + d.diskBytes, 0), allocTotalBytes: allocTotal, ramTotalMB: devices.reduce((a, d) => a + d.ramMB, 0), cpuTotalPercent: Math.round(devices.reduce((a, d) => a + d.cpuPercent, 0) * 10) / 10, devices,
  };
} finally {
  for (const s of started) await adb(s.serial, ["emu", "kill"], 10000).catch(() => {});
  await sleep(5000);
  for (const s of stock) { await killMatching(re(s.avd)).catch(() => {}); }
  await sleep(2000);
  for (const s of stock) {
    manager(["delete", "avd", "-n", s.avd]);
    for (const p of [`${s.avd}.avd`, `${s.avd}.ini`]) if (existsSync(join(avdHome(), p))) rmSync(join(avdHome(), p), { recursive: true, force: true });
  }
}
}
const rounds = [];
for (let i = 0; i < ROUNDS; i++) rounds.push(await round()); // each round creates fresh AVDs, boots them, measures, deletes them
const result = { ...rounds[0], rounds };
writeFileSync(join(out, "baseline-atd.json"), JSON.stringify(result, null, 2) + "\n");
const g = (b) => (b / 2 ** 30).toFixed(2);
const rng = (f, d = 0) => { const a = rounds.map(f); return Math.min(...a).toFixed(d) === Math.max(...a).toFixed(d) ? Math.min(...a).toFixed(d) : `${Math.min(...a).toFixed(d)}-${Math.max(...a).toFixed(d)}`; };
const md = `# Baseline: stock google_atd AVDs x3 (T70)

- Date: ${result.date.slice(0, 10)} · raw: \`baseline-atd.json\` · script: \`scripts/measure-stock.mjs\` · n=${rounds.length} rounds (fresh AVDs each round)
- PC: ${result.pc.cpuModel.trim()} ${result.pc.cores} threads, ${result.pc.ramGB} GB RAM, ${result.pc.os}
- Emulator: ${result.emulatorVersion} · images: the same \`google_atd\` images \`up --count 3\` uses (API ${stock.map((s) => s.api).join(", ")})
- AVDs: \`avdmanager create avd -d pixel_9\`, default RAM/cores, fresh (never run before), launched \`${result.flags}\`; ${IDLE} s idle sampling after all booted, 3 s launch stagger (as \`measure --up 3\`)
- RAM = ${result.method}; CPU % is of one core (100 % = 1 core); ready = boot_completed (stock has no extra setup steps)
- Disk, two metrics (AVD dir + system image, each image once): **allocated** = bytes really on disk (sparse holes and NTFS compression excluded, \`allocBytes\` as in slim.md; the metric of crewdroid's 6.99 GiB) and **logical** = summed file lengths (\`dirBytes\`; the metric of the old google_apis 24.74 GiB).

| Round | Disk allocated | Disk logical | Host RAM | Idle CPU | Boot / ready (API ${stock.map((s) => s.api).join(" / ")}) |
|---|---|---|---|---|---|
${rounds.map((r, i) => `| ${i + 1} | ${g(r.allocTotalBytes)} GiB | ${g(r.diskTotalBytes)} GiB | ${(r.ramTotalMB / 1000).toFixed(2)} GB | ${Math.round(r.cpuTotalPercent)} % | ${r.devices.map((d) => d.readySeconds).join(" / ")} s |`).join("\n")}

- Range over ${rounds.length} rounds: disk allocated **${rng((r) => r.allocTotalBytes / 2 ** 30, 2)} GiB** (logical ${rng((r) => r.diskTotalBytes / 2 ** 30, 2)} GiB), RAM **${rng((r) => r.ramTotalMB / 1000, 2)} GB**, idle CPU **${rng((r) => r.cpuTotalPercent)} %**.
- Second baseline (stock \`google_apis\`, API 33, 2026-10-23): \`baseline.json\` / \`baseline.md\` — 24.74 GiB **logical** (not re-measured as allocated; the AVDs are gone), 8.45 GB, ~1000 %.
- crewdroid \`up --count 3\` (3 read-only clones, slimmed): 6.99 GiB allocated (slim.md), 3.93 GB, ~600 %.
`;
writeFileSync(join(out, "baseline-atd.md"), md);
console.log(md);
console.log(JSON.stringify({ alloc: rng((r) => r.allocTotalBytes / 2 ** 30, 2), ramGB: rng((r) => r.ramTotalMB / 1000, 2), cpu: rng((r) => r.cpuTotalPercent) }));
