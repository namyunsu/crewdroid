import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import type { Tool } from "./mcp.ts";
import { relaunchBlackApis } from "./profiles.ts";
import { adbPath } from "./sdk.ts";

const run = promisify(execFile);

export interface UiNode { cls: string; text: string; desc: string; id: string; bounds: [number, number, number, number]; clickable: boolean; depth: number }

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

// `uiautomator dump` XML -> flat list in document order with nesting depth. Compact: layout-only nodes (no text, desc, id and
// not clickable) are dropped, their children keep their real depth.
export function parseUiDump(xml: string): UiNode[] {
  const out: UiNode[] = [];
  let depth = -1;
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0] === "</node>") { depth--; continue; }
    depth++;
    const a: Record<string, string> = {};
    for (const x of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[x[1]] = unxml(x[2]);
    const b = (a.bounds?.match(/-?\d+/g) ?? [0, 0, 0, 0]).map(Number) as UiNode["bounds"];
    const n = { cls: a.class ?? "", text: a.text ?? "", desc: a["content-desc"] ?? "", id: a["resource-id"] ?? "", bounds: b, clickable: a.clickable === "true", depth };
    if (n.text || n.desc || n.id || n.clickable) out.push(n);
    if (m[2] === "/") depth--;
  }
  return out;
}

// Raw `screencap` (no -p): header (12 bytes, 16 from API 28 with colour space) + RGBA. True when every sampled pixel is black.
export function isBlackRaw(raw: Buffer): boolean {
  const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
  const head = raw.length - w * h * 4;
  if (!w || !h || (head !== 12 && head !== 16)) throw new Error(`unexpected screencap size ${raw.length} for ${w}x${h}`);
  for (let i = 0; i < w * h; i += 97) { // ~1 % of pixels; a drawn app screen differs from black almost everywhere
    const p = head + i * 4;
    if (raw[p] | raw[p + 1] | raw[p + 2]) return false;
  }
  return true;
}

async function blackScreen(serial: string): Promise<boolean> {
  const { stdout } = await run(adbPath(), ["-s", assertSerial(serial), "exec-out", "screencap"], { encoding: "buffer", maxBuffer: 2 ** 28, timeout: 60000, windowsHide: true });
  return isBlackRaw(stdout);
}

export const focusOf =(win: string) => win.match(/mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/)?.[1] ?? (win.match(/mCurrentFocus=(\S+)/)?.[1] ?? "");

// ADR 0005: on Android 12 (API 31) an app killed and started again at once (`am start -S`, Maestro/mobile-mcp relaunch, a
// test harness) can stay black although it keeps drawing (WindowManager shows the task, SurfaceFlinger never does).
// HOME + starting the same activity again without -S brings the task back on screen. Only on relaunchBlack APIs, only when
// the whole screen is black, at most twice. Returns what it saw so the caller never mistakes this for an app bug.
// ponytail: an app whose real screen is pure black on API 31 also gets HOME + resume once; harmless, reported as recovered=false.
export async function unblack(serial: string): Promise<{ black: boolean; recovered: boolean; tries: number }> {
  const api = Number(await adb(serial, ["shell", "getprop", "ro.build.version.sdk"]));
  if (!relaunchBlackApis().includes(api) || !(await blackScreen(serial))) return { black: false, recovered: false, tries: 0 };
  const comp = focusOf(await adb(serial, ["shell", "dumpsys window | grep mCurrentFocus; true"]));
  if (!comp.includes("/")) return { black: true, recovered: false, tries: 0 };
  for (let i = 1; i <= 2; i++) {
    await adb(serial, ["shell", "input", "keyevent", "KEYCODE_HOME"]);
    await new Promise((r) => setTimeout(r, 1000));
    await adb(serial, ["shell", "am", "start", "-W", "-n", comp], 60000);
    await new Promise((r) => setTimeout(r, 1500));
    if (!(await blackScreen(serial))) return { black: true, recovered: true, tries: i };
  }
  return { black: true, recovered: false, tries: 2 };
}

export async function screen(serial: string, png?: string) {
  assertSerial(serial);
  const blackRelaunch = await unblack(serial);
  const focus = focusOf(await adb(serial, ["shell", "dumpsys window | grep mCurrentFocus; true"]));
  const remote = "/data/local/tmp/crewdroid-ui.xml";
  const dump = await adb(serial, ["shell", `uiautomator dump ${remote} >/dev/null && cat ${remote}`], 60000);
  if (!dump.includes("<hierarchy")) throw new Error(`uiautomator dump failed on ${serial}: ${dump.slice(0, 300)}`);
  let pngOut: string | undefined;
  if (png) {
    await adb(serial, ["shell", "screencap -p /data/local/tmp/crewdroid-screen.png"]);
    await adb(serial, ["pull", "/data/local/tmp/crewdroid-screen.png", resolve(png)], 60000);
    pngOut = resolve(png);
  }
  return {
    serial, focus, nodes: parseUiDump(dump), png: pngOut, blackRelaunch,
    note: "Compose: Modifier.testTag shows as id only under Modifier.semantics { testTagsAsResourceId = true }; otherwise only text/desc. blackRelaunch: API 31 emulator black-after-relaunch was detected/recovered (ADR 0005), not an app bug",
  };
}

export const mcpTools: Tool[] = [{
  name: "screen", description: "Use to READ the screen before tap/type (tree, not pixels): focused window and a compact accessibility tree from uiautomator, nodes {cls,text,desc,id,bounds,clickable,depth}; optional PNG path. For how it looks, use shot. On API 31 a fully black screen after an app relaunch (emulator bug, ADR 0005) is recovered first and reported in blackRelaunch (not an app bug).",
  input: { serial: z.string().describe("emulator-<port>"), png: z.string().optional().describe("host path for a screenshot") },
  run: (a) => screen(a.serial, a.png),
}];
