// T37 verify: node scripts/check-install.mjs [--base-port 5580]
// Boots 1 device and drives install / launch / logs only through the CLI. Always downs its emulator.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" } } });
const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const tmp = mkdtempSync(join(tmpdir(), "crewinstall-"));
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const crew = (cmd, ...args) => new Promise((ok) => execFile(process.execPath, ["--import", "tsx", cli, cmd, "--json", ...args], { windowsHide: true, maxBuffer: 64 << 20 }, (e, out, err) => {
  let json = null;
  try { json = JSON.parse(out || err); } catch { json = null; }
  ok({ code: e ? e.code ?? 1 : 0, json, err: String(err).trim().slice(0, 300) });
}));

try {
  await down();
  const s = (await up(1, Number(v["base-port"]))).devices[0].serial;

  let r = await crew("install", s, probeApk());
  claim(r.code === 0 && r.json?.results?.[0]?.result === "Success" && r.json.results[0].package === PKG, `install probe APK: ${JSON.stringify(r.json?.results?.[0])}`);

  const junk = join(tmp, "junk.apk");
  writeFileSync(junk, "not an apk");
  r = await crew("install", s, junk);
  claim(r.code === 1 && r.json?.results?.[0]?.ok === false && /INSTALL_|Failure|failed/i.test(r.json.results[0].detail ?? r.json.results[0].result), `install non-APK exits 1 with adb's text: ${r.json?.results?.[0]?.result} | ${(r.json?.results?.[0]?.detail ?? "").slice(0, 120)}`);

  r = await crew("launch", s, PKG);
  claim(r.code === 0 && r.json?.component === `${PKG}/.ProbeActivity` && r.json.totalTime > 0 && r.json.crashed === false, `launch resolves the activity: ${r.json?.component} TotalTime=${r.json?.totalTime} crashed=${r.json?.crashed}`);

  // logs of the running app, before the crash run replaces its pid
  await sleep(1000);
  r = await crew("logs", s, PKG, "--since", "2m", "--level", "I");
  const pids = new Set((r.json?.lines ?? []).map((l) => l.pid));
  claim(r.code === 0 && r.json.source === "pid" && r.json.lines.some((l) => l.tag === "CrewProbe") && pids.size === 1 && pids.has(r.json.pid) && r.json.lines.every((l) => "VDIWEF".indexOf(l.level) >= 2),
    `logs --since 2m --level I: ${r.json?.count} lines, pids=[${[...pids]}] (app pid ${r.json?.pid}), has CrewProbe`);

  r = await crew("launch", s, PKG, "--restart", "--", "--es", "check", "crash");
  claim(r.code === 0 && r.json?.crashed === true && /IllegalStateException/.test(r.json.crash?.exception ?? ""), `launch --restart check=crash: crashed=${r.json?.crashed} ${r.json?.crash?.exception}`);

  r = await crew("logs", s, PKG, "--since", "2m");
  claim(r.code === 0 && r.json.source === "last-pid" && /not running/.test(r.json.note ?? "") && r.json.count > 0, `logs of the dead app fall back to its last pid ${r.json?.pid}: ${r.json?.count} lines, note=${r.json?.note}`);

  r = await crew("logs", s, "dev.crewdroid.nothere");
  claim(r.code === 1 && /not installed/.test(r.json?.error ?? ""), `logs for a package that is not installed exits 1: ${r.json?.error}`);

  r = await crew("install", "all", probeApk(), "--grant");
  claim(r.code === 0 && r.json?.results?.length === 1 && r.json.results[0].result === "Success", `install all --grant: ${r.json?.results?.length} device(s) ${r.json?.results?.[0]?.result}`);
} finally {
  await down().catch((e) => console.log(`down failed: ${e.message}`));
  rmSync(tmp, { recursive: true, force: true });
}
if (errs.length) { console.log(`FAIL: ${errs.length} claims failed`); process.exit(1); }
console.log("OK: install, launch and logs claims hold");
