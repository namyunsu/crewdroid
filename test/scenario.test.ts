import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fill, lastRequest, loadScenario } from "../src/scenario-actions.ts";

const dir = mkdtempSync(join(tmpdir(), "crewscn-"));
writeFileSync(join(dir, "flow.yaml"), "appId: x\n---\n- launchApp\n");
const base = { name: "t", app: { package: "com.example.app" }, repeat: 2, delayMs: [100, 200], server: { target: "http://127.0.0.1:8080" }, actions: [{ maestro: "flow.yaml" }] };
const file = (o: unknown) => { const f = join(dir, `s${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify(o)); return f; };

test("v2 scenario with maestro, intent and adb actions loads", () => {
  const sc = loadScenario(file({ ...base, actions: [{ maestro: "flow.yaml", env: { T: "{serial}-{iter}" } }, { intent: { action: "android.intent.action.VIEW", data: "x://y", extras: { a: "b", n: 1, z: true } } }, { adb: ["shell", "true"] }], drain: { idleSeconds: 10 } }));
  assert.equal(sc.kind, "app");
});

test("the shipped probe preset still loads", () => {
  assert.equal(loadScenario(join(import.meta.dirname, "..", "scenarios", "photo-upload.json")).kind, "probe");
});

test("schema errors throw before anything boots", () => {
  const bad: [unknown, RegExp][] = [
    [{ ...base, actions: [{ tap: "Save" }] }, /unknown action/],
    [{ ...base, actions: [] }, /actions/],
    [{ ...base, app: undefined }, /app/],
    [{ ...base, app: { package: "com.example.app" }, extra: 1 }, /extra|Unrecognized/i],
    [{ ...base, actions: [{ maestro: "missing.yaml" }] }, /maestro flow not found/],
    [{ ...base, server: { target: "https://x" } }, /http:\/\//],
    [{ ...base, server: undefined }, /nothing to judge/],
    [{ ...base, server: undefined, source: "x.json", rules: "flow.yaml" }, /idleSeconds watches the proxy log/],
    [{ ...base, drain: { idleSeconds: 5, waitText: "x" } }, /drain/],
    [{ ...base, delayMs: [300, 100] }, /lo <= hi/],
    [{ ...base, preset: "other" }, /unknown preset/],
    [{ preset: "probe", name: "x" }, /repeat/],
  ];
  for (const [o, re] of bad) assert.throws(() => loadScenario(file(o)), re, JSON.stringify(o));
});

test("placeholders fill serial, device index and iteration", () => {
  assert.equal(fill("{serial}/{device}/{iter}/{other}", { serial: "emulator-5580", device: 1, iter: 3 }), "emulator-5580/1/3/{other}");
});

test("idle drain counts only this device's requests to the server", () => {
  const log = join(dir, "p.jsonl");
  const e = (device: string, t: string, extra = {}) => JSON.stringify({ t, device, method: "PUT", path: "/a", bodyHash: "x", status: 201, ms: 1, ...extra });
  writeFileSync(log, [e("emulator-5580", "2026-01-01T00:00:01Z"), e("emulator-5580", "2026-01-01T00:00:09Z", { host: "connectivitycheck.gstatic.com" }), e("emulator-5582", "2026-01-01T00:00:05Z")].join("\n") + "\n");
  assert.equal(lastRequest(log, "emulator-5580"), Date.parse("2026-01-01T00:00:01Z"));
  assert.equal(lastRequest(join(dir, "none.jsonl"), "emulator-5580"), 0);
});
