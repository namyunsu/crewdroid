import { statSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import type { Tool } from "./mcp.ts";

const sh = (serial: string, cmd: string, ms = 30000) => adb(serial, ["shell", cmd], ms);
const PKG_RE = /^[\w.]+$/;
// threadtime: "10-25 17:04:53.180  4423  4423 E AndroidRuntime: msg"
const LINE = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(\d+)\s+\d+\s+\w\s+(.+?)\s*: (.*)$/;

export interface Crash { pkg: string; pid: number; exception: string; topFrame: string; time: string }
export interface Anr { pkg: string; pid: number; reason: string; time: string; source: "logcat" | "exit-info" }
export interface Exit { pkg: string; pid: number; reason: string; description: string; time: string }

// `logcat -b crash` -> one entry per "FATAL EXCEPTION". topFrame = first frame in the app's own package, else the first frame.
export function parseCrashes(log: string): Crash[] {
  const out: Crash[] = [];
  let cur: (Crash & { frames: string[] }) | null = null;
  for (const l of log.split(/\r?\n/)) {
    const m = l.match(LINE);
    if (!m || m[3] !== "AndroidRuntime") continue;
    const msg = m[4];
    if (msg.startsWith("FATAL EXCEPTION")) { cur = { pkg: "", pid: Number(m[2]), exception: "", topFrame: "", time: m[1], frames: [] }; out.push(cur); continue; }
    if (!cur) continue;
    const p = msg.match(/^Process: ([^,]+), PID: (\d+)/);
    if (p) { cur.pkg = p[1]; cur.pid = Number(p[2]); }
    else if (/^\s*at /.test(msg)) cur.frames.push(msg.trim().slice(3));
    else if (!cur.exception && msg.trim()) cur.exception = msg.trim();
  }
  return out.map(({ frames, ...c }) => ({ ...c, topFrame: frames.find((f) => c.pkg && f.startsWith(c.pkg.split(":")[0] + ".")) ?? frames[0] ?? "" }));
}

// ActivityManager's "ANR in <proc> (<component>)" followed by "PID: n" and "Reason: …" (same timestamp).
export function parseAnrLog(log: string): Anr[] {
  const out: Anr[] = [];
  for (const l of log.split(/\r?\n/)) {
    const m = l.match(LINE);
    if (!m || m[3] !== "ActivityManager") continue;
    const a = m[4].match(/^ANR in (\S+)/);
    if (a) { out.push({ pkg: a[1], pid: 0, reason: "", time: m[1], source: "logcat" }); continue; }
    const last = out.at(-1);
    if (!last || last.time !== m[1]) continue;
    const pid = m[4].match(/^PID: (\d+)/);
    if (pid) last.pid = Number(pid[1]);
    else if (m[4].startsWith("Reason: ") && !last.reason) last.reason = m[4].slice(8);
  }
  return out;
}

// `dumpsys activity exit-info [pkg]` (API 30+ ApplicationExitInfo), newest first.
export function parseExitInfo(text: string): Exit[] {
  const out: Exit[] = [];
  for (const block of text.split(/ApplicationExitInfo #\d+:/).slice(1)) {
    const g = (re: RegExp) => block.match(re)?.[1] ?? "";
    out.push({
      pkg: g(/process=(\S+)/), pid: Number(g(/\bpid=(\d+)/)), reason: g(/reason=\d+ \(([^)]*\)?)\)/), time: g(/timestamp=(\S+ \S+)/),
      description: g(/description=(.*?)(?: state=| trace=|\r?\n|$)/),
    });
  }
  return out;
}

