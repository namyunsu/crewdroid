import { test } from "node:test";
import assert from "node:assert/strict";
import { install, launch, logs, parseLogs, parseSince } from "../src/appctl.ts";

test("parseLogs keeps time, pid, level, tag, message and skips buffer headers", () => {
  const r = parseLogs("--------- beginning of main\r\n10-25 17:04:53.180  4423  4431 I CrewProbe: UPLOAD ok id=7\r\n10-25 17:04:54.001  4423  4423 E AndroidRuntime: FATAL EXCEPTION: main\r\n");
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { time: "10-25 17:04:53.180", pid: 4423, tid: 4431, level: "I", tag: "CrewProbe", message: "UPLOAD ok id=7" });
  assert.equal(r[1].level, "E");
});

test("parseSince: 60s, 90, 2m; junk throws", () => {
  assert.equal(parseSince("60s"), 60);
  assert.equal(parseSince("90"), 90);
  assert.equal(parseSince("2m"), 120);
  assert.throws(() => parseSince("2h"), /bad --since/);
});

test("input guards run before any adb call", async () => {
  await assert.rejects(launch("emulator-5580", "bad pkg"), /bad package name/);
  await assert.rejects(launch("emulator-5580", "a.b", { extras: ["x;rm"] }), /bad --activity/);
  await assert.rejects(launch("R5CT123", "a.b"), /emulator-<port>/);
  await assert.rejects(logs("emulator-5580", "a.b", { level: "X" }), /bad --level/);
  await assert.rejects(logs("emulator-5580", "a.b", { since: "x" }), /bad --since/);
  await assert.rejects(install("R5CT123", "x.apk"), /emulator-<port>/);
});
