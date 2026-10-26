import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { adb } from "./adb.ts";
import { avdHome, avdName } from "./avd.ts";
import { makeDistinct } from "./identity.ts";
import { dirBytes, procs, sysImageDir, waitBoot } from "./measure.ts";
import { emulatorPath } from "./sdk.ts";
import { assign, atdImages, loadProfiles, loadProfilesFile, parseScreen, relaunchBlackApis } from "./profiles.ts";
import { prepare, sleep, start } from "./snapshot.ts";
import { avdSlim } from "./slim.ts";

const run = promisify(execFile);

export interface UpDevice {
  serial: string; port: number; avd: string; image: string; api: number; belowMinApi: boolean;
  profile: string; model: string; width: number; height: number; density: number; densitySource: string;
  wmSize: string; wmDensity: string; bootSeconds: number; readySeconds: number; distinctNotes: string[]; relaunchBlack: boolean;
  phases: Record<string, number>; // seconds since launch at the end of each step (T42)
}

// One crewdroid run drives the emulators at a time. down() kills every crew-* instance, so a second run started meanwhile
// (two autopilot shifts on one checkout, 2026-10-24) killed the first run's clones mid-setup -> "device offline" (T15).
// The owner is the first process that calls up()/down(); child processes inherit CREWDROID_OWNER and share it.
// A dead owner PID frees the lock (e.g. after `crewdroid up` exits with its emulators left running).
export const LOCK = () => process.env.CREWDROID_LOCK || join(tmpdir(), "crewdroid-emulators.lock");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; } };
export function claimEmulators() {
  const me = process.env.CREWDROID_OWNER || String(process.pid);
  const owner = existsSync(LOCK()) ? readFileSync(LOCK(), "utf8").trim() : "";
  if (owner && owner !== me && alive(Number(owner))) throw new Error(`another crewdroid run (pid ${owner}) is using the emulators; wait for it to finish (lock ${LOCK()})`);
  writeFileSync(LOCK(), me);
  process.env.CREWDROID_OWNER = me;
}

async function waitAdb(serial: string, t0: number, timeoutMs = 540000) {
  while (Date.now() - t0 < timeoutMs) {
    if ((await adb(serial, ["get-state"], 5000, false).catch(() => "")) === "device") return;
    await sleep(500);
  }
}

// AI NOTE: Android's wm size only accepts up to 2x the display's physical size per side (base AVD: 1080x2340), so
// 3840x2160 came out as 2160x2160 (T18). Only a profile past that limit gets `-skin` (half its size, rounded up; the saved snapshot no longer matches, so cold boot) so the
// physical display is big enough; every other profile keeps the unchanged launch args.
const skinFor = (p: { width: number; height: number }) =>
  p.width > 2 * 1080 || p.height > 2 * 2340 ? ["-skin", `${Math.ceil(p.width / 2)}x${Math.ceil(p.height / 2)}`, "-no-snapshot-load"] : [];

// T36: no count -> one device (s24ultra on the highest installed API <= 36); an explicit count keeps the mixed behaviour.
export function upDefaults(a: { count?: number; profiles?: string[]; api?: number; screens?: string[]; profilesFile?: string }) {
  const single = a.count === undefined;
  return {
    count: a.count ?? 1,
    names: a.profiles ?? (single && !a.screens?.length && !a.profilesFile ? ["s24ultra"] : undefined),
    api: a.api ?? (single ? ("latest" as const) : undefined),
  };
}

function pickImages(api?: number | "latest") {
  const all = atdImages();
  if (api === undefined) return all;
  const have = all.map((x) => x.api).join(",") || "none";
  const hit = api === "latest" ? all.filter((x) => x.api <= 36).slice(-1) : all.filter((x) => x.api === api);
  if (!hit.length) throw new Error(`no google_atd image for API ${api} (installed: ${have})`);
  return hit;
}

