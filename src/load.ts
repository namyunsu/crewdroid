import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import type { Tool } from "./mcp.ts";

// T62: make a device behave like a used phone (FR-42). One fixed recipe per level (docs/measurements/load.md):
// fillers = installed tiny packages (scripts/gen-filler-apks.mjs; every 3rd wakes up and schedules a periodic job),
// procs = background app processes kept alive by the load app (dev.crewdroid.load, load-app/), availPct = MemAvailable
// left, in % of the device's MemAvailable with load off (ballast = anonymous shared memory held by the load app),
// cpuPct = duty cycle of one worker thread per guest core, alarms = repeating AlarmManager wakeups, jobs = self-rescheduling jobs.
export const LEVELS = ["off", "low", "mid", "high"] as const;
export type Level = (typeof LEVELS)[number];
export const RECIPES: Record<Exclude<Level, "off">, { fillers: number; procs: number; availPct: number; cpuPct: number; alarms: number; jobs: number }> = {
  low: { fillers: 30, procs: 5, availPct: 50, cpuPct: 10, alarms: 10, jobs: 3 },
  mid: { fillers: 80, procs: 15, availPct: 30, cpuPct: 25, alarms: 30, jobs: 8 },
  high: { fillers: 150, procs: 30, availPct: 15, cpuPct: 50, alarms: 60, jobs: 15 },
};
export const LOAD_PKG = "dev.crewdroid.load";
export const FILLER_PREFIX = "dev.crewdroid.filler.f";
const root = join(import.meta.dirname, "..");
export const loadApk = () => join(root, "load-app/build/outputs/apk/release/crewdroid-load-release.apk");
export const fillerDir = () => join(root, "load-app/build/fillers");
export const fillerName = (i: number) => `${FILLER_PREFIX}${String(i).padStart(3, "0")}`;
const REMOTE = "/data/local/tmp/crew-fillers";

export function checkLevel(level: string): Level {
  if (!(LEVELS as readonly string[]).includes(level)) throw new Error(`unknown load level '${level}' (${LEVELS.join("|")})`);
  return level as Level;
}

// ---- guest state ----
export const parseMeminfo = (t: string) => {
  const kb = (k: string) => Number(t.match(new RegExp(`^${k}:\\s+(\\d+)`, "m"))?.[1] ?? NaN);
  return { totalKb: kb("MemTotal"), availKb: kb("MemAvailable"), swapTotalKb: kb("SwapTotal"), swapFreeKb: kb("SwapFree") };
};
// two `cpu ...` lines of /proc/stat -> % of all guest cores busy between them (idle + iowait = not busy)
export function cpuBusy(a: string, b: string): number {
  const f = (l: string) => l.trim().split(/\s+/).slice(1).map(Number);
  const [x, y] = [f(a), f(b)];
  const tot = y.reduce((s, v) => s + v, 0) - x.reduce((s, v) => s + v, 0);
  const idle = y[3] + (y[4] ?? 0) - x[3] - (x[4] ?? 0);
  return tot > 0 ? Math.round((1 - idle / tot) * 1000) / 10 : 0;
}
const section = (out: string, k: string) => out.replace(/\r/g, "").split(`@@${k}\n`)[1]?.split("@@")[0] ?? "";

