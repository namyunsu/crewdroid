import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Sample server for judge runs. State lives in <dir>/db.json ({uploads, records}); every 2xx answer is also appended
// to <dir>/acks.jsonl (uploads) / writes.jsonl (record PUTs) — the "access log" the judge compares the DB against.
//   POST /upload        headers x-client-id + idempotency-key, body = photo bytes  -> {id, key, bytes}
//   PUT  /records/:id   JSON {version, value, clientId}; version = the version the client last read (0 = new)
//                       optional idempotency-key header: a key already seen for that id replays the first 200 (no new version/write line)
//   GET  /export        {uploads, records, acks, writes}
// buggy=true: no idempotency dedupe, no version check, and read-modify-write of db.json with an await in between
// (concurrent requests overwrite each other's db.json, so an acked write can vanish).
type Upload = { id: string; key: string; clientId: string; bytes: number; at: string };
type Rec = { id: string; version: number; value: unknown; clientId: string; at: string };
type Db = { uploads: Upload[]; records: Rec[]; idem?: Record<string, Record<string, Rec>> }; // idem[recordId][key] = first 200 response

export interface AppOptions { port: number; dir: string; buggy?: boolean; raceMs?: number; host?: string }

export function startApp({ port, dir, buggy = false, raceMs = 30, host = "0.0.0.0" }: AppOptions) {
  mkdirSync(dir, { recursive: true });
  const dbFile = join(dir, "db.json");
  const read = (): Db => existsSync(dbFile) ? JSON.parse(readFileSync(dbFile, "utf8")) : { uploads: [], records: [] };
  const log = (name: string, row: object) => appendFileSync(join(dir, name), JSON.stringify(row) + "\n");
  const readLog = (name: string) => existsSync(join(dir, name))
    ? readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  let mem = read();

  // Clean: synchronous mutate+save on one in-memory copy (atomic on Node's single thread).
  // Buggy: load from disk, yield, then save — the classic lost-write race.
  async function mutate<T>(fn: (db: Db) => T): Promise<T> {
    if (!buggy) { const r = fn(mem); writeFileSync(dbFile, JSON.stringify(mem)); return r; }
    const db = read();
    await new Promise((ok) => setTimeout(ok, raceMs));
    const r = fn(db);
    writeFileSync(dbFile, JSON.stringify(db));
    return r;
  }

  const send = (res: ServerResponse, code: number, body: unknown) =>
    res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
  const body = (req: IncomingMessage) => new Promise<Buffer>((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c)).on("end", () => ok(Buffer.concat(chunks))).on("error", fail);
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/export") {
      return send(res, 200, { ...(buggy ? read() : mem), acks: readLog("acks.jsonl"), writes: readLog("writes.jsonl") });
    }
    if (req.method === "POST" && url.pathname === "/upload") {
      const key = req.headers["idempotency-key"], clientId = req.headers["x-client-id"];
      if (typeof key !== "string" || !key || typeof clientId !== "string" || !clientId) return send(res, 400, { error: "x-client-id and idempotency-key headers required" });
      const bytes = (await body(req)).length;
      const up = await mutate((db) => {
        const seen = buggy ? undefined : db.uploads.find((u) => u.key === key);
        if (seen) return seen;
        const u = { id: randomUUID(), key, clientId, bytes, at: new Date().toISOString() };
        db.uploads.push(u);
        return u;
      });
      log("acks.jsonl", { id: up.id, key, clientId });
      return send(res, 200, { id: up.id, key, bytes: up.bytes });
    }
    const m = /^\/records\/([^/]+)$/.exec(url.pathname);
    if (req.method === "PUT" && m) {
      const id = decodeURIComponent(m[1]);
      let p: { version?: unknown; value?: unknown; clientId?: unknown };
      try { p = JSON.parse((await body(req)).toString("utf8")); } catch { return send(res, 400, { error: "JSON body required" }); }
      if (typeof p.version !== "number") return send(res, 400, { error: "version (number) required" });
      const base = p.version;
      const ikey = req.headers["idempotency-key"];
      const r = await mutate((db) => {
        const hit = !buggy && typeof ikey === "string" && ikey ? db.idem?.[id]?.[ikey] : undefined;
        if (hit) return { rec: hit, replay: true };
        const cur = db.records.find((x) => x.id === id);
        const curVer = cur?.version ?? 0;
        if (!buggy && base !== curVer) return { conflict: curVer };
        const next: Rec = { id, version: curVer + 1, value: p.value, clientId: String(p.clientId ?? ""), at: new Date().toISOString() };
        if (cur) Object.assign(cur, next); else db.records.push(next);
        if (!buggy && typeof ikey === "string" && ikey) ((db.idem ??= {})[id] ??= {})[ikey] = next;
        return { rec: next, replay: false };
      });
      if ("conflict" in r) return send(res, 409, { error: "stale version", version: r.conflict });
      if (!r.replay) log("writes.jsonl", { id, baseVersion: base, version: r.rec.version, clientId: r.rec.clientId, value: r.rec.value });
      return send(res, 200, r.rec);
    }
    send(res, 404, { error: "not found" });
  }

  const server = createServer((req, res) => { handle(req, res).catch((e) => send(res, 500, { error: String(e) })); });
  return new Promise<typeof server>((ok) => server.listen(port, host, () => ok(server)));
}