export async function up(count: number, basePort = 5580, names?: string[], window = false, custom: { screens?: string[]; profilesFile?: string; api?: number | "latest" } = {}) {
  // Validate every input before taking the lock or launching anything.
  const screens = (custom.screens ?? []).map(parseScreen);
  const all = [...loadProfiles(), ...(custom.profilesFile ? loadProfilesFile(custom.profilesFile) : [])];
  const named = names ? names.map((n) => all.find((p) => p.name === n) ?? (() => { throw new Error(`unknown profile '${n}' (have: ${all.map((p) => p.name).join(",")})`); })()) : undefined;
  // --screen alone -> only those screens; with --profiles -> named profiles then screens; --profiles-file alone -> its profiles.
  const profiles = [...(named ?? (screens.length ? [] : custom.profilesFile ? loadProfilesFile(custom.profilesFile) : all)), ...screens];
  const images = pickImages(custom.api);
  claimEmulators();
  const slots = assign(count, profiles, images);
  const ports = slots.map((_, i) => basePort + 2 * i);
  for (const p of ports) {
    if (await adb(`emulator-${p}`, ["get-state"], 5000, false).then(() => true, () => false)) throw new Error(`emulator-${p} already running (crewdroid down?)`);
  }
  // Each image needs a base AVD with a quickboot snapshot saved with the current knobs (avd.ts KNOBS); prepare() makes it
  // (boots writable on basePort) on first use and after a knob change.
  for (const image of new Set(slots.map((s) => s.image))) {
    if (!avdSlim(join(avdHome(), `${avdName(image)}.avd`))) {
      console.error(`preparing ${image} (first use or changed settings)`);
      await prepare(image, basePort);
    }
  }
  const serials = ports.map((p) => `emulator-${p}`);
  try {
    const t0s: number[] = [];
    for (const [i, s] of slots.entries()) {
      await start(avdName(s.image), ports[i], true, ["-no-boot-anim", ...skinFor(s.profile)], window);
      t0s.push(Date.now());
      if (i < slots.length - 1) await sleep(3000); // stagger launches; nothing to stagger after the last
    }
    const devices = await Promise.all(slots.map(async (s, i): Promise<UpDevice> => {
      const serial = serials[i];
      const phases: Record<string, number> = {};
      const mark = (k: string) => (phases[k] = Math.round((Date.now() - t0s[i]) / 100) / 10);
      await waitAdb(serial, t0s[i]);
      mark("adbDevice");
      const bootSeconds = await waitBoot(serial, t0s[i]);
      mark("bootCompleted");
      // AI NOTE: ATD's /system/build.prop sets debug.hwui.drawing_enabled=0, so apps never post a frame (screencap black,
      // window stuck on the boot logo). Not persist.*: set on every boot; apps started after this draw (ADR 0003).
      await adb(serial, ["shell", "setprop", "debug.hwui.drawing_enabled", "1"]);
      mark("hwui");
      // AI NOTE: prepare() saves the snapshot with adbd already root, so clones come up as root and the old fixed
      // 5 s + 3 s around `adb root` were pure wait (T42). Root is still needed by makeDistinct, net (tc) and triage (/data/anr).
      if ((await adb(serial, ["shell", "id", "-u"])) !== "0") {
        await sleep(5000);
        await adb(serial, ["root"], 20000);
        await sleep(3000);
      }
      mark("root");
      // T42: clones of one snapshot share android_id, serial, MAC, hostname; makeDistinct (framework restart + probe
      // reinstall, ~27 s) only matters when two clones run side by side. A single device keeps the snapshot's identity.
      const distinctNotes = slots.length > 1 ? await makeDistinct(serial, i + 1) : [];
      mark("identity");
      await adb(serial, ["shell", "wm", "size", `${s.profile.width}x${s.profile.height}`]);
      await adb(serial, ["shell", "wm", "density", String(s.profile.density)]);
      mark("wm");
      return {
        serial, port: ports[i], avd: avdName(s.image), image: s.image, api: s.api, belowMinApi: s.belowMinApi,
        profile: s.profile.name, model: s.profile.model, width: s.profile.width, height: s.profile.height,
        density: s.profile.density, densitySource: s.profile.densitySource,
        wmSize: await adb(serial, ["shell", "wm", "size"]), wmDensity: await adb(serial, ["shell", "wm", "density"]),
        bootSeconds: Math.round(bootSeconds * 10) / 10, readySeconds: Math.round((Date.now() - t0s[i]) / 100) / 10, distinctNotes,
        relaunchBlack: relaunchBlackApis().includes(s.api), phases,
      };
    }));
    for (const d of devices.filter((x) => x.relaunchBlack)) {
      console.error(`WARN ${d.serial} API ${d.api}: screen can stay black after am start -S / force-stop + immediate start; wait 2 s between stop and start (ADR 0005)`);
    }
    return { date: new Date().toISOString(), count, devices };
  } catch (e) {
    await down();
    throw e;
  }
}

