import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { adoptiumArch, cmdlineUrl, imageAbi, imagePackage, jreUrl, parseCmdlineBuild, parseSize, planSteps, repoOs, STEPS } from "../src/setup.ts";

const XML = `<remotePackage path="cmdline-tools;latest"><archives>
<archive><complete><size>100</size><url>commandlinetools-linux-1234_latest.zip</url></complete><host-os>linux</host-os></archive></archives></remotePackage>
<remotePackage path="emulator"><archives>
<archive><complete><size>11</size></complete><host-os>linux</host-os><host-arch>x64</host-arch></archive>
<archive><complete><size>22</size></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive>
<archive><complete><size>33</size></complete><host-os>windows</host-os></archive></archives></remotePackage>
<remotePackage path="system-images;android-34;google_atd;x86_64"><archives><archive><complete><size>7</size></complete></archive></archives></remotePackage>`;

test("os/arch mapping and urls", () => {
  assert.equal(jreUrl("win32", "x64"), "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse");
  assert.equal(jreUrl("darwin", "arm64"), "https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jre/hotspot/normal/eclipse");
  assert.equal(cmdlineUrl("99", "linux"), "https://dl.google.com/android/repository/commandlinetools-linux-99_latest.zip");
  assert.equal(cmdlineUrl("99", "win32"), "https://dl.google.com/android/repository/commandlinetools-win-99_latest.zip");
  assert.equal(cmdlineUrl("99", "darwin"), "https://dl.google.com/android/repository/commandlinetools-mac-99_latest.zip");
  assert.equal(imageAbi("arm64"), "arm64-v8a");
  assert.equal(imagePackage("31", "x64"), "system-images;android-31;google_atd;x86_64");
  assert.equal(imagePackage("36", "arm64"), "system-images;android-36;google_atd;arm64-v8a");
  assert.equal(adoptiumArch("x64"), "x64");
  assert.equal(repoOs("darwin"), "macosx");
});

test("repository xml parsing", () => {
  assert.equal(parseCmdlineBuild(XML), "1234");
  assert.equal(parseSize(XML, "emulator", "linux"), 11);
  assert.equal(parseSize(XML, "emulator", "macosx", "aarch64"), 22);
  assert.equal(parseSize(XML, "emulator", "windows"), 33);
  assert.equal(parseSize(XML, "system-images;android-34;google_atd;x86_64", "linux"), 7);
  assert.equal(parseSize(XML, "nope", "linux"), null);
});

test("step planning without network", () => {
  const sdk = join("/s");
  const none = planSteps(sdk, [...STEPS], ["34"], "x64", "linux", false, () => false);
  assert.deepEqual(none.map((p) => p.step), [...STEPS]);
  assert.ok(none.every((p) => !p.present));
  const have = new Set([join(sdk, "platform-tools", "adb"), join(sdk, "system-images", "android-34", "google_atd", "x86_64", "system.img")]);
  const some = planSteps(sdk, ["images", "platform-tools", "emulator"], ["34"], "x64", "linux", true, (p) => have.has(p));
  assert.deepEqual(some, [{ step: "platform-tools", present: true }, { step: "emulator", present: false }, { step: "images", present: true }]);
  assert.equal(planSteps(sdk, ["images"], ["34", "31"], "x64", "linux", true, (p) => have.has(p))[0].present, false);
});
