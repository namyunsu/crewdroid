import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import { READS } from "./judge.ts";
import { mulberry32 } from "./net.ts";
import { CREW_RE, listProcesses } from "./platform.ts";

// T69: recording HTTP proxy on the host. Devices reach it as 10.0.2.2:<port> through the system proxy setting
// (`settings put global http_proxy`), so neither the app nor the emulator launch flags change. One listen port per device
// (base, base+1, ...) tells the requests apart: every emulator's traffic leaves the host from 127.0.0.1, so the source
// address cannot. Plain HTTP (absolute-form or origin-form) goes to --target; CONNECT (HTTPS) is tunnelled blind.
// Log: one JSON line per request (LogEntry in judge.ts) — `judge --log` runs dupSuccess / lostUpdate / lostWrite / idle on it.
export interface ProxyOptions { target: string; port?: number; devices?: string[]; log: string; loseAcks?: number; seed?: number }
export interface ProxyHandle { ports: { device: string; port: number }[]; log: string; close(): Promise<void> }

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "proxy-authorization", "transfer-encoding", "upgrade", "te", "trailer"]);
const SECRET = new Set(["authorization", "cookie", "proxy-authorization"]); // never written to the log
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 16);

function readBody(req: IncomingMessage) {
  return new Promise<Buffer>((ok, no) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c)).on("end", () => ok(Buffer.concat(chunks))).on("error", no)
      .on("close", () => { if (!req.complete) no(new Error("client closed before the request body ended")); });
  });
}

