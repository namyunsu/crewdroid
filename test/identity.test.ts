import { test } from "node:test";
import assert from "node:assert/strict";
import { cellConnected } from "../src/identity.ts";

// NetworkAgentInfo lines from an API 34 clone on macOS, before and after the RIL restart (2026-11-03)
test("cellConnected tells a stuck cellular data call from a connected one", () => {
  const stuck = "  NetworkAgentInfo{network{100}  handle{432902426637}  ni{MOBILE[HSPA] CONNECTING extra: epc.tmobile.com} created=2026-11-03T06:14:16.856Z";
  const up = "  NetworkAgentInfo{network{101}  handle{437197393933}  ni{MOBILE[HSPA] CONNECTED extra: epc.tmobile.com} created=2026-11-03T06:55:02.101Z";
  const wifi = "  NetworkAgentInfo{network{102}  handle{441492361229}  ni{WIFI CONNECTED extra: } created=2026-11-03T06:55:09.000Z";
  assert.equal(cellConnected(stuck), false);
  assert.equal(cellConnected(`${stuck}\n${wifi}`), false);
  assert.equal(cellConnected(up), true);
  assert.equal(cellConnected(""), false);
});
