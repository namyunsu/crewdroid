import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Rules file: {"rules":[{"table":"uploads","rule":"unique(key)"}, ...]}
//   unique(f)               no two rows of `table` share field f
//   count(src) + "on": f    every row of src (by field f) exists in `table`; src = http(s) URL, *.json file
//                           (relative to the rules file) or another table name in the judged source
//   noLostUpdate(id,ver)    per id, no two accepted writes were based on the same version (one overwrote the other)
// Request-log rules (T69, no "table"; `judge --log proxy.jsonl`, log written by src/proxy.ts):
//   dupSuccess()            one write (same idempotency key, else same device+method+path+body hash) got 2xx with different
//                           response bodies: the server applied it twice. An identical 2xx replay is idempotency working.
//   lostUpdate(pattern,ver) two different writes (PUT/PATCH) to one resource matching pattern (/records/:id) based on the same
//                           version both got 2xx; ver = JSON pointer into the request body (/version) or a header name (if-match)
//   lostWrite(N)            a write failed (no answer, 5xx, answer cut) and the same write was not sent again within N s
//   idle(N)                 every device in the log has sent nothing for the last N s (queue drained)
export type Row = Record<string, unknown>;
export type Data = Record<string, Row[]>;
export interface Rule { table?: string; rule: string; on?: string }
export interface LogEntry { t: string; device: string; method: string; host?: string; path: string; headers?: Record<string, string>; bodyHash: string | null; key?: string; json?: unknown; status: number; ms: number; resHash?: string; cut?: boolean; error?: string }
export interface Violation { rule: string; table: string; message: string; rows: Row[] }
const LOG_RULES = /^(dupSuccess|lostUpdate|lostWrite|idle)\(/;

export async function load(src: string, base = process.cwd()): Promise<unknown> {
  if (/^https?:\/\//.test(src)) {
    const u = new URL(src);
    if (u.pathname === "/") u.pathname = "/export";
    const r = await fetch(u);
    if (!r.ok) throw new Error(`GET ${u} -> ${r.status}`);
    return r.json();
  }
  return JSON.parse(readFileSync(resolve(base, src), "utf8"));
}

const groupBy = <T,>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
};

function table(data: Data, name: string): Row[] {
  const t = data[name];
  if (!Array.isArray(t)) throw new Error(`table '${name}' not found in source (have: ${Object.keys(data).join(", ")})`);
  return t;
}

export async function check(data: Data, rule: Rule, rulesDir = process.cwd()): Promise<Violation[]> {
  const m = /^(\w+)\(([^)]*)\)$/.exec(rule.rule.trim());
  if (!m) throw new Error(`bad rule: ${rule.rule}`);
  const [, name, argStr] = m;
  const args = argStr.split(",").map((s) => s.trim());
  const tab = rule.table ?? "";
  const rows = table(data, tab);
  const v = (message: string, offending: Row[]): Violation => ({ rule: rule.rule, table: tab, message, rows: offending });

  if (name === "unique") {
    const [f] = args;
    return [...groupBy(rows, (r) => JSON.stringify(r[f]))].filter(([, g]) => g.length > 1)
      .map(([k, g]) => v(`duplicate ${f}=${k} (${g.length} rows)`, g));
  }
  if (name === "count") {
    const [src] = args;
    const on = rule.on;
    if (!on) throw new Error(`count(${src}) needs "on": <field>`);
    let expected: Row[];
    if (/^https?:\/\//.test(src) || src.endsWith(".json")) {
      const e = await load(src, rulesDir);
      expected = Array.isArray(e) ? e : table(e as Data, tab);
    } else expected = table(data, src);
    const have = new Set(rows.map((r) => JSON.stringify(r[on])));
    const missing = [...groupBy(expected, (r) => JSON.stringify(r[on])).values()].map((g) => g[0]).filter((r) => !have.has(JSON.stringify(r[on])));
    return missing.length ? [v(`missing ${missing.length} of ${new Set(expected.map((r) => JSON.stringify(r[on]))).size} expected ${on} values (table has ${rows.length} rows)`, missing)] : [];
  }
  if (name === "noLostUpdate") {
    const [idF, verF] = args;
    return [...groupBy(rows, (r) => JSON.stringify([r[idF], r[verF]]))].filter(([, g]) => g.length > 1)
      .map(([, g]) => v(`lost update: ${g.length} writes to ${idF}=${JSON.stringify(g[0][idF])} all based on ${verF}=${JSON.stringify(g[0][verF])}; all but one were overwritten`, g));
  }
  throw new Error(`unknown rule: ${name}`);
}

const pointer = (doc: unknown, p: string) => p.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
  .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), doc);