// T01's metrics for `up` instances, on fresh boots: kills running crew instances first and its own at the end.
export async function measureUp(count: number, basePort = 5580, idleSec = 60, names?: string[]) {
  await down();
  try {
    const r = await up(count, basePort, names);
    const re = (port: number) => `-port ${port}([ "]|$)`;
    const before = await Promise.all(r.devices.map((d) => procs(re(d.port))));
    const w0 = Date.now();
    await sleep(idleSec * 1000);
    const after = await Promise.all(r.devices.map((d) => procs(re(d.port))));
    const wall = (Date.now() - w0) / 1000;
    // AI NOTE: clones of one AVD share its dir and system image, so each dir is counted once (on the first device using it).
    const seen = new Set<string>();
    const once = (dir: string) => (seen.has(dir) ? 0 : (seen.add(dir), dirBytes(dir)));
    const devices = r.devices.map((d, i) => {
      const dir = join(avdHome(), `${d.avd}.avd`);
      const avdDirBytes = once(dir);
      return {
        avd: d.avd, serial: d.serial, profile: d.profile, api: d.api, avdDirBytes, diskBytes: avdDirBytes + once(sysImageDir(dir)),
        bootSeconds: d.bootSeconds, readySeconds: d.readySeconds,
        ramMB: Math.round(after[i].ws / 1048576),
        cpuPercent: Math.round(((after[i].cpu - before[i].cpu) / wall) * 1000) / 10,
      };
    });
    const { stdout } = await run(emulatorPath(), ["-version"], { windowsHide: true });
    return {
      date: new Date().toISOString(),
      pc: { cpuModel: cpus()[0].model, cores: cpus().length, ramGB: Math.round(totalmem() / 2 ** 30), os: `${process.platform} ${release()}` },
      emulatorVersion: stdout.match(/version\s+(\S+)/)?.[1] ?? "unknown",
      idleSeconds: idleSec, diskTotalBytes: devices.reduce((a, d) => a + d.diskBytes, 0), devices,
    };
  } finally {
    await down();
  }
}

// Kills only crewdroid instances: emulator/qemu processes whose command line names an AVD `crew-*`.
export async function down(): Promise<{ killed: number[]; ports: number[] }> {
  claimEmulators();
  const list = async () => {
    const ps = `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'emulator|qemu' -and $_.CommandLine -match '(^|[ @"])crew-[^ "]+([ "]|$)' } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; cmd = $_.CommandLine } })`;
    const { stdout } = await run("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
    return JSON.parse(stdout.trim() || "[]") as { pid: number; cmd: string }[];
  };
  const procs = await list();
  const ports = [...new Set(procs.map((p) => Number(p.cmd.match(/-port\s+(\d+)/)?.[1])).filter((p) => p > 0))];
  for (const p of ports) await adb(`emulator-${p}`, ["emu", "kill"], 10000).catch(() => {});
  if (ports.length) await sleep(5000);
  for (const p of await list()) await run("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${p.pid} -Force`], { windowsHide: true }).catch(() => {});
  return { killed: procs.map((p) => p.pid), ports };
}