// One adb shell call: meminfo, loadavg, cpu busy over `cpuSec`, processes, packages.
export async function guestState(serial: string, cpuSec = 3) {
  const out = await adb(serial, ["shell", `echo @@mem; cat /proc/meminfo; echo @@load; cat /proc/loadavg; echo @@s1; head -1 /proc/stat; sleep ${cpuSec}; echo @@s2; head -1 /proc/stat; ` +
    `echo @@ps; ps -A -o NAME=; echo @@pkgs; pm list packages; echo @@end`], 60000);
  const m = parseMeminfo(section(out, "mem"));
  const ps = section(out, "ps").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pkgs = section(out, "pkgs").split(/\r?\n/).map((l) => l.trim().replace(/^package:/, "")).filter(Boolean);
  return {
    memTotalMB: Math.round(m.totalKb / 1024), memAvailableMB: Math.round(m.availKb / 1024), memAvailableKb: m.availKb,
    memAvailablePct: Math.round((m.availKb / m.totalKb) * 1000) / 10, swapUsedMB: Math.round((m.swapTotalKb - m.swapFreeKb) / 1024),
    loadAverage: section(out, "load").trim().split(/\s+/).slice(0, 3).map(Number),
    cpuBusyPct: cpuBusy(section(out, "s1"), section(out, "s2")),
    runningProcesses: ps.length, loadProcesses: ps.filter((n) => n === LOAD_PKG || n.startsWith(`${LOAD_PKG}:`)).length,
    installedPackages: pkgs.length, fillerPackages: pkgs.filter((p) => p.startsWith(FILLER_PREFIX)).length,
  };
}
export type GuestState = Awaited<ReturnType<typeof guestState>>;

// ---- per-device state: baseline MemAvailable measured while load was off ----
const stateFile = (serial: string) => join(tmpdir(), "crewdroid", `load-${assertSerial(serial)}.json`);
type State = { level: Level; baselineKb: number; baselinePct: number; bootId: string };
const bootId = async (serial: string) => (await sh(serial, "cat /proc/sys/kernel/random/boot_id")).trim();
// a state file from an earlier boot of the same port (down + up) does not count
async function readState(serial: string): Promise<State | undefined> {
  let st: State;
  try { st = JSON.parse(readFileSync(stateFile(serial), "utf8")); } catch { return undefined; }
  return st.bootId === (await bootId(serial)) ? st : undefined;
}

// ---- host-side artifacts ----
function ensureArtifacts(fillers: number) {
  if (!existsSync(loadApk())) {
    console.error("building the load app (load-app/, first use)");
    execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["-p", join(root, "load-app"), "assembleRelease", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });
  }
  if (fillers && !existsSync(join(fillerDir(), `${fillerName(fillers)}.apk`))) {
    console.error(`generating filler APKs (first use)`);
    execFileSync(process.execPath, [join(root, "scripts/gen-filler-apks.mjs"), "--count", String(RECIPES.high.fillers)], { stdio: "inherit" });
  }
}

const sh = (serial: string, cmd: string, ms = 60000) => adb(serial, ["shell", cmd], ms);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const installed = async (serial: string) => (await sh(serial, `pm list packages ${FILLER_PREFIX}`)).split(/\r?\n/).map((l) => l.trim().replace(/^package:/, "")).filter(Boolean);

// Installs fillers 1..n that are missing and removes the ones above n. Returns how many were installed/removed.
async function setFillers(serial: string, n: number) {
  const have = new Set(await installed(serial));
  const want = Array.from({ length: n }, (_, k) => fillerName(k + 1));
  const add = want.filter((p) => !have.has(p)), drop = [...have].filter((p) => !want.includes(p));
  if (add.length) {
    await sh(serial, `rm -rf ${REMOTE}; mkdir -p ${REMOTE}`);
    await adb(serial, ["push", ...add.map((p) => join(fillerDir(), `${p}.apk`)), REMOTE], 300000);
    // AI NOTE: one device-side loop instead of one `adb install` per package (host round-trip + streaming per APK)
    await sh(serial, `for f in ${REMOTE}/*.apk; do pm install -r "$f" >/dev/null || echo "FAIL $f"; done; rm -rf ${REMOTE}`, 900000);
  }
  if (drop.length) await sh(serial, `for p in ${drop.join(" ")}; do pm uninstall $p >/dev/null; done`, 600000);
  const now = await installed(serial);
  if (now.length !== n) throw new Error(`fillers on ${serial}: ${now.length} installed, want ${n}`);
  return { added: add.length, removed: drop.length };
}

