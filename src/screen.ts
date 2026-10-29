import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import { call, helperMiss, orFallback } from "./helper.ts";
import type { Tool } from "./mcp.ts";
import { relaunchBlackApis } from "./profiles.ts";
import { adbPath } from "./sdk.ts";

const run = promisify(execFile);

// cls = class short name; editable/scrollable/focused/disabled only when true, checked only when checkable
export interface UiNode { cls: string; text: string; desc: string; id: string; bounds: [number, number, number, number]; clickable: boolean; depth: number; editable?: boolean; scrollable?: boolean; checked?: boolean; focused?: boolean; disabled?: boolean }

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
    const n: UiNode = { cls: (a.class ?? "").split(".").at(-1)!, text: a.text ?? "", desc: a["content-desc"] ?? "", id: a["resource-id"] ?? "", bounds: b, clickable: a.clickable === "true", depth };
    if (a.scrollable === "true") n.scrollable = true;
    if (a.checkable === "true") n.checked = a.checked === "true";
    if (a.focused === "true") n.focused = true;
    if (a.enabled === "false") n.disabled = true;
    if (n.text || n.desc || n.id || n.clickable || n.scrollable) out.push(n);
    if (m[2] === "/") depth--;
  }
  return out;
}

// `screencap -p` PNG (8-bit RGB or RGBA, not interlaced) -> true when every pixel's RGB is 0. Checked on the filtered scanlines:
// every PNG filter predicts a byte from earlier pixels, so when those are black a filtered RGB byte is 0 exactly when the pixel is.
export function isBlackPng(png: Buffer): boolean {
  let width = 0, bpp = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= png.length;) {
    const len = png.readUInt32BE(at), type = png.toString("latin1", at + 4, at + 8), data = png.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); bpp = data[8] === 8 && data[12] === 0 ? ({ 2: 3, 6: 4 } as Record<number, number>)[data[9]] ?? 0 : 0; }
    else if (type === "IDAT") idat.push(data);
    at += 12 + len;
  }
  if (!width || !bpp || !idat.length) throw new Error("not an 8-bit RGB/RGBA screencap PNG");
  const rows = inflateSync(Buffer.concat(idat)), stride = 1 + width * bpp;
  for (let i = 0; i < rows.length; i++) { const k = i % stride; if (k && (k - 1) % bpp < 3 && rows[i]) return false; }
  return true;
}

