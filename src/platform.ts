import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { arch } from "node:os";
import { promisify } from "node:util";

// Every OS difference lives here (T43): emulator launch, process listing/killing, NTFS steps, image ABI.
// Windows keeps the PowerShell commands crewdroid has used since T01; macOS/Linux use spawn + ps + process.kill.
// `platform` / `exec` / `sp` parameters exist so test/platform.test.ts can check both sides on one OS.

type Exec = (cmd: string, args: string[], opts?: object) => Promise<{ stdout: string }>;
const run: Exec = promisify(execFile) as Exec;
const win = (p: string) => p === "win32";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ps = (cmd: string, exec: Exec = run) => exec("powershell", ["-NoProfile", "-Command", cmd], { windowsHide: true, maxBuffer: 64 * 2 ** 20 }).then((r) => r.stdout);

// google_atd image ABI for a host CPU: arm64 (Apple Silicon, ARM Linux) -> arm64-v8a, else x86_64.
export const imageAbi = (a: string) => (a === "arm64" ? "arm64-v8a" : "x86_64");
export const hostAbi = (a: string = arch()) => imageAbi(a);
// NTFS sparse files + compression (slim) exist only on Windows.
export const ntfs = (p: string = process.platform) => win(p);
// What ramMB / ws means on this OS (measurement JSON `method`).
export const ramMethod = (p: string = process.platform) => (win(p) ? "WorkingSet64 (Get-Process)" : "RSS from ps (shared pages not split between clones)");

// Emulator launch. Windows: Start-Process -WindowStyle Hidden (same as the old launcher script); Node's detached spawn left
// the grandchild qemu-system-*-headless.exe with a visible console window (2026-10-23).
// AI NOTE: powershell's stdout/stderr are ignored and the PID goes through a file. With execFile, the emulator
// inherited the pipe and the promise never resolved (up hung after launch).
// macOS/Linux: detached spawn with the log as stdout/stderr; headless comes from -no-window in the args.
// Returns the launcher PID; callers match instances by their `crew-*` command line, not by this PID.
export async function launchDetached(exe: string, args: string[], log: string, window = false, platform: string = process.platform, sp: typeof spawn = spawn): Promise<number> {
  if (!win(platform)) {
    const fd = openSync(log, "w");
    try {
      const p = sp(exe, args, { detached: true, stdio: ["ignore", fd, fd] });
      p.on("error", () => {}); // a missing binary surfaces as pid undefined below
      p.unref();
      if (!p.pid) throw new Error(`emulator launch failed: ${exe}`);
      return p.pid;
    } finally { closeSync(fd); }
  }
  const pidFile = `${log}.pid`;
  const cmd = `$p = Start-Process -FilePath ${q(exe)} -ArgumentList @(${args.map(q).join(",")}) -WindowStyle ${window ? "Minimized" : "Hidden"} -PassThru -RedirectStandardOutput ${q(log)} -RedirectStandardError ${q(log + ".err")}; Set-Content -LiteralPath ${q(pidFile)} -Value $p.Id`;
  await new Promise<void>((ok, fail) => {
    const p = sp("powershell", ["-NoProfile", "-Command", cmd], { stdio: "ignore", windowsHide: true });
    p.on("error", fail);
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`emulator launch failed (powershell exit ${code})`))));
  });
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  unlinkSync(pidFile);
  if (!pid) throw new Error(`emulator launch returned no PID`);
  return pid;
}

export interface PsRow { pid: number; ppid: number; rss: number; cpuSec: number; cmd: string }
export const PS_ARGS = ["-axo", "pid=,ppid=,rss=,%cpu=,time=,command="];
// `ps -axo pid=,ppid=,rss=,%cpu=,time=,command=` output; rss in bytes, cpuSec = cumulative CPU time (`time`:
// [[dd-]hh:]mm:ss[.cc]). AI NOTE: %cpu is a decaying (macOS) or lifetime (Linux) average, so CPU% over an idle window
// is computed from `time` deltas, same as TotalProcessorTime on Windows.
export function parsePs(out: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const l of out.split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+[\d.,]+\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [d, hms] = m[4].includes("-") ? m[4].split("-") : ["0", m[4]];
    const cpuSec = Number(d) * 86400 + hms.split(":").reduce((a, x) => a * 60 + Number(x), 0);
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024, cpuSec, cmd: m[5] });
  }
  return rows;
}
// Windows' `$_.Name -match 'emulator|qemu'`: the executable's file name (command text before the first ` -` argument).
const emuName = (cmd: string) => /(emulator|qemu)[^/]*$/i.test(cmd.split(" -")[0]);
const psMatch = async (re: string, exec: Exec) => parsePs((await exec("ps", PS_ARGS, { maxBuffer: 64 * 2 ** 20 })).stdout).filter((r) => emuName(r.cmd) && new RegExp(re).test(r.cmd));

// command line naming a crewdroid AVD (`crew-*`)
export const CREW_RE = `(^|[ @"])crew-[^ "]+([ "]|$)`;
// emulator/qemu processes whose command line matches `re` (PowerShell / JS regex, the patterns used are valid in both).
export async function listProcesses(re: string, platform: string = process.platform, exec: Exec = run): Promise<{ pid: number; cmd: string }[]> {
  if (!win(platform)) return (await psMatch(re, exec)).map((r) => ({ pid: r.pid, cmd: r.cmd }));
  const out = await ps(`ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'emulator|qemu' -and $_.CommandLine -match '${re}' } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; cmd = $_.CommandLine } })`, exec);
  return JSON.parse(out.trim() || "[]");
}

