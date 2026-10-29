import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { drawBoxes, judgeLayout, textShape, type LNode } from "../src/layout.ts";

type Box = [number, number, number, number];
const n = (depth: number, cls: string, bounds: Box, o: Partial<LNode> = {}): LNode => ({ cls, text: "", desc: "", id: "", clickable: false, depth, bounds, ...o });
// one box per character, left to right on lines of `perLine` characters, 30 px wide, 50 px tall
const boxes = (len: number, perLine: number, x = 0, y = 0): Box[] => Array.from({ length: len }, (_, i) => [x + (i % perLine) * 30, y + Math.floor(i / perLine) * 50, x + (i % perLine) * 30 + 30, y + Math.floor(i / perLine) * 50 + 50]);
const kinds = (f: { kind: string }[]) => f.map((x) => x.kind).sort();
const S24 = { width: 1080, height: 2340 };

test("textShape: lines, word broken across lines, ellipsized tail, cut characters", () => {
  assert.deepEqual(textShape("Save", boxes(4, 10)), { lines: 1, cut: 0, ellipsized: 0, midWord: false });
  assert.deepEqual(textShape("Sync all", boxes(8, 5)), { lines: 2, cut: 0, ellipsized: 0, midWord: false }); // "Sync " | "all"
  assert.equal(textShape("Synchronize", boxes(11, 6)).midWord, true); // "Synchr" | "onize"
  const ell = boxes(10, 10).map((b, i): Box => (i >= 6 ? [180, 0, 180, 50] : b)); // as an ellipsized TextView reports its tail
  assert.equal(textShape("Pending up", ell).ellipsized, 3); // the space at index 6 is not counted
  assert.equal(textShape("Pending up", [...boxes(5, 10), null, null, null, null, null]).cut, 5);
  assert.equal(textShape("gone", [null, null, null, null]).cut, 0); // nothing drawn at all = a hidden node, not a cut text
});

// the probe's layout-bad screen as the helper reported it on s24ultra @450, font 1.0 (2026-10-29)
const bad: LNode[] = [
  n(0, "FrameLayout", [0, 0, 1080, 2340]),
  n(1, "LinearLayout", [0, 0, 1080, 2340]),
  n(2, "TextView", [45, 45, 1035, 128], { text: "Layout check", chars: boxes(12, 12, 45, 45) }),
  n(2, "FrameLayout", [45, 128, 1035, 263]),
  n(3, "Button", [45, 128, 438, 263], { text: "Left", clickable: true, chars: boxes(4, 4, 207, 169) }),
  n(3, "Button", [241, 128, 634, 263], { text: "Right", clickable: true, chars: boxes(5, 5, 391, 169) }),
  n(2, "Button", [45, 263, 466, 414], { text: "Synchronize all field notes now", clickable: true, chars: boxes(31, 16, 79, 289) }),
  n(2, "TextView", [45, 414, 438, 475], { text: "Pending upload for North field pump house", chars: boxes(41, 41, 45, 414).map((b, i): Box => (i >= 22 ? [438, 414, 438, 475] : b)) }),
  n(2, "ImageButton", [45, 475, 112, 542], { desc: "tiny", clickable: true }),
  n(2, "View", [45, 542, 46, 2340]),
  n(2, "Button", [45, 7562, 331, 2340], { text: "Unreachable", clickable: true, hidden: true, chars: Array(11).fill(null) }),
];

test("judgeLayout: the broken fixture has one finding of each kind", () => {
  const f = judgeLayout(bad, S24, 450);
  assert.deepEqual(kinds(f), ["clip", "offscreen", "overlap", "target", "wrap"]);
  assert.equal(f.find((x) => x.kind === "wrap")!.text, "Synchronize all field notes now");
  assert.equal(f.find((x) => x.kind === "clip")!.text, "Pending upload for North field pump house");
  assert.match(f.find((x) => x.kind === "overlap")!.detail, /"Right".* 50 %/);
  assert.match(f.find((x) => x.kind === "target")!.detail, /24x24 dp/);
  assert.equal(f.find((x) => x.kind === "offscreen")!.text, "Unreachable");
});

test("judgeLayout: under a scroll container nothing is offscreen, cut or too small at the edge; 20 % overlap is the limit", () => {
  const ok: LNode[] = [
    n(0, "ScrollView", [0, 0, 1080, 2340], { scrollable: true }),
    n(1, "LinearLayout", [0, 0, 1080, 2340]),
    n(2, "Button", [45, 128, 1035, 263], { text: "Left", clickable: true, chars: boxes(4, 4, 500, 169) }),
    n(2, "TextView", [45, 300, 1035, 450], { text: "Pending upload for North field", chars: boxes(30, 19, 45, 300) }), // wraps between words: fine
    n(2, "Button", [45, 2300, 331, 2340], { text: "Half", clickable: true, chars: [...boxes(2, 4, 60, 2300), null, null] }), // cut by the scroll edge
    n(2, "Button", [45, 7562, 331, 2340], { text: "Reachable", clickable: true, hidden: true }),
  ];
  assert.deepEqual(judgeLayout(ok, S24, 450), []);
  const pair = (dx: number) => [n(0, "FrameLayout", [0, 0, 1080, 2340]), n(1, "Button", [0, 0, 400, 200], { text: "A", clickable: true }), n(1, "Button", [400 - dx, 0, 800 - dx, 200], { text: "B", clickable: true })];
  assert.deepEqual(judgeLayout(pair(80), S24, 450), []); // exactly 20 %
  assert.deepEqual(kinds(judgeLayout(pair(81), S24, 450)), ["overlap"]);
});

test("judgeLayout: a Compose button (clickable View + same-size Button role child) counts as a button label; parents never overlap children", () => {
  const compose: LNode[] = [
    n(0, "View", [0, 0, 720, 748]),
    n(1, "ScrollView", [384, 48, 672, 700], { scrollable: true }),
    n(2, "View", [384, 48, 672, 230], { clickable: true }),
    n(3, "TextView", [432, 64, 624, 214], { text: "Add account", chars: boxes(11, 6, 432, 64) }), // "Add ac" | "count"
    n(3, "Button", [384, 48, 672, 230]),
    n(2, "View", [384, 246, 672, 400], { clickable: true }),
    n(3, "TextView", [432, 262, 624, 380], { text: "Wrapped prose ok", chars: boxes(16, 8, 432, 262) }), // no Button role: prose, may wrap
  ];
  const f = judgeLayout(compose, { width: 720, height: 748 }, 320);
  assert.deepEqual(f.map((x) => [x.kind, x.text, x.detail]), [["wrap", "Add account", "button label wraps to 2 lines"]]);
});

test("drawBoxes: red outline on a decoded and re-encoded PNG (Paeth-filtered input)", () => {
  const w = 40, h = 30, rows: number[] = [];
  for (let y = 0; y < h; y++) { rows.push(4); for (let x = 0; x < w; x++) rows.push(0, 0, 0, 0); } // Paeth of all-zero = 0
  const chunk = (t: string, d: Buffer) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
  const out = drawBoxes(png, [[2, 1, 32, 25]]);
  assert.equal(out.readUInt32BE(16), w);
  const at = out.indexOf("IDAT") - 4, px = inflateSync(out.subarray(at + 8, at + 8 + out.readUInt32BE(at)));
  const rgb = (x: number, y: number) => [...px.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 3)];
  assert.deepEqual(rgb(2, 1), [255, 0, 0]); // corner
  assert.deepEqual(rgb(15, 12), [0, 0, 0]); // inside, untouched
  assert.deepEqual(rgb(36, 12), [0, 0, 0]); // outside
});
