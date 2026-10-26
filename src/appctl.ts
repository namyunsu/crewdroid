import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import { apk } from "./apk.ts";
import { parseStart } from "./perf.ts";
import { parseExitInfo, triage } from "./triage.ts";
import type { Tool } from "./mcp.ts";

const sh = (serial: string, cmd: string, ms = 30000) => adb(serial, ["shell", cmd], ms);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pkgOf = (p: string) => { if (!/^[\w.]+$/.test(p)) throw new Error(`bad package name '${p}'`); return p; };
const text = (e: any) => `${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`.trim();

// ---- install ----
// `all` = every running crew device. AI NOTE: devices() lives in mcp.ts (which loads this file), so import it on use.
export async function install(target: string, file: string, grant = false) {
  const serials = target === "all" ? (await (await import("./mcp.ts")).devices()).map((d) => d.serial) : [assertSerial(target)];
  if (!serials.length) throw new Error("no running crewdroid devices");
  // a non-APK has no manifest: still let adb give its own failure text
  const pkg = await apk(file).then((a) => a.package, () => null);
  const results = await Promise.all(serials.map(async (serial) => {
    try {
      const out = await adb(serial, ["install", "-r", ...(grant ? ["-g"] : []), file], 180000);
      return /Success/.test(out) ? { serial, package: pkg, ok: true, result: "Success" } : { serial, package: pkg, ok: false, result: out.split(/\r?\n/).at(-1) ?? "failed" };
    } catch (e: any) {
      const t = text(e);
      return { serial, package: pkg, ok: false, result: t.match(/INSTALL_\w+/)?.[0] ?? t.split(/\r?\n/).filter(Boolean).at(-1) ?? "failed", detail: t.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ").slice(0, 400) };
    }
  }));
  return { file, grant, results, ok: results.every((r) => r.ok) };
}

// ---- launch ----
const ARG_RE = /^[A-Za-z0-9._$/:=-]+$/;
export async function launch(serial: string, pkg: string, o: { activity?: string; restart?: boolean; extras?: string[] } = {}) {
  assertSerial(serial); pkgOf(pkg);
  const extras = o.extras ?? [];
  // adb shell joins these into one device shell line: no metacharacters
  for (const x of [...(o.activity ? [o.activity] : []), ...extras]) if (!ARG_RE.test(x)) throw new Error(`bad --activity/extra '${x}' (allowed: A-Z a-z 0-9 . _ $ / : = -)`);
  const comp = o.activity ? `${pkg}/${o.activity}` : (await sh(serial, `cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${pkg}`)).split(/\r?\n/).at(-1)!.trim();
  if (!comp.includes("/")) throw new Error(`no launcher activity for ${pkg} on ${serial} (installed?): ${comp}`);
  if (o.restart) { await sh(serial, `am force-stop ${pkg}`); await sleep(2000); } // never `am start -S` (ADR 0005)
  const out = await adb(serial, ["shell", "am", "start", "-W", "-n", comp, ...extras], 120000);
  const start = parseStart(out);
  if (start.status !== "ok") throw new Error(`am start ${comp} failed: ${out.slice(0, 300)}`);
  await sleep(2000);
  const alive = !!(await sh(serial, `pidof ${pkg}`).catch(() => ""));
  const r: any = { serial, pkg, component: comp, restart: !!o.restart, totalTime: start.totalTime, launchState: start.launchState, crashed: !alive };
  if (!alive) { const c = (await triage(serial, pkg)).crashes.at(-1); r.crash = c ? { exception: c.exception, topFrame: c.topFrame, time: c.time } : null; }
  return r;
}

// ---- logs ----
const LINE = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.+?)\s*: (.*)$/;
const LEVELS = "VDIWEF";
export interface LogLine { time: string; pid: number; tid: number; level: string; tag: string; message: string }
export function parseLogs(out: string): LogLine[] {
  const r: LogLine[] = [];
  for (const l of out.split(/\r?\n/)) {
    const m = l.match(LINE);
    if (m) r.push({ time: m[1], pid: Number(m[2]), tid: Number(m[3]), level: m[4], tag: m[5], message: m[6] });
  }
  return r;
}
export function parseSince(s: string): number {
  const m = s.match(/^(\d+)([sm]?)$/);
  if (!m) throw new Error(`bad --since '${s}' (60s, 90, 2m)`);
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
}

