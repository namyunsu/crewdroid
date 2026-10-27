import { test } from "node:test";
import assert from "node:assert/strict";
import { assign, loadProfiles, relaunchBlackApis } from "../src/profiles.ts";
import { avdName, checkSpec, coresOf, ramMB } from "../src/avd.ts";

const images = [31, 34, 36].map((api) => ({ image: `android-${api}/google_atd`, api }));

test("galaxy.json has 11 profiles with a known densitySource", () => {
  const ps = loadProfiles();
  assert.equal(ps.length, 11);
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

test("relaunchBlackApis: API 31 is flagged (ADR 0005), 34/36 are not", () => {
  assert.deepEqual(relaunchBlackApis(), [31]);
});

test("spec: default spec keeps the old AVD name; another spec gets its own, with ram/cores read back from it", () => {
  const img = "android-36/google_atd";
  assert.equal(avdName(img), "crew-android-36-google_atd");
  assert.equal(avdName(img, { ramMB: 896, cores: 2 }), "crew-android-36-google_atd");
  const a = avdName(img, { ramMB: 2048, cores: 4 });
  assert.equal(a, "crew-android-36-google_atd-r2048-c4");
  assert.deepEqual([ramMB(a), coresOf(a)], [2048, 4]);
  assert.deepEqual([ramMB("crew-android-31-google_atd"), coresOf("crew-android-31-google_atd")], [768, 2]);
  assert.equal(avdName("android-31/google_atd", { cores: 1 }), "crew-android-31-google_atd-r768-c1");
});

test("checkSpec: limits fail with the reason, valid specs pass", () => {
  const host = { cpus: 16, freeMB: 30000 };
  checkSpec("android-36/google_atd", { ramMB: 2048, cores: 4 }, host);
  checkSpec("android-31/google_atd", { ramMB: 768 }, host);
  checkSpec("android-36/google_atd", {}, host);
  assert.throws(() => checkSpec("android-36/google_atd", { ramMB: 128 }, host), /at least 896/);
  assert.throws(() => checkSpec("android-36/google_atd", { ramMB: 9000 }, host), /at most 8192/);
  assert.throws(() => checkSpec("android-36/google_atd", { ramMB: 4096 }, { cpus: 16, freeMB: 3000 }), /free host RAM/);
  assert.throws(() => checkSpec("android-36/google_atd", { cores: 999 }, host), /1\.\.16/);
  assert.throws(() => checkSpec("android-36/google_atd", { cores: 0 }, host), /host logical CPUs/);
  assert.throws(() => checkSpec("android-36/google_atd", { cores: NaN }, host), /--cores/);
});

test("a16-lowend carries a guest spec; other profiles keep the default", () => {
  const ps = loadProfiles();
  const low = ps.find((p) => p.name === "a16-lowend")!;
  assert.deepEqual([low.cores, low.ramMB], [4, 2048]);
  assert.equal(ps.filter((p) => p.cores !== undefined || p.ramMB !== undefined).length, 1);
});