// NOTE (T66): this used the raw frame (`exec-out screencap`, 10 MB at 1080x2340). Pulled while Maestro starts, it took the
// emulator's adb transport offline ("device offline" / "not found"; Maestro: "device not connected"): 6 of 6 Maestro flows
// failed with raw frames pulled in a loop (stress run, T66). The PNG is ~20x smaller. Advisory check: a frame
// that cannot be read means "not black" (no recovery), never a failed command.
async function blackScreen(serial: string): Promise<boolean> {
  try {
    const { stdout } = await run(adbPath(), ["-s", assertSerial(serial), "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 2 ** 28, timeout: 60000, windowsHide: true });
    return isBlackPng(stdout);
  } catch (e: any) {
    console.error(`black-screen check skipped on ${serial}: ${String(e.message).split("\n")[0]}`);
    return false;
  }
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
  // NOTE (T66): the ATD home screen is black by design. Taking it for the bug pressed HOME and restarted the home activity
  // twice in the middle of a Maestro flow that was launching its app (the app's upload then never arrived).
  const home = await adb(serial, ["shell", "cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME | tail -n 1"]);
  if (home.trim().split("/")[0] === comp.split("/")[0]) return { black: false, recovered: false, tries: 0 };
  for (let i = 1; i <= 2; i++) {
    await adb(serial, ["shell", "input", "keyevent", "KEYCODE_HOME"]);
    await new Promise((r) => setTimeout(r, 1000));
    await adb(serial, ["shell", "am", "start", "-W", "-n", comp], 60000);
    await new Promise((r) => setTimeout(r, 1500));
    if (!(await blackScreen(serial))) return { black: true, recovered: true, tries: i };
  }
  return { black: true, recovered: false, tries: 2 };
}

async function dumpNodes(serial: string): Promise<UiNode[]> {
  const remote = "/data/local/tmp/crewdroid-ui.xml";
  // NOTE (T66): a dump that loses UiAutomation to another client logs "already registered" to logcat only (its stdout
  // says nothing), so on failure that line is fetched from this dump's time on, for screen() to report `busy`.
  const dump = await adb(serial, ["shell", `t=$(date +%s); uiautomator dump ${remote} >/dev/null && cat ${remote} || logcat -d -v epoch -s AndroidRuntime:E | awk -v t=$t '$1 >= t' | grep -m1 'already registered'`], 60000);
  if (!dump.includes("<hierarchy")) throw new Error(`uiautomator dump failed on ${serial}: ${dump.slice(0, 300)}`);
  return parseUiDump(dump);
}

export type Size = { width: number; height: number };
export interface Look { win: string; focus: string; size?: Size; nodes: UiNode[]; via: "helper" | "fallback"; fallbackReason?: string; busy?: string }

// the whole mCurrentFocus value (see look)
export const focusWin = (serial: string) => adb(serial, ["shell", "dumpsys window | grep mCurrentFocus; true"]).then((w) => w.match(/mCurrentFocus=(.*)/)?.[1]?.trim() ?? "");

// Focused window + tree, no black-screen check and no PNG (what an action reads after it ran). win = the whole mCurrentFocus
// value: a dialog or bottom sheet has the activity's name but its own window hash, so it tells "same window" for `tap [n]`.
export async function look(serial: string): Promise<Look> {
  assertSerial(serial);
  const [win, { nodes, width, height, via, fallbackReason, busy }] = await Promise.all([
    focusWin(serial),
    orFallback<{ nodes: UiNode[]; busy?: string } & Partial<Size>>(serial, () => call(serial, "GET", "/tree"), async () => {
      // NOTE (T66): a Maestro flow holds UiAutomation for its whole run and `uiautomator dump` needs it too; there is no
      // tree without it, so say so instead of failing (focus and png still work) and leave the other tool alone.
      const held = (why?: string) => ({ nodes: [], busy: `no tree now: another automation client (a Maestro flow, uiautomator dump, mobile-mcp) holds UiAutomation; focus and png still work, retry when it is done (${why})` });
      if (helperMiss(serial)?.startsWith("busy")) return held(helperMiss(serial));
      const size = adb(serial, ["shell", "dumpsys window displays | grep -m1 ' cur='; true"]).then((o) => o.match(/\bcur=(\d+)x(\d+)/), () => null);
      try {
        const nodes = await dumpNodes(serial), m = await size;
        return { nodes, ...(m ? { width: Number(m[1]), height: Number(m[2]) } : {}) };
      } catch (e: any) { if (/already registered|UiAutomationService/.test(e.message)) return held("uiautomator dump: UiAutomation already registered"); throw e; }
    }),
  ]);
  return { win, focus: focusOf(`mCurrentFocus=${win}`), ...(width && height ? { size: { width, height } } : {}), nodes, via, ...(fallbackReason ? { fallbackReason } : {}), ...(busy ? { busy } : {}) };
}

export async function screen(serial: string, png?: string) {
  assertSerial(serial);
  const blackRelaunch = await unblack(serial);
  const { win, ...l } = await look(serial);
  let pngOut: string | undefined;
  if (png) {
    await adb(serial, ["shell", "screencap -p /data/local/tmp/crewdroid-screen.png"]);
    await adb(serial, ["pull", "/data/local/tmp/crewdroid-screen.png", resolve(png)], 60000);
    pngOut = resolve(png);
  }
  remember(serial, win, compact(l).items);
  return {
    serial, ...l, png: pngOut, blackRelaunch,
    note: "via: helper = on-device agent helper, fallback = uiautomator dump (fallbackReason says why); busy = no tree because another automation client (e.g. a running Maestro flow) holds UiAutomation, nodes is empty. Compose: Modifier.testTag shows as id only under Modifier.semantics { testTagsAsResourceId = true }; otherwise only text/desc. blackRelaunch: API 31 emulator black-after-relaunch was detected/recovered (ADR 0005), not an app bug",
  };
}

// ---- compact outline (T53): what a model reads instead of the JSON tree ----
export type Item = { x: number; y: number; label: string };
const ROLES: [string, (n: UiNode) => boolean][] = [
  ["edit", (n) => !!n.editable || /EditText/.test(n.cls)],
  ["check", (n) => n.checked !== undefined || /CheckBox|Switch|RadioButton|ToggleButton/.test(n.cls)],
  ["list", (n) => !!n.scrollable || /RecyclerView|ListView|GridView|ScrollView|ViewPager/.test(n.cls)],
  ["btn", (n) => n.clickable],
  ["img", (n) => /Image/.test(n.cls)],
];
const roleOf = (n: UiNode) => ROLES.find(([, is]) => is(n))?.[0] ?? "text";
// R8 / ProGuard renames resource ids to one or two characters (`a`, `b0`): such an id says nothing, so it is left out
export const shortId = (id: string) => { const s = id.replace(/^.*:id\//, ""); return /^[A-Za-z_$][\w$]?$|^\d+$/.test(s) ? "" : s; };
const cut = (t: string) => { const one = t.replace(/\s+/g, " ").trim(); return one.length > 60 ? `${one.slice(0, 59)}…` : one; };

// One line per visible meaningful node: `[n] role "text" #id @x,y flags`, indented by nesting. A clickable or checkable node
// absorbs the texts of its non-interactive descendants (a card = one line). Nodes outside the screen are only counted.
export function compact(l: Pick<Look, "focus" | "size" | "nodes" | "busy">, o: { bounds?: boolean } = {}): { text: string; items: Item[] } {
  const W = l.size?.width ?? Infinity, H = l.size?.height ?? Infinity;
  type Row = { n: UiNode; role: string; texts: string[]; indent: number };
  const rows: Row[] = [];
  const open: { depth: number; bounds: UiNode["bounds"]; row?: Row; off?: boolean }[] = []; // ancestors of the current node; emitted ones carry their row
  let above = 0, below = 0;
  const inside = (a: UiNode["bounds"], b: UiNode["bounds"]) => a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
  for (const n of l.nodes) {
    // layout-only nodes are not in the list, so a deeper next node may be a sibling's child: an ancestor must also contain it
    while (open.length && (open.at(-1)!.depth >= n.depth || !inside(open.at(-1)!.bounds, n.bounds))) open.pop();
    if (open.some((s) => s.off)) continue; // inside an off-screen node: counted with it
    const [x1, y1, x2, y2] = n.bounds;
    const role = roleOf(n), interactive = role !== "text" && role !== "img";
    const own = [n.text, n.desc].map(cut).filter((t, i, a) => t && a.indexOf(t) === i);
    const keep = x2 > x1 && y2 > y1 && (own.length > 0 || interactive); // zero-sized or id-only layout nodes are not shown
    const off = keep && (y1 >= H || x1 >= W ? (below++, true) : y2 <= 0 || x2 <= 0 ? (above++, true) : false);
    if (off) { open.push({ depth: n.depth, bounds: n.bounds, off }); continue; }
    if (keep) {
      const owner = open.findLast((s) => s.row)?.row;
      if (!interactive && owner && (owner.role === "btn" || owner.role === "check")) { for (const t of own) if (!owner.texts.includes(t)) owner.texts.push(t); }
      else {
        const row = { n, role, texts: own, indent: open.filter((s) => s.row).length };
        rows.push(row);
        open.push({ depth: n.depth, bounds: n.bounds, row });
        continue;
      }
    }
    open.push({ depth: n.depth, bounds: n.bounds });
  }
  const items: Item[] = [];
  const lines = rows.map(({ n, role, texts, indent }, i) => {
    const x = Math.round((n.bounds[0] + n.bounds[2]) / 2), y = Math.round((n.bounds[1] + n.bounds[3]) / 2), id = shortId(n.id);
    items.push({ x, y, label: texts[0] ?? (id ? `#${id}` : role) });
    const flags = [n.focused && "focused", n.checked && "checked", n.disabled && "disabled"].filter(Boolean);
    return `${"  ".repeat(indent)}[${i}] ${role}${texts.map((t) => ` ${JSON.stringify(t)}`).join("")}${id ? ` #${id}` : ""} @${x},${y}${o.bounds ? ` [${n.bounds}]` : ""}${flags.map((f) => ` ${f}`).join("")}`;
  });
  if (above) lines.unshift(`… ${above} more above (swipe down)`);
  if (below) lines.push(`… ${below} more below (swipe up)`);
  const head = `${l.focus || "no focused window"}${l.size ? ` ${l.size.width}x${l.size.height}` : ""}`;
  return { text: [head, ...(l.busy ? [l.busy] : []), ...lines].join("\n"), items };
}

// The last outline per serial (CLI calls are separate processes), so `tap [n]` needs no new tree while the window is the same.
const lastFile = (serial: string) => join(tmpdir(), `crewdroid-screen-${serial}.json`);
export const remember = (serial: string, win: string, items: Item[]) => writeFileSync(lastFile(serial), JSON.stringify({ win, items }));
export const lastScreen = (serial: string): { win: string; items: Item[] } | undefined => { try { return JSON.parse(readFileSync(lastFile(serial), "utf8")); } catch { return undefined; } };

// screen() result -> the default text: black-screen recovery line, the outline, the PNG path
export const screenText = (r: Awaited<ReturnType<typeof screen>>, o: { bounds?: boolean } = {}) =>
  [...(r.blackRelaunch.black ? [`blackRelaunch: API 31 black screen after relaunch, ${r.blackRelaunch.recovered ? "recovered" : "NOT recovered"} (ADR 0005)`] : []), compact(r, o).text, ...(r.png ? [`png: ${r.png}`] : [])].join("\n");

export const mcpTools: Tool[] = [{
  name: "screen", description: "Use to READ the screen before tap/type (tree, not pixels). Default: a short outline, first line = focused window and size, then one line per visible element `[n] role \"text\" #id @x,y flags` (role btn/edit/text/img/list/check; a card's texts sit on its one line; `… N more below (swipe up)` = off-screen). tap {index:n} alone taps [n] of this outline. format:\"json\" = full tree {focus, nodes[{cls,text,desc,id,bounds,clickable,depth,...}], via}. While a Maestro flow runs the tree is empty and a line says why. For how it looks, use shot. On API 31 a black screen after a relaunch (emulator bug, ADR 0005) is recovered first and reported (blackRelaunch), not an app bug.",
  input: { serial: z.string().describe("emulator-<port>"), png: z.string().optional().describe("host path for a screenshot"), format: z.enum(["text", "json"]).default("text"), bounds: z.boolean().default(false).describe("add [l,t,r,b] to each line") },
  run: async (a) => { const r = await screen(a.serial, a.png); return a.format === "json" ? r : screenText(r, { bounds: a.bounds }); },
}];