// Force-kills the given PIDs (a listProcesses result holds launcher and qemu child, so the whole tree goes).
// Windows: Stop-Process -Force. macOS/Linux: SIGTERM, SIGKILL to survivors after 5 s.
export async function killTree(pids: number[], platform: string = process.platform, exec: Exec = run) {
  if (win(platform)) {
    for (const pid of pids) await ps(`Stop-Process -Id ${pid} -Force`, exec).catch(() => {});
    return;
  }
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (const pid of pids) try { process.kill(pid, "SIGTERM"); } catch {}
  for (let t = 0; t < 50 && pids.some(alive); t++) await sleep(100);
  for (const pid of pids.filter(alive)) try { process.kill(pid, "SIGKILL"); } catch {}
}

export const killMatching = async (re: string) => killTree((await listProcesses(re)).map((p) => p.pid));

// Sum over matching emulator/qemu processes: ws = resident bytes, cpu = cumulative CPU seconds.
export async function procStats(re: string, platform: string = process.platform, exec: Exec = run): Promise<{ ws: number; cpu: number }[]> {
  if (!win(platform)) return (await psMatch(re, exec)).map((r) => ({ ws: r.rss, cpu: r.cpuSec }));
  const out = await ps(`$r=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${re}' -and $_.Name -match 'emulator|qemu' } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if($p){ [pscustomobject]@{ws=$p.WorkingSet64;cpu=$p.TotalProcessorTime.TotalSeconds} } }); ConvertTo-Json -Compress -InputObject @($r)`, exec);
  return JSON.parse(out.trim() || "[]");
}

export interface Mem { pid: number; name: string; privateBytes: number; ws: number; privateWs: number; sharedWs: number; sharedPss: number }
// T16 memory split (Windows): Private Bytes, working set split into private and shared pages (QueryWorkingSet), shared part
// divided by each page's share count (PSS). AI NOTE: ShareCount saturates at 7, so pages shared by more processes (system
// DLLs) are slightly over-counted. macOS/Linux: RSS only, reported as private (shared pages not split).
export async function memRows(re: string, platform: string = process.platform, exec: Exec = run): Promise<Mem[]> {
  if (!win(platform)) return (await psMatch(re, exec)).map((r) => ({ pid: r.pid, name: r.cmd.split(" -")[0].split("/").pop()!, privateBytes: r.rss, ws: r.rss, privateWs: r.rss, sharedWs: 0, sharedPss: 0 }));
  const cs = `using System;using System.Runtime.InteropServices;public static class CrewWs{[DllImport("psapi.dll")]static extern bool QueryWorkingSet(IntPtr h,long[] b,int n);[DllImport("kernel32.dll")]static extern IntPtr OpenProcess(uint a,bool i,int p);[DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);public static double[] Stat(int pid){IntPtr h=OpenProcess(0x410,false,pid);if(h==IntPtr.Zero)return null;try{for(int n=1<<20;;n*=2){long[] b=new long[n];if(!QueryWorkingSet(h,b,n*8)){if(b[0]>=n-1)continue;return null;}double p=0,s=0,pss=0;for(long i=1;i<=b[0];i++){long e=b[i];if((e&256)==0){p++;}else{s++;long c=(e>>5)&7;pss+=1.0/(c<1?1:c);}}return new double[]{p*4096,s*4096,pss*4096};}}finally{CloseHandle(h);}}}`;
  const out = await ps(`Add-Type -TypeDefinition '${cs}'; $r=@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${re}' -and $_.Name -match 'emulator|qemu' } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; $s=[CrewWs]::Stat($_.ProcessId); if($p -and $s){ [pscustomobject]@{pid=$p.Id;name=$p.ProcessName;privateBytes=$p.PrivateMemorySize64;ws=$p.WorkingSet64;privateWs=[int64]$s[0];sharedWs=[int64]$s[1];sharedPss=[int64]$s[2]} } }); ConvertTo-Json -Compress -InputObject @($r)`, exec);
  return JSON.parse(out.trim() || "[]");
}

// Real on-disk allocation summed over every file under each path. Windows: GetCompressedFileSizeW (sparse holes and NTFS
// compression excluded). macOS/Linux: `du -sk` (allocated blocks). Missing path -> 0.
export async function allocBytes(paths: string[], platform: string = process.platform, exec: Exec = run): Promise<number[]> {
  if (!win(platform)) return Promise.all(paths.map(async (p) => (existsSync(p) ? Number((await exec("du", ["-sk", p])).stdout.split(/\s/)[0]) * 1024 : 0)));
  const list = paths.map(q).join(",");
  const out = await ps(`Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern uint GetCompressedFileSizeW(string p, out uint h);';
    @(${list}) | ForEach-Object { $t=[int64]0; if (Test-Path -LiteralPath $_) { Get-ChildItem -LiteralPath $_ -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { $h=[uint32]0; $l=[W.K]::GetCompressedFileSizeW($_.FullName,[ref]$h); $t += [int64]$h*4294967296 + $l } }; $t }`, exec);
  return out.trim().split(/\r?\n/).map(Number);
}

// NTFS (LZNT1) compression and the sparse flag; callers check ntfs() first.
export const ntfsCompress = (paths: string[]) => run("compact", ["/c", "/q", ...paths], { windowsHide: true, maxBuffer: 16 * 2 ** 20 });
export const ntfsSparseFlag = (file: string) => run("fsutil", ["sparse", "setflag", file], { windowsHide: true });
