import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import { call, HelperError, orFallback } from "./helper.ts";
import type { Tool } from "./mcp.ts";
import { compact, focusOf, focusWin, lastScreen, look, remember, screen, type Look, type UiNode } from "./screen.ts";

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

// n = the [n] line of the last screen outline on this serial (screen or an action's returned screen)
export type TapTarget = { x: number; y: number } | { text: string } | { id: string } | { any: string } | { n: number };

type Size = { width: number; height: number };
// the screen after an action, read by the helper in the same request (settle:true; Runner.kt settled())
export type After = { tree?: Size & { nodes: UiNode[] } };
const settleArg = (settle: boolean) => (settle ? { settle: true } : {});

// keepFocused (type --into): a matched editable field that already has input focus is not tapped again
export async function tap(serial: string, t: TapTarget, index?: number, settle = false, keepFocused = false): Promise<{ serial: string; x: number; y: number; via: "helper" | "fallback"; node?: Pick<UiNode, "text" | "desc" | "id" | "bounds" | "cls">; item?: string } & After> {
  assertSerial(serial);
  if ("n" in t) {
    // the outline's centre is reused only while the same window has focus (a sheet or dialog is another window)
    const last = lastScreen(serial), win = await focusWin(serial);
    if (!last) throw new Error(`no earlier screen on ${serial}: run screen first, then tap [n]`);
    if (last.win !== win) throw new Error(`[${t.n}] is from another window (a dialog, sheet or activity changed since; focus now ${focusOf(`mCurrentFocus=${win}`) || "none"}); run screen again`);
    const it = last.items[t.n];
    if (!Number.isInteger(t.n) || !it) throw new Error(`[${t.n}] is not in the last screen (${last.items.length} lines, [0]..[${last.items.length - 1}])`);
    return { ...(await tap(serial, { x: it.x, y: it.y }, undefined, settle)), item: it.label };
  }
  const aim = (all: UiNode[] = []): { p: { x: number; y: number }; node?: UiNode } => {
    if ("x" in t) return { p: { x: t.x, y: t.y } };
    const [by, query] = Object.entries(t)[0] as ["text" | "id" | "any", string];
    const node = pickNode(findNodes(all, query, by), all, `${by === "any" ? "text|id" : by} '${query}'`, index);
    return { p: centre(node), node };
  };
  const { p, node, via, after } = await orFallback<ReturnType<typeof aim> & { after?: After["tree"] }>(serial, async () => {
    // ponytail: idle=0 reads the tree at once (no 100 ms quiet wait): right for a screen the last action settled; a tap
    // straight after `swipe --no-screen` could aim at a list still moving
    let tree = await call<{ nodes?: UiNode[] } & Size>(serial, "GET", "x" in t ? "/size" : "/tree?idle=0");
    if (!tree) return undefined;
    let a: ReturnType<typeof aim>;
    // no match in the instant read (a window still coming up: an empty tree) -> once more after the 100 ms quiet wait
    try { a = aim(tree.nodes); } catch (e) { const again = await call<{ nodes?: UiNode[] } & Size>(serial, "GET", "/tree"); if (!again) throw e; tree = again; a = aim(tree.nodes); }
    checkPoint(a.p.x, a.p.y, tree);
    if (keepFocused && a.node?.focused && a.node.editable) return a;
    const done = await call(serial, "POST", "/tap", { ...a.p, ...settleArg(settle) });
    return done ? { ...a, after: done.tree } : undefined;
  }, async () => {
    const a = aim("x" in t ? undefined : (await screen(serial)).nodes);
    checkPoint(a.p.x, a.p.y, await screenSize(serial));
    await sh(serial, `input tap ${a.p.x} ${a.p.y}`);
    return a;
  });
  return { serial, ...p, via, node: node ? { text: node.text, desc: node.desc, id: node.id, bounds: node.bounds, cls: node.cls } : undefined, ...(after ? { tree: after } : {}) };
}

