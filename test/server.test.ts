import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { startApp } from "../sample/server/app.ts";

type Put = (key?: string, version?: number) => Promise<{ status: number; body: any }>;

async function withServer(buggy: boolean, fn: (put: Put, exp: () => Promise<any>) => Promise<void>) {
  const srv = await startApp({ port: 0, dir: mkdtempSync(join(tmpdir(), "crew-srv-")), buggy, raceMs: 1, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const put: Put = async (key, version = 0) => {
    const r = await fetch(`${base}/records/r1`, { method: "PUT", headers: key ? { "idempotency-key": key } : {}, body: JSON.stringify({ version, value: "v", clientId: "c" }) });
    return { status: r.status, body: await r.json() };
  };
  try { await fn(put, async () => (await fetch(base + "/export")).json()); } finally { srv.close(); srv.closeAllConnections(); }
}

test("normal: same key twice -> same response, one version, one write line", () => withServer(false, async (put, exp) => {
  const a = await put("k1"), b = await put("k1");
  assert.deepEqual(b, a);
  assert.equal(a.body.version, 1);
  assert.equal((await exp()).writes.length, 1);
}));

test("normal: different keys -> two versions", () => withServer(false, async (put) => {
  const a = await put("k1", 0), b = await put("k2", 1);
  assert.deepEqual([a.status, b.status, b.body.version], [200, 200, 2]);
}));

test("normal: no key -> unchanged (stale retry conflicts)", () => withServer(false, async (put) => {
  await put(undefined, 0);
  assert.equal((await put(undefined, 0)).status, 409);
}));

test("BUGGY: same key twice -> two versions", () => withServer(true, async (put) => {
  const a = await put("k1"), b = await put("k1");
  assert.deepEqual([a.body.version, b.body.version], [1, 2]);
}));
