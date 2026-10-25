// T10 verify: node scripts/check-scenario.mjs [--server-port 5595] [--base-port 5580]
// Seeds 1..3 x (BUGGY, clean) sample server: each runs `crewdroid run scenarios/photo-upload.json --seed N` (3 mixed emulators,
// booted and killed by the run itself). Exit 0 only if BUGGY shows >= 1 violation in >= 2 of 3 seeds and clean passes 3 of 3.
// Writes docs/measurements/scenario.json (raw reports) and scenario.md (table).
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { startApp } from "../sample/server/app.ts";
import { claimEmulators, down } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "server-port": { type: "string", default: "5595" }, "base-port": { type: "string", default: "5580" } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const scenario = "scenarios/photo-upload.json";
const runs = [];
claimEmulators(); // the `run` children inherit this run's lock (src/up.ts)

for (const seed of [1, 2, 3]) {
  for (const buggy of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), "crewscenario-"));
    const out = join(dir, "report.json");
    const server = await startApp({ port: Number(v["server-port"]), dir: join(dir, "data"), buggy });
    const code = await new Promise((ok) => {
      const p = execFile(process.execPath, [cli, "run", scenario, "--seed", String(seed), "--server-port", v["server-port"], "--base-port", v["base-port"], "--out", out],
        { cwd: root, windowsHide: true, maxBuffer: 64 * 2 ** 20 }, (e) => ok(e ? (e.code ?? 1) : 0));
      p.stdout.pipe(process.stdout); p.stderr.pipe(process.stderr);
    });
    server.close();
    let report;
    try { report = JSON.parse(readFileSync(out, "utf8")); } catch { report = { ok: false, error: `no report (exit ${code})`, judge: { violations: [] }, devices: [] }; }
    runs.push({ buggy, seed, exit: code, report });
    console.log(`== ${buggy ? "BUGGY" : "CLEAN"} seed=${seed} exit=${code} drained=${report.drained} violations=${report.judge.violations.length}`);
  }
}
await down().catch(() => {});

const buggyCaught = runs.filter((r) => r.buggy && r.report.devices.length && r.report.judge.violations.length > 0).length;
const cleanPassed = runs.filter((r) => !r.buggy && r.exit === 0 && r.report.ok).length;
const ok = buggyCaught >= 2 && cleanPassed === 3;

writeFileSync(join(root, "docs/measurements/scenario.json"), JSON.stringify(runs, null, 2) + "\n");
const rows = runs.map(({ buggy, seed, exit, report: r }) => {
  const kinds = [...new Set(r.judge.violations.map((x) => x.rule))].join(", ") || "-";
  const devs = r.devices.map((d) => `${d.profile}/API${d.api}: ${d.network.filter((x) => x.state !== "online").map((x) => x.state).join(">")}`).join("<br>");
  const log = r.devices.map((d) => `${d.log.SYNCED}/${d.log.RETRY}/${d.log.CONFLICT}`).join(" · ");
  return `| ${buggy ? "BUGGY=1" : "clean"} | ${seed} | ${exit} | ${r.drained ?? "-"} (${r.drainSeconds ?? "-"}s) | ${r.judge.violations.length} (${kinds}) | ${devs || r.error} | ${log} | ${r.wallSeconds ?? "-"} | ${r.host?.peakCpuPercent ?? "-"}% / ${r.host?.peakRamMB ?? "-"} MB |`;
});
writeFileSync(join(root, "docs/measurements/scenario.md"), `# 다자 현장 시나리오 (T10)

\`node scripts/check-scenario.mjs\` — \`crewdroid run ${scenario} --seed N\` 를 BUGGY / 정상 서버에 seed 1..3 씩. 원본: \`scenario.json\`.
기기마다 자기 지연으로 사진·읽기·수정을 ${JSON.parse(readFileSync(join(root, scenario), "utf8")).repeat}회 반복하고, 네트워크 상태 순서는 기기마다 다르다 (사이사이 online). 동시 누르기 배리어 없음.

| 서버 | seed | exit | outbox 비움 | 위반 (규칙) | 기기 / 네트워크 순서 | 기기별 SYNCED/RETRY/CONFLICT | 전체 s | 호스트 peak CPU / RAM |
|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

결과: BUGGY 위반 발견 ${buggyCaught}/3 (기준 >= 2), 정상 통과 ${cleanPassed}/3 (기준 3). 측정일 ${new Date().toISOString().slice(0, 10)}.
`);
console.log(`BUGGY caught ${buggyCaught}/3 (need >=2), clean passed ${cleanPassed}/3 (need 3)`);
console.log(ok ? "OK: scenario runs catch BUGGY and pass clean" : "FAIL");
process.exit(ok ? 0 : 1);