// Safe methods: HTTP reads plus the WebDAV reads (PROPFIND, REPORT) a CalDAV/CardDAV client sends before every sync (T55).
export const READS = new Set(["GET", "HEAD", "OPTIONS", "PROPFIND", "REPORT"]);
const isWrite = (e: LogEntry) => e.method !== "CONNECT" && !READS.has(e.method);
const is2xx = (e: LogEntry) => e.status >= 200 && e.status < 300; // what the server did, even if the answer was then cut
const same = (e: LogEntry) => e.key ? `key ${e.key}` : `${e.device} ${e.method} ${e.path} ${e.bodyHash}`;
const ms = (e: LogEntry) => Date.parse(e.t);

export function checkLog(log: LogEntry[], rule: Rule, now = Date.now()): Violation[] {
  const m = /^(\w+)\(([^)]*)\)$/.exec(rule.rule.trim());
  if (!m) throw new Error(`bad rule: ${rule.rule}`);
  const [, name, argStr] = m;
  const args = argStr.split(",").map((s) => s.trim());
  const v = (message: string, rows: LogEntry[]): Violation => ({ rule: rule.rule, table: "log", message, rows: rows as unknown as Row[] });
  log = log.filter((e) => !e.host && e.method !== "CONNECT"); // only traffic to the server under test; the OS's own requests pass through too
  const writes = log.filter(isWrite);

  if (name === "dupSuccess") {
    return [...groupBy(writes.filter(is2xx), same)].map(([k, g]) => [k, g, new Set(g.map((e) => e.resHash)).size] as const).filter(([, , n]) => n > 1)
      .map(([k, g, n]) => v(`${k}: ${g.length} 2xx answers with ${n} different bodies; the server applied one write more than once`, g));
  }
  if (name === "lostUpdate") {
    const [pattern, ver] = args;
    if (!pattern || !ver) throw new Error("lostUpdate needs (<path pattern>, <JSON pointer | header>)");
    const re = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:\w+/g, "[^/]+") + "$");
    const path = (e: LogEntry) => e.path.split("?")[0];
    const version = (e: LogEntry) => ver.startsWith("/") ? pointer(e.json, ver) : e.headers?.[ver.toLowerCase()];
    const hits = writes.filter((e) => (e.method === "PUT" || e.method === "PATCH") && is2xx(e) && re.test(path(e)) && version(e) !== undefined);
    return [...groupBy(hits, (e) => JSON.stringify([path(e), version(e)]))].map(([, g]) => [g, new Set(g.map(same)).size] as const).filter(([, n]) => n > 1)
      .map(([g, n]) => v(`lost update: ${n} different writes to ${path(g[0])} all based on ${ver}=${JSON.stringify(version(g[0]))} got 2xx; all but one were overwritten`, g));
  }
  if (name === "lostWrite") {
    const n = Number(args[0]);
    if (!(n > 0)) throw new Error("lostWrite needs (<seconds>)");
    // NOTE: a failure younger than N s at judge time is not judged yet (the app may still retry); 4xx is a definite answer, not a failure.
    const failed = writes.filter((e) => e.status === 0 || e.status >= 500 || e.cut);
    const lost = failed.filter((e) => now - ms(e) >= n * 1000 && !writes.some((f) => f !== e && same(f) === same(e) && ms(f) >= ms(e) && ms(f) - ms(e) <= n * 1000));
    return lost.map((e) => v(`${e.device} ${e.method} ${e.path} ${e.status ? `http ${e.status}` : e.error ?? "no answer"}${e.cut ? " (answer cut)" : ""} was not sent again within ${n} s`, [e]));
  }
  if (name === "idle") {
    const n = Number(args[0]);
    if (!(n > 0)) throw new Error("idle needs (<seconds>)");
    const last = new Map<string, LogEntry>();
    for (const e of log) if (!last.has(e.device) || ms(e) > ms(last.get(e.device)!)) last.set(e.device, e);
    return [...last.values()].filter((e) => now - ms(e) < n * 1000)
      .map((e) => v(`${e.device} not idle: last request ${Math.round((now - ms(e)) / 100) / 10} s ago (< ${n} s)`, [e]));
  }
  throw new Error(`unknown log rule: ${name}`);
}

export const readLog = (file: string): LogEntry[] => readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// source = server data (/export URL or JSON file) for table rules; log = proxy JSONL for request-log rules. A rules file may mix both.
export async function judge(rulesFile: string, source?: string, log?: string) {
  const { rules } = JSON.parse(readFileSync(rulesFile, "utf8")) as { rules: Rule[] };
  const data = source ? (await load(source)) as Data : undefined;
  const entries = log ? readLog(log) : undefined;
  const violations: Violation[] = [];
  for (const r of rules) {
    if (LOG_RULES.test(r.rule.trim())) {
      if (!entries) throw new Error(`${r.rule} judges a request log: pass --log <proxy.jsonl>`);
      violations.push(...checkLog(entries, r));
    } else {
      if (!data) throw new Error(`${r.rule} judges server data: pass --source <url|file>`);
      violations.push(...(await check(data, r, dirname(resolve(rulesFile)))));
    }
  }
  return { ok: violations.length === 0, rules: rules.length, violations };
}
