import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Rules file: {"rules":[{"table":"uploads","rule":"unique(key)"}, ...]}
//   unique(f)               no two rows of `table` share field f
//   count(src) + "on": f    every row of src (by field f) exists in `table`; src = http(s) URL, *.json file
//                           (relative to the rules file) or another table name in the judged source
//   noLostUpdate(id,ver)    per id, no two accepted writes were based on the same version (one overwrote the other)
export type Row = Record<string, unknown>;
export type Data = Record<string, Row[]>;
export interface Rule { table: string; rule: string; on?: string }
export interface Violation { rule: string; table: string; message: string; rows: Row[] }

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

const groupBy = (rows: Row[], key: (r: Row) => string) => {
  const m = new Map<string, Row[]>();
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
  const rows = table(data, rule.table);
  const v = (message: string, offending: Row[]): Violation => ({ rule: rule.rule, table: rule.table, message, rows: offending });

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
      expected = Array.isArray(e) ? e : table(e as Data, rule.table);
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

export async function judge(rulesFile: string, source: string) {
  const { rules } = JSON.parse(readFileSync(rulesFile, "utf8")) as { rules: Rule[] };
  const data = (await load(source)) as Data;
  const violations: Violation[] = [];
  for (const r of rules) violations.push(...(await check(data, r, dirname(resolve(rulesFile)))));
  return { ok: violations.length === 0, rules: rules.length, violations };
}
