// T52 verify: node scripts/check-helper.mjs [--base-port 5580] [--idle-seconds 30]   (~8 min)
// Builds agent-helper/ and Field Notes (demo-app/), boots 3 devices (s24ultra@34, s22@31, flip7-main@36; `up` starts the
// helper) and on each: helper start cost in `up`, 20 x /tree latency, tree-vs-uiautomator text parity on the list and the
// editor sheet, `tap --text "New note"` through the CLI and through MCP, `type "안녕 pump"`, and fallback + restart after the
// helper is killed. Then idle RAM with the helper on / off / on (writes the T52 row in docs/measurements/features.md).
// Always downs its emulators.
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { adb } from "../src/adb.ts";
import { install, launch } from "../src/appctl.ts";
import { buildHelper, call, HELPER_PKG, startHelper } from "../src/helper.ts";
import { procs } from "../src/measure.ts";
import { parseUiDump } from "../src/screen.ts";
import { sleep } from "../src/snapshot.ts";
import { down, up } from "../src/up.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" }, "idle-seconds": { type: "string", default: "30" } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const APP = "dev.crewdroid.demo";
const IDLE_RELEASE_MS = 4000; // the helper lets go of UiAutomation after 3 s without a request
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const crew = (cmd, ...args) => new Promise((ok) => {
  const t0 = performance.now();
  execFile(process.execPath, ["--import", "tsx", cli, cmd, "--json", ...args], { cwd: root, windowsHide: true, maxBuffer: 64 << 20 }, (e, out, err) => {
    let json = null;
    try { json = JSON.parse(out || err); } catch { json = null; }
    ok({ code: e ? e.code ?? 1 : 0, json, err: String(err).trim().slice(0, 300), ms: Math.round(performance.now() - t0) });
  });
});
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
const texts = (nodes) => new Set(nodes.flatMap((n) => [n.text, n.desc]).filter(Boolean));
const tree = async (s) => (await call(s, "GET", "/tree"))?.nodes ?? [];
const has = (nodes, text) => nodes.some((n) => n.text === text);
// the editor sheet slides in; on a busy API 36 clone it was not there yet 1 s after the tap but was 4 s later
async function shows(s, text, ms = 3000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) if (has(await tree(s), text)) return true;
  return false;
}

// uiautomator dump texts (taken once the helper has let go of UiAutomation) must all be in the helper's tree
async function parity(s, tag) {
  await sleep(IDLE_RELEASE_MS);
  const xml = await adb(s, ["shell", "uiautomator dump /data/local/tmp/crewdroid-parity.xml >/dev/null && cat /data/local/tmp/crewdroid-parity.xml"], 60000);
  const dump = texts(parseUiDump(xml)), mine = texts(await tree(s));
  const missing = [...dump].filter((t) => !mine.has(t));
  claim(dump.size > 0 && missing.length === 0, `${tag}: uiautomator dump ran while the helper is idle (${dump.size} texts); helper tree has all of them, ${mine.size} texts${missing.length ? `; missing ${JSON.stringify(missing)}` : ""}`);
}

async function closeSheet(s) {
  for (let i = 0; i < 3 && !has(await tree(s), "New note"); i++) { await crew("key", s, "back"); await sleep(500); }
}

// summed over all devices: emulator+qemu working set, CPU % of one host core over the window
async function idle(ports, sec) {
  const re = (p) => `-port ${p}([ "]|$)`;
  const a = await Promise.all(ports.map((p) => procs(re(p)))), t0 = Date.now();
  await sleep(sec * 1000);
  const b = await Promise.all(ports.map((p) => procs(re(p))));
  const wall = (Date.now() - t0) / 1000, sum = (xs, k) => xs.reduce((n, x) => n + x[k], 0);
  return { ramMB: Math.round(sum(b, "ws") / 1048576), cpuPercent: Math.round(((sum(b, "cpu") - sum(a, "cpu")) / wall) * 1000) / 10 };
}

