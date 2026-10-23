import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, judge } from "../src/judge.ts";

const data = {
  uploads: [{ key: "a" }, { key: "b" }, { key: "b" }, { key: "c" }],
  acks: [{ key: "a" }, { key: "b" }, { key: "b" }, { key: "c" }, { key: "d" }],
  writes: [{ id: "r1", baseVersion: 0 }, { id: "r1", baseVersion: 1 }, { id: "r1", baseVersion: 1 }, { id: "r2", baseVersion: 1 }],
};

test("unique flags the duplicated key with both rows", async () => {
  const v = await check(data, { table: "uploads", rule: "unique(key)" });
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].rows, [{ key: "b" }, { key: "b" }]);
  assert.deepEqual(await check({ uploads: [{ key: "a" }, { key: "b" }] }, { table: "uploads", rule: "unique(key)" }), []);
});

test("count flags expected rows missing from the table (table-name source)", async () => {
  const v = await check(data, { table: "uploads", rule: "count(acks)", on: "key" });
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].rows, [{ key: "d" }]);
  assert.deepEqual(await check(data, { table: "acks", rule: "count(uploads)", on: "key" }), []);
});

test("count reads a .json expected file relative to the rules dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-"));
  writeFileSync(join(dir, "expected.json"), JSON.stringify([{ key: "a" }, { key: "z" }]));
  const v = await check(data, { table: "uploads", rule: "count(expected.json)", on: "key" }, dir);
  assert.deepEqual(v[0].rows, [{ key: "z" }]);
});

test("noLostUpdate flags two writes based on the same version", async () => {
  const v = await check(data, { table: "writes", rule: "noLostUpdate(id,baseVersion)" });
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].rows, [{ id: "r1", baseVersion: 1 }, { id: "r1", baseVersion: 1 }]);
  assert.deepEqual(await check({ writes: data.writes.slice(0, 2) }, { table: "writes", rule: "noLostUpdate(id,baseVersion)" }), []);
});

test("judge runs a rules file against a file source; bad rule / table throw", async () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-"));
  writeFileSync(join(dir, "src.json"), JSON.stringify(data));
  writeFileSync(join(dir, "r.json"), JSON.stringify({ rules: [{ table: "uploads", rule: "unique(key)" }, { table: "writes", rule: "noLostUpdate(id,baseVersion)" }] }));
  const r = await judge(join(dir, "r.json"), join(dir, "src.json"));
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 2);
  await assert.rejects(check(data, { table: "uploads", rule: "nope(x)" }));
  await assert.rejects(check(data, { table: "missing", rule: "unique(x)" }));
});