// AI NOTE: `input text` only types characters the device key map has (ASCII); anything else throws a NullPointerException
// inside InputShellCommand. The other routes need what ATD lacks: there is no shell command that sets the clipboard
// (`cmd clipboard` has no implementation, IClipboard parcels differ per API), the emulator's gRPC clipboard needs a launch
// flag we may not add, and an IME that takes text from a broadcast is an app install. So without the on-device helper
// (ACTION_SET_TEXT, T52) non-ASCII exits 1 (T38).
export const NON_ASCII = "non-ASCII text cannot be typed without the on-device helper (not answering on this device): `input text` only types characters in the device key map (ASCII), ATD has no shell command to set the clipboard for a paste, and crewdroid does not install a keyboard app. Pass such text to your app another way (intent extra, test hook) or install an IME such as ADBKeyboard yourself.";

// `input text` turns "%s" into a space, so a "%" followed by "s" is sent in two calls
export const textChunks = (text: string) => text.split(/(?<=%)(?=s)/);

export async function type(serial: string, text: string, into?: string, settle = false) {
  assertSerial(serial);
  if (!text) throw new Error("nothing to type");
  if (/[\x00-\x1f\x7f]/.test(text)) throw new Error("control characters (newline, tab) cannot be typed; use `key enter` / `key tab`");
  const field = into ? await tap(serial, { any: into }, undefined, false, true) : undefined;
  // the helper waits on the device until input focus reached the tapped field (waitMs); `input text` needs the pause here
  if (field?.via === "fallback") await sleep(500);
  const keys = async () => {
    if (/[^\x20-\x7e]/.test(text)) throw new Error(NON_ASCII);
    for (const chunk of textChunks(text)) await sh(serial, `input text ${q(chunk)}`);
    return {};
  };
  let via: "helper" | "fallback", after: After["tree"];
  try {
    const r = await orFallback<{ tree?: After["tree"] }>(serial, () => call(serial, "POST", "/text", { text, ...(field ? { waitMs: 1000, at: field.node?.bounds } : {}), ...settleArg(settle) }), keys);
    [via, after] = [r.via, r.tree];
  } catch (e) {
    // 409: no field with input focus in the accessibility tree (e.g. inside a WebView); `input text` types into whatever has it
    if (!(e instanceof HelperError && e.status === 409) || /[^\x20-\x7e]/.test(text)) throw e;
    await keys();
    via = "fallback";
  }
  return { serial, text, into: field?.node, via, ...(after ? { tree: after } : {}) };
}

export const DIRECTIONS = ["up", "down", "left", "right"] as const;

// Direction = where the finger moves ("up" scrolls the content down, like a thumb flick), over the middle 50 % of the screen.
export function swipeLine(dir: (typeof DIRECTIONS)[number], s: { width: number; height: number }): [number, number, number, number] {
  const [cx, cy, lo, hi] = [Math.round(s.width / 2), Math.round(s.height / 2), (v: number) => Math.round(v * 0.25), (v: number) => Math.round(v * 0.75)];
  return dir === "up" ? [cx, hi(s.height), cx, lo(s.height)] : dir === "down" ? [cx, lo(s.height), cx, hi(s.height)]
    : dir === "left" ? [hi(s.width), cy, lo(s.width), cy] : [lo(s.width), cy, hi(s.width), cy];
}

