// usage: node scripts/check-hammer.mjs -> 5 seeds x (BUGGY, clean) with users=50 repeat=20.
// Exit 0 only if BUGGY fails judge (exit 1) in >= 4 of 5 seeds and clean passes (exit 0) in 5 of 5.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tsx = ["--import", "tsx"];

async function waitUp(base) {
  for (let i = 0; i < 100; i++) {
    try { await fetch(base + "/export"); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error(`server ${base} did not start`);
}

async function run(buggy, seed, port) {
  const base = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [...tsx, "sample/server/main.ts", String(port)], {
    env: { ...process.env, BUGGY: buggy ? "1" : "", DATA_DIR: mkdtempSync(join(tmpdir(), "crew-hammer-")) }, stdio: "inherit",
  });
  try {
    await waitUp(base);
    const h = spawnSync(process.execPath, [...tsx, "src/cli.ts", "hammer", "--url", base, "--users", "50", "--repeat", "20", "--seed", String(seed), "--retry-rate", "0.1", "--jitter", "50", "--rules", "judge/sample.rules.json"], { encoding: "utf8" });
    console.log(`${buggy ? "BUGGY" : "CLEAN"} seed=${seed} exit=${h.status}\n${h.stdout.split("\n").filter(Boolean).map((l) => "  " + l.slice(0, 160)).join("\n")}`);
    if (h.stderr) console.error(h.stderr);
    return h.status;
  } finally { srv.kill(); }
}

let buggyCaught = 0, cleanPassed = 0, port = 5600;
for (let seed = 1; seed <= 5; seed++) {
  if (await run(true, seed, port++) === 1) buggyCaught++;
  if (await run(false, seed, port++) === 0) cleanPassed++;
}
console.log(`BUGGY caught ${buggyCaught}/5 (need >=4), clean passed ${cleanPassed}/5 (need 5)`);
const ok = buggyCaught >= 4 && cleanPassed === 5;
console.log(ok ? "OK" : "FAIL");
process.exit(ok ? 0 : 1);
