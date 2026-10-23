import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claimEmulators } from "../src/up.ts";

test("claimEmulators: a live other owner blocks, a dead one or our own run does not", () => {
  process.env.CREWDROID_LOCK = join(mkdtempSync(join(tmpdir(), "crewlock-")), "lock");
  delete process.env.CREWDROID_OWNER;
  writeFileSync(process.env.CREWDROID_LOCK, String(process.ppid)); // parent of the test process: alive
  assert.throws(() => claimEmulators(), /another crewdroid run/);
  writeFileSync(process.env.CREWDROID_LOCK, "2147483646"); // no such process
  claimEmulators();
  assert.equal(readFileSync(process.env.CREWDROID_LOCK, "utf8"), String(process.pid));
  claimEmulators(); // same owner again (e.g. down() after up() in one run)
  process.env.CREWDROID_OWNER = String(process.ppid); // child of a run that owns the lock
  writeFileSync(process.env.CREWDROID_LOCK, String(process.ppid));
  claimEmulators();
});
