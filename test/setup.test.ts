import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { adoptiumArch, cmdlineUrl, findJava, imageAbi, imagePackage, jreUrl, parseSize, planSteps, repoOs, STEPS } from "../src/setup.ts";

const REPO = "https://dl.google.com/android/repository";
const XML = `<remotePackage path="cmdline-tools;latest"><archives>
<archive><complete><size>100</size><url>commandlinetools-linux-1234_latest.zip</url></complete><host-os>linux</host-os></archive>
<archive><complete><size>101</size><url>commandlinetools-mac_x86_64-1234_latest.zip</url></complete><host-os>macosx</host-os><host-arch>x64</host-arch></archive>
<archive><complete><size>102</size><url>commandlinetools-mac_arm64-1234_latest.zip</url></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive>
<archive><complete><size>103</size><url>commandlinetools-win-1234_latest.zip</url></complete><host-os>windows</host-os></archive></archives></remotePackage>
<remotePackage path="cmdline-tools;22.0"><archives>
<archive><complete><size>104</size><url>commandlinetools-mac-999_latest.zip</url></complete><host-os>macosx</host-os></archive></archives></remotePackage>
<remotePackage path="emulator"><archives>
<archive><complete><size>11</size></complete><host-os>linux</host-os><host-arch>x64</host-arch></archive>
<archive><complete><size>22</size></complete><host-os>macosx</host-os><host-arch>aarch64</host-arch></archive>
<archive><complete><size>33</size></complete><host-os>windows</host-os></archive></archives></remotePackage>
<remotePackage path="system-images;android-34;google_atd;x86_64"><archives><archive><complete><size>7</size></complete></archive></archives></remotePackage>`;

test("os/arch mapping and urls", () => {
  assert.equal(jreUrl("win32", "x64"), "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse");
  assert.equal(jreUrl("darwin", "arm64"), "https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jre/hotspot/normal/eclipse");
  assert.equal(cmdlineUrl(XML, "linux", "x64"), `${REPO}/commandlinetools-linux-1234_latest.zip`);
  assert.equal(cmdlineUrl(XML, "win32", "x64"), `${REPO}/commandlinetools-win-1234_latest.zip`);
  assert.equal(cmdlineUrl(XML, "darwin", "arm64"), `${REPO}/commandlinetools-mac_arm64-1234_latest.zip`);
  assert.equal(cmdlineUrl(XML, "darwin", "x64"), `${REPO}/commandlinetools-mac_x86_64-1234_latest.zip`);
  assert.equal(cmdlineUrl("", "darwin", "arm64"), `${REPO}/commandlinetools-mac-11076708_latest.zip`); // repository unreadable: pinned build
  assert.equal(imageAbi("arm64"), "arm64-v8a");
  assert.equal(imagePackage("31", "x64"), "system-images;android-31;google_atd;x86_64");
  assert.equal(imagePackage("36", "arm64"), "system-images;android-36;google_atd;arm64-v8a");
  assert.equal(adoptiumArch("x64"), "x64");
  assert.equal(repoOs("darwin"), "macosx");
});

test("repository xml parsing", () => {
  assert.equal(parseSize(XML, "emulator", "linux"), 11);
  assert.equal(parseSize(XML, "emulator", "macosx", "aarch64"), 22);
  assert.equal(parseSize(XML, "emulator", "windows"), 33);
  assert.equal(parseSize(XML, "system-images;android-34;google_atd;x86_64", "linux"), 7);
  assert.equal(parseSize(XML, "nope", "linux"), null);
});

test("no java anywhere: findJava says so instead of throwing", () => {
  const { PATH, Path, JAVA_HOME } = process.env;
  try {
    for (const k of ["PATH", "Path", "JAVA_HOME"]) delete process.env[k];
    process.env.PATH = join("/no", "such", "bin"); // an unset PATH makes Linux/macOS spawn search /usr/bin, where CI runners have java
    assert.equal(findJava(join("/no", "such", "sdk")), undefined);
  } finally {
    Object.assign(process.env, PATH === undefined ? {} : { PATH }, Path === undefined ? {} : { Path }, JAVA_HOME === undefined ? {} : { JAVA_HOME });
  }
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
