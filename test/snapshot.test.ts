import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KNOBS, vulkanOn } from "../src/avd.ts";
import { emulatorArgs } from "../src/snapshot.ts";

// a fake SDK so the args do not depend on the emulator installed here (37.2+ turns Vulkan back on)
const sdk = mkdtempSync(join(tmpdir(), "crew-sdk-"));
mkdirSync(join(sdk, "emulator"));
const emulatorRev = (r: string) => writeFileSync(join(sdk, "emulator", "source.properties"), `Pkg.Revision=${r}
`);
emulatorRev("37.1.11");
process.env.ANDROID_SDK_ROOT = sdk;

// T74: `up --wifi` adds -WiFiPacketStream to the -feature list of -read-only clones; without it the args stay as before.
const avd = "crew-android-34-google_atd";
const today = ["-avd", avd, "-port", "5580", "-no-window", "-no-audio", "-gpu", KNOBS.gpu, "-camera-back", "emulated", "-cores", "2", "-memory", "896",
  "-feature", "-QuickbootFileBacked,-Vulkan", "-lowram", "-read-only", "-no-boot-anim"];

test("emulatorArgs: default clone args unchanged", { skip: process.env.CREWDROID_KNOBS ? "CREWDROID_KNOBS set" : false }, () => {
  assert.deepEqual(emulatorArgs(avd, 5580, true, ["-no-boot-anim"]), today);
  assert.deepEqual(emulatorArgs(avd, 5580, true, ["-no-boot-anim"], false, false), today);
});

test("emulatorArgs: wifi merges -WiFiPacketStream into the one -feature list, clones only", { skip: process.env.CREWDROID_KNOBS ? "CREWDROID_KNOBS set" : false }, () => {
  const w = emulatorArgs(avd, 5580, true, ["-no-boot-anim"], false, true);
  assert.deepEqual(w, today.map((a) => (a === "-QuickbootFileBacked,-Vulkan" ? "-QuickbootFileBacked,-Vulkan,-WiFiPacketStream" : a)));
  assert.equal(w.filter((a) => a === "-feature").length, 1);
  // prepare() boots the base AVD writable: never with the flag
  assert.deepEqual(emulatorArgs(avd, 5580, false, [], false, true), emulatorArgs(avd, 5580, false, []));
  assert.ok(!emulatorArgs(avd, 5580, false, [], false, true).join(" ").includes("WiFiPacketStream"));
});

test("vulkanOn: kept off up to emulator 37.1, back on from 37.2 with -gpu host", { skip: process.env.CREWDROID_KNOBS ? "CREWDROID_KNOBS set" : false }, () => {
  try {
    assert.equal(vulkanOn(), false);
    for (const r of ["37.2.13", "37.3.1", "38.0.0"]) {
      emulatorRev(r);
      assert.equal(vulkanOn(), KNOBS.gpu === "host", r); // swiftshader (Linux CI) boots with -Vulkan
    }
    if (KNOBS.gpu === "host") assert.ok(emulatorArgs(avd, 5580, true).includes("-QuickbootFileBacked,Vulkan"));
  } finally { emulatorRev("37.1.11"); }
});