export async function triage(serial: string, app?: string, heap?: string) {
  assertSerial(serial);
  if (app && !PKG_RE.test(app)) throw new Error(`bad package name '${app}'`);
  if (heap && !app) throw new Error("--heap needs --app <pkg>");
  const mine = (p: string) => !app || p === app || p.startsWith(`${app}:`);

  const crashes = parseCrashes(await sh(serial, "logcat -b crash -d -v threadtime")).filter((c) => mine(c.pkg));
  const exits = parseExitInfo(await sh(serial, `dumpsys activity exit-info ${app ?? ""}`)).filter((e) => mine(e.pkg));
  const anrs = parseAnrLog(await sh(serial, "logcat -b main,system -d -v threadtime | grep -A2 'ActivityManager: ANR in'; true")).filter((a) => mine(a.pkg));
  // exit-info keeps ANRs across a logcat wipe; add those logcat no longer has (same pid = same ANR)
  for (const e of exits) if (/ANR/.test(e.reason) && !anrs.some((a) => a.pid === e.pid)) anrs.push({ pkg: e.pkg, pid: e.pid, reason: e.description, time: e.time, source: "exit-info" });

  // /data/anr needs root (crewdroid `up` runs `adb root`); one shell call reads the header of every trace file.
  // AI NOTE: adb shell passes the remote exit code through, so a grep with no match / ls without permission would throw: `; true`.
  const ls = await sh(serial, "ls /data/anr 2>&1; true");
  let anrTraces: { file: string; pkg: string; pid: number; subject: string }[] | "unreadable" = "unreadable";
  if (!/denied|No such/i.test(ls)) {
    const heads = await sh(serial, "for f in /data/anr/anr_*; do [ -f \"$f\" ] && echo \"== $f\" && grep -m3 -E '^Subject:|^----- pid|^Cmd line:' \"$f\"; done; true");
    anrTraces = heads.split("== ").slice(1).map((b) => ({
      file: b.split(/\r?\n/)[0].trim(), pkg: b.match(/Cmd line: (\S+)/)?.[1] ?? "", pid: Number(b.match(/----- pid (\d+)/)?.[1] ?? 0), subject: b.match(/Subject: (.*)/)?.[1]?.trim() ?? "",
    })).filter((t) => mine(t.pkg));
  }

  // last 200 lines that name the app or come from one of its pids (live or from the crash/ANR/exit records)
  let recentLog: string[];
  if (app) {
    const pids = new Set([...crashes, ...anrs, ...exits].map((x) => x.pid).filter(Boolean));
    for (const p of (await sh(serial, `pidof ${app}`).catch(() => "")).split(/\s+/)) if (p) pids.add(Number(p));
    const pat = [app.replace(/\./g, "\\."), ...[...pids].map((p) => ` ${p} `)].join("|");
    recentLog = (await sh(serial, `logcat -b main,system,crash -d -v threadtime | grep -E '${pat}' | tail -n 200`)).split(/\r?\n/).filter(Boolean);
  } else recentLog = (await sh(serial, "logcat -b main,system,crash -d -v threadtime -t 200")).split(/\r?\n/).filter((l) => l && !l.startsWith("---------"));

  let heapOut: { file: string; bytes: number } | undefined;
  if (heap) {
    const remote = "/data/local/tmp/crewdroid-heap.hprof";
    if (!(await sh(serial, `pidof ${app}`).catch(() => ""))) throw new Error(`${app} is not running on ${serial}; start it before --heap`);
    await sh(serial, `rm -f ${remote}; am dumpheap ${app} ${remote}`, 120000); // API 30+: returns after the dump is written
    await adb(serial, ["pull", remote, resolve(heap)], 120000);
    await sh(serial, `rm -f ${remote}`);
    heapOut = { file: resolve(heap), bytes: statSync(resolve(heap)).size };
  }

  const tops = new Map<string, number>();
  for (const c of crashes) tops.set(c.exception, (tops.get(c.exception) ?? 0) + 1);
  const top = [...tops].sort((a, b) => b[1] - a[1])[0]?.[0] ?? anrs[0]?.reason ?? "none";
  return {
    serial, app: app ?? null, crashes, anrs, anrTraces, exits, recentLog, heap: heapOut,
    summary: `${crashes.length} crashes, ${anrs.length} ANRs, top: ${top.slice(0, 160)}`,
  };
}

export const mcpTools: Tool[] = [{
  name: "triage", description: "Why did the app die? Crashes (logcat crash buffer), ANRs (ActivityManager log, exit-info, /data/anr traces), exit reasons, the app's last 200 log lines, optional heap dump.",
  input: { serial: z.string().describe("emulator-<port>"), app: z.string().optional().describe("package name, e.g. dev.crewdroid.probe"), heap: z.string().optional().describe("host path for an .hprof (needs app running)") },
  run: (a) => triage(a.serial, a.app, a.heap),
}];
