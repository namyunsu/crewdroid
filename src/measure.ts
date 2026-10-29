import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { adb } from "./adb.ts";
import { launchEmulator } from "./emulator.ts";
import { type Mem, killMatching, memRows, procStats, ramMethod } from "./platform.ts";
import { emulatorPath, sdkRoot } from "./sdk.ts";

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Device {
  avd: string; serial: string; diskBytes: number; avdDirBytes: number;
  bootSeconds: number; ramMB: number; cpuPercent: number;
}

export function dirBytes(p: string): number {
  let n = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    const f = join(p, e.name);
    n += e.isDirectory() ? dirBytes(f) : statSync(f).size;
  }
  return n;
}

const avdHome = () => process.env.ANDROID_AVD_HOME || join(process.env.USERPROFILE || process.env.HOME || "", ".android", "avd");

function avdDir(name: string): string {
  const d = join(avdHome(), `${name}.avd`);
  if (!existsSync(d)) throw new Error(`AVD not found: ${name}`);
  return d;
}

export function sysImageDir(avd: string): string {
  const m = readFileSync(join(avd, "config.ini"), "utf8").match(/^image\.sysdir\.1\s*=\s*(.+)$/m);
  if (!m) throw new Error("image.sysdir.1 missing in config.ini");
  return resolve(sdkRoot(), m[1].trim());
}

const avdRe = (avd: string) => `(^|[ @"])${avd}([ "]|$)`;

// emulator/qemu process rows (launcher + qemu child) whose command line matches `re`, summed: ws bytes, cpu seconds.
export async function procs(re: string): Promise<{ ws: number; cpu: number }> {
  const rows = await procStats(re);
  if (!rows.length) throw new Error(`no emulator process found for ${re}`);
  return { ws: rows.reduce((a, r) => a + r.ws, 0), cpu: rows.reduce((a, r) => a + r.cpu, 0) };
}

export type { Mem } from "./platform.ts";
// T16 memory measure per emulator/qemu process whose command line matches `re` (see platform.ts memRows).
export async function memStats(re: string): Promise<Mem[]> {
  const rows = await memRows(re);
  if (!rows.length) throw new Error(`no emulator process found for ${re}`);
  return rows;
}

export async function waitBoot(serial: string, t0: number, timeoutMs = 540000): Promise<number> {
  let last = "";
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await adb(serial, ["shell", "getprop", "sys.boot_completed"], 5000, false)) === "1") { console.error(`${serial} booted`); return (Date.now() - t0) / 1000; }
    } catch (e) { last = String(e).slice(0, 200); }
    await sleep(1000);
  }
  throw new Error(`${serial} boot timeout; last adb error: ${last}`);
}

export async function measure(avds: string[], basePort: number, idleSec = 60) {
  const started: { avd: string; serial: string; t0: number }[] = [];
  try {
    for (const [i, avd] of avds.entries()) {
      avdDir(avd);
      const port = basePort + 2 * i;
      const serial = `emulator-${port}`;
      // same flags as the launcher script it replaced, plus -read-only so the AVD files are never modified
      await launchEmulator(["-avd", avd, "-port", String(port), "-no-window", "-no-audio", "-read-only", "-gpu", "host", "-camera-back", "emulated"], join(tmpdir(), `crewdroid-${avd}.log`));
      started.push({ avd, serial, t0: Date.now() });
      await sleep(3000); // AI NOTE: launching 3 emulators in the same instant intermittently hung one at startup (log stops after GPU init); a 3 s stagger avoids it
    }
    const boots = await Promise.all(started.map((s) => waitBoot(s.serial, s.t0)));
    const before = await Promise.all(started.map((s) => procs(avdRe(s.avd))));
    const w0 = Date.now();
    await sleep(idleSec * 1000);
    const after = await Promise.all(started.map((s) => procs(avdRe(s.avd))));
    const wall = (Date.now() - w0) / 1000;

    const imgSeen = new Set<string>();
    const devices: Device[] = started.map((s, i) => {
      const dir = avdDir(s.avd);
      const img = sysImageDir(dir);
      const imgBytes = imgSeen.has(img) ? 0 : dirBytes(img); // system image counted once per distinct dir
      imgSeen.add(img);
      const avdDirBytes = dirBytes(dir);
      return {
        avd: s.avd, serial: s.serial, avdDirBytes, diskBytes: avdDirBytes + imgBytes,
        bootSeconds: Math.round(boots[i] * 10) / 10,
        ramMB: Math.round(after[i].ws / 1048576),
        cpuPercent: Math.round(((after[i].cpu - before[i].cpu) / wall) * 1000) / 10,
      };
    });
    const { stdout } = await run(emulatorPath(), ["-version"], { windowsHide: true });
    return {
      date: new Date().toISOString(),
      pc: { cpuModel: cpus()[0].model, cores: cpus().length, ramGB: Math.round(totalmem() / 2 ** 30), os: `${process.platform} ${release()}` },
      emulatorVersion: stdout.match(/version\s+(\S+)/)?.[1] ?? "unknown",
      method: ramMethod(), idleSeconds: idleSec, devices,
    };
  } finally {
    for (const s of started) {
      await adb(s.serial, ["emu", "kill"], 10000).catch(() => {});
    }
    await sleep(5000);
    for (const s of started) {
      // fallback if emu kill did not finish the process
      await killMatching(avdRe(s.avd)).catch(() => {});
    }
  }
}
