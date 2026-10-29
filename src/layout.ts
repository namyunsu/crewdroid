import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";
import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import { launch } from "./appctl.ts";
import { envSet } from "./env.ts";
import { call, startHelper } from "./helper.ts";
import type { Tool } from "./mcp.ts";
import { loadProfiles } from "./profiles.ts";
import { runAction } from "./scenario-actions.ts";
import { unblack, type Size, type UiNode } from "./screen.ts";
import { adbPath } from "./sdk.ts";
import { stamp } from "./shot.ts";

const run = promisify(execFile);

// Layout sweep (T67, FR-39): one app on ONE device across Galaxy profiles (wm size/density) x font scales, judged from the
// helper's tree in layout mode (/tree?layout=1: every node, hidden:true for nodes not visible to the user, chars = per-character
// screen boxes from EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY). Nothing here knows the app under test.
export const DEFAULT_PROFILES = ["s24ultra", "fold5-cover", "fold5-main", "flip6-cover", "trifold-main"];
export const DEFAULT_FONTS = [1.0, 1.3, 2.0];
export const OVERLAP = 0.2; // share of the smaller element's area
export const MIN_TARGET_DP = 48;

type Box = [number, number, number, number];
export type LNode = UiNode & { hidden?: boolean; chars?: (Box | null)[] };
export type Kind = "wrap" | "clip" | "offscreen" | "overlap" | "target" | "crash";
export interface Finding { kind: Kind; text?: string; id?: string; bounds: Box; detail: string }

const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inter = (a: Box, b: Box): Box => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const word = /[\p{L}\p{N}]/u;

// How a text is drawn, from its per-character boxes: lines (distinct line tops), cut (characters with no visible part while
// others have one), ellipsized (the hidden tail of an ellipsized text: zero-width boxes on non-space characters), midWord
// (a line break between two letters/digits).
export function textShape(text: string, chars: (Box | null)[]) {
  const tops: number[] = [];
  let cut = 0, ellipsized = 0, midWord = false, prev = -1, prevLine = -1;
  chars.forEach((c, i) => {
    if (!c) { cut++; return; }
    if (c[2] - c[0] <= 0) { if (!/\s/.test(text[i] ?? "")) ellipsized++; return; }
    let line = tops.findIndex((t) => Math.abs(t - c[1]) <= 2);
    if (line < 0) line = tops.push(c[1]) - 1;
    if (prev === i - 1 && prevLine >= 0 && line !== prevLine && word.test(text[i - 1]) && word.test(text[i])) midWord = true;
    prev = i; prevLine = line;
  });
  return { lines: tops.length, cut: cut === chars.length ? 0 : cut, ellipsized, midWord };
}

