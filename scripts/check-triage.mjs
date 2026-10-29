// T22 verify: node scripts/check-triage.mjs [--base-port 5580] [--idle-seconds 30] [--out file]
// Boots 3 mixed devices; on the API 34 one drives the probe app's check=crash|anr|jank and checks triage / screen / perf / apk
// through the CLI. Writes the 3-device idle RAM/CPU before/after row to docs/measurements/features.md (replaces its own T22 row on rerun). Always downs its emulators.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { procs } from "../src/measure.ts";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, "idle-seconds": { type: "string", default: "30" }, out: { type: "string" } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const tmp = mkdtempSync(join(tmpdir(), "crewtriage-"));
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const errs = [];
const claim = (ok, text) => { say(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
// one CLI call -> { code, json }
const crew = (cmd, ...args) => new Promise((ok) => execFile(process.execPath, ["--import", "tsx", cli, cmd, "--json", ...args], { cwd: root, windowsHide: true, maxBuffer: 64 << 20 }, (e, out, err) => {
  let json = null;
  // non-JSON output (crash, usage text) leaves json = null on purpose: every claim reading json then FAILs and prints `err`
  try { json = JSON.parse(out || err); } catch { json = null; }
  ok({ code: e ? e.code ?? 1 : 0, json, err: String(err).trim().slice(0, 300) });
}));
const probe = (serial, check) => adb(serial, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`, "--es", "check", check]);

// summed over all devices: emulator+qemu working set, CPU % of one host core over the window
async function idle(ports, sec) {
  const re = (p) => `-port ${p}([ "]|$)`;
  const a = await Promise.all(ports.map((p) => procs(re(p)))), t0 = Date.now();
  await sleep(sec * 1000);
  const b = await Promise.all(ports.map((p) => procs(re(p))));
  const wall = (Date.now() - t0) / 1000, sum = (xs, k) => xs.reduce((n, x) => n + x[k], 0);
  return { ramMB: Math.round(sum(b, "ws") / 1048576), cpuPercent: Math.round(((sum(b, "cpu") - sum(a, "cpu")) / wall) * 1000) / 10 };
}

try {
  await down();
  // 3 mixed devices for the lightness row (todo wave rule); the functional checks run on the API 34 one
  const r = await up(3, Number(v["base-port"]), ["s24ultra", "s22", "flip7-main"]);
  const ports = r.devices.map((x) => x.port), mix = r.devices.map((x) => `${x.profile}@${x.api}`).join(", ");
  const d = r.devices[0], s = d.serial;
  claim(d.api === 34, `${s} ${d.profile} API ${d.api} (idle set: ${mix})`);
  for (const x of r.devices) { await adb(x.serial, ["install", "-r", probeApk()], 120000); await adb(x.serial, ["shell", "am", "force-stop", PKG]); } // snapshot may hold an older probe build
  await sleep(60000); // CPU is still high right after boot (first run: 196 % vs 9 % later)
  const before = await idle(ports, Number(v["idle-seconds"]));
  say(`idle before: ram=${before.ramMB}MB cpu=${before.cpuPercent}%`);

  // crash
  await adb(s, ["logcat", "-c"]);
  await probe(s, "crash");
  await sleep(4000);
  let t = await crew("triage", s, "--app", PKG);
  const c = t.json?.crashes ?? [];
  claim(t.code === 0 && c.length === 1 && /ProbeActivity/.test(c[0].topFrame), `triage after check=crash: ${c.length} crash, topFrame=${c[0]?.topFrame} exception=${c[0]?.exception} | ${t.json?.summary ?? `exit ${t.code} ${t.err}`}`);

  // screen while check=anr shows its button (not blocked yet)
  await probe(s, "anr");
  await sleep(3000);
  const sc = await crew("screen", s, "--png", join(tmp, "screen.png"));
  const btn = sc.json?.nodes?.find((n) => n.desc === "probe-button" || /probe button/i.test(n.text));
  const wm = await adb(s, ["shell", "wm", "size"]);
  const [w, h] = (wm.match(/Override size: (\d+)x(\d+)/) ?? wm.match(/(\d+)x(\d+)/)).slice(1).map(Number);
  const inside = btn && btn.bounds[0] >= 0 && btn.bounds[1] >= 0 && btn.bounds[2] <= w && btn.bounds[3] <= h && btn.bounds[2] > btn.bounds[0] && btn.bounds[3] > btn.bounds[1];
  claim(sc.code === 0 && /ProbeActivity/.test(sc.json?.focus) && inside && btn.clickable, `screen: focus=${sc.json?.focus} button ${JSON.stringify(btn?.text)} bounds=[${btn?.bounds}] inside wm size ${w}x${h}, ${sc.json?.nodes?.length} nodes, png=${existsSync(join(tmp, "screen.png"))}`);

  // anr: first tap blocks the main thread 10 s, the next taps wait > 5 s for dispatch
  const [cx, cy] = btn ? [Math.round((btn.bounds[0] + btn.bounds[2]) / 2), Math.round((btn.bounds[1] + btn.bounds[3]) / 2)] : [w / 2, h / 2];
  for (let i = 0; i < 3; i++) { await adb(s, ["shell", "input", "tap", String(cx), String(cy)]); await sleep(1500); }
  await sleep(10000);
  t = await crew("triage", s, "--app", PKG);
  const anrs = t.json?.anrs ?? [], exitAnr = (t.json?.exits ?? []).some((e) => /ANR/.test(e.reason));
  claim(t.code === 0 && (anrs.length >= 1 || exitAnr), `triage after check=anr: anrs=${anrs.length} exit-info ANR=${exitAnr} traces=${Array.isArray(t.json?.anrTraces) ? t.json.anrTraces.length : t.json?.anrTraces} | ${t.json?.summary?.slice(0, 120)}`);

  // perf on the jank screen
  const p = await crew("perf", s, PKG, "--", "--es", "check", "jank");
  claim(p.code === 0 && p.json?.start?.totalTime > 0 && p.json?.frames?.frames > 0, `perf check=jank: TotalTime=${p.json?.start?.totalTime}ms frames=${p.json?.frames?.frames} jank=${p.json?.frames?.jankPercent}% p50/p90/p99=${p.json?.frames?.p50Ms}/${p.json?.frames?.p90Ms}/${p.json?.frames?.p99Ms} PSS=${p.json?.memory?.pssTotalKB}KB java=${p.json?.memory?.javaHeapKB} native=${p.json?.memory?.nativeHeapKB} ${p.err}`);
  const hp = await crew("triage", s, "--app", PKG, "--heap", join(tmp, "probe.hprof"));
  claim(hp.code === 0 && hp.json?.heap?.bytes > 0, `triage --heap: ${hp.json?.heap?.bytes} bytes pulled ${hp.err}`);
  await adb(s, ["shell", "am", "force-stop", PKG]);

  // apk (host only)
  const a = await crew("apk", probeApk());
  claim(a.code === 0 && a.json?.package === PKG && a.json?.minSdk === 31 && a.json?.permissions?.includes("android.permission.CAMERA"), `apk app-debug.apk: ${a.json?.package} minSdk=${a.json?.minSdk} targetSdk=${a.json?.targetSdk} permissions=${a.json?.permissions} exported=${a.json?.exportedActivities}`);
  const m = await crew("apk", "missing.apk");
  claim(m.code === 1 && /not found/.test(m.json?.error ?? ""), `apk missing.apk: exit ${m.code} ${m.json?.error}`);

  const bad = await crew("perf", s, PKG, "--activity", ".ProbeActivity;reboot");
  claim(bad.code === 1 && /bad --activity/.test(bad.json?.error ?? ""), `perf --activity with ';' rejected: exit ${bad.code} ${bad.json?.error}`);

  await sleep(10000);
  const after = await idle(ports, Number(v["idle-seconds"]));
  say(`idle after: ram=${after.ramMB}MB cpu=${after.cpuPercent}%`);
  const f = join(root, "docs", "measurements", "features.md");
  if (!existsSync(f)) writeFileSync(f, "# Runtime features: idle cost\n\nOne row per Todo that adds a runtime command (lightness rule: no launch flag / AVD config / KNOBS change; idle RAM over +5 % -> opt-in). RAM = emulator+qemu working set, CPU = % of one host core over the idle window, probe app stopped.\n\n| date | Todo | devices | idle s | RAM before -> after (MB) | RAM delta | CPU before -> after (%) | note |\n|---|---|---|---|---|---|---|---|\n");
  const dRam = Math.round(((after.ramMB - before.ramMB) / before.ramMB) * 1000) / 10;
  const row = `| ${new Date().toISOString().slice(0, 10)} | T22 triage/screen/perf/apk | 3 (${mix}) | ${v["idle-seconds"]} | ${before.ramMB} -> ${after.ramMB} | ${dRam >= 0 ? "+" : ""}${dRam} % | ${before.cpuPercent} -> ${after.cpuPercent} | no daemon; after = after crash/anr/jank/heap runs |`;
  // one T22 row: a rerun replaces it
  const keep = readFileSync(f, "utf8").split(/\r?\n/).filter((l) => !l.includes("| T22 triage/screen/perf/apk |"));
  while (keep.at(-1) === "") keep.pop();
  writeFileSync(f, keep.join("\n") + "\n" + row + "\n");
  say(`idle RAM delta ${dRam >= 0 ? "+" : ""}${dRam} % (T22 row written to docs/measurements/features.md)`);
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  await down().catch(() => {});
  rmSync(tmp, { recursive: true, force: true }); // ~38 MB hprof
  if (v.out) writeFileSync(v.out, lines.join("\n") + "\n");
  say(errs.length ? `FAIL: ${errs.length} claim(s)` : "OK: triage, screen, perf and apk claims hold");
  process.exit(errs.length ? 1 : 0);
}
