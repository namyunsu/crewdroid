import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, loadProfiles } from "../src/profiles.ts";

const images = [31, 34, 36].map((api) => ({ image: `android-${api}/google_atd`, api }));

test("galaxy.json has 10 profiles with a known densitySource", () => {
  const ps = loadProfiles();
  assert.equal(ps.length, 10);
  for (const p of ps) assert.ok(["blisk", "yesviz", "chrome", "unverified"].includes(p.densitySource), p.name);
});

test("assign: oldest API >= launch API, no repeated profile+API up to profile count", () => {
  const ps = loadProfiles();
  const s = assign(10, ps, images);
  assert.deepEqual(s.slice(0, 3).map((x) => x.api), [31, 34, 36]);
  assert.equal(new Set(s.map((x) => `${x.profile.name}@${x.api}`)).size, 10);
  const fold8 = s.find((x) => x.profile.name === "fold8-main")!;
  assert.equal(fold8.api, 36);
  assert.equal(fold8.belowMinApi, true);
});

test("assign: a repeated profile moves to the next API when one exists", () => {
  const s22 = loadProfiles().filter((p) => p.name === "s22");
  assert.deepEqual(assign(3, s22, images).map((x) => x.api), [31, 34, 36]);
});