// Findings on one screen. size = display size, density = dpi (dp = px * 160 / density).
export function judgeLayout(nodes: LNode[], size: Size, density: number, overlap = OVERLAP): Finding[] {
  const { width: W, height: H } = size, out: Finding[] = [];
  // parent = nearest earlier node with a smaller depth (layout mode keeps every node)
  const parent: number[] = [], stack: number[] = [];
  nodes.forEach((n, i) => { while (stack.length && nodes[stack.at(-1)!].depth >= n.depth) stack.pop(); parent[i] = stack.at(-1) ?? -1; stack.push(i); });
  const ancestors = (i: number) => { const a: number[] = []; for (let p = parent[i]; p >= 0; p = parent[p]) a.push(p); return a; };
  const scroller = (i: number) => ancestors(i).find((p) => nodes[p].scrollable);
  const who = (n: LNode) => (n.text || n.desc ? { text: n.text || n.desc } : { id: n.id });
  const add = (kind: Kind, n: LNode, detail: string) => out.push({ kind, ...who(n), bounds: n.bounds, detail });
  const meaningful = (n: LNode) => !!(n.text || n.desc || n.clickable);

  // (b) outside the screen with no scroll container above it. A node pushed past an edge reports clamped, inverted bounds
  // (top >= bottom) and hidden:true; one partly past the edge is clamped to it (its text shows up as cut under (a)).
  const off = new Set<number>();
  nodes.forEach((n, i) => {
    const [l, t, r, b] = n.bounds;
    const outside = t >= H || l >= W || b <= 0 || r <= 0 || (!!n.hidden && (t > b || l > r));
    if (!outside || !meaningful(n) || scroller(i) !== undefined) return;
    off.add(i);
    if (!ancestors(i).some((p) => off.has(p))) add("offscreen", n, `outside the ${W}x${H} screen and no scroll container can bring it in`);
  });

  const shown = (i: number) => !nodes[i].hidden && !off.has(i) && area(nodes[i].bounds) > 0;
  // A button label: a text that is, or sits inside, a Button/Chip/Tab view, or a node with a same-size Button child (Compose:
  // the clickable is a plain View and its Role.Button shows as a child node of class Button with the same bounds).
  const buttonish = (i: number) => /Button|Chip|Tab/.test(nodes[i].cls) || nodes.some((c, k) => parent[k] === i && /Button|Chip|Tab/.test(c.cls) && String(c.bounds) === String(nodes[i].bounds));
  const isLabel = (i: number) => [i, ...ancestors(i)].some(buttonish);
  // (a) wrapped or clipped text
  nodes.forEach((n, i) => {
    if (!n.text || !n.chars?.length || !shown(i) || n.editable) return;
    const s = textShape(n.text, n.chars);
    const button = isLabel(i);
    if (button && s.lines > 1 && !n.text.includes("\n")) add("wrap", n, `button label wraps to ${s.lines} lines`);
    else if (s.midWord) add("wrap", n, "text breaks inside a word");
    if (s.ellipsized) add("clip", n, `ellipsized: ${s.ellipsized} of ${n.chars.length} characters not drawn`);
    else if (s.cut && scroller(i) === undefined) add("clip", n, `${s.cut} of ${n.chars.length} characters cut off by the edge of a parent or the screen`);
  });

  // (c) overlap between elements (clickable nodes, and texts not inside a clickable one) that are not ancestor and descendant.
  // Elements covering half the screen or more (scrims, containers) are left out.
  const els = nodes.map((_, i) => i).filter((i) => shown(i) && meaningful(nodes[i]) && area(nodes[i].bounds) < 0.5 * W * H && (nodes[i].clickable || !ancestors(i).some((p) => nodes[p].clickable)));
  for (let x = 0; x < els.length; x++) for (let y = x + 1; y < els.length; y++) {
    const [i, j] = [els[x], els[y]];
    if (ancestors(j).includes(i) || ancestors(i).includes(j)) continue;
    const a = nodes[i], b = nodes[j], share = area(inter(a.bounds, b.bounds)) / Math.min(area(a.bounds), area(b.bounds));
    if (share > overlap) out.push({ kind: "overlap", ...who(a), bounds: inter(a.bounds, b.bounds), detail: `overlaps ${JSON.stringify(b.text || b.desc || b.id)} [${b.bounds}] by ${Math.round(share * 100)} % of the smaller` });
  }

  // (d) touch target below 48 dp. A node clamped at the screen or its scroll container's edge is only partly shown: skipped.
  const min = (MIN_TARGET_DP * density) / 160;
  nodes.forEach((n, i) => {
    if (!n.clickable || !shown(i)) return;
    const [l, t, r, b] = n.bounds, s = scroller(i), e = s === undefined ? [0, 0, W, H] : nodes[s].bounds;
    if (l <= e[0] || t <= e[1] || r >= e[2] || b >= e[3]) return;
    const w = ((r - l) * 160) / density, h = ((b - t) * 160) / density;
    if (r - l < min - 0.5 || b - t < min - 0.5) add("target", n, `touch target ${Math.round(w)}x${Math.round(h)} dp < ${MIN_TARGET_DP} dp`);
  });
  return out;
}

