// T11 verify: node scripts/mvp-private-app.mjs [--runs 3]
// `crewdroid up --count 3 --base-port 5570` (3 aspect ratios, API 31/34/36) -> 60 s idle sample -> private-app
// `npm run e2e:multi -- --grep @techs` N times in a row on the same devices (run 1 is screen-recorded -> docs/demo/techs.gif)
// -> down. Writes docs/measurements/mvp.json + mvp.md (old path vs crewdroid). Exit 0 only if all N runs pass and the GIF is <= 10 MB.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { avdHome } from "../src/avd.ts";
import { dirBytes, procs, sysImageDir } from "../src/measure.ts";
import { down, up } from "../src/up.ts";
import { PRIVATE_APP_BASE_PORT, PRIVATE_APP_PROFILES, record, runSpec } from "../src/integrations/private-app.ts";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { values: v } = parseArgs({ options: { runs: { type: "string", default: "3" }, "idle-seconds": { type: "string", default: "60" } } });
const root = join(import.meta.dirname, "..");
const N = Number(v.runs);
const GiB = (b) => (b / 2 ** 30).toFixed(2);
const portRe = (port) => `-port ${port}([ "]|$)`;

// Old path = avd-up.ps1 + old-avd-1..3 (google_apis API 33). Not re-run here: avd-up.ps1:74 boots them without
// -read-only, which crewdroid must never do. Device numbers: T01 baseline.json (same flags, -read-only, fresh boots, 60 s idle).
// Spec times: the last two private-app records of this spec (both passed).
const baseline = JSON.parse(readFileSync(join(root, "docs/measurements/baseline.json"), "utf8"));
const OLD_SPEC = [
  { source: "private-app/.ai-log/evidence/T29-1.txt", testSeconds: 96, totalSeconds: 198, ok: true },
  { source: "private-app/.ai-log/evidence/T29-verify.txt", testSeconds: 40.8, totalSeconds: 108, ok: true },
];

const work = mkdtempSync(join(tmpdir(), "crewmvp-"));
const result = { date: new Date().toISOString(), runsWanted: N, profiles: PRIVATE_APP_PROFILES };
let ok = false;
await down();
try {
  const u = await up(3, PRIVATE_APP_BASE_PORT, PRIVATE_APP_PROFILES);
  const serials = u.devices.map((d) => d.serial);
  const idle = Number(v["idle-seconds"]);
  const before = await Promise.all(u.devices.map((d) => procs(portRe(d.port))));
  await sleep(idle * 1000);
  const after = await Promise.all(u.devices.map((d) => procs(portRe(d.port))));
  // clones of one AVD share its dir; each image here is a different AVD, so every dir + image counts once
  const seen = new Set();
  const once = (dir) => (seen.has(dir) ? 0 : (seen.add(dir), dirBytes(dir)));
  result.devices = u.devices.map((d, i) => {
    const dir = join(avdHome(), `${d.avd}.avd`);
    return {
      serial: d.serial, profile: d.profile, model: d.model, api: d.api, size: `${d.width}x${d.height}@${d.density}`, avd: d.avd,
      diskBytes: once(dir) + once(sysImageDir(dir)), bootSeconds: d.bootSeconds, readySeconds: d.readySeconds,
      ramMB: Math.round(after[i].ws / 1048576), cpuPercent: Math.round(((after[i].cpu - before[i].cpu) / idle) * 1000) / 10,
    };
  });

  result.runs = [];
  for (let r = 1; r <= N; r++) {
    let stop;
    const cpu0 = await Promise.all(u.devices.map((d) => procs(portRe(d.port))));
    const s = await runSpec("@techs", r === 1 ? () => { stop = record(serials, work); } : undefined);
    const cpu1 = await Promise.all(u.devices.map((d) => procs(portRe(d.port))));
    const emuCpuPercent = Math.round((cpu1.reduce((a, x) => a + x.cpu, 0) - cpu0.reduce((a, x) => a + x.cpu, 0)) / s.wallSeconds * 1000) / 10;
    const emuRamMB = Math.round(cpu1.reduce((a, x) => a + x.ws, 0) / 1048576);
    if (stop) result.videos = await stop().catch((e) => (console.error(`recording failed: ${e}`), []));
    result.runs.push({ run: r, ok: s.ok, exit: s.exit, wallSeconds: s.wallSeconds, testSeconds: s.testSeconds, totalSeconds: s.totalSeconds, emuCpuPercent, emuRamMB, tail: s.output.split(/\r?\n/).slice(-12).join("\n") });
    console.log(`== run ${r}/${N} ${s.ok ? "PASS" : "FAIL"} exit=${s.exit} wall=${s.wallSeconds}s test=${s.testSeconds}s emuCPU=${emuCpuPercent}%`);
  }
} finally {
  result.down = await down().catch((e) => ({ error: String(e) }));
}

