import { test } from "node:test";
import assert from "node:assert/strict";
import { envSet, num, parseAccel } from "../src/env.ts";

test("num: range and integer checks", () => {
  assert.equal(num("42", "x", 0, 100, true), 42);
  assert.equal(num("-122.08", "x", -180, 180), -122.08);
  for (const v of ["150", "-1", "4.5", "", "abc", undefined]) assert.throws(() => num(v, "x", 0, 100, true), /must be/);
});

test("parseAccel: x:y:z only", () => {
  assert.deepEqual(parseAccel("0:9.81:-1"), [0, 9.81, -1]);
  for (const v of ["1:2", "a:b:c", "1:2:3:4", undefined, "1:2:999"]) assert.throws(() => parseAccel(v), /acceleration/);
});

// bad input must reject on validation, before any adb call (emulator-59999 does not exist; a call would fail differently / slowly)
test("envSet: invalid serial and values are refused before adb", async () => {
  await assert.rejects(envSet("5580", "show", []), /emulator-<port>/);
  const s = "emulator-59999";
  const cases: [string, string[], RegExp][] = [
    ["battery", ["150"], /battery level/], ["battery", ["50", "usb"], /ac\|unplugged/], ["rotate", ["9"], /rotation/],
    ["geo", ["200", "10"], /longitude/], ["geo", ["10", "95"], /latitude/], ["sensor", ["gyroscope", "1:2:3"], /acceleration/], ["dark", ["maybe"], /on\|off/],
    ["font", ["9"], /font scale/], ["locale", ["notapkg", "ko-KR"], /package/], ["locale", ["a.b.c", "ko KR"], /BCP-47/],
    ["gsm", ["data", "gone"], /gsm data/], ["gsm", ["signal", "32"], /signal/], ["sms", ["abc", "hi"], /sender/], ["sms", ["0101", "a\nb"], /one line/],
    ["call", ["0101", "hold"], /accept\|cancel/], ["call", ["x"], /number/], ["nope", [], /unknown env item/],
  ];
  for (const [what, args, re] of cases) await assert.rejects(envSet(s, what, args), re, `${what} ${args.join(" ")}`);
  await assert.rejects(envSet(s, "gsm", ["signal", "5"], { hold: 0 }), /--hold/);
});
