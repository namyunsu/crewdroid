import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { forwardPort, HELPER_VERSION, helperFresh } from "../src/helper.ts";

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

test("helperFresh: no APK, or a source newer than it, means build; an npm install (no sources) never builds", () => {
  const dir = mkdtempSync(join(tmpdir(), "crew-helper-")), apk = join(dir, "out.apk"), src = join(dir, "src", "main");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "Runner.kt"), "");
  writeFileSync(join(dir, "build.gradle.kts"), "");
  assert.equal(helperFresh(apk, dir), false);
  writeFileSync(apk, "");
  const at = (f: string, s: number) => utimesSync(f, s, s);
  at(join(src, "Runner.kt"), 1000); at(join(dir, "build.gradle.kts"), 1000); at(apk, 2000);
  assert.equal(helperFresh(apk, dir), true);
  at(join(dir, "build.gradle.kts"), 3000);
  assert.equal(helperFresh(apk, dir), false);
  assert.equal(helperFresh(apk, join(dir, "nope")), true);
});

test("the npm package ships every APK the CLI installs at run time", async () => {
  const { files } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));
  const { helperApk } = await import("../src/helper.ts");
  const { probeApk } = await import("../src/snapshot.ts");
  const { loadApk, fillerDir } = await import("../src/load.ts");
  const root = join(import.meta.dirname, "..");
  const rel = (p: string) => relative(root, p).replaceAll("\\", "/");
  for (const apk of [probeApk(), helperApk(), loadApk()]) assert.ok(files.includes(rel(apk)), `${apk} not in package.json files`);
  assert.ok(files.includes(`${rel(fillerDir())}/*.apk`), "load filler APKs not in package.json files");
});
