import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { checkSampleServer } from "../src/scenario.ts";
import { load } from "../src/judge.ts";

test("run's probe preset stops before booting when the sample server is not up", async () => {
  const srv = createServer().listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as AddressInfo).port;
  await new Promise((r) => srv.close(r)); // a port nothing listens on
  await assert.rejects(checkSampleServer(port, 1000), /sample server not reachable at http:\/\/127\.0\.0\.1:\d+\/export: start it first/);
  await assert.rejects(load(`http://127.0.0.1:${port}`), /GET http:\/\/127\.0\.0\.1:\d+\/export failed: ECONNREFUSED/);
});

test("checkSampleServer passes when GET /export answers", async () => {
  const srv = createServer((req, res) => { res.writeHead(req.url === "/export" ? 200 : 404).end("{}"); }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try { await checkSampleServer((srv.address() as AddressInfo).port); } finally { srv.close(); }
});
