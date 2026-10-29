import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import type { Tool } from "./mcp.ts";

const sh = (serial: string, cmd: string, ms = 60000) => adb(serial, ["shell", cmd], ms);
const num = (text: string, re: RegExp) => { const m = text.match(re); return m ? Number(m[1]) : null; };

// `am start -W` -> ms (ThisTime is gone on newer images: null)
export const parseStart = (t: string) => ({ status: t.match(/Status: (\S+)/)?.[1] ?? "", launchState: t.match(/LaunchState: (\S+)/)?.[1] ?? null, thisTime: num(t, /ThisTime: (\d+)/), totalTime: num(t, /TotalTime: (\d+)/), waitTime: num(t, /WaitTime: (\d+)/) });
// `dumpsys gfxinfo <pkg> framestats` summary block
export const parseGfx = (t: string) => ({ frames: num(t, /Total frames rendered: (\d+)/) ?? 0, jankyFrames: num(t, /Janky frames: (\d+)/) ?? 0, jankPercent: num(t, /Janky frames: \d+ \(([\d.]+)%\)/) ?? 0, p50Ms: num(t, /^50th percentile: (\d+)ms/m), p90Ms: num(t, /^90th percentile: (\d+)ms/m), p99Ms: num(t, /^99th percentile: (\d+)ms/m) });
// `dumpsys meminfo <pkg>` App Summary, KB
export const parseMem = (t: string) => ({ pssTotalKB: num(t, /TOTAL PSS:\s+(\d+)/) ?? num(t, /^\s*TOTAL\s+(\d+)/m), javaHeapKB: num(t, /Java Heap:\s+(\d+)/), nativeHeapKB: num(t, /Native Heap:\s+(\d+)/) });

// Cold start (force-stop, 2 s, start: `am start -S` leaves API 31 black, ADR 0005), then frames and memory after `holdSec` of running. `extras` go to am start as-is
// (e.g. ["--es", "check", "jank"]). NOTE: ATD renders without GPU acceleration -> frame times are for relative comparison only.
export async function perf(serial: string, pkg: string, activity?: string, extras: string[] = [], holdSec = 3) {
  assertSerial(serial);
  if (!/^[\w.]+$/.test(pkg)) throw new Error(`bad package name '${pkg}'`);
  // adb shell joins these into one device shell line: no metacharacters (; | & > ` spaces ...)
  for (const x of [...(activity ? [activity] : []), ...extras]) if (!/^[A-Za-z0-9._$/:=-]+$/.test(x)) throw new Error(`bad --activity/extra '${x}' (allowed: A-Z a-z 0-9 . _ $ / : = -)`);
  let comp = activity ? `${pkg}/${activity}` : (await sh(serial, `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`)).split(/\r?\n/).at(-1)!.trim();
  if (!comp.includes("/")) throw new Error(`no launcher activity for ${pkg} on ${serial} (installed?): ${comp}`);
  await sh(serial, `am force-stop ${pkg}`);
  await new Promise((r) => setTimeout(r, 2000));
  const startOut = await adb(serial, ["shell", "am", "start", "-W", "-n", comp, ...extras], 120000);
  const start = parseStart(startOut);
  if (start.status !== "ok" || !start.totalTime) throw new Error(`am start ${comp} failed: ${startOut.slice(0, 300)}`);
  await new Promise((r) => setTimeout(r, holdSec * 1000));
  const gfx = parseGfx(await sh(serial, `dumpsys gfxinfo ${pkg} framestats`));
  const mem = parseMem(await sh(serial, `dumpsys meminfo ${pkg}`));
  return { serial, pkg, component: comp, start, frames: gfx, memory: mem, holdSeconds: holdSec };
}

export const mcpTools: Tool[] = [{
  name: "perf", description: "Cold start time (force-stop, 2 s, am start -W), frames/jank %/p50-p99 (gfxinfo) and PSS java/native (meminfo) of one app. ATD has no GPU: compare frame numbers relatively.",
  input: {
    serial: z.string().describe("emulator-<port>"), pkg: z.string(), activity: z.string().optional().describe("e.g. .MainActivity; default = launcher activity"),
    extras: z.array(z.string()).default([]).describe('am start extras, e.g. ["--es","check","jank"]'),
  },
  run: (a) => perf(a.serial, a.pkg, a.activity, a.extras),
}];
