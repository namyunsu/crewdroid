import { test } from "node:test";
import assert from "node:assert/strict";
import { apk, manifestInfo } from "../src/apk.ts";

// aapt2 35.0.0 `dump xmltree` shape (uneven indents are real), trimmed
const NS = "http://schemas.android.com/apk/res/android";
const XML = `N: android=${NS} (line=2)
  E: manifest (line=2)
    A: ${NS}:versionCode(0x0101021b)=7
    A: ${NS}:versionName(0x0101021c)="1.2" (Raw: "1.2")
    A: package="dev.example" (Raw: "dev.example")
      E: uses-sdk (line=7)
        A: ${NS}:minSdkVersion(0x0101020c)=31
        A: ${NS}:targetSdkVersion(0x01010270)=34
      E: uses-permission (line=11)
        A: ${NS}:name(0x01010003)="android.permission.CAMERA" (Raw: "android.permission.CAMERA")
      E: application (line=26)
          E: activity (line=35)
            A: ${NS}:name(0x01010003)="dev.example.Main" (Raw: "dev.example.Main")
            A: ${NS}:exported(0x01010010)=true
              E: intent-filter (line=38)
                A: ${NS}:autoVerify(0x010104ee)=true
                  E: action (line=39)
                    A: ${NS}:name(0x01010003)="android.intent.action.VIEW" (Raw: "android.intent.action.VIEW")
                  E: category (line=41)
                    A: ${NS}:name(0x01010003)="android.intent.category.BROWSABLE" (Raw: "android.intent.category.BROWSABLE")
                  E: data (line=42)
                    A: ${NS}:scheme(0x01010027)="https" (Raw: "https")
                    A: ${NS}:host(0x01010028)="a.example" (Raw: "a.example")
                    A: ${NS}:pathPrefix(0x0101002b)="/p" (Raw: "/p")
          E: activity (line=50)
            A: ${NS}:name(0x01010003)="dev.example.Hidden" (Raw: "dev.example.Hidden")
            A: ${NS}:exported(0x01010010)=false
          E: activity (line=55)
            A: ${NS}:name(0x01010003)="dev.example.Legacy" (Raw: "dev.example.Legacy")
              E: intent-filter (line=56)
                  E: action (line=57)
                    A: ${NS}:name(0x01010003)="android.intent.action.SEND" (Raw: "android.intent.action.SEND")
`;

test("manifestInfo: package, sdk, permissions, exported activities, deep links", () => {
  const m = manifestInfo(XML);
  assert.equal(m.package, "dev.example");
  assert.equal(m.versionName, "1.2");
  assert.equal(m.versionCode, 7);
  assert.equal(m.minSdk, 31);
  assert.equal(m.targetSdk, 34);
  assert.deepEqual(m.permissions, ["android.permission.CAMERA"]);
  assert.deepEqual(m.exportedActivities, ["dev.example.Main", "dev.example.Legacy"]);
  assert.deepEqual(m.deepLinks, [{ activity: "dev.example.Main", autoVerify: true, browsable: true, schemes: ["https"], hosts: ["a.example"], paths: ["/p"] }]);
});

test("manifestInfo: no manifest element -> error", () => {
  assert.throws(() => manifestInfo("garbage"), /no <manifest>/);
});

test("apk: missing file -> error naming the file, before aapt2 runs", async () => {
  await assert.rejects(apk("missing.apk"), /apk not found: missing\.apk/);
});
