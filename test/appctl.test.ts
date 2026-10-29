import { test } from "node:test";
import assert from "node:assert/strict";
import { install, launch, logLine, logs, parseLogs, parseSince, shorten } from "../src/appctl.ts";

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

test("shorten folds repeated lines and cuts stack traces to the top 8 app frames", () => {
  const L = (m: string, level = "I", tag = "App") => ({ time: "10-25 17:04:53.180", pid: 1, tid: 1, level, tag, message: m });
  const frames = Array.from({ length: 30 }, (_, i) => L(`\tat ${i % 3 ? "android.os.X" : "dev.app.Main"}.f${i}(Main.kt:${i})`, "E", "AndroidRuntime"));
  const r = shorten([L("tick"), L("tick"), L("tick"), L("FATAL EXCEPTION: main", "E", "AndroidRuntime"), ...frames, L("Caused by: boom", "E", "AndroidRuntime"), L("done")], "dev.app");
  assert.deepEqual(r.map((l) => l.message), ["tick", "FATAL EXCEPTION: main", ...[0, 3, 6, 9, 12, 15, 18, 21].map((i) => `\tat dev.app.Main.f${i}(Main.kt:${i})`), "  … 22 frames cut", "Caused by: boom", "done"]);
  assert.equal(r[0].repeat, 3);
  // the "frames cut" line must carry time/level/tag of the trace (it was built from run[j - 1], an absolute index into a slice, so it came out empty and logLine threw)
  const cut = r.find((l) => l.message.includes("frames cut"))!;
  assert.equal(logLine(cut), "17:04:53.180 E AndroidRuntime:   … 22 frames cut");
  assert.equal(logLine(r[0]), "17:04:53.180 I App: tick (x3)");
  assert.equal(shorten([L("y".repeat(500)), L("y".repeat(500))], "dev.app")[0].message.length, 200); // cut, still folded
  assert.equal(shorten([L("y".repeat(500)), L("y".repeat(500))], "dev.app").length, 1);
  // a trace with no app frame keeps its first 8
  assert.equal(shorten(frames.filter((f) => !f.message.includes("dev.app")), "dev.app").length, 9);
});