// GIF: the 3 recordings side by side at one height; shrink until <= 10 MB.
const gif = join(root, "docs/demo/techs.gif");
mkdirSync(join(root, "docs/demo"), { recursive: true });
if (result.videos?.length === 3) {
  for (const [h, fps] of [[480, 8], [400, 6], [320, 5], [240, 4]]) {
    // AI NOTE: frame 0 of every --bugreport recording is the "Android screenrecord v1.4" intro text. A static/black screen emits no
    // frames, so it stays up until the first real frame (18.9 s on the API 36 device in T11): drop it, keep the original pts.
    const scaled = result.videos.map((_, i) => `[${i}:v]select='gt(n,0)',fps=${fps},scale=-2:${h}[v${i}]`).join(";");
    const fc = `${scaled};[v0][v1][v2]hstack=inputs=3,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer`;
    await run("ffmpeg", ["-y", "-loglevel", "error", ...result.videos.flatMap((f) => ["-i", f]), "-filter_complex", fc, gif], { windowsHide: true, maxBuffer: 2 ** 26 });
    result.gif = { path: "docs/demo/techs.gif", height: h, fps, bytes: statSync(gif).size };
    // panel x-ranges: scale=-2:h gives each video width = h * w / h0 rounded to even; they must add up to the GIF width
    const dim = async (f) => (await run("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { windowsHide: true })).stdout.trim().split(",").map(Number);
    let x = 0;
    result.gif.panels = [];
    for (const [i, f] of result.videos.entries()) {
      const [w0, h0] = await dim(f);
      const width = 2 * Math.round((h * w0) / h0 / 2);
      const d = result.devices[i];
      result.gif.panels.push({ serial: d.serial, profile: d.profile, api: d.api, x, width, height: h });
      x += width;
    }
    if ((await dim(gif))[0] !== x) throw new Error(`panel widths ${x} != gif width`);
    if (result.gif.bytes <= 10 * 2 ** 20) break;
  }
}

const passed = (result.runs ?? []).filter((x) => x.ok).length;
const gifOk = (result.gif?.bytes ?? Infinity) <= 10 * 2 ** 20;
ok = passed === N && (result.runs?.length ?? 0) === N && gifOk;
result.ok = ok;
writeFileSync(join(root, "docs/measurements/mvp.json"), JSON.stringify({ ...result, old: { baseline: "baseline.json", spec: OLD_SPEC } }, null, 2) + "\n");

const dev = result.devices ?? [];
const sum = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
const runs = result.runs ?? [];
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 10) / 10 : "-");
const oldDisk = sum(baseline.devices, "diskBytes");
writeFileSync(join(root, "docs/measurements/mvp.md"), `# MVP: private-app \`techs.multi.ts\` on crewdroid (T11)

\`node scripts/mvp-private-app.mjs --runs ${N}\` — raw: \`mvp.json\`, old path devices: \`baseline.json\` (T01). Date ${result.date.slice(0, 10)}.
private-app unchanged: its global-setup runs \`avd-up.ps1\`, which kills only \`old-avd-*\` emulators and skips booting a port that is already a device, so the crewdroid instances on 5570/5572/5574 only get the APK installed.

## Devices

| | Old path (avd-up.ps1) | crewdroid |
|---|---|---|
| Devices | old-avd-1..3, google_apis API 33, all 1080x2340 | ${dev.map((d) => `${d.profile} ${d.size} API ${d.api}`).join("<br>")} |
| Disk (AVD dirs + system images, each once) | ${GiB(oldDisk)} GiB | ${GiB(sum(dev, "diskBytes"))} GiB |
| Boot (launch -> boot_completed) | ${baseline.devices.map((d) => d.bootSeconds).join(" / ")} s (cold) | ${dev.map((d) => d.bootSeconds).join(" / ")} s (snapshot); ready incl. identity + wm ${dev.map((d) => d.readySeconds).join(" / ")} s |
| Host RAM (sum, after 60 s idle) | ${sum(baseline.devices, "ramMB")} MB | ${sum(dev, "ramMB")} MB |
| Host CPU (sum, 60 s idle, 100 % = 1 core) | ${Math.round(sum(baseline.devices, "cpuPercent"))} % | ${Math.round(sum(dev, "cpuPercent"))} % |

## Spec \`npm run e2e:multi -- --grep @techs\`

| | Old path | crewdroid |
|---|---|---|
| Pass count | ${OLD_SPEC.filter((x) => x.ok).length}/${OLD_SPEC.length} (records: ${OLD_SPEC.map((x) => `\`${x.source}\``).join(", ")}) | ${passed}/${N} in a row |
| Test time (Playwright) | ${OLD_SPEC.map((x) => x.testSeconds).join(" / ")} s | ${runs.map((x) => x.testSeconds).join(" / ")} s (avg ${avg(runs.map((x) => x.testSeconds))}) |
| Spec wall time (Playwright total incl. global-setup: APK build + install + server; old path also boots the 3 AVDs there) | ${OLD_SPEC.map((x) => x.totalSeconds).join(" / ")} s | ${runs.map((x) => x.totalSeconds).join(" / ")} s (npm run end to end: ${runs.map((x) => x.wallSeconds).join(" / ")} s) |
| Emulator CPU during the spec (sum, avg) | not measured | ${runs.map((x) => x.emuCpuPercent).join(" / ")} % |

Old path not re-run: \`avd-up.ps1\` line 74 boots old-avd-1..3 without \`-read-only\`, and crewdroid must only launch them read-only. Old device numbers come from T01 (same emulator flags plus \`-read-only\`, fresh boots).
Demo: \`docs/demo/techs.gif\` (${result.gif ? `${(result.gif.bytes / 2 ** 20).toFixed(1)} MB, ${result.gif.height} px high, ${result.gif.fps} fps` : "not made"}) — run 1, the 3 devices side by side (screenrecord with timestamp overlay).
`);
console.log(`runs passed ${passed}/${N}; gif ${result.gif ? `${result.gif.bytes} bytes` : "missing"}; emulators killed ${result.down?.killed?.length ?? "?"}`);
console.log(ok ? `OK: private-app @techs passed ${N}/${N} on crewdroid devices` : "FAIL");
process.exit(ok ? 0 : 1);