buildHelper();
execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["-p", join(root, "demo-app"), "assembleDebug", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });
const apk = join(root, "demo-app/build/outputs/apk/debug/crewdroid-demo-debug.apk");

let client;
try {
  await down();
  const r = await up(3, Number(v["base-port"]), ["s24ultra", "s22", "flip7-main"]);
  claim(r.devices.map((d) => d.api).sort().join(",") === "31,34,36", `devices: ${r.devices.map((d) => `${d.serial} ${d.profile}@${d.api}`).join(", ")}`);
  for (const d of r.devices) {
    const added = Math.round((d.phases.helper - d.phases.wm) * 10) / 10;
    claim(d.helper.ok && added <= 1, `${d.serial} API ${d.api} up started the helper (${JSON.stringify(d.helper)}); ready ${d.readySeconds} s, helper added ${added} s after the wm step (<= 1 s)`);
  }
  // the helper installs and connects in the background after `up`; the first command waits for it
  for (const d of r.devices) {
    const t0 = performance.now(), h = await call(d.serial, "GET", "/health");
    claim(h?.ok === true && h.api === d.api, `${d.serial} API ${d.api} helper answers ${Math.round(performance.now() - t0)} ms after up returned (first command waits for it)`);
  }
  client = new Client({ name: "check-helper", version: "0.0.1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", cli, "mcp"], env: process.env }));

  for (const d of r.devices) {
    const s = d.serial, tag = `${s} API ${d.api}`;
    const ins = await install(s, apk);
    if (!ins.ok) throw new Error(`install failed: ${JSON.stringify(ins.results)}`);
    await adb(s, ["shell", "pm", "clear", APP]);
    const l = await launch(s, APP, { restart: true });
    claim(!l.crashed, `${tag} Field Notes launched`);
    await sleep(1500);

    // 20 x /tree, back to back, host round trip included; then 3 after the idle release (reconnect included)
    const warm = [], cold = [];
    const timed = async () => { const t0 = performance.now(); return (await call(s, "GET", "/tree"))?.nodes?.length ? Math.round(performance.now() - t0) : Infinity; };
    for (let i = 0; i < 20; i++) warm.push(await timed());
    for (let i = 0; i < 3; i++) { await sleep(IDLE_RELEASE_MS); cold.push(await timed()); }
    claim(pct(warm, 50) <= 300 && pct(warm, 90) <= 600 && Math.max(...cold) <= 600, `${tag} 20 x /tree: p50 ${pct(warm, 50)} ms, p90 ${pct(warm, 90)} ms (<= 300 / 600); after idle release ${cold.join(", ")} ms (<= 600)`);

    await parity(s, `${tag} parity on the Field Notes list`);

    let x = await crew("tap", s, "--text", "New note");
    const open = await shows(s, "Save");
    claim(x.code === 0 && x.json?.via === "helper" && x.ms <= 1500 && open, `${tag} CLI tap --text "New note": ${x.ms} ms end to end (<= 1500), via ${x.json?.via}, editor open ${open} ${x.err}`);

    await parity(s, `${tag} parity on the editor sheet`);

    x = await crew("type", s, "안녕 pump", "--into", "title");
    const title = (await tree(s)).find((n) => /:id\/title$/.test(n.id));
    claim(x.code === 0 && x.json?.via === "helper" && title?.text === "안녕 pump", `${tag} type "안녕 pump" --into title: field reads ${JSON.stringify(title?.text)} via ${x.json?.via} ${x.err}`);

    await closeSheet(s);
    await sleep(500);
    const t0 = performance.now();
    const m = await client.callTool({ name: "tap", arguments: { serial: s, text: "New note" } });
    const mcpMs = Math.round(performance.now() - t0);
    let mj = {};
    try { mj = JSON.parse(m.content?.[0]?.text ?? "{}"); } catch { mj = { error: m.content?.[0]?.text }; }
    claim(!m.isError && mj.via === "helper" && mcpMs <= 500 && (await shows(s, "Save")), `${tag} MCP tap {text: "New note"}: ${mcpMs} ms tool call (<= 500), via ${mj.via}${mj.error ? ` ${mj.error}` : ""}`);
    await closeSheet(s);

    // kill the helper: the next screen falls back to uiautomator, then restarts the helper; the one after uses it again
    await adb(s, ["shell", "am", "force-stop", HELPER_PKG]);
    x = await crew("screen", s);
    claim(x.code === 0 && x.json?.via === "fallback" && has(x.json?.nodes ?? [], "New note"), `${tag} helper killed -> screen still works: via ${x.json?.via}, ${x.json?.nodes?.length} nodes, ${x.ms} ms ${x.err}`);
    x = await crew("screen", s);
    claim(x.code === 0 && x.json?.via === "helper", `${tag} next screen restarted helper: via ${x.json?.via}, ${x.ms} ms`);
    await adb(s, ["shell", "am", "force-stop", APP]);
  }

  // idle RAM: helper on (A) -> off (B) -> on (C); (A + C) / 2 vs B cancels the steady drift of a long-running emulator
  const ports = r.devices.map((d) => d.port), sec = Number(v["idle-seconds"]), mix = r.devices.map((d) => `${d.profile}@${d.api}`).join(", ");
  await sleep(30000);
  const A = await idle(ports, sec);
  for (const d of r.devices) await adb(d.serial, ["shell", "am", "force-stop", HELPER_PKG]);
  const B = await idle(ports, sec);
  for (const d of r.devices) await startHelper(d.serial, 30000);
  const C = await idle(ports, sec);
  const on = (A.ramMB + C.ramMB) / 2, dRam = Math.round(((on - B.ramMB) / B.ramMB) * 1000) / 10;
  const pss = [];
  for (const d of r.devices) {
    const mem = await adb(d.serial, ["shell", `dumpsys meminfo ${HELPER_PKG} | grep -m1 'TOTAL PSS:'; grep MemTotal /proc/meminfo`]);
    pss.push(`${d.api}: ${Math.round(Number(mem.match(/TOTAL PSS:\s+(\d+)/)?.[1]) / 1024)} of ${Math.round(Number(mem.match(/MemTotal:\s+(\d+)/)?.[1]) / 1024)} MB`);
  }
  claim(dRam <= 5, `idle RAM: helper on ${A.ramMB} / ${C.ramMB} MB, off ${B.ramMB} MB -> ${dRam >= 0 ? "+" : ""}${dRam} % (<= +5 %); CPU ${A.cpuPercent} / ${C.cpuPercent} vs ${B.cpuPercent} %; helper PSS ${pss.join(", ")}`);
  const f = join(root, "docs", "measurements", "features.md");
  const row = `| ${new Date().toISOString().slice(0, 10)} | T52 agent helper | 3 (${mix}) | ${sec} | ${B.ramMB} -> ${Math.round(on)} | ${dRam >= 0 ? "+" : ""}${dRam} % | ${B.cpuPercent} -> ${Math.round(((A.cpuPercent + C.cpuPercent) / 2) * 10) / 10} | daemon: on-device helper; before = helper stopped, after = mean of helper running before and after that window; helper PSS ${pss.join(", ")} |`;
  const keep = readFileSync(f, "utf8").split(/\r?\n/).filter((l) => !l.includes("| T52 agent helper |"));
  while (keep.at(-1) === "") keep.pop();
  writeFileSync(f, keep.join("\n") + "\n" + row + "\n");
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  await client?.close().catch(() => {});
  await down().catch((e) => console.log(`down failed: ${e.message}`));
}
if (errs.length) { console.log(`FAIL: ${errs.length} claims failed`); process.exit(1); }
console.log("OK: agent helper claims hold on API 31, 34 and 36");
