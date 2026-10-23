// usage: node scripts/check-judge.mjs -> BUGGY server + bad history => judge exits 1 naming dup, missing, lost update;
// clean server + same history => judge exits 0 (409 on the stale PUT). Exit 0 only if both hold.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tsx = ["--import", "tsx"];
let fail = 0;

async function waitUp(base) {
  for (let i = 0; i < 100; i++) {
    try { await fetch(base + "/export"); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error(`server ${base} did not start`);
}

const up = (base, key, client = "c1") => fetch(base + "/upload", { method: "POST", headers: { "x-client-id": client, "idempotency-key": key }, body: "photo-" + key }).then((r) => r.status);
const put = (base, version, value, client) => fetch(base + "/records/r1", { method: "PUT", body: JSON.stringify({ version, value, clientId: client }) }).then((r) => r.status);

async function run(buggy, port) {
  const base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [...tsx, "sample/server/main.ts", String(port)], {
    env: { ...process.env, BUGGY: buggy ? "1" : "", DATA_DIR: mkdtempSync(join(tmpdir(), "crew-judge-")) }, stdio: "inherit",
  });
  try {
    await waitUp(base);
    const s = [];
    s.push(await up(base, "k1"), await up(base, "k1"));                  // client retry, same key
    s.push(...await Promise.all([up(base, "k2", "c2"), up(base, "k3", "c3")])); // two users at once
    s.push(await put(base, 0, "created", "c1"));
    s.push(...await Promise.all([put(base, 1, "edit-by-c2", "c2"), put(base, 1, "edit-by-c3", "c3")])); // both read v1
    console.log(`${buggy ? "BUGGY" : "CLEAN"} statuses: ${s.join(" ")}`);
    const j = spawnSync(process.execPath, [...tsx, "src/cli.ts", "judge", "--rules", "judge/sample.rules.json", "--source", base, "--json"], { encoding: "utf8" });
    const out = j.stdout ? JSON.parse(j.stdout) : { violations: [] };
    const rules = out.violations.map((v) => v.rule);
    console.log(`${buggy ? "BUGGY" : "CLEAN"} judge exit=${j.status} violations=${JSON.stringify(rules)}`);
    for (const v of out.violations) console.log(`  ${v.rule}: ${v.message}`);
    if (j.stderr) console.error(j.stderr);
    const want = buggy
      ? j.status === 1 && ["unique(key)", "count(acks)", "noLostUpdate(id,baseVersion)"].every((r) => rules.includes(r))
      : j.status === 0 && rules.length === 0;
    if (!want) { fail++; console.error(`FAIL: ${buggy ? "BUGGY should exit 1 with dup + missing + lost update" : "CLEAN should exit 0"}`); }
  } finally { srv.kill(); }
}

await run(true, 5596);
await run(false, 5597);
console.log(fail ? "FAIL" : "OK: BUGGY caught dup + missing + lost update; CLEAN passed");
process.exit(fail ? 1 : 0);
