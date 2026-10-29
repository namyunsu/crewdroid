import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "../sample/server/app.ts";
import { checkLog, judge, readLog, type LogEntry } from "../src/judge.ts";
import { startProxy } from "../src/proxy.ts";

const at = (s: number) => new Date(Date.UTC(2026, 9, 28, 0, 0, s)).toISOString();
const e = (o: Partial<LogEntry>): LogEntry => ({ t: at(0), device: "emulator-5580", method: "POST", path: "/upload", bodyHash: "b", status: 200, ms: 1, resHash: "r", ...o });

test("dupSuccess: same key, different 2xx bodies fires; identical replay and 409 do not", () => {
  const log = [e({ key: "k1", resHash: "a" }), e({ key: "k1", resHash: "b", cut: true }), e({ key: "k2", resHash: "c" }), e({ key: "k2", resHash: "c" }), e({ key: "k3", status: 409, resHash: "x" }), e({ key: "k3", resHash: "y" })];
  const v = checkLog(log, { rule: "dupSuccess()" });
  assert.equal(v.length, 1);
  assert.match(v[0].message, /key k1: 2 2xx answers with 2 different bodies/);
  // no key: same device+method+path+body hash is one write; another device with the same body is another user
  assert.equal(checkLog([e({ resHash: "a" }), e({ resHash: "b" }), e({ device: "emulator-5582", resHash: "c" })], { rule: "dupSuccess()" }).length, 1);
  // T55: WebDAV reads (a CardDAV client's PROPFIND / REPORT before each sync) answer differently as data changes; not writes
  assert.equal(checkLog(["PROPFIND", "REPORT"].flatMap((method) => [e({ method, status: 207, resHash: "a" }), e({ method, status: 207, resHash: "b" })]), { rule: "dupSuccess()" }).length, 0);
});

test("lostUpdate: two different writes on the same base version, by body pointer or header", () => {
  const put = (key: string, version: number, status = 200) => e({ method: "PUT", path: "/records/r1", key, json: { version }, status });
  assert.equal(checkLog([put("a", 3), put("b", 3)], { rule: "lostUpdate(/records/:id, /version)" }).length, 1);
  assert.equal(checkLog([put("a", 3), put("a", 3), put("b", 3, 409), put("c", 4)], { rule: "lostUpdate(/records/:id, /version)" }).length, 0); // retry, conflict, next version
  assert.equal(checkLog([put("a", 3), e({ method: "PUT", path: "/records/r2", key: "b", json: { version: 3 } })], { rule: "lostUpdate(/records/:id, /version)" }).length, 0); // other resource
  const hdr = (key: string) => e({ method: "PATCH", path: "/items/7?x=1", key, headers: { "if-match": "\"v1\"" } });
  assert.equal(checkLog([hdr("a"), hdr("b")], { rule: "lostUpdate(/items/:id, If-Match)" }).length, 1);
});

test("lostWrite: a failed write not resent within N s; idle: nothing from a device for N s", () => {
  const now = Date.parse(at(200));
  const log = [e({ key: "a", status: 0, error: "upstream timeout" }), e({ key: "a", t: at(30) }), e({ key: "b", status: 503 }), e({ key: "c", cut: true, t: at(10) }), e({ key: "c", t: at(200) }), e({ key: "d", status: 0, t: at(150) }), e({ key: "e", status: 409 })];
  const v = checkLog(log, { rule: "lostWrite(60)" }, now);
  assert.deepEqual(v.map((x) => (x.rows[0] as unknown as LogEntry).key), ["b", "c"]); // a retried in 30 s; c only after 190 s; d too young; 409 is an answer
  const idle = [e({ t: at(100) }), e({ device: "emulator-5582", t: at(195) }), e({ method: "GET", t: at(10) }), e({ device: "emulator-5584", method: "CONNECT", t: at(199) }), e({ device: "emulator-5584", host: "connectivitycheck.gstatic.com", t: at(199) })];
  assert.deepEqual(checkLog(idle, { rule: "idle(30)" }, now).map((x) => (x.rows[0] as unknown as LogEntry).device), ["emulator-5582"]);
  assert.equal(checkLog(idle, { rule: "idle(4)" }, now).length, 0);
  assert.throws(() => checkLog(idle, { rule: "lostWrite()" }));
});

