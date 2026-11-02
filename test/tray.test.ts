import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRAY_ACTIVITY, TRAY_STATE, startTray, trayAction, trayClear, trayState } from "../src/tray.ts";

process.env.CREWDROID_TRAY_DIR = mkdtempSync(join(tmpdir(), "tray-"));
const dev = { serial: "emulator-5580", port: 5580, profile: "s24ultra", api: 36 };

test("up writes the state, a command writes one line, down clears both", () => {
  trayState("starting", [dev], "win32");
  assert.deepEqual(JSON.parse(readFileSync(TRAY_STATE(), "utf8")), { status: "starting", pid: process.pid, devices: [dev] });
  trayAction("tap", "emulator-5580");
  assert.equal(readFileSync(TRAY_ACTIVITY(), "utf8"), "tap emulator-5580");
  trayClear();
  assert.equal(existsSync(TRAY_STATE()) || existsSync(TRAY_ACTIVITY()), false);
});

test("no state file or a lifecycle command writes no activity", () => {
  trayAction("tap", "emulator-5580");
  assert.equal(existsSync(TRAY_ACTIVITY()), false);
  trayState("ready", [dev], "win32");
  for (const c of ["devices", "mcp", "up", "down"]) trayAction(c);
  assert.equal(existsSync(TRAY_ACTIVITY()), false);
  trayClear();
});

test("the icon starts on Windows only, not with CREWDROID_NO_TRAY", () => {
  const calls: string[][] = [];
  const sp = ((_: string, args: string[]) => (calls.push(args), { on() {}, unref() {} })) as any;
  startTray("linux", sp);
  trayState("ready", [dev], "linux");
  assert.equal(calls.length, 0);
  assert.equal(existsSync(TRAY_STATE()), false);
  process.env.CREWDROID_NO_TRAY = "1";
  startTray("win32", sp);
  delete process.env.CREWDROID_NO_TRAY;
  assert.equal(calls.length, 0);
  startTray("win32", sp);
  assert.match(calls[0].at(-1)!, /Start-Process powershell -WindowStyle Hidden .*-File ".*tray\.ps1"/);
});
