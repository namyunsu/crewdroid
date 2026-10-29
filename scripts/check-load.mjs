// T62 verify: node scripts/check-load.mjs [--api 34,36] [--cores 4 --ram 2048]  (boots its own device per API, then down)
// One device per API: baseline -> load low -> mid -> high -> off. MemAvailable % strictly decreases over the levels, the probe
// app's cold start TotalTime median (of 5) rises (reported, not failed, when it does not), `off` brings MemAvailable back
// to no more than 10 % below the baseline and leaves no load process or filler package; a bad level exits 1; `up --load mid` applies the
// level at boot. Per level: guest free RAM / CPU busy, probe cold start + jank (perf), LOW_MEMORY kills of the probe
// (exit-info) and the host cost (emulator+qemu working set / CPU) -> the measured section of docs/measurements/load.md.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adb } from "../src/adb.ts";
import { guestState } from "../src/load.ts";
import { procs } from "../src/measure.ts";
import { perf } from "../src/perf.ts";
import { parseExitInfo } from "../src/triage.ts";

const root = join(import.meta.dirname, "..");
process.env.CREWDROID_OWNER = String(process.pid); // children share this process's emulator lock
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const apis = arg("api", "34,36").split(",").map(Number);
const spec = ["--cores", arg("cores", "4"), "--ram", arg("ram", "2048")];
const cli = (...a) => { const t = Date.now(); const r = spawnSync("npx", ["tsx", "src/cli.ts", ...a, "--json"], { cwd: root, encoding: "utf8", shell: true, maxBuffer: 64 << 20 }); return { code: r.status, out: r.stdout, err: r.stderr, wall: Math.round((Date.now() - t) / 100) / 10 }; };
const json = (r, what) => { if (r.code !== 0) throw new Error(`${what}: exit ${r.code}: ${(r.err || r.out).trim().split("\n").at(-1)}`); return JSON.parse(r.out); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const PROBE = "dev.crewdroid.probe";
const probeApk = join(root, "probe-app/app/build/outputs/apk/debug/app-debug.apk");
const errs = [], notes = [], rows = [], offs = [];
const want = (c, m) => { if (!c) errs.push(m); };

// guest state over 10 s with the host cost of this emulator in the same window, then 5 probe cold starts
async function measure(d, label, loadOut) {
  const re = `-port ${d.port}([ "]|$)`;
  const h0 = await procs(re), t0 = Date.now();
  const g = await guestState(d.serial, 10);
  const h1 = await procs(re), wall = (Date.now() - t0) / 1000;
  const lowMem = async () => parseExitInfo(await adb(d.serial, ["shell", `dumpsys activity exit-info ${PROBE}`])).filter((e) => e.reason.startsWith("LOW_MEMORY")).map((e) => e.pid);
  const killed0 = new Set(await lowMem());
  const starts = [], janks = [];
  for (let i = 0; i < 5; i++) {
    const p = await perf(d.serial, PROBE);
    starts.push(p.start.totalTime); janks.push(p.frames.jankPercent);
    await adb(d.serial, ["shell", "input keyevent KEYCODE_HOME"]); // to the background, where a low-memory kill can take it
    await sleep(5000);
  }
  const kills = (await lowMem()).filter((pid) => !killed0.has(pid)).length;
  const row = { api: d.api, label, g, starts, startMedian: median(starts), jankMedian: median(janks), kills, hostRamMB: Math.round(h1.ws / 2 ** 20), hostCpuPct: Math.round(((h1.cpu - h0.cpu) / wall) * 1000) / 10, load: loadOut };
  rows.push(row);
  console.error(`API ${d.api} ${label}: MemAvailable ${g.memAvailablePct}% cpu ${g.cpuBusyPct}% start ${row.startMedian} ms (${starts}) jank ${row.jankMedian}% kills ${kills} host ${row.hostRamMB} MB ${row.hostCpuPct}%`);
  return row;
}

let upLoad;
try {
  if (!existsSync(probeApk)) throw new Error(`probe APK missing: ${probeApk} (probe-app/gradlew -p probe-app assembleDebug)`);
  for (const api of apis) {
    cli("down");
    const [d] = json(cli("up", "--api", String(api), ...spec), `up --api ${api}`).devices;
    await adb(d.serial, ["install", "-r", probeApk], 180000);
    await sleep(60000); // first-boot jobs (dexopt, package scans) would otherwise land in the baseline
    const base = await measure(d, "baseline (no load)");
    const lv = [base];
    for (const level of ["low", "mid", "high"]) {
      const r = cli("load", d.serial, level);
      lv.push(await measure(d, level, { ...json(r, `load ${level}`), wall: r.wall }));
    }
    for (let i = 1; i < lv.length; i++) {
      want(lv[i].g.memAvailablePct < lv[i - 1].g.memAvailablePct, `API ${api}: MemAvailable ${lv[i].label} ${lv[i].g.memAvailablePct}% not below ${lv[i - 1].label} ${lv[i - 1].g.memAvailablePct}%`);
      if (!(lv[i].startMedian > lv[i - 1].startMedian)) notes.push(`API ${api}: cold start median ${lv[i].label} ${lv[i].startMedian} ms not above ${lv[i - 1].label} ${lv[i - 1].startMedian} ms`);
    }
    const offR = cli("load", d.serial, "off");
    const off = { ...json(offR, "load off"), wall: offR.wall };
    const og = await guestState(d.serial, 10);
    rows.push({ api, label: "off", g: og, load: off });
    const baseKb = base.g.memAvailableKb;
    // NOTE: off may end ABOVE the baseline: under the ballast kswapd moved idle system pages to zram and they stay there
    // until touched (API 36 run 1: 1065 vs 858 MB, swap 263 MB). Nothing of the load is held then, so only "not more than
    // 10 % below the baseline" is checked; the difference is written to load.md.
    want(og.memAvailableKb >= baseKb * 0.9, `API ${api}: off MemAvailable ${og.memAvailableMB} MB more than 10 % below baseline ${Math.round(baseKb / 1024)} MB`);
    offs.push(`API ${api}: off ${og.memAvailableMB} MB vs baseline ${Math.round(baseKb / 1024)} MB (${og.memAvailableKb >= baseKb ? "+" : ""}${Math.round((og.memAvailableKb / baseKb - 1) * 1000) / 10} %), swap used ${base.g.swapUsedMB} -> ${og.swapUsedMB} MB`);
    want(og.loadProcesses === 0 && og.fillerPackages === 0, `API ${api}: after off ${og.loadProcesses} load processes, ${og.fillerPackages} filler packages`);
    const bad = cli("load", d.serial, "max");
    want(bad.code === 1 && /unknown load level 'max'/.test(bad.err), `load max: exit ${bad.code} ${bad.err.trim()}`);
    if (api === apis.at(-1)) {
      cli("down");
      const r = cli("up", "--api", String(api), ...spec, "--load", "mid");
      const [u] = json(r, "up --load mid").devices;
      const g = await guestState(u.serial, 3);
      upLoad = { api, wall: r.wall, ready: u.readySeconds, load: u.load, g };
      want(u.load?.level === "mid" && g.loadProcesses > 0 && g.fillerPackages === 80, `up --load mid: level ${u.load?.level}, ${g.loadProcesses} load processes (want > 0), ${g.fillerPackages} fillers (want 80)`);
    }
  }

  const md = join(root, "docs", "measurements", "load.md");
  const head = readFileSync(md, "utf8").split("\n## Measured by scripts/check-load.mjs")[0].trimEnd();
  const lr = (x) => x.load ? `${x.load.wall} s` : "-";
  writeFileSync(md, [head, "", "## Measured by scripts/check-load.mjs", "",
    `Date: ${new Date().toISOString().slice(0, 10)}. One device per API (\`up --api N ${spec.join(" ")}\`, s24ultra screen), probe app installed, 60 s idle, then baseline -> low -> mid -> high -> off on the same device. ` +
    "MemAvailable / CPU busy = guest /proc/meminfo, /proc/stat over 10 s. Cold start = `perf` TotalTime (force-stop, 2 s, `am start -W`), 5 runs, median; jank = median of the 5 runs' gfxinfo janky %. " +
    "Kills = new LOW_MEMORY exit-info records of the probe (it goes to the background for 5 s after each run). Host = emulator+qemu working set and CPU (% of one host core) over the same 10 s.", "",
    "| API | level | apply (s) | MemAvailable MB (% of total) | swap used MB | CPU busy % | load avg 1m | processes (load app) | packages (fillers) | cold start ms median (runs) | jank % | probe LOW_MEMORY kills | host RAM MB | host CPU % |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((x) => `| ${x.api} | ${x.label} | ${lr(x)} | ${x.g.memAvailableMB} (${x.g.memAvailablePct} %) | ${x.g.swapUsedMB} | ${x.g.cpuBusyPct} | ${x.g.loadAverage[0]} | ${x.g.runningProcesses} (${x.g.loadProcesses}) | ${x.g.installedPackages} (${x.g.fillerPackages}) | ${x.starts ? `${x.startMedian} (${x.starts.join(", ")})` : "-"} | ${x.starts ? x.jankMedian : "-"} | ${x.starts ? x.kills : "-"} | ${x.hostRamMB ?? "-"} | ${x.hostCpuPct ?? "-"} |`), "",
    ...(upLoad ? [`\`up --api ${upLoad.api} ${spec.join(" ")} --load mid\`: whole command ${upLoad.wall} s (device ready ${upLoad.ready} s, then load ${upLoad.load?.seconds} s); after it MemAvailable ${upLoad.g.memAvailablePct} %, ${upLoad.g.loadProcesses} load processes, ${upLoad.g.fillerPackages} fillers.`, ""] : []),
    "`off` against the baseline (MemAvailable can end above it: idle pages that kswapd moved to zram under the ballast stay there until used):", "", ...offs.map((o) => `- ${o}`), "",
    ...(notes.length ? ["Not as expected (reported, not failed):", "", ...notes.map((n) => `- ${n}`), ""] : []),
  ].join("\n"));
} catch (e) {
  errs.push(String(e.message ?? e));
} finally {
  cli("down");
}
for (const n of notes) console.error(`NOTE: ${n}`);
if (errs.length) { console.error("FAIL:\n" + errs.join("\n")); process.exit(1); }
console.log(`OK: load claims hold (${rows.filter((x) => x.starts).map((x) => `API ${x.api} ${x.label.split(" ")[0]} ${x.g.memAvailablePct}% ${x.startMedian}ms`).join(", ")})`);
