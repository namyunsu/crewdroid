import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPoint, findNodes, keyCode, pickNode, swipeLine, textChunks, type } from "../src/input.ts";
import type { UiNode } from "../src/screen.ts";
import { pngSize, stamp } from "../src/shot.ts";

const node = (text: string, id = "", desc = "", bounds: UiNode["bounds"] = [0, 0, 10, 10]): UiNode => ({ cls: "android.widget.TextView", text, desc, id, bounds, clickable: true, depth: 1 });
const nodes = [node("Send", "app:id/send"), node("Send later"), node("", "app:id/name"), node("", "", "Close"), node("sending")];

test("findNodes: exact first, then case-insensitive contains; id full or short; any = id and text", () => {
  assert.deepEqual(findNodes(nodes, "Send", "text").map((n) => n.text), ["Send"]);
  assert.deepEqual(findNodes(nodes, "send", "text").map((n) => n.text), ["Send", "Send later", "sending"]);
  assert.deepEqual(findNodes(nodes, "close", "text").map((n) => n.desc), ["Close"]);
  assert.equal(findNodes(nodes, "name", "id")[0].id, "app:id/name");
  assert.equal(findNodes(nodes, "app:id/name", "id").length, 1);
  assert.equal(findNodes(nodes, "Close", "id").length, 0);
  assert.equal(findNodes(nodes, "name", "any")[0].id, "app:id/name");
  assert.equal(findNodes(nodes, "Nothing", "text").length, 0);
});

test("pickNode: one match, --index, several or none fail listing candidates", () => {
  assert.equal(pickNode([nodes[0]], nodes, "x").text, "Send");
  assert.equal(pickNode(nodes.slice(0, 2), nodes, "x", 1).text, "Send later");
  assert.throws(() => pickNode(nodes.slice(0, 2), nodes, "text 'send'"), /2 matches for text 'send'; pass --index[\s\S]*"Send later"/);
  assert.throws(() => pickNode([], nodes, "text 'Nothing'"), /no match for text 'Nothing'; on screen:[\s\S]*id=app:id\/name/);
  assert.throws(() => pickNode(nodes.slice(0, 2), nodes, "x", 2), /--index 2 out of range/);
});

test("checkPoint and swipeLine stay inside the screen", () => {
  const s = { width: 1080, height: 2340 };
  checkPoint(0, 0, s); checkPoint(1079, 2339, s);
  assert.throws(() => checkPoint(99999, 1, s), /outside the screen 1080x2340/);
  assert.throws(() => checkPoint(1080, 1, s), /outside/);
  assert.throws(() => checkPoint(-1, 1, s), /outside/);
  assert.deepEqual(swipeLine("up", s), [540, 1755, 540, 585]);
  assert.deepEqual(swipeLine("down", s), [540, 585, 540, 1755]);
  assert.deepEqual(swipeLine("left", s), [810, 1170, 270, 1170]);
  assert.deepEqual(swipeLine("right", s), [270, 1170, 810, 1170]);
});

test("keyCode names and KEYCODE_*; textChunks splits only %s", () => {
  assert.equal(keyCode("back"), "KEYCODE_BACK");
  assert.equal(keyCode("Delete"), "KEYCODE_DEL");
  assert.equal(keyCode("KEYCODE_VOLUME_UP"), "KEYCODE_VOLUME_UP");
  assert.throws(() => keyCode("rm -rf"), /unknown key/);
  assert.deepEqual(textChunks("hello world & 100%"), ["hello world & 100%"]);
  assert.deepEqual(textChunks("5%sale %d"), ["5%", "sale %d"]);
});

test("type: non-ASCII and control characters fail before any adb call", async () => {
  await assert.rejects(type("emulator-5580", "안녕"), /non-ASCII text cannot be typed/);
  await assert.rejects(type("emulator-5580", "a\nb"), /control characters/);
  await assert.rejects(type("phone-1234", "hi"), /emulator-<port>/);
});

test("pngSize reads IHDR; stamp is yyyymmdd-HHMMSS", () => {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(1080, 16); b.writeUInt32BE(2520, 20);
  assert.deepEqual(pngSize(b), { width: 1080, height: 2520 });
  assert.throws(() => pngSize(Buffer.from("error: device offline")), /not a PNG/);
  assert.equal(stamp(new Date(2026, 9, 6, 7, 8, 9)), "20261006-070809");
});