export async function swipe(serial: string, o: { dir?: string; line?: number[]; ms?: number; times?: number }, settle = false) {
  assertSerial(serial);
  const ms = o.ms ?? 300, times = o.times ?? 1;
  if (!Number.isInteger(ms) || ms < 1 || !Number.isInteger(times) || times < 1) throw new Error("ms and --times must be positive integers");
  if (!o.line && !DIRECTIONS.includes(o.dir as any)) throw new Error(`swipe direction must be ${DIRECTIONS.join("|")} or x1 y1 x2 y2 [ms], got '${o.dir}'`);
  if (o.line && o.line.length !== 4) throw new Error("swipe needs x1 y1 x2 y2");
  const lineFor = (s: Size) => {
    const line = o.line ?? swipeLine(o.dir as (typeof DIRECTIONS)[number], s);
    checkPoint(line[0], line[1], s); checkPoint(line[2], line[3], s);
    return line;
  };
  const { line, via, after } = await orFallback<{ line: number[]; after?: After["tree"] }>(serial, async () => {
    const s = await call<Size>(serial, "GET", "/size");
    if (!s) return undefined;
    const line = lineFor(s);
    let r: any;
    for (let i = 0; i < times; i++) {
      if (i) await sleep(400);
      // ponytail: a helper that dies between swipes makes the fallback redo the whole series; rare, so not handled
      if (!(r = await call(serial, "POST", "/swipe", { x1: line[0], y1: line[1], x2: line[2], y2: line[3], ms, ...settleArg(settle && i === times - 1) }, 15000 + ms))) return undefined;
    }
    return { line, after: r.tree };
  }, async () => {
    const line = lineFor(await screenSize(serial));
    for (let i = 0; i < times; i++) {
      if (i) await sleep(400);
      await sh(serial, `input swipe ${line.join(" ")} ${ms}`);
    }
    return { line };
  });
  return { serial, from: line.slice(0, 2), to: line.slice(2), ms, times, via, ...(after ? { tree: after } : {}) };
}

const KEYS: Record<string, string> = { back: "KEYCODE_BACK", home: "KEYCODE_HOME", enter: "KEYCODE_ENTER", delete: "KEYCODE_DEL", tab: "KEYCODE_TAB", menu: "KEYCODE_MENU" };
export function keyCode(k: string): string {
  const code = KEYS[k.toLowerCase()] ?? (/^KEYCODE_[A-Z0-9_]+$/.test(k) ? k : "");
  if (!code) throw new Error(`unknown key '${k}' (${Object.keys(KEYS).join("|")}|KEYCODE_*)`);
  return code;
}

export async function key(serial: string, k: string, settle = false) {
  assertSerial(serial);
  const code = keyCode(k);
  const { via, tree } = await orFallback<{ tree?: After["tree"] }>(serial, () => call(serial, "POST", "/key", { code, ...settleArg(settle) }), async () => { await sh(serial, `input keyevent ${code}`); return {}; });
  if (!tree) await sleep(700); // the settled tree already waited for the key's effect
  return { serial, key: code, via, focus: focusOf(`mCurrentFocus=${await focusWin(serial)}`), ...(tree ? { tree } : {}) };
}

// ---- the screen after an action (T53) ----
// Tree read until it is unchanged for 150 ms, 1 s at most (a uiautomator dump alone takes longer: then the first read counts).
// AI NOTE: a tap that opens a dialog / bottom sheet first reads an empty tree for ~0.5 s (old window gone, new one not
// attached yet; Field Notes "New note"); empty reads do not start the 1 s and never count as settled (3 s cap, then returned).
export async function settled(serial: string): Promise<Look> {
  const t0 = Date.now();
  let a = await look(serial), at = Date.now(), ta = compact(a).text, since = a.nodes.length || a.busy ? t0 : 0;
  while (since ? Date.now() - since < 1000 : Date.now() - t0 < 3000) {
    await sleep(Math.max(0, 150 - (Date.now() - at)));
    const b = await look(serial), tb = compact(b).text;
    if (tb === ta && (b.nodes.length || b.busy)) return b;
    if (!since && (b.nodes.length || b.busy)) since = Date.now();
    [a, at, ta] = [b, Date.now(), tb];
  }
  return a;
}

// Runs the action (asked to settle and return the tree when the screen is wanted), then returns its result with the new
// outline as `screen` (unless noScreen); its [n] work for tap. Without the helper's tree, settled() polls from the host.
export async function withScreen<T extends After>(serial: string, act: (settle: boolean) => Promise<T>, noScreen = false): Promise<Omit<T, "tree"> & { screen?: string }> {
  const { tree, ...r } = await act(!noScreen);
  if (noScreen) return r;
  const l: Look = tree ? await focusWin(serial).then((win) => ({ win, focus: focusOf(`mCurrentFocus=${win}`), size: { width: tree.width, height: tree.height }, nodes: tree.nodes, via: "helper" as const })) : await settled(serial);
  const c = compact(l);
  remember(serial, l.win, c.items);
  return { ...r, screen: c.text };
}

