import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forwardPort, HELPER_VERSION } from "../src/helper.ts";

test("HELPER_VERSION matches the APK's versionCode (an outdated helper on a device gets reinstalled)", () => {
  const gradle = readFileSync(join(import.meta.dirname, "..", "agent-helper", "build.gradle.kts"), "utf8");
  assert.equal(Number(gradle.match(/versionCode = (\d+)/)?.[1]), HELPER_VERSION);
});

test("forwardPort finds this serial's forward to the helper port only", () => {
  const list = "emulator-5582 tcp:50001 tcp:6790\nemulator-5580 tcp:50002 tcp:5555\nemulator-5580 tcp:50003 tcp:6790\n";
  assert.equal(forwardPort(list, "emulator-5580"), 50003);
  assert.equal(forwardPort(list, "emulator-5584"), undefined);
  assert.equal(forwardPort("", "emulator-5580"), undefined);
});
