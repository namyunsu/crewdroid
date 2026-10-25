import { test } from "node:test";
import assert from "node:assert/strict";
import { appRun, domainName, gb, parseDfAvailKB, parseLinks, parsePerms, permName, uriArg } from "../src/app.ts";

test("parsePerms: runtime block only, stops at the first other line", () => {
  const dump = "  install permissions:\n    android.permission.INTERNET: granted=true\n  User 0: ceDataInode=1\n      runtime permissions:\n        android.permission.CAMERA: granted=false, flags=[ A|B]\n        android.permission.ACCESS_FINE_LOCATION: granted=true, flags=[]\n\nQueries:\n  x: granted=true";
  assert.deepEqual(parsePerms(dump), [{ name: "android.permission.CAMERA", granted: false }, { name: "android.permission.ACCESS_FINE_LOCATION", granted: true }]);
  assert.deepEqual(parsePerms("nothing here"), []);
});

test("parseLinks: domain states after the header only", () => {
  const out = "  dev.x.y:\n    ID: abc\n    Signatures: [83:48]\n    Domain verification state:\n      probe.crewdroid.example: approved\n      other.example: none\n    Selection state:\n      Disabled:\n        probe.crewdroid.example";
  assert.deepEqual(parseLinks(out), { "probe.crewdroid.example": "approved", "other.example": "none" });
});

test("parseDfAvailKB: Available column of the last line", () => {
  assert.equal(parseDfAvailKB("Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-39   6082144 285768   5796376   5% /data"), 5796376);
  assert.throws(() => parseDfAvailKB("garbage"), /cannot parse/);
});

test("validators", () => {
  assert.equal(permName("CAMERA"), "android.permission.CAMERA");
  assert.equal(permName("com.x.permission.Y"), "com.x.permission.Y");
  for (const v of ["camera", "a b", "", undefined, "CAM;ERA"]) assert.throws(() => permName(v), /bad permission/);
  assert.equal(domainName("probe.crewdroid.example"), "probe.crewdroid.example");
  for (const v of ["nodot", "a..b", "x y.com", undefined]) assert.throws(() => domainName(v), /bad domain/);
  assert.equal(uriArg("crewdroid://probe/x?a=1"), "crewdroid://probe/x?a=1");
  for (const v of ["http:/x", "a://b c", "a://b'; rm", "a://b$(x)", undefined]) assert.throws(() => uriArg(v), /bad uri/);
  assert.equal(gb("2"), 2);
  for (const v of ["0", "abc", "", "101", undefined]) assert.throws(() => gb(v), /GB/);
});

// bad input must reject on validation, before any adb call (emulator-59999 does not exist)
test("appRun: invalid input is refused before adb", async () => {
  const s = "emulator-59999", p = "dev.crewdroid.probe";
  await assert.rejects(appRun("5580", p, "clear", []), /emulator-<port>/);
  await assert.rejects(appRun(s, "notapkg", "clear", []), /package/);
  const cases: [string, string[], RegExp][] = [
    ["perm", ["fly", "CAMERA"], /grant\|revoke\|show/], ["perm", ["grant"], /at least one/], ["perm", ["grant", "bogus"], /bad permission/],
    ["open", ["nope"], /bad uri/], ["open", [], /bad uri/],
    ["pressure", ["standby", "bogus"], /bucket/], ["pressure", ["trim", "x"], /trim level/], ["pressure", ["nap"], /pressure needs/],
    ["fill-storage", ["lots"], /GB/], ["fill-storage", [], /GB/], ["nope", [], /unknown app item/],
  ];
  for (const [what, args, re] of cases) await assert.rejects(appRun(s, p, what, args), re, `${what} ${args.join(" ")}`);
});