export async function startProxy({ target, port = 5590, devices = [], log, loseAcks = 0, seed = 1 }: ProxyOptions): Promise<ProxyHandle> {
  const t = new URL(target);
  if (t.protocol !== "http:") throw new Error(`--target must be http://host:port (got ${target})`);
  devices.forEach(assertSerial);
  mkdirSync(dirname(resolve(log)), { recursive: true });
  writeFileSync(log, "");
  const rnd = mulberry32(seed * 2654435761);
  const write = (e: object) => appendFileSync(log, JSON.stringify(e) + "\n");
  const sockets = new Set<Socket>();

  const listen = (device: string, p: number) => {
    const server = createServer(async (req, res) => {
      const t0 = performance.now(), at = new Date().toISOString();
      // origin-form (app pointed straight here) and absolute-form to 10.0.2.2 (the host, through the system proxy) go to --target;
      // absolute-form to any other host (e.g. the OS's captive-portal check) passes through to that host and is logged with `host`.
      const u = new URL(req.url ?? "/", "http://10.0.2.2");
      const dest = u.hostname === "10.0.2.2" ? t : u;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !SECRET.has(k) && k !== "host") headers[k] = String(v);
      const entry: Record<string, unknown> = { t: at, device, method: req.method, ...(dest === u ? { host: u.host } : {}), path: u.pathname + u.search, headers };
      const key = req.headers["idempotency-key"] ?? req.headers["x-idempotency-key"];
      if (typeof key === "string" && key) entry.key = key;
      let body: Buffer;
      try { body = await readBody(req); } catch (e) {
        write({ ...entry, bodyHash: null, status: 0, ms: Math.round(performance.now() - t0), error: (e as Error).message });
        return;
      }
      entry.bodyHash = hash(body); entry.bytes = body.length;
      if (/json/i.test(req.headers["content-type"] ?? "") && body.length <= 65536) { try { entry.json = JSON.parse(body.toString("utf8")); } catch {} }
      const fwd: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && v !== undefined) fwd[k] = v;
      fwd.host = dest.host; fwd["content-length"] = String(body.length);
      const up = request({ host: dest.hostname, port: dest.port || 80, method: req.method, path: entry.path as string, headers: fwd, timeout: 60000 }, (r) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c)).on("end", () => {
          const out = Buffer.concat(chunks);
          Object.assign(entry, { status: r.statusCode, ms: Math.round(performance.now() - t0), resHash: hash(out) });
          // NOTE: --lose-acks = the server committed the write but the answer never reaches the phone (network died in
          // between). Natural runs rarely hit that window (scenario.md: no duplicate in 6 BUGGY runs), so a check can
          // force it. Reads are never cut; the app sees a reset connection and retries like after any lost answer.
          if (res.destroyed || (!READS.has(req.method ?? "") && loseAcks > 0 && rnd() < loseAcks)) { entry.cut = true; write(entry); req.socket.destroy(); return; }
          const rh: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k) && v !== undefined) rh[k] = v;
          rh["content-length"] = String(out.length);
          res.on("close", () => { if (!res.writableFinished) entry.cut = true; write(entry); });
          res.writeHead(r.statusCode ?? 502, rh).end(out);
        });
      });
      up.on("timeout", () => up.destroy(new Error("upstream timeout (60 s)")));
      up.on("error", (e) => {
        write({ ...entry, status: 0, ms: Math.round(performance.now() - t0), error: e.message });
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" }).end(`crewdroid proxy: ${e.message}`);
      });
      up.end(body);
    });
    // HTTPS: blind tunnel, so a device behind the proxy keeps working; only the host:port is logged (ADR 0008).
    server.on("connect", (req, sock, head) => {
      const [h, pt] = (req.url ?? "").split(":");
      const at = new Date().toISOString();
      const peer = connect(Number(pt) || 443, h === "10.0.2.2" ? "127.0.0.1" : h, () => {
        write({ t: at, device, method: "CONNECT", path: req.url, bodyHash: null, status: 200, ms: 0 });
        sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        peer.write(head); peer.pipe(sock); sock.pipe(peer);
      });
      peer.on("error", (e) => { write({ t: at, device, method: "CONNECT", path: req.url, bodyHash: null, status: 0, ms: 0, error: e.message }); sock.destroy(); });
      sock.on("error", () => peer.destroy()).on("close", () => peer.destroy());
    });
    // NOTE: CONNECT tunnels (the OS keeps *.googleapis.com:443 open) are not HTTP connections, so closeAllConnections() leaves
    // them and server.close() never called back: `run --proxy` stalled in its finally and skipped down(). close() destroys every socket.
    server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
    return new Promise<Server>((ok, no) => server.once("error", no).listen(p, "127.0.0.1", () => ok(server)));
  };

  const ports = (devices.length ? devices : ["-"]).map((device, k) => ({ device, port: port + k }));
  const servers: Server[] = [];
  try { for (const x of ports) servers.push(await listen(x.device, x.port)); } catch (e) { servers.forEach((s) => s.close()); throw e; }
  return { ports, log: resolve(log), close: () => Promise.all(servers.map((s) => new Promise((ok) => { s.close(ok); sockets.forEach((x) => x.destroy()); }))).then(() => {}) };
}

// ---- device side: the system-wide proxy setting; `:0` is how Android clears it (delete leaves the old value cached) ----
export const setDeviceProxy = (serial: string, port: number) => adb(serial, ["shell", "settings", "put", "global", "http_proxy", `10.0.2.2:${port}`]);
export const clearDeviceProxy = (serial: string) => adb(serial, ["shell", "settings", "put", "global", "http_proxy", ":0"]);

// ---- detached CLI proxy: `proxy start` spawns `proxy serve` and keeps its state here ----
const STATE = () => join(tmpdir(), "crewdroid", "proxy.json");
type State = { pid: number | null; target: string; ports: { device: string; port: number }[]; log: string; started: string };
const readState = (): State | undefined => existsSync(STATE()) ? JSON.parse(readFileSync(STATE(), "utf8")) : undefined;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; } };

async function runningSerials() {
  const ports = (await listProcesses(CREW_RE)).map((p) => Number(p.cmd.match(/-port\s+(\d+)/)?.[1])).filter((p) => p > 0);
  return [...new Set(ports)].sort((a, b) => a - b).map((p) => `emulator-${p}`);
}