// The sample server, unmodified, behind the proxy; requests sent the way an Android system proxy sends them (absolute-form).
async function viaProxy(buggy: boolean, loseAcks = 0) {
  const dir = mkdtempSync(join(tmpdir(), "proxy-"));
  const server = await startApp({ port: 0, dir: join(dir, "data"), buggy, raceMs: 5, host: "127.0.0.1" });
  const sp = (server.address() as { port: number }).port;
  const log = join(dir, "proxy.jsonl");
  const pp = await new Promise<number>((ok) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
  const px = await startProxy({ target: `http://127.0.0.1:${sp}`, port: pp, devices: ["emulator-5580"], log, loseAcks, seed: 1 });
  const send = (method: string, path: string, headers: Record<string, string>, body: string) => new Promise<number>((ok) => {
    const r = request({ host: "127.0.0.1", port: pp, method, path: `http://10.0.2.2:${sp}${path}`, headers: { ...headers, "content-length": String(Buffer.byteLength(body)) } }, (res) => { res.resume(); res.on("end", () => ok(res.statusCode ?? 0)); });
    r.on("error", () => ok(-1)); r.end(body);
  });
  return { dir, log, sp, pp, send, close: async () => { await px.close(); server.close(); } };
}

test("proxy + sample server: BUGGY retry after a lost answer is dupSuccess, clean replay is not; two edits on one base = lostUpdate only on BUGGY", async () => {
  const rules = join(mkdtempSync(join(tmpdir(), "proxy-rules-")), "r.json");
  writeFileSync(rules, JSON.stringify({ rules: [{ rule: "dupSuccess()" }, { rule: "lostUpdate(/records/:id, /version)" }] }));
  const kinds: Record<string, string[]> = {};
  for (const buggy of [true, false]) {
    const p = await viaProxy(buggy);
    const up = { "x-client-id": "c1", "idempotency-key": "k1", "content-type": "image/jpeg" };
    assert.equal(await p.send("POST", "/upload", up, "photo"), 200);
    assert.equal(await p.send("POST", "/upload", up, "photo"), 200); // the app's retry after it saw no answer
    const edit = (key: string, value: string) => p.send("PUT", "/records/r1", { "idempotency-key": key, "content-type": "application/json" }, JSON.stringify({ version: 0, value, clientId: key }));
    await edit("e1", "a"); await edit("e2", "b");
    await p.close();
    const r = await judge(rules, undefined, p.log);
    kinds[buggy ? "buggy" : "clean"] = r.violations.map((v) => v.rule);
    const lines = readLog(p.log);
    assert.equal(lines.length, 4);
    assert.ok(lines.every((l) => l.device === "emulator-5580" && l.path.startsWith("/") && l.bodyHash && l.ms >= 0));
    assert.equal(lines[2].json && (lines[2].json as { version: number }).version, 0);
  }
  assert.deepEqual(kinds, { buggy: ["dupSuccess()", "lostUpdate(/records/:id, /version)"], clean: [] });
});

test("--lose-acks: the server commits, the client sees a reset, the log says cut; reads are never cut", async () => {
  const p = await viaProxy(false, 1);
  assert.equal(await p.send("POST", "/upload", { "x-client-id": "c", "idempotency-key": "k" }, "x"), -1);
  assert.equal(await p.send("GET", "/export", {}, ""), 200);
  await p.close();
  const [w, g] = readLog(p.log);
  assert.equal(w.status, 200); assert.equal(w.cut, true);
  assert.equal(g.cut, undefined);
});

test("absolute-form to another host passes through to that host (not --target) and is logged with host", async () => {
  const other = createServer((_, res) => res.writeHead(204).end());
  await new Promise<void>((ok) => other.listen(0, "127.0.0.1", ok));
  const op = (other.address() as { port: number }).port;
  const p = await viaProxy(false);
  const code = await new Promise<number>((ok) => request({ host: "127.0.0.1", port: p.pp, path: `http://127.0.0.1:${op}/generate_204` }, (res) => { res.resume(); ok(res.statusCode ?? 0); }).end());
  await p.close(); other.close();
  assert.equal(code, 204);
  assert.deepEqual(readLog(p.log).map((l) => [l.host, l.path, l.status]), [[`127.0.0.1:${op}`, "/generate_204", 204]]);
});

test("CONNECT is tunnelled to the requested host (10.0.2.2 = host loopback) and logged without content; close() ends open tunnels", { timeout: 10000 }, async () => {
  const tcp = createNetServer((s) => s.pipe(s));
  await new Promise<void>((ok) => tcp.listen(0, "127.0.0.1", ok));
  const tp = (tcp.address() as { port: number }).port;
  const p = await viaProxy(false);
  const got = await new Promise<string>((ok) => {
    const s = connect(p.pp, "127.0.0.1", () => s.write(`CONNECT 10.0.2.2:${tp} HTTP/1.1\r\nHost: 10.0.2.2:${tp}\r\n\r\n`));
    let buf = "";
    s.on("data", (d) => { buf += d; if (buf.includes("\r\n\r\n") && !buf.includes("ping")) s.write("ping"); if (buf.endsWith("ping")) ok(buf); });
  });
  assert.match(got, /^HTTP\/1.1 200/);
  await p.close(); // the tunnel is still open here; close() used to wait for it forever
  tcp.close();
  assert.deepEqual(readLog(p.log).map((l) => [l.method, l.path, l.status]), [["CONNECT", `10.0.2.2:${tp}`, 200]]);
});
