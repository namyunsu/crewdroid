import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import type { Tool } from "./mcp.ts";
import { focusOf, screen, type UiNode } from "./screen.ts";

const sh = (serial: string, cmd: string, ms = 30000) => adb(serial, ["shell", cmd], ms);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`; // one device-shell word

// Display size in the current rotation: `cur=WxH` of dumpsys window displays (wm size ignores rotation); wm size as fallback.
export async function screenSize(serial: string): Promise<{ width: number; height: number }> {
  const out = await sh(serial, "dumpsys window displays | grep -m1 ' cur='; wm size");
  const m = out.match(/\bcur=(\d+)x(\d+)/) ?? out.match(/Override size: (\d+)x(\d+)/) ?? out.match(/Physical size: (\d+)x(\d+)/);
  if (!m) throw new Error(`cannot read the screen size of ${serial}: ${out.slice(0, 200)}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export function checkPoint(x: number, y: number, s: { width: number; height: number }) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= s.width || y >= s.height) throw new Error(`point (${x}, ${y}) is outside the screen ${s.width}x${s.height}`);
}

// --text matches text or content-desc, --id the resource-id (full `pkg:id/name` or just `name`); `any` = both (type --into).
// Exact matches win; only when there is none, case-insensitive contains.
export function findNodes(nodes: UiNode[], query: string, by: "text" | "id" | "any"): UiNode[] {
  const vals = (n: UiNode) => [...(by !== "text" ? [n.id, n.id.replace(/^.*:id\//, "")] : []), ...(by !== "id" ? [n.text, n.desc] : [])].filter(Boolean);
  const exact = nodes.filter((n) => vals(n).includes(query));
  if (exact.length) return exact;
  const lq = query.toLowerCase();
  return nodes.filter((n) => vals(n).some((v) => v.toLowerCase().includes(lq)));
}

const show = (n: UiNode) => `${JSON.stringify(n.text || n.desc)} id=${n.id || "-"} [${n.bounds}]`;

export function pickNode(nodes: UiNode[], all: UiNode[], what: string, index?: number): UiNode {
  if (index !== undefined) {
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length) throw new Error(`--index ${index} out of range: ${nodes.length} matches for ${what}${nodes.length ? `\n${nodes.map((n, i) => `  ${i}: ${show(n)}`).join("\n")}` : ""}`);
    return nodes[index];
  }
  if (nodes.length === 1) return nodes[0];
  const list = nodes.length ? nodes : all.filter((n) => n.text || n.desc || n.id).slice(0, 40);
  throw new Error(nodes.length
    ? `${nodes.length} matches for ${what}; pass --index N (0-based):\n${list.map((n, i) => `  ${i}: ${show(n)}`).join("\n")}`
    : `no match for ${what}; on screen:\n${list.map((n) => `  ${show(n)}`).join("\n")}`);
}

const centre = (n: UiNode) => ({ x: Math.round((n.bounds[0] + n.bounds[2]) / 2), y: Math.round((n.bounds[1] + n.bounds[3]) / 2) });

export type TapTarget = { x: number; y: number } | { text: string } | { id: string } | { any: string };

export async function tap(serial: string, t: TapTarget, index?: number) {
  assertSerial(serial);
  let p: { x: number; y: number }, node: UiNode | undefined;
  if ("x" in t) p = { x: t.x, y: t.y };
  else {
    const [by, query] = Object.entries(t)[0] as ["text" | "id" | "any", string];
    const all = (await screen(serial)).nodes;
    node = pickNode(findNodes(all, query, by), all, `${by === "any" ? "text|id" : by} '${query}'`, index);
    p = centre(node);
  }
  checkPoint(p.x, p.y, await screenSize(serial));
  await sh(serial, `input tap ${p.x} ${p.y}`);
  return { serial, ...p, node: node ? { text: node.text, desc: node.desc, id: node.id, bounds: node.bounds, cls: node.cls } : undefined };
}

// AI NOTE: `input text` only types characters the device key map has (ASCII); anything else throws a NullPointerException
// inside InputShellCommand. The other routes need what ATD lacks: there is no shell command that sets the clipboard
// (`cmd clipboard` has no implementation, IClipboard parcels differ per API), the emulator's gRPC clipboard needs a launch
// flag we may not add, and an IME that takes text from a broadcast is an app install. So non-ASCII exits 1 (T38).
export const NON_ASCII = "non-ASCII text cannot be typed: `input text` only types characters in the device key map (ASCII), ATD has no shell command to set the clipboard for a paste, and crewdroid does not install a keyboard app. Pass such text to your app another way (intent extra, test hook) or install an IME such as ADBKeyboard yourself.";

// `input text` turns "%s" into a space, so a "%" followed by "s" is sent in two calls
export const textChunks = (text: string) => text.split(/(?<=%)(?=s)/);

export async function type(serial: string, text: string, into?: string) {
  assertSerial(serial);
  if (!text) throw new Error("nothing to type");
  if (/[^\x20-\x7e]/.test(text)) throw new Error(/[^\x00-\x7f]/.test(text) ? NON_ASCII : "control characters (newline, tab) cannot be typed; use `key enter` / `key tab`");
  const field = into ? await tap(serial, { any: into }) : undefined;
  if (field) await sleep(500);
  for (const chunk of textChunks(text)) await sh(serial, `input text ${q(chunk)}`);
  return { serial, text, into: field?.node };
}

export const DIRECTIONS = ["up", "down", "left", "right"] as const;

// Direction = where the finger moves ("up" scrolls the content down, like a thumb flick), over the middle 50 % of the screen.
export function swipeLine(dir: (typeof DIRECTIONS)[number], s: { width: number; height: number }): [number, number, number, number] {
  const [cx, cy, lo, hi] = [Math.round(s.width / 2), Math.round(s.height / 2), (v: number) => Math.round(v * 0.25), (v: number) => Math.round(v * 0.75)];
  return dir === "up" ? [cx, hi(s.height), cx, lo(s.height)] : dir === "down" ? [cx, lo(s.height), cx, hi(s.height)]
    : dir === "left" ? [hi(s.width), cy, lo(s.width), cy] : [lo(s.width), cy, hi(s.width), cy];
}

export async function swipe(serial: string, o: { dir?: string; line?: number[]; ms?: number; times?: number }) {
  assertSerial(serial);
  const ms = o.ms ?? 300, times = o.times ?? 1;
  if (!Number.isInteger(ms) || ms < 1 || !Number.isInteger(times) || times < 1) throw new Error("ms and --times must be positive integers");
  if (!o.line && !DIRECTIONS.includes(o.dir as any)) throw new Error(`swipe direction must be ${DIRECTIONS.join("|")} or x1 y1 x2 y2 [ms], got '${o.dir}'`);
  const s = await screenSize(serial);
  const line = o.line ?? swipeLine(o.dir as (typeof DIRECTIONS)[number], s);
  if (line.length !== 4) throw new Error("swipe needs x1 y1 x2 y2");
  checkPoint(line[0], line[1], s); checkPoint(line[2], line[3], s);
  for (let i = 0; i < times; i++) {
    if (i) await sleep(400);
    await sh(serial, `input swipe ${line.join(" ")} ${ms}`);
  }
  return { serial, from: line.slice(0, 2), to: line.slice(2), ms, times };
}

const KEYS: Record<string, string> = { back: "KEYCODE_BACK", home: "KEYCODE_HOME", enter: "KEYCODE_ENTER", delete: "KEYCODE_DEL", tab: "KEYCODE_TAB", menu: "KEYCODE_MENU" };
export function keyCode(k: string): string {
  const code = KEYS[k.toLowerCase()] ?? (/^KEYCODE_[A-Z0-9_]+$/.test(k) ? k : "");
  if (!code) throw new Error(`unknown key '${k}' (${Object.keys(KEYS).join("|")}|KEYCODE_*)`);
  return code;
}

export async function key(serial: string, k: string) {
  assertSerial(serial);
  const code = keyCode(k);
  await sh(serial, `input keyevent ${code}`);
  await sleep(700);
  return { serial, key: code, focus: focusOf(await sh(serial, "dumpsys window | grep mCurrentFocus; true")) };
}

const serial = z.string().describe("emulator-<port>");
export const mcpTools: Tool[] = [
  {
    name: "tap", description: "Tap a point, or the centre of the element whose text/content-desc (text) or resource-id (id) matches (exact first, then case-insensitive contains). 0 or several matches (without index) fail and list the candidates.",
    input: { serial, x: z.number().int().optional(), y: z.number().int().optional(), text: z.string().optional(), id: z.string().optional().describe("resource-id, full or the part after :id/"), index: z.number().int().optional().describe("0-based, when several elements match") },
    run: (a) => tap(a.serial, a.text !== undefined ? { text: a.text } : a.id !== undefined ? { id: a.id } : a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : (() => { throw new Error("give x+y, text or id"); })(), a.index),
  },
  {
    name: "type", description: "Type ASCII text with `input text` (spaces, quotes, & and % are safe); into = text or resource-id of the field to tap first. Non-ASCII (e.g. Korean) fails with the reason: ATD offers no way to type it without installing a keyboard app.",
    input: { serial, text: z.string(), into: z.string().optional() },
    run: (a) => type(a.serial, a.text, a.into),
  },
  {
    name: "swipe", description: "Swipe up|down|left|right (finger direction, middle 50 % of the screen; up scrolls content down) `times` times, or a line x1,y1 -> x2,y2 in ms.",
    input: { serial, direction: z.enum(DIRECTIONS).optional(), times: z.number().int().min(1).default(1), line: z.array(z.number().int()).length(4).optional().describe("[x1,y1,x2,y2]"), ms: z.number().int().min(1).default(300) },
    run: (a) => swipe(a.serial, { dir: a.direction, line: a.line, ms: a.ms, times: a.times }),
  },
  {
    name: "key", description: "Press a key: back|home|enter|delete|tab|menu or any KEYCODE_*. Returns the focused window afterwards.",
    input: { serial, key: z.string() },
    run: (a) => key(a.serial, a.key),
  },
];