// one line per action, for the CLI and MCP text output
export const actionLine = (cmd: string, r: any): string =>
  cmd === "tap" ? `tapped ${r.x},${r.y}${r.item ? ` ${JSON.stringify(r.item)}` : r.node ? ` ${JSON.stringify(r.node.text || r.node.desc || r.node.id)}` : ""}`
  : cmd === "type" ? `typed ${JSON.stringify(r.text)}${r.into ? ` into ${r.into.id || r.into.text}` : ""}`
  : cmd === "swipe" ? `swiped ${r.from} -> ${r.to} ${r.ms}ms x${r.times}`
  : `${r.key} -> focus ${r.focus}`;
const asText = (cmd: string, a: any) => (r: any) => (a.format === "json" ? r : [actionLine(cmd, r), ...(r.screen ? [r.screen] : [])].join("\n"));

const serial = z.string().describe("emulator-<port>");
const after = { screen: z.boolean().default(true).describe("false = do not return the new screen"), format: z.enum(["text", "json"]).default("text") };
export const mcpTools: Tool[] = [
  {
    name: "tap", description: "Use to press a button or field: by text/content-desc (text), resource-id (id), a point x,y, or index alone = the [n] line of the last screen outline (no new tree read while that window still has focus). Element match = exact first, then case-insensitive contains. 0 or several matches (text/id without index) fail and list the candidates; retry with index (0-based among the matches) or id. Returns the tapped point and the new screen outline once it settled (screen:false to skip), so no separate screen call is needed.",
    input: { serial, x: z.number().int().optional(), y: z.number().int().optional(), text: z.string().optional(), id: z.string().optional().describe("resource-id, full or the part after :id/"), index: z.number().int().optional().describe("alone: [n] of the last screen; with text/id: 0-based among the matches"), ...after },
    run: (a) => withScreen(a.serial, (s) => tap(a.serial, a.text !== undefined ? { text: a.text } : a.id !== undefined ? { id: a.id } : a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : a.index !== undefined ? { n: a.index } : (() => { throw new Error("give x+y, text, id or index"); })(), a.text !== undefined || a.id !== undefined ? a.index : undefined, s), !a.screen).then(asText("tap", a)),
  },
  {
    name: "type", description: "Use to fill a text field: appends any text (Korean, emoji included) to the focused field through the on-device helper; into = text or resource-id of the field to tap first. Returns the field typed into and the new screen outline (screen:false to skip). Without the helper it falls back to `input text`, where non-ASCII fails with the reason.",
    input: { serial, text: z.string(), into: z.string().optional(), ...after },
    run: (a) => withScreen(a.serial, (s) => type(a.serial, a.text, a.into, s), !a.screen).then(asText("type", a)),
  },
  {
    name: "swipe", description: "Use to scroll or page: swipe up|down|left|right (finger direction, middle 50 % of the screen; up scrolls content down) `times` times, or a line x1,y1 -> x2,y2 in ms. Returns the from/to points and the new screen outline (screen:false to skip).",
    input: { serial, direction: z.enum(DIRECTIONS).optional(), times: z.number().int().min(1).default(1), line: z.array(z.number().int()).length(4).optional().describe("[x1,y1,x2,y2]"), ms: z.number().int().min(1).default(300), ...after },
    run: (a) => withScreen(a.serial, (s) => swipe(a.serial, { dir: a.direction, line: a.line, ms: a.ms, times: a.times }, s), !a.screen).then(asText("swipe", a)),
  },
  {
    name: "key", description: "Use for navigation and hardware keys: back|home|enter|delete|tab|menu or any KEYCODE_*. Returns the focused window and the new screen outline (screen:false to skip).",
    input: { serial, key: z.string(), ...after },
    run: (a) => withScreen(a.serial, (s) => key(a.serial, a.key, s), !a.screen).then(asText("key", a)),
  },
];
