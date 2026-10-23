import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { cpus, release, totalmem } from "node:os";
import { join } from "node:path";
import { adb } from "./adb.ts";
import { avdHome, avdName } from "./avd.ts";
import { makeDistinct } from "./identity.ts";
import { dirBytes, procs, sysImageDir, waitBoot } from "./measure.ts";
import { emulatorPath } from "./sdk.ts";
import { assign, atdImages, loadProfiles } from "./profiles.ts";
import { SNAPSHOT, prepare, sleep, start } from "./snapshot.ts";

const run = promisify(execFile);

export interface UpDevice {
  serial: string; port: number; avd: string; image: string; api: number; belowMinApi: boolean;
  profile: string; model: string; width: number; height: number; density: number; densitySource: string;
  wmSize: string; wmDensity: string; bootSeconds: number; readySeconds: number; distinctNotes: string[];
}

export async function up(count: number, basePort = 5580, names?: string[]) {
  const all = loadProfiles();
  const profiles = names ? names.map((n) => all.find((p) => p.name === n) ?? (() => { throw new Error(`unknown profile '${n}' (have: ${all.map((p) => p.name).join(",")})`); })()) : all;
  const slots = assign(count, profiles, atdImages());
  const ports = slots.map((_, i) => basePort + 2 * i);
  for (const p of ports) {
    if (await adb(`emulator-${p}`, ["get-state"], 5000).then(() => true, () => false)) throw new Error(`emulator-${p} already running (crewdroid down?)`);
  }
  // Each image needs a base AVD with a saved quickboot snapshot; prepare() makes it once (boots writable on basePort).
  for (const image of new Set(slots.map((s) => s.image))) {
    if (!existsSync(join(avdHome(), `${avdName(image)}.avd`, "snapshots", SNAPSHOT))) {
      console.error(`preparing ${image} (first use)`);
      await prepare(image, basePort);
    }
  }
  const serials = ports.map((p) => `emulator-${p}`);
  try {
    const t0s: number[] = [];
    for (const [i, s] of slots.entries()) {
      start(avdName(s.image), ports[i], true, ["-no-boot-anim"]);
      t0s.push(Date.now());
      await sleep(3000);
    }
    const devices = await Promise.all(slots.map(async (s, i): Promise<UpDevice> => {
      const serial = serials[i];
      const bootSeconds = await waitBoot(serial, t0s[i]);
      await sleep(5000);
      await adb(serial, ["root"], 20000); // makeDistinct edits /data/system and wlan0 (see identity.ts)
      await sleep(3000);
      const distinctNotes = await makeDistinct(serial, i + 1);
      await adb(serial, ["shell", "wm", "size", `${s.profile.width}x${s.profile.height}`]);
      await adb(serial, ["shell", "wm", "density", String(s.profile.density)]);
      return {
        serial, port: ports[i], avd: avdName(s.image), image: s.image, api: s.api, belowMinApi: s.belowMinApi,
        profile: s.profile.name, model: s.profile.model, width: s.profile.width, height: s.profile.height,
        density: s.profile.density, densitySource: s.profile.densitySource,
        wmSize: await adb(serial, ["shell", "wm", "size"]), wmDensity: await adb(serial, ["shell", "wm", "density"]),
        bootSeconds: Math.round(bootSeconds * 10) / 10, readySeconds: Math.round((Date.now() - t0s[i]) / 100) / 10, distinctNotes,
      };
    }));
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
