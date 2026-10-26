import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlackRaw } from "../src/screen.ts";

const raw = (w: number, h: number, head: number, fill: (i: number) => number[]) => {
  const b = Buffer.alloc(head + w * h * 4);
  b.writeUInt32LE(w, 0); b.writeUInt32LE(h, 4);
  for (let i = 0; i < w * h; i++) b.set(fill(i), head + i * 4);
  return b;
};

test("isBlackRaw: all-black frame is black, a drawn frame is not, both header sizes, bad size throws", () => {
  assert.equal(isBlackRaw(raw(100, 200, 16, () => [0, 0, 0, 255])), true);
  assert.equal(isBlackRaw(raw(100, 200, 12, () => [0, 0, 0, 255])), true);
  assert.equal(isBlackRaw(raw(100, 200, 16, () => [0x0b, 0x1a, 0x2a, 255])), false); // sample app's dark navy
  assert.equal(isBlackRaw(raw(100, 200, 16, (i) => (i >= 5000 ? [255, 255, 255, 255] : [0, 0, 0, 255]))), false); // half drawn
  assert.throws(() => isBlackRaw(raw(100, 200, 16, () => [0, 0, 0, 255]).subarray(0, 1000)), /unexpected screencap size/);
});
