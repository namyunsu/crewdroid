import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flagScenario, loadScenario, PROXY_RULES, scenarioFile } from "../src/scenario-actions.ts";

// T77: `run --apk --flow --server` with no scenario file. No emulator, no aapt2 (package reader stubbed).
const dir = mkdtempSync(join(tmpdir(), "crewflags-"));
mkdirSync(join(dir, "flows"));
for (const f of ["app.apk", "flows/new.yaml", "flows/sync.yaml", "flows/login.yaml"]) writeFileSync(join(dir, f), "x");
const pkg = async () => "com.example.app";
const base = { apk: "app.apk", flows: ["flows/new.yaml"], server: "http://127.0.0.1:8080" };

test("flags build the defaults: count 3, repeat 5, four network states, drain idle 20 s, proxy rules", async () => {
  const sc = await flagScenario(base, dir, pkg);
  assert.equal(sc.kind, "app");
  assert.deepEqual(sc.app, { apk: "app.apk", package: "com.example.app" });
  assert.equal(sc.devices?.count, 3);
  assert.equal(sc.repeat, 5);
  assert.deepEqual(sc.network?.states, ["airplane", "nodata", "slow", "flaky"]);
  assert.deepEqual(sc.drain, { idleSeconds: 20 });
  assert.deepEqual(sc.actions, [{ maestro: "flows/new.yaml" }]);
  assert.equal(sc.rules, undefined); // runScenario then judges the proxy log with PROXY_RULES
  assert.match(PROXY_RULES, /proxy\.rules\.json$/);
});

test("all flags land in the scenario", async () => {
  const sc = await flagScenario({ ...base, flows: ["flows/new.yaml", "flows/sync.yaml"], setupFlow: "flows/login.yaml", count: 2, repeat: 3, network: false }, dir, pkg);
  assert.deepEqual(sc.actions, [{ maestro: "flows/new.yaml" }, { maestro: "flows/sync.yaml" }]);
  assert.deepEqual(sc.setup, [{ maestro: "flows/login.yaml" }]);
  assert.equal(sc.devices?.count, 2);
  assert.equal(sc.repeat, 3);
  assert.equal("network" in sc, false);
});

test("--print-scenario output loads back to an equal object", async () => {
  const sc = await flagScenario({ ...base, apk: join(dir, "app.apk"), setupFlow: "flows/login.yaml", count: 2 }, dir, pkg);
  assert.equal(sc.app.apk, "app.apk"); // absolute input printed relative to dir
  const f = join(dir, "printed.json");
  writeFileSync(f, scenarioFile(sc));
  assert.deepEqual(loadScenario(f), sc);
});

test("bad flags throw naming the flag, before anything boots", async () => {
  const bad: [object, RegExp][] = [
    [{ ...base, apk: undefined }, /--apk/],
    [{ ...base, apk: "missing.apk" }, /--apk: file not found/],
    [{ ...base, flows: [] }, /--flow/],
    [{ ...base, flows: ["flows/nope.yaml"] }, /--flow: file not found/],
    [{ ...base, setupFlow: "nope.yaml" }, /--setup-flow: file not found/],
    [{ ...base, server: undefined }, /--server/],
    [{ ...base, server: "https://x" }, /--server: .*http:\/\//],
    [{ ...base, count: 0 }, /--count/],
  ];
  for (const [f, re] of bad) await assert.rejects(flagScenario(f, dir, pkg), re, JSON.stringify(f));
});
