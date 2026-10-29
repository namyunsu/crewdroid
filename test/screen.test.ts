import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { compact, isBlackPng, parseUiDump, shortId, type UiNode } from "../src/screen.ts";

// minimal PNG: 8-bit RGBA (type 6) or RGB (type 2); every row stored with the given filter (0 None, 1 Sub, 2 Up)
const png = (w: number, h: number, px: (i: number) => number[], filter = 0, type = 6) => {
  const bpp = type === 6 ? 4 : 3, rows: number[] = [], prev = Array(w * bpp).fill(0);
  for (let y = 0; y < h; y++) {
    const cur = Array.from({ length: w }, (_, x) => px(y * w + x).slice(0, bpp)).flat();
    rows.push(filter, ...cur.map((v, i) => (v - (filter === 1 ? (i >= bpp ? cur[i - bpp] : 0) : filter === 2 ? prev[i] : 0) + 256) % 256));
    prev.splice(0, prev.length, ...cur);
  }
  const chunk = (t: string, d: Buffer) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "latin1"); d.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = type;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
};

test("isBlackPng: black frames are black under every filter, drawn ones are not, other PNGs throw", () => {
  for (const f of [0, 1, 2]) {
    assert.equal(isBlackPng(png(40, 30, () => [0, 0, 0, 255], f)), true, `filter ${f} black`);
    assert.equal(isBlackPng(png(40, 30, () => [0x0b, 0x1a, 0x2a, 255], f)), false, `filter ${f} dark navy`); // sample app's dark navy
    assert.equal(isBlackPng(png(40, 30, (i) => (i === 1199 ? [1, 0, 0, 255] : [0, 0, 0, 255]), f)), false, `filter ${f} one pixel`);
  }
  assert.equal(isBlackPng(png(40, 30, () => [0, 0, 0], 1, 2)), true);
  assert.equal(isBlackPng(png(40, 30, () => [0, 0, 0, 0], 0)), true); // alpha is ignored
  assert.throws(() => isBlackPng(Buffer.from("not a png at all")), /not an 8-bit/);
});

const node = (o: Partial<UiNode> & { depth: number; bounds: UiNode["bounds"] }): UiNode => ({ cls: "TextView", text: "", desc: "", id: "", clickable: false, ...o });

test("compact: one line per meaningful node, cards absorb their texts, off-screen counted, flags and ids", () => {
  const nodes = [
    node({ cls: "FrameLayout", id: "android:id/content", depth: 1, bounds: [0, 0, 1080, 2340] }), // id-only layout: dropped
    node({ text: "Field Notes", id: "dev.x:id/app_title", depth: 3, bounds: [40, 80, 600, 160] }),
    node({ cls: "Chip", text: "Synced ✓", id: "dev.x:id/sync", depth: 3, bounds: [800, 80, 1040, 160] }),
    node({ cls: "RecyclerView", id: "dev.x:id/list", scrollable: true, depth: 3, bounds: [0, 200, 1080, 2340] }),
    node({ cls: "MaterialCardView", clickable: true, depth: 4, bounds: [20, 210, 1060, 410] }),
    node({ text: "Check pump", id: "dev.x:id/note_title", depth: 6, bounds: [100, 230, 800, 300] }),
    node({ text: "Pump house · 09:12", id: "dev.x:id/meta", depth: 6, bounds: [100, 300, 800, 360] }),
    node({ cls: "ImageView", desc: "Synced", id: "dev.x:id/synced", depth: 6, bounds: [900, 280, 960, 340] }),
    node({ cls: "MaterialCardView", clickable: true, depth: 4, bounds: [20, 2400, 1060, 2600] }), // below the screen
    node({ text: "Below", depth: 6, bounds: [100, 2420, 800, 2500] }),
    node({ cls: "EditText", text: "", id: "dev.x:id/a", editable: true, focused: true, depth: 3, bounds: [0, 1000, 1080, 1100] }), // obfuscated id
    node({ cls: "Chip", text: "Pump house", clickable: true, checked: true, depth: 3, bounds: [0, 1200, 300, 1300] }),
    node({ cls: "Button", text: "Save", clickable: true, disabled: true, depth: 3, bounds: [0, 1400, 300, 1500] }),
    node({ cls: "View", text: "zero", depth: 3, bounds: [5, 5, 5, 5] }), // zero-sized: dropped
  ];
  const { text, items } = compact({ focus: "dev.x/.Main", size: { width: 1080, height: 2340 }, nodes });
  assert.equal(text, [
    "dev.x/.Main 1080x2340",
    '[0] text "Field Notes" #app_title @320,120',
    '[1] text "Synced ✓" #sync @920,120',
    "[2] list #list @540,1270",
    '  [3] btn "Check pump" "Pump house · 09:12" "Synced" @540,310',
    "[4] edit @540,1050 focused",
    '[5] check "Pump house" @150,1250 checked',
    '[6] btn "Save" @150,1450 disabled',
    "… 1 more below (swipe up)",
  ].join("\n"));
  assert.deepEqual(items[3], { x: 540, y: 310, label: "Check pump" });
  assert.equal(items[4].label, "edit");
  assert.match(compact({ focus: "f", nodes: nodes.slice(1, 2) }, { bounds: true }).text, /@320,120 \[40,80,600,160\]$/);
});

test("compact: busy line, long text cut; shortId hides R8-renamed ids", () => {
  const t = compact({ focus: "", nodes: [node({ text: "x".repeat(100), depth: 0, bounds: [0, 0, 10, 10] })], busy: "no tree now" }).text.split("\n");
  assert.equal(t[0], "no focused window");
  assert.equal(t[1], "no tree now");
  assert.equal(t[2], '[0] text "' + "x".repeat(59) + '…" @5,5');
  assert.deepEqual(["p:id/a", "p:id/b0", "p:id/new_note", "android:id/button1", "p:id/12"].map(shortId), ["", "", "new_note", "button1", ""]);
});

test("parseUiDump reads scrollable, checkable, focused and enabled", () => {
  const [list, box] = parseUiDump('<hierarchy><node class="x.RecyclerView" scrollable="true" bounds="[0,0][10,10]"><node class="x.CheckBox" text="ok" checkable="true" checked="false" focused="true" enabled="false" bounds="[0,0][5,5]"/></node></hierarchy>');
  assert.equal(list.scrollable, true);
  assert.deepEqual([box.checked, box.focused, box.disabled], [false, true, true]);
});
