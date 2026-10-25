import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { cpus, release, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { adb } from "./adb.ts";
import { launchEmulator } from "./emulator.ts";
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

// Win32 process rows (emulator launcher + qemu child) whose command line matches `re` (PowerShell regex).
export async function procs(re: string): Promise<{ ws: number; cpu: number }> {
  const ps = `$r=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${re}' -and $_.Name -match 'emulator|qemu' } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($p){ [pscustomobject]@{ws=$p.WorkingSet64;cpu=$p.TotalProcessorTime.TotalSeconds} } }); ConvertTo-Json -Compress -InputObject @($r)`;
  const { stdout } = await run("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
  const rows = JSON.parse(stdout.trim() || "[]") as { ws: number; cpu: number }[];
  if (!rows.length) throw new Error(`no emulator process found for ${re}`);
  return { ws: rows.reduce((a, r) => a + r.ws, 0), cpu: rows.reduce((a, r) => a + r.cpu, 0) };
}

export interface Mem { pid: number; name: string; privateBytes: number; ws: number; privateWs: number; sharedWs: number; sharedPss: number }

// T16 memory measure, per emulator/qemu process whose command line matches `re`: Private Bytes (commit), working set split
// into private and shared pages (QueryWorkingSet), and the shared part divided by each page's share count (PSS), so the
// sum over processes counts a page shared by clones once. `ws` is the old T01 number (WorkingSet64).
// AI NOTE: ShareCount saturates at 7, so pages shared by more processes (system DLLs) are slightly over-counted.
export async function memStats(re: string): Promise<Mem[]> {
  const cs = `using System;using System.Runtime.InteropServices;public static class CrewWs{[DllImport("psapi.dll")]static extern bool QueryWorkingSet(IntPtr h,long[] b,int n);[DllImport("kernel32.dll")]static extern IntPtr OpenProcess(uint a,bool i,int p);[DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);public static double[] Stat(int pid){IntPtr h=OpenProcess(0x410,false,pid);if(h==IntPtr.Zero)return null;try{for(int n=1<<20;;n*=2){long[] b=new long[n];if(!QueryWorkingSet(h,b,n*8)){if(b[0]>=n-1)continue;return null;}double p=0,s=0,pss=0;for(long i=1;i<=b[0];i++){long e=b[i];if((e&256)==0){p++;}else{s++;long c=(e>>5)&7;pss+=1.0/(c<1?1:c);}}return new double[]{p*4096,s*4096,pss*4096};}}finally{CloseHandle(h);}}}`;
  const ps = `Add-Type -TypeDefinition '${cs}'; $r=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${re}' -and $_.Name -match 'emulator|qemu' } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; $s=[CrewWs]::Stat($_.ProcessId); if($p -and $s){ [pscustomobject]@{pid=$p.Id;name=$p.ProcessName;privateBytes=$p.PrivateMemorySize64;ws=$p.WorkingSet64;privateWs=[int64]$s[0];sharedWs=[int64]$s[1];sharedPss=[int64]$s[2]} } }); ConvertTo-Json -Compress -InputObject @($r)`;
  const { stdout } = await run("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
  const rows = JSON.parse(stdout.trim() || "[]") as Mem[];
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
      // same flags as private-app avd-up.ps1, plus -read-only so the AVD files are never modified
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
      idleSeconds: idleSec, devices,
    };
  } finally {
    for (const s of started) {
      await adb(s.serial, ["emu", "kill"], 10000).catch(() => {});
    }
    await sleep(5000);
    for (const s of started) {
      // fallback if emu kill did not finish the process
      await run("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '(^|[ @"])${s.avd}([ "]|$)' -and $_.Name -match 'emulator|qemu' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { windowsHide: true }).catch(() => {});
    }
  }
}
