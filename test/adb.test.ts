import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSerial, adb } from "../src/adb.ts";

test("emulator serial accepted", () => assert.equal(assertSerial("emulator-5580"), "emulator-5580"));

for (const bad of ["R3CT1234567", "192.168.0.2:5555", "", "emulator-", "emulator-55a0", "xemulator-5580"]) {
  test(`rejects '${bad}'`, async () => {
    assert.throws(() => assertSerial(bad));
    await assert.rejects(adb(bad, ["get-state"]));
  });
}
