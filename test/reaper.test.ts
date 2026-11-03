import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { idleMinutes, reap } from "../src/reaper.ts";

test("idleMinutes: flag, then CREWDROID_IDLE_MINUTES, then 60; 0 = never", () => {
  const env = process.env.CREWDROID_IDLE_MINUTES;
  try {
    delete process.env.CREWDROID_IDLE_MINUTES;
    assert.equal(idleMinutes(), 60);
    assert.equal(idleMinutes("0"), 0);
    process.env.CREWDROID_IDLE_MINUTES = "15";
    assert.equal(idleMinutes(), 15);
    assert.equal(idleMinutes(90), 90);
    assert.throws(() => idleMinutes("-1"), /0 \(never\) or more/);
    assert.throws(() => idleMinutes("soon"), /0 \(never\) or more/);
  } finally {
    if (env === undefined) delete process.env.CREWDROID_IDLE_MINUTES; else process.env.CREWDROID_IDLE_MINUTES = env;
  }
});

// Both cases end before any down: the watcher stops itself without touching emulators.
test("reap exits once the devices' console ports stop answering, or when a newer up replaced it", async () => {
  const pid = join(mkdtempSync(join(tmpdir(), "crew-reap-")), "reaper.pid");
  const srv = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as AddressInfo).port;
  await new Promise((r) => srv.close(r)); // nothing listens there now
  assert.equal(await reap([port], 60, undefined, 10, pid), "devices gone");

  const live = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => live.once("listening", r));
  try {
    const run = reap([(live.address() as AddressInfo).port], 60, undefined, 20, pid);
    setTimeout(() => writeFileSync(pid, "1"), 50);
    assert.equal(await run, "replaced by a newer up");
  } finally { live.close(); }
});