// ---- PNG: screencap (8-bit RGB/RGBA) -> the same picture with red boxes ----
export function drawBoxes(png: Buffer, boxes: Box[]): Buffer {
  let w = 0, h = 0, type = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at + 8 <= png.length;) {
    const len = png.readUInt32BE(at), t = png.toString("latin1", at + 4, at + 8), d = png.subarray(at + 8, at + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[8] === 8 && d[12] === 0 ? d[9] : -1; }
    else if (t === "IDAT") idat.push(d);
    at += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!w || !bpp) throw new Error("not an 8-bit RGB/RGBA PNG");
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { // undo the per-row filters (PNG spec 9.2)
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      px[row + x] = (raw[src + x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
  }
  const dot = (x: number, y: number) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = y * stride + x * bpp; px[o] = 255; px[o + 1] = 0; px[o + 2] = 0; if (bpp === 4) px[o + 3] = 255; };
  for (const [l, t, r, b] of boxes) for (let k = 0; k < 4; k++) {
    for (let x = l; x < r; x++) { dot(x, t + k); dot(x, b - 1 - k); }
    for (let y = t; y < b; y++) { dot(l + k, y); dot(r - 1 - k, y); }
  }
  const rows = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) px.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = type;
  return Buffer.concat([png.subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

// ---- the sweep ----
export interface LayoutOptions { activity?: string; flow?: string; profiles?: string[]; fonts?: number[]; extras?: string[]; out?: string; overlap?: number }
const sh = (serial: string, cmd: string) => adb(serial, ["shell", cmd]);
const override = (out: string) => out.match(/Override \w+: (\S+)/)?.[1] ?? ""; // "" = none set: restored with `wm ... reset`
type Tree = { width: number; height: number; nodes: LNode[] };

// NOTE: after a Maestro flow its driver still holds UiAutomation for a moment; the helper answers 503 (busy) and exits.
// So: wait, restart the helper (call() then waits for it to come up), try again, for up to 60 s.
async function layoutTree(serial: string): Promise<Tree> {
  for (const t0 = Date.now(); ;) {
    const t = await call<Tree>(serial, "GET", "/tree?layout=1&idle=500", undefined, 30000);
    if (t) return t;
    if (Date.now() - t0 > 60000) throw new Error(`the on-device helper does not answer on ${serial} (another automation client may hold UiAutomation); layout needs it (text boxes and hidden nodes are not in uiautomator dump)`);
    await new Promise((r) => setTimeout(r, 2000));
    await startHelper(serial);
  }
}

export async function layout(serial: string, pkg: string, o: LayoutOptions = {}) {
  assertSerial(serial);
  const t0 = Date.now();
  const all = loadProfiles();
  const profiles = (o.profiles ?? DEFAULT_PROFILES).map((n) => all.find((p) => p.name === n) ?? (() => { throw new Error(`unknown profile '${n}' (profiles/galaxy.json: ${all.map((p) => p.name).join(", ")})`); })());
  const fonts = o.fonts ?? DEFAULT_FONTS;
  for (const f of fonts) if (!(f >= 0.5 && f <= 3)) throw new Error(`bad font scale ${f} (0.5..3)`);
  if (o.flow) await maestroPresent();
  if (!(await sh(serial, `pm path ${pkg}`).catch(() => ""))) throw new Error(`${pkg} is not installed on ${serial} (crewdroid install ${serial} <apk>)`);
  const before = { size: override(await sh(serial, "wm size")), density: override(await sh(serial, "wm density")), font: (await sh(serial, "settings get system font_scale")).trim() };
  const dir = resolve(o.out ?? `crewdroid-layout-${pkg}-${stamp()}`);
  const combos: { profile: string; font: number; ok: boolean; seconds: number; findings: Finding[]; png?: string }[] = [];
  try {
    for (const p of profiles) {
      await sh(serial, `wm size ${p.width}x${p.height}`);
      await sh(serial, `wm density ${p.density}`);
      for (const font of fonts) {
        const c0 = Date.now();
        await envSet(serial, "font", [String(font)]);
        const findings: Finding[] = [];
        const started = await launch(serial, pkg, { activity: o.activity, restart: true, extras: o.extras }); // force-stop, 2 s, start
        if (started.crashed) findings.push({ kind: "crash", bounds: [0, 0, 0, 0], detail: `app died after start: ${started.crash?.exception ?? "no crash record"}` });
        else {
          if (o.flow) {
            await runAction(serial, { maestro: resolve(o.flow) }, { serial, device: 0, iter: 0 }, process.cwd());
            // NOTE: `maestro test --no-reinstall-driver` leaves its driver (dev.mobile.maestro) running and holding UiAutomation
            // after the flow (measured: still busy 60 s later), so the helper cannot read the tree. This sweep started that
            // flow and it has ended, so its driver is stopped; the next `maestro test` starts it again.
            await sh(serial, "am force-stop dev.mobile.maestro");
          }
          await unblack(serial);
          const tree = await layoutTree(serial);
          if (tree.width !== p.width || tree.height !== p.height) throw new Error(`${serial}: display is ${tree.width}x${tree.height} after wm size ${p.width}x${p.height}`);
          findings.push(...judgeLayout(tree.nodes, tree, p.density, o.overlap));
        }
        let png: string | undefined;
        if (findings.length) {
          const { stdout } = await run(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 2 ** 28, timeout: 60000, windowsHide: true });
          mkdirSync(dir, { recursive: true });
          png = join(dir, `${p.name}-font${font.toFixed(1)}.png`);
          writeFileSync(png, drawBoxes(stdout, findings.filter((f) => f.kind !== "crash").map((f) => f.bounds)));
        }
        combos.push({ profile: p.name, font, ok: !findings.length, seconds: Math.round((Date.now() - c0) / 100) / 10, findings, ...(png ? { png } : {}) });
        console.error(`${p.name} font ${font.toFixed(1)}: ${findings.length ? `${findings.length} finding(s)` : "ok"}`);
      }
    }
  } finally {
    await sh(serial, before.size ? `wm size ${before.size}` : "wm size reset").catch(() => {});
    await sh(serial, before.density ? `wm density ${before.density}` : "wm density reset").catch(() => {});
    await sh(serial, /^[\d.]+$/.test(before.font) ? `settings put system font_scale ${before.font}` : "settings delete system font_scale").catch(() => {}); // "null" = never set
  }
  const byKind: Record<string, number> = {};
  for (const c of combos) for (const f of c.findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  const bad = combos.filter((c) => !c.ok).length;
  return {
    serial, pkg, ok: bad === 0, combos,
    summary: { combos: combos.length, withFindings: bad, byKind, seconds: Math.round((Date.now() - t0) / 100) / 10, pngDir: bad ? dir : undefined },
    note: "wrap = button label on 2+ lines or a text broken inside a word; clip = ellipsized or cut text (per-character boxes from the accessibility text-location extra); offscreen = outside the screen with no scroll container; overlap > 20 % of the smaller element; target < 48 dp. Texts drawn without the extra (custom views, WebView, canvas) are not checked for wrap/clip.",
  };
}

async function maestroPresent() {
  const win = process.platform === "win32";
  try { await run(win ? "maestro.cmd" : "maestro", ["--version"], { windowsHide: true, timeout: 60000, shell: win }); } catch (e: any) {
    throw new Error(`--flow needs Maestro, which is not on PATH (install: https://maestro.dev; Windows: scoop install maestro): ${String(e.message).split("\n")[0]}`);
  }
}

export const layoutText = (r: Awaited<ReturnType<typeof layout>>) => [
  ...r.combos.flatMap((c) => [`${c.profile} font ${c.font.toFixed(1)}: ${c.ok ? "ok" : `${c.findings.length} finding(s)`} (${c.seconds}s)${c.png ? ` ${c.png}` : ""}`,
    ...c.findings.map((f) => `  ${f.kind} ${f.text !== undefined ? JSON.stringify(f.text) : `#${f.id}`} [${f.bounds}] ${f.detail}`)]),
  `${r.ok ? "OK" : "FAIL"}: ${r.summary.withFindings} of ${r.summary.combos} combos with findings ${JSON.stringify(r.summary.byKind)} in ${r.summary.seconds}s`,
].join("\n");

export const mcpTools: Tool[] = [{
  name: "layout", long: true,
  description: "Use to find broken screens of any installed app across Galaxy screens x font sizes on ONE device (default 5 profiles x fonts 1.0/1.3/2.0 = 15 combos, ~2-4 min). Per combo the app is restarted and the launch activity (or the screen a Maestro flow reaches) is judged from the accessibility tree: wrap (button label on 2+ lines, word broken), clip (ellipsized/cut text), offscreen (no scroll can reach it), overlap (> 20 %), target (< 48 dp). Returns {ok, combos:[{profile, font, ok, findings:[{kind, text|id, bounds, detail}], png?}], summary}; png = screenshot with the finding boxes drawn. The device's screen size, density and font are restored afterwards.",
  input: {
    serial: z.string().describe("emulator-<port>"), pkg: z.string().describe("installed package"),
    activity: z.string().optional().describe("e.g. .MainActivity; default = launcher activity"),
    flow: z.string().optional().describe("Maestro flow (host path) run after each start; the screen it ends on is judged"),
    profiles: z.array(z.string()).optional().describe(`profile names, default ${DEFAULT_PROFILES.join(",")}`),
    fonts: z.array(z.number()).optional().describe("font scales, default [1.0,1.3,2.0]"),
    extras: z.array(z.string()).default([]).describe('am start extras, e.g. ["--es","check","layout-bad"]'),
    out: z.string().optional().describe("directory for the PNGs (default ./crewdroid-layout-<pkg>-<time>)"),
  },
  run: (a) => layout(a.serial, a.pkg, a),
}];
