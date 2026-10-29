// T72 (FR-48): one device, crewdroid vs what Android Studio's Device Manager makes by default.
//   node scripts/measure-single.mjs [--reps 3] [--idle-seconds 60] [--calls 10]   (~35 min; boots its own emulators)
// Baseline: AVD `crewbench-pixel` (avdmanager, pixel_9, google_apis_playstore, newest installed API <= 36, default RAM/cores,
// quickboot on, window on, -gpu auto) on port 5560. crewdroid: base AVD + `up` defaults on port 5580. Never run side by side.
// Per side, per rep: cold boot -> kill (Studio saves its quickboot snapshot) -> start from the snapshot -> idle 60 s -> 10 screen
// reads -> 10 screenshots. RAM/CPU/calls are measured on the snapshot-started instance. Writes
// docs/measurements/single-vs-studio.{json,md}; deletes the crewbench AVD and runs `down` at the end.
import { execFile, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, freemem, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { assertSerial, adb } from "../src/adb.ts";
import { avdHome, avdName, imageDir, imagePackage } from "../src/avd.ts";
import { dirBytes, procs, sysImageDir, waitBoot } from "../src/measure.ts";
import { allocBytes, killMatching, listProcesses, ramMethod } from "../src/platform.ts";
import { atdImages } from "../src/profiles.ts";
import { screen } from "../src/screen.ts";
import { adbPath, emulatorPath, sdkRoot } from "../src/sdk.ts";
import { shot } from "../src/shot.ts";
import { killAll, sleep, start } from "../src/snapshot.ts";
import { claimEmulators } from "../src/up.ts";

const { values: v } = parseArgs({ options: { reps: { type: "string", default: "3" }, "idle-seconds": { type: "string", default: "60" }, calls: { type: "string", default: "10" } } });
const REPS = Number(v.reps), IDLE = Number(v["idle-seconds"]), CALLS = Number(v.calls);
const root = join(import.meta.dirname, "..");
const out = join(root, "docs", "measurements");
const run = promisify(execFile);

const NAME = "crewbench-pixel", S_PORT = 5560, S_SERIAL = `emulator-${S_PORT}`;
const C_PORT = 5580, C_SERIAL = `emulator-${C_PORT}`;
const DEVICE = "pixel_9";
const crewImage = atdImages().filter((x) => x.api <= 36).at(-1);
if (!crewImage) throw new Error("no google_atd image installed");
const api = crewImage.api;
const studioImage = `android-${api}/google_apis_playstore`;
const studioPkg = imagePackage(studioImage);
const C_AVD = avdName(crewImage.image);

const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => Math.round(x * 10) / 10;
const r3 = (x) => Math.round(x * 1000) / 1000;
const bat = (n) => join(sdkRoot(), "cmdline-tools", "latest", "bin", process.platform === "win32" ? `${n}.bat` : n);
const crewCli = (...a) => { const r = spawnSync("npx", ["tsx", "src/cli.ts", ...a, "--json"], { cwd: root, encoding: "utf8", shell: true, maxBuffer: 2 ** 26 }); return { code: r.status, out: r.stdout, err: r.stderr }; };

const hasHierarchy = (s) => s.includes("<hierarchy");
async function stockDump(serial) {
  assertSerial(serial);
  const t = performance.now();
  const { stdout } = await run(adbPath(), ["-s", serial, "exec-out", "uiautomator", "dump", "/dev/tty"], { timeout: 30000, windowsHide: true, maxBuffer: 2 ** 26 });
  if (!hasHierarchy(stdout)) throw new Error(`uiautomator dump gave no hierarchy: ${stdout.slice(0, 200)}`);
  return performance.now() - t;
}
async function stockShot(serial) {
  assertSerial(serial);
  const t = performance.now();
  const { stdout } = await run(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", timeout: 30000, windowsHide: true, maxBuffer: 2 ** 28 });
  if (stdout.length < 1000 || stdout.readUInt32BE(0) !== 0x89504e47) throw new Error("screencap gave no PNG");
  return performance.now() - t;
}
// seconds from t0 until the first successful `adb exec-out uiautomator dump` (the first moment an agent can read the screen)
async function readyDump(serial, t0) {
  for (;;) {
    try { await stockDump(serial); return (Date.now() - t0) / 1000; } catch { if (Date.now() - t0 > 300000) throw new Error(`${serial}: no screen read within 300 s`); await sleep(300); }
  }
}
const times = async (n, f) => { const a = []; for (let i = 0; i < n; i++) a.push(await f()); return a; };

async function emuAlive(re) { return (await listProcesses(re)).length > 0; }
async function waitGone(re, ms = 180000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (!(await emuAlive(re))) return; await sleep(1000); }
  await killMatching(re); // gave up waiting for the snapshot save
}
const studioRe = `(^|[ @"])${NAME}([ "]|$)`;
const studioPort = `-port ${S_PORT}([ "]|$)`;

// Studio launch: visible window, -gpu auto, quickboot unless `extra` says otherwise. The emulator log is kept for the snapshot load time.
function studioLaunch(extra, tag) {
  const log = join(tmpdir(), `crewbench-${tag}.log`);
  const fd = openSync(log, "w");
  const p = spawn(emulatorPath(), ["-avd", NAME, "-port", String(S_PORT), "-gpu", "auto", ...extra], { detached: true, stdio: ["ignore", fd, fd], windowsHide: false });
  p.unref();
  closeSync(fd);
  return log;
}
async function studioQuit() {
  await adb(S_SERIAL, ["emu", "kill"], 15000).catch(() => {});
  await waitGone(studioRe);
}
const snapLoadMs = (log) => { try { const m = readFileSync(log, "utf8").match(/loaded snapshot '[^']+' using (\d+) ms/); return m ? Number(m[1]) : null; } catch { return null; } };

// idle CPU/RAM + calls on a running instance; `portRe` finds its processes
async function idleStats(portRe) {
  const a = await procs(portRe), w0 = Date.now();
  await sleep(IDLE * 1000);
  const b = await procs(portRe);
  return { ramMB: Math.round(b.ws / 1048576), cpuPercent: r1(((b.cpu - a.cpu) / ((Date.now() - w0) / 1000)) * 100) };
}

const errs = [];
const want = (c, m) => { if (!c) errs.push(m); };
process.env.CREWDROID_OWNER = String(process.pid); // children share this process's emulator lock
claimEmulators();

const result = { date: new Date().toISOString(), reps: REPS, idleSeconds: IDLE, calls: CALLS };
const studio = { reps: [] }, crew = { reps: [] };
let imageSizeBytes = 0;
try {
  // a fresh host: nothing else emulating
  const others = await listProcesses(`.`);
  if (others.length) throw new Error(`emulator processes already running (pids ${others.map((p) => p.pid).join(",")}); measure on a fresh host`);
  await run(adbPath(), ["start-server"], { windowsHide: true });

  // ---- Studio baseline ----
  if (!existsSync(join(sdkRoot(), "system-images", `android-${api}`, "google_apis_playstore", "x86_64", "system.img")) && !existsSync(imageDir(studioImage) + "/system.img")) {
    throw new Error(`BLOCKED: ${studioPkg} not installed (sdkmanager "${studioPkg}")`);
  }
  imageSizeBytes = (await allocBytes([imageDir(studioImage)]))[0];
  spawnSync(`"${bat("avdmanager")}"`, ["delete", "avd", "-n", NAME], { shell: true, encoding: "utf8" }); // leftover of an aborted run only
  const mk = spawnSync(`"${bat("avdmanager")}"`, ["create", "avd", "-n", NAME, "-k", `"${studioPkg}"`, "-d", DEVICE, "--force"], { shell: true, input: "no\n", encoding: "utf8" });
  if (mk.status !== 0) throw new Error(`avdmanager create failed: ${mk.stdout}${mk.stderr}`);
  const studioDir = join(avdHome(), `${NAME}.avd`);
  const cfg = readFileSync(join(studioDir, "config.ini"), "utf8");
  const cfgGet = (k) => cfg.match(new RegExp(`^${k.replace(".", "\\.")}\\s*=\\s*(.*)$`, "m"))?.[1]?.trim();
  studio.config = Object.fromEntries(["hw.ramSize", "hw.cpu.ncore", "hw.lcd.width", "hw.lcd.height", "hw.lcd.density", "hw.gpu.mode", "image.sysdir.1", "disk.dataPartition.size"].map((k) => [k, cfgGet(k) ?? null]));
  console.error(`studio AVD ${NAME}:`, JSON.stringify(studio.config));

  console.error("studio warm-up boot (first boot of a fresh AVD, not counted)");
  studioLaunch(["-no-snapshot-load"], "warmup");
  await waitBoot(S_SERIAL, Date.now());
  await sleep(30000);
  await studioQuit();

  for (let i = 0; i < REPS; i++) {
    console.error(`studio rep ${i + 1}/${REPS}: cold boot`);
    let t0 = Date.now();
    studioLaunch(["-no-snapshot-load"], `cold${i}`);
    const coldBoot = await waitBoot(S_SERIAL, t0);
    const coldReady = await readyDump(S_SERIAL, t0);
    await sleep(15000);
    await studioQuit(); // quickboot saves default_boot on exit

    console.error(`studio rep ${i + 1}/${REPS}: from quickboot snapshot`);
    t0 = Date.now();
    const log = studioLaunch([], `snap${i}`);
    const snapBoot = await waitBoot(S_SERIAL, t0);
    const snapReady = await readyDump(S_SERIAL, t0);
    const idle = await idleStats(studioPort);
    const dumps = await times(CALLS, () => stockDump(S_SERIAL));
    const shots = await times(CALLS, () => stockShot(S_SERIAL));
    await studioQuit();
    studio.reps.push({ coldBoot: r1(coldBoot), coldReady: r1(coldReady), snapBoot: r1(snapBoot), snapReady: r1(snapReady), snapLoadMs: snapLoadMs(log), ...idle, screenMs: r1(median(dumps)), shotMs: r1(median(shots)) });
    want(studio.reps.at(-1).snapLoadMs !== null, `studio rep ${i + 1}: the second start did not load a snapshot`);
  }
  studio.avdDirBytes = (await allocBytes([studioDir]))[0];
  studio.avdDirLogicalBytes = dirBytes(studioDir);
  studio.diskBytes = studio.avdDirBytes + imageSizeBytes;

  // ---- crewdroid ----
  const cDir = join(avdHome(), `${C_AVD}.avd`);
  for (let i = 0; i < REPS; i++) {
    crewCli("down");
    console.error(`crewdroid rep ${i + 1}/${REPS}: cold boot (same launch args as up, minus snapshot load)`);
    let t0 = Date.now();
    await start(C_AVD, C_PORT, true, ["-no-boot-anim", "-no-snapshot-load"]);
    const coldBoot = await waitBoot(C_SERIAL, t0);
    const coldReady = await readyDump(C_SERIAL, t0);
    await killAll(C_AVD, [C_SERIAL]);

    console.error(`crewdroid rep ${i + 1}/${REPS}: up (snapshot)`);
    t0 = Date.now();
    const up = crewCli("up");
    const wall = (Date.now() - t0) / 1000;
    if (up.code !== 0) throw new Error(`up exited ${up.code}: ${up.err || up.out}`);
    const d = JSON.parse(up.out).devices[0];
    want(d.serial === C_SERIAL && d.api === api, `crewdroid rep ${i + 1}: got ${d.serial} API ${d.api}`);
    const snapReady = wall + (await readyDump(C_SERIAL, Date.now()));
    const idle = await idleStats(`-port ${C_PORT}([ "]|$)`);
    const dumps = await times(CALLS, () => stockDump(C_SERIAL));
    const shots = await times(CALLS, () => stockShot(C_SERIAL));
    const cliScreen = await times(CALLS, async () => { const t = performance.now(); const r = crewCli("screen", C_SERIAL); if (r.code !== 0) throw new Error(`screen: ${r.err || r.out}`); return performance.now() - t; });
    const png = join(tmpdir(), "crewbench-shot.png");
    const cliShot = await times(CALLS, async () => { const t = performance.now(); const r = crewCli("shot", C_SERIAL, png); if (r.code !== 0) throw new Error(`shot: ${r.err || r.out}`); return performance.now() - t; });
    const apiScreen = await times(CALLS, async () => { const t = performance.now(); await screen(C_SERIAL); return performance.now() - t; });
    const apiShot = await times(CALLS, async () => { const t = performance.now(); await shot(C_SERIAL, png); return performance.now() - t; });
    rmSync(png, { force: true });
    crew.reps.push({
      coldBoot: r1(coldBoot), coldReady: r1(coldReady), snapBoot: r1(d.bootSeconds), upReady: d.readySeconds, upWall: r1(wall), snapReady: r1(snapReady), ...idle,
      stockScreenMs: r1(median(dumps)), stockShotMs: r1(median(shots)),
      screenMs: r1(median(cliScreen)), shotMs: r1(median(cliShot)), inProcessScreenMs: r1(median(apiScreen)), inProcessShotMs: r1(median(apiShot)),
    });
    crewCli("down");
  }
  crew.avdDirBytes = (await allocBytes([cDir]))[0];
  crew.avdDirLogicalBytes = dirBytes(cDir);
  const cImg = sysImageDir(cDir);
  crew.diskBytes = crew.avdDirBytes + (await allocBytes([cImg]))[0];
  crew.imageLogicalBytes = dirBytes(cImg);

  // ---- result ----
  const col = (side, k) => r1(median(side.reps.map((x) => x[k])));
  const colN = (side, k, n = 1) => Math.round(median(side.reps.map((x) => x[k])) * 10 ** n) / 10 ** n;
  result.pc = { cpuModel: cpus()[0].model.trim(), cores: cpus().length, ramGB: Math.round(totalmem() / 2 ** 30), freeRamGBAtStart: r1(freemem() / 2 ** 30), os: `${process.platform} ${release()}` };
  result.ramMethod = ramMethod();
  result.emulatorVersion = (await run(emulatorPath(), ["-version"], { windowsHide: true })).stdout.match(/version\s+(\S+)/)?.[1] ?? "unknown";
  result.studio = { ...studio, avd: NAME, device: DEVICE, image: studioPkg, api, imageAllocBytes: imageSizeBytes, launch: "visible window, -gpu auto, quickboot (snapshot saved on exit)",
    median: { coldBoot: col(studio, "coldBoot"), coldReady: col(studio, "coldReady"), snapBoot: col(studio, "snapBoot"), snapReady: col(studio, "snapReady"), ramMB: colN(studio, "ramMB", 0), cpuPercent: col(studio, "cpuPercent"), screenMs: col(studio, "screenMs"), shotMs: col(studio, "shotMs") } };
  result.crewdroid = { ...crew, avd: C_AVD, image: crewImage.image, api, launch: "crewdroid up (no flags): headless, -gpu host, snapshot, 2 cores",
    median: { coldBoot: col(crew, "coldBoot"), coldReady: col(crew, "coldReady"), snapBoot: col(crew, "snapBoot"), snapReady: col(crew, "snapReady"), upReady: col(crew, "upReady"), ramMB: colN(crew, "ramMB", 0), cpuPercent: col(crew, "cpuPercent"), screenMs: col(crew, "screenMs"), shotMs: col(crew, "shotMs"), stockScreenMs: col(crew, "stockScreenMs"), stockShotMs: col(crew, "stockShotMs"), inProcessScreenMs: col(crew, "inProcessScreenMs"), inProcessShotMs: col(crew, "inProcessShotMs") } };
  result.method = {
    boot: "seconds from launch to sys.boot_completed=1 (adb getprop poll, 1 s)",
    ready: "seconds from launch to the first successful `adb exec-out uiautomator dump /dev/tty`; crewdroid snapshot start = wall time of `crewdroid up` (incl. node start) + that first dump",
    cold: "Studio: -no-snapshot-load. crewdroid: the `up` launch args plus -no-snapshot-load (up itself never cold boots)",
    snapshot: "Studio: quickboot snapshot saved on the previous exit. crewdroid: `crewdroid up` (default_boot of the base AVD)",
    ram: `${ramMethod()}, emulator + qemu processes of the instance, taken at the end of the ${IDLE} s idle window`,
    cpu: `cumulative CPU seconds of those processes over ${IDLE} s idle, 100 % = 1 core`,
    calls: `median of ${CALLS} calls per rep, then median of the ${REPS} reps. Studio and crewdroid-stock: adb exec-out uiautomator dump /dev/tty and screencap -p. crewdroid: wall time of 'npx tsx src/cli.ts screen|shot' (incl. node start) and, in-process, of the same functions the MCP server calls`,
    disk: "bytes actually allocated (NTFS compression and sparse holes excluded) of the AVD dir + its system image dir",
  };
  writeFileSync(join(out, "single-vs-studio.json"), JSON.stringify(result, null, 2) + "\n");
  writeFileSync(join(out, "single-vs-studio.md"), md(result));
  console.log(md(result));
} catch (e) {
  errs.push(String(e?.stack || e));
} finally {
  await killMatching(studioRe).catch(() => {});
  const del = spawnSync(`"${bat("avdmanager")}"`, ["delete", "avd", "-n", NAME], { shell: true, encoding: "utf8" });
  console.error(`avdmanager delete ${NAME}: exit ${del.status}`);
  crewCli("down");
}

function md(r) {
  const s = r.studio.median, c = r.crewdroid.median, GB = (b) => (b / 2 ** 30).toFixed(2);
  const row = (name, a, b, unit) => `| ${name} | ${a} ${unit} | ${b} ${unit} |`;
  return `# One device: crewdroid vs Android Studio's default emulator (T72, FR-48)

Date: ${r.date.slice(0, 10)}. Host: ${r.pc.cpuModel}, ${r.pc.cores} threads, ${r.pc.ramGB} GB RAM, ${r.pc.os}, emulator ${r.emulatorVersion}. Median of ${r.reps} runs per side; nothing else emulating.

- Studio side: AVD made with avdmanager (\`${r.studio.device}\`, \`${r.studio.image}\`, ${JSON.stringify(r.studio.config)}), ${r.studio.launch}.
- crewdroid side: ${r.crewdroid.launch}; base AVD \`${r.crewdroid.avd}\` (${r.crewdroid.image}).

| | Studio default AVD | crewdroid |
|---|---|---|
${row("Cold boot to sys.boot_completed", s.coldBoot, c.coldBoot, "s")}
${row("Cold boot to first screen read", s.coldReady, c.coldReady, "s")}
${row("Start from snapshot to sys.boot_completed", s.snapBoot, c.snapBoot, "s")}
${row("Start from snapshot to first screen read", s.snapReady, c.snapReady, "s")}
${row("Host RAM after ready (" + r.idleSeconds + " s idle)", s.ramMB, c.ramMB, "MB")}
${row("Idle CPU over " + r.idleSeconds + " s (100 % = 1 core)", s.cpuPercent, c.cpuPercent, "%")}
${row("Disk (AVD + system image)", GB(r.studio.diskBytes), GB(r.crewdroid.diskBytes), "GiB")}
${row("Screen read, median of " + r.calls, s.screenMs + " (adb uiautomator dump)", c.screenMs + " (\`crewdroid screen\` CLI)", "ms")}
${row("Screenshot, median of " + r.calls, s.shotMs + " (adb screencap)", c.shotMs + " (\`crewdroid shot\` CLI)", "ms")}

Extra crewdroid rows: stock \`adb\` calls on the crewdroid device ${c.stockScreenMs} ms (dump) and ${c.stockShotMs} ms (screencap); the same \`screen\` / \`shot\` functions in-process (what the MCP server runs) ${c.inProcessScreenMs} ms and ${c.inProcessShotMs} ms. \`up\` itself reports ready after ${c.upReady} s.

System image on disk (already included in the Studio disk row above; it can stay installed): ${GB(r.studio.imageAllocBytes)} GiB.

## Per run
Studio: ${JSON.stringify(r.studio.reps)}

crewdroid: ${JSON.stringify(r.crewdroid.reps)}

## Method
${Object.entries(r.method).map(([k, t]) => `- ${k}: ${t}`).join("\n")}
`;
}

if (errs.length) { console.error("FAIL:\n" + errs.join("\n")); process.exit(1); }
console.log("OK: single-device comparison written to docs/measurements/single-vs-studio.{json,md}");