export async function logs(serial: string, pkg: string, o: { since?: string; level?: string; seconds?: number } = {}) {
  assertSerial(serial); pkgOf(pkg);
  const level = (o.level ?? "V").toUpperCase();
  if (!/^[VDIWEF]$/.test(level)) throw new Error(`bad --level '${o.level}' (V D I W E)`);
  const cutoffSec = o.since ? parseSince(o.since) : 0;
  if (!(await sh(serial, `pm path ${pkg}`).catch(() => ""))) throw new Error(`${pkg} is not installed on ${serial}`);
  let pid = Number((await sh(serial, `pidof ${pkg}`).catch(() => "")).split(/\s+/)[0]) || 0;
  const running = pid > 0;
  if (!running) {
    const start = [...(await sh(serial, "logcat -b all -d -v threadtime | grep 'Start proc'; true", 60000)).matchAll(new RegExp(`Start proc (\\d+):${pkg.replace(/\./g, "\\.")}/`, "g"))].at(-1);
    pid = Number(start?.[1]) || parseExitInfo(await sh(serial, `dumpsys activity exit-info ${pkg}`))[0]?.pid || 0;
    if (!pid) throw new Error(`${pkg} is not running and no earlier pid was found in the log`);
  }
  // cutoff in the device's own clock and time zone, same shape as logcat's time column (string compare works)
  const cutoff = cutoffSec ? await sh(serial, `date -d @$(( $(date +%s) - ${cutoffSec} )) +'%m-%d %H:%M:%S.000'`) : "";
  let raw: string;
  if (o.seconds) {
    // follow for N s: the killed adb still hands over what it read
    raw = await adb(serial, ["logcat", "-v", "threadtime", ...(running ? [`--pid=${pid}`] : ["-b", "all"])], o.seconds * 1000, false).catch((e: any) => { if (e.killed) return String(e.stdout ?? ""); throw e; });
  } else raw = await sh(serial, running ? `logcat -d -v threadtime --pid=${pid}` : `logcat -b all -d -v threadtime | grep -E ' +${pid} +[0-9]+ [VDIWEF] '; true`, 60000);
  const lines = parseLogs(raw).filter((l) => l.pid === pid && LEVELS.indexOf(l.level) >= LEVELS.indexOf(level) && l.time >= cutoff);
  return {
    serial, pkg, pid, source: running ? "pid" : "last-pid", count: lines.length,
    ...(running ? {} : { note: `${pkg} is not running; showing lines from its last pid ${pid} (logcat -b all)` }), lines,
  };
}

export const mcpTools: Tool[] = [
  {
    name: "install", description: "Use after each build: adb install -r [-g] a host .apk on one emulator or `all` crew devices (replaces the old version, keeps data). Returns ok and per device package + Success or the adb failure code (INSTALL_FAILED_*).",
    input: { target: z.string().describe("emulator-<port> or all"), apk: z.string().describe("host path to the .apk"), grant: z.boolean().default(false).describe("-g: grant all runtime permissions") },
    run: (a) => install(a.target, a.apk, a.grant),
  },
  {
    name: "launch", description: "Use to open the app after install, or restart it (restart:true) after a change. am start -W, then checks the process 2 s later. Returns component, totalTime ms and crashed; crashed:true comes with crash {exception, topFrame} (then call logs or triage).",
    input: { serial: z.string().describe("emulator-<port>"), pkg: z.string(), activity: z.string().optional().describe("e.g. .MainActivity; default = launcher activity"), restart: z.boolean().default(false), extras: z.array(z.string()).default([]).describe('am start extras, e.g. ["--es","check","crash"]') },
    run: (a) => launch(a.serial, a.pkg, { activity: a.activity, restart: a.restart, extras: a.extras }),
  },
  {
    name: "logs", description: "Use to see what the app printed or why it failed: one app's logcat lines only (its pid; its last pid when not running). Returns {lines:[{time, level, tag, message}]}, newest last, max 500; since:\"1m\" limits to recent lines.",
    input: { serial: z.string().describe("emulator-<port>"), pkg: z.string(), since: z.string().optional().describe("60s | 90 | 2m"), level: z.enum(["V", "D", "I", "W", "E"]).default("V"), seconds: z.number().int().min(1).max(300).optional().describe("follow for N s") },
    run: async (a) => { const r = await logs(a.serial, a.pkg, a); return { ...r, truncated: r.lines.length > 500, lines: r.lines.slice(-500) }; },
  },
];
