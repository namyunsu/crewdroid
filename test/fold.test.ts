import { test } from "node:test";
import assert from "node:assert/strict";
import { foldPair } from "../src/fold.ts";
import { loadProfiles } from "../src/profiles.ts";

test("foldPair: current size (override first) picks the fold pair; a bar phone screen is refused", () => {
  const ps = loadProfiles();
  assert.equal(foldPair("Physical size: 1080x2340\nOverride size: 904x2316", ps).profile.fold!.main.width, 1812);
  assert.equal(foldPair("Physical size: 1080x2340\nOverride size: 1080x2640", ps).profile.name, "flip6-cover");
  assert.throws(() => foldPair("Physical size: 1080x2340", ps), /not a fold\/flip screen/);
});