async function waitReady(serial: string, token: string, timeoutMs = 240000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeoutMs; await sleep(2000)) {
    const line = (await sh(serial, `logcat -d -s CrewLoad:I | grep 'READY ${token}'; true`)).trim();
    if (line) return line.slice(line.indexOf("READY"));
  }
  throw new Error(`load app on ${serial} did not report READY within ${timeoutMs / 1000} s (logcat -s CrewLoad)`);
}

// Applies one level. Returns the recipe and the measured guest state.
export async function setLoad(serial: string, level: string, opt: { keepApps?: boolean } = {}) {
  assertSerial(serial);
  const lv = checkLevel(level);
  const t0 = Date.now();
  const prev = await readState(serial);
  await sh(serial, `am force-stop ${LOAD_PKG}`); // kills its processes, alarms and jobs; releases the ballast
  if (lv === "off") {
    if (!opt.keepApps) {
      await setFillers(serial, 0);
      await sh(serial, `pm uninstall ${LOAD_PKG} >/dev/null; true`);
    }
    rmSync(stateFile(serial), { force: true });
    await sleep(5000);
    const guest = await guestState(serial);
    return { serial, level: lv, keepApps: !!opt.keepApps, baselineMemAvailablePct: prev?.baselinePct ?? null, guest, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  }
  const r = RECIPES[lv];
  ensureArtifacts(r.fillers);
  let base = prev;
  if (!base) {
    await sleep(3000);
    const g = await guestState(serial, 1);
    base = { level: lv, baselineKb: g.memAvailableKb, baselinePct: g.memAvailablePct, bootId: await bootId(serial) };
  }
  mkdirSync(join(tmpdir(), "crewdroid"), { recursive: true });
  writeFileSync(stateFile(serial), JSON.stringify({ ...base, level: lv }));
  const out = await adb(serial, ["install", "-r", loadApk()], 120000); // ~2 s; always, so a rebuilt load app is picked up
  if (!/Success/.test(out)) throw new Error(`install load app on ${serial}: ${out}`);
  const fillers = await setFillers(serial, r.fillers);
  // packages that have code start stopped; an explicit broadcast (incl. stopped packages, 0x20) wakes them once, so their
  // receiver schedules its periodic job as on a phone after boot
  const woken = Array.from({ length: r.fillers }, (_, k) => k + 1).filter((i) => i % 3 === 0).map(fillerName);
  await sh(serial, `for p in ${woken.join(" ")}; do am broadcast -f 32 -a dev.crewdroid.filler.WAKE -n $p/dev.crewdroid.filler.Boot >/dev/null; done`, 300000);
  const token = `t${Date.now()}`;
  const targetKb = Math.round((base.baselineKb * r.availPct) / 100);
  await sh(serial, "logcat -c; true");
  await sh(serial, `am start -n ${LOAD_PKG}/.Start --ei procs ${r.procs} --el availKb ${targetKb} --ei cpu ${r.cpuPct} --ei alarms ${r.alarms} --ei jobs ${r.jobs} --es token ${token}`);
  const ready = await waitReady(serial, token);
  await sleep(5000); // let lmkd react to the new pressure before measuring
  const guest = await guestState(serial);
  return {
    serial, level: lv, recipe: r, baselineMemAvailablePct: base.baselinePct, targetMemAvailableMB: Math.round(targetKb / 1024),
    fillers, ready, guest, seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
}

export const mcpTools: Tool[] = [{
  name: "load", long: true,
  description: "Make one emulator behave like a used phone: off|low|mid|high = installed filler apps (30/80/150), background processes (5/15/30), memory ballast down to 50/30/15 % of the off-level free RAM, CPU workers at 10/25/50 % per core, alarm/job wakeups. off removes it all (keepApps keeps the fillers installed). Returns the measured guest state (MemAvailable %, load average, CPU busy %, processes, packages).",
  input: { serial: z.string().describe("emulator-<port>"), level: z.enum(LEVELS), keepApps: z.boolean().optional().describe("off only: keep the filler packages installed") },
  run: (a) => setLoad(a.serial, a.level, { keepApps: a.keepApps }),
}];
