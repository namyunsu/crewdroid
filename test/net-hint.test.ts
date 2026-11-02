import { test } from "node:test";
import assert from "node:assert/strict";
import { wifiHint } from "../src/net.ts";

// T83: failure hint by device. (state, wifi link up, booted with up --wifi, retry already ran)
test("wifiHint: default boot keeps the up --wifi advice", () => {
  assert.match(wifiHint("wifi", false, false, false), /boot with `up --wifi`/);
  assert.match(wifiHint("both", false, false, true), /boot with `up --wifi`/);
  assert.match(wifiHint("slow", true, false, false), /boot with `up --wifi`/);
});
test("wifiHint: --wifi device after the retry names the retry, not up --wifi", () => {
  const h = wifiHint("wifi", false, true, true);
  assert.match(h, /after the retry/);
  assert.match(h, /31 of 33/);
  assert.doesNotMatch(h, /up --wifi/);
});
test("wifiHint: --wifi device on paths without a retry gets nothing", () => {
  for (const s of ["slow", "wifi", "both"]) assert.equal(wifiHint(s, true, true, false), ""); // handover/slow/metered settle
});
test("wifiHint: unrelated states get nothing", () => {
  assert.equal(wifiHint("airplane", false, false, false), "");
  assert.equal(wifiHint("slow", false, false, false), "");
});