export async function proxyStart(o: { target: string; port?: number; devices?: string[]; log?: string; loseAcks?: number; seed?: number }) {
  const old = readState();
  if (old?.pid && alive(old.pid)) throw new Error(`a crewdroid proxy is already running (pid ${old.pid}, ports ${old.ports.map((x) => x.port).join(",")}); run \`proxy stop\` first`);
  const devices = o.devices?.length ? o.devices : await runningSerials();
  const log = resolve(o.log ?? join(tmpdir(), "crewdroid", "proxy.jsonl"));
  mkdirSync(dirname(STATE()), { recursive: true });
  rmSync(STATE(), { force: true });
  const args = [join(import.meta.dirname, "cli.ts"), "proxy", "serve", "--target", o.target, "--port", String(o.port ?? 5590), "--log", log,
    "--lose-acks", String(o.loseAcks ?? 0), "--seed", String(o.seed ?? 1), ...(devices.length ? ["--devices", devices.join(",")] : [])];
  const p = spawn(process.execPath, args,{ detached: true, stdio: "ignore", windowsHide: true });
  p.unref();
  for (let i = 0; !readState(); i++) {
    if (i > 100) { try { process.kill(p.pid!); } catch {} throw new Error("proxy did not start within 10 s (port in use?)"); }
    await new Promise((r) => setTimeout(r, 100));
  }
  const st = readState()!;
  for (const x of st.ports) if (x.device !== "-") await setDeviceProxy(x.device, x.port);
  return { ...st, note: "apps that ignore the system proxy (own proxy setting, Proxy.NO_PROXY, raw sockets, Cronet/QUIC) bypass it; see docs/adr/0008-proxy-judge.md" };
}

// Foreground worker behind `proxy start`; writes the state file once every port listens.
export async function proxyServe(o: ProxyOptions) {
  const h = await startProxy(o);
  writeFileSync(STATE(), JSON.stringify({ pid: process.pid, target: o.target, ports: h.ports, log: h.log, started: new Date().toISOString() } satisfies State));
}

// `clearDevices: false` from down(): the clones are about to die and take the setting with them (-read-only disk).
export async function proxyStop({ clearDevices = true } = {}) {
  const st = readState();
  if (!st?.pid) return { stopped: false, log: st?.log ?? null, cleared: [] as string[] };
  const cleared: string[] = [];
  if (clearDevices) for (const x of st.ports) if (x.device !== "-" && (await clearDeviceProxy(x.device).then(() => true, () => false))) cleared.push(x.device);
  if (alive(st.pid)) try { process.kill(st.pid); } catch {}
  writeFileSync(STATE(), JSON.stringify({ ...st, pid: null }));
  return { stopped: true, log: st.log, cleared };
}

export function proxyLog() {
  const st = readState();
  if (!st) throw new Error("no proxy log yet (run `proxy start` first)");
  const entries = existsSync(st.log) ? readFileSync(st.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { running: !!st.pid && alive(st.pid), log: st.log, ports: st.ports, entries };
}

export const mcpTools = [
  {
    name: "proxy", description: "Recording HTTP proxy between the emulators and your server (no app or server change): action start points every device's system proxy at it (10.0.2.2:<port+k>), stop clears it, log returns the request log. Judge the log with the judge tool's `log` input (dupSuccess / lostUpdate / lostWrite / idle).",
    input: {
      action: z.enum(["start", "stop", "log"]), target: z.string().optional().describe("start: server base URL as seen from the host, e.g. http://127.0.0.1:5599"),
      port: z.number().int().default(5590), devices: z.array(z.string()).optional().describe("default: every running crew emulator"), log: z.string().optional().describe("JSONL path"),
      loseAcks: z.number().min(0).max(1).default(0).describe("fault injection: share of writes whose answer is dropped after the server committed them"),
    },
    run: async (a: any) => {
      if (a.action === "stop") return proxyStop();
      if (a.action === "log") return proxyLog();
      if (!a.target) throw new Error("start needs target (http://host:port)");
      return proxyStart(a);
    },
  },
];
