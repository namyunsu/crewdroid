// T61 verify: node scripts/check-coexist.mjs [--base-port 5580]
// Measures whether the on-device helper (T52, holds UiAutomation until 3 s without a request) breaks mobile-mcp and Maestro.
// Boots 2 emulators, runs 6 cases on the first, writes docs/measurements/coexist.json + coexist.md. A failing case is a
// result (exit 0); exit non-zero only when a case could not run (boot failure, missing maestro).
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { down, up } from "../src/up.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";
import { startApp } from "../sample/server/app.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" } } });
const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const HELPER_IDLE_MS = 3000; // agent-helper Runner.kt idleMs
const mcpServers = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")).mcpServers;

// Minimal MCP stdio client (same as check-mcp.mjs): newline-delimited JSON-RPC, initialize + tools/call.
async function connect(name) {
  const s = mcpServers[name];
  // AI NOTE: shell:true so npx.cmd resolves on Windows; args are our own fixed strings.
  const p = spawn([s.command, ...s.args].join(" "), { shell: true, stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...s.env }, windowsHide: true });
  let buf = ""; let id = 0; const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("{")) continue;
      const m = JSON.parse(line); waiting.get(m.id)?.(m);
    }
  });
  const rpc = (method, params) => new Promise((ok, fail) => {
    const n = ++id, t = setTimeout(() => fail(new Error(`${name} ${method} timeout`)), 120000);
    waiting.set(n, (m) => { clearTimeout(t); ok(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "check-coexist", version: "0" } });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    async call(tool, args) {
      const r = await rpc("tools/call", { name: tool, arguments: args });
      return { error: !!r.error || !!r.result?.isError, text: r.error?.message ?? r.result.content.map((c) => c.text ?? "").join("\n") };
    },
    close: () => spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => p.kill()),
  };
}

// run a command to the end -> { code, out } (never rejects)
const sh = (cmd, args, opts = {}) => new Promise((ok) => {
  execFile(cmd, args, { windowsHide: true, cwd: root, shell: opts.shell, timeout: 240000, maxBuffer: 1 << 26 }, (e, out, err) => ok({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, out: `${out}\n${err}`.trim() }));
});
const crew = (...a) => sh(process.execPath, ["--import", "tsx", cli, ...a]);
const lastLine = (s) => s.split(/\r?\n/).filter(Boolean).slice(-3).join(" | ").slice(0, 300);

const cases = [];
async function measure(name, fn) { // fn -> { ok, error? }
  const t0 = Date.now();
  let r;
  try { r = await fn(); } catch (e) { r = { ok: false, error: String(e.message ?? e) }; }
  const c = { name, ok: !!r.ok, ms: Date.now() - t0, error: r.ok ? undefined : (r.error || "failed") };
  cases.push(c);
  console.log(`${c.ok ? "ok  " : "FAIL"} ${name} ${c.ms} ms${c.error ? " -- " + c.error : ""}`);
}

let server, mobile, ranAll = false;
let exitCode = 1;
try {
  if ((await sh("maestro", ["--version"], { shell: true })).code !== 0) throw new Error("maestro not found (scoop install maestro)");
  await down();
  const r = await up(2, Number(v["base-port"]));
  const target = r.devices[0].serial;
  console.log(`booted ${r.devices.map((d) => `${d.serial}=${d.profile}/API${d.api}`).join(", ")}; target ${target}`);
  mobile = await connect("mobile-mcp");
  const elements = async () => {
    const x = await mobile.call("mobile_list_elements_on_screen", { device: target });
    return { ok: !x.error && x.text.length > 0, error: x.error ? x.text.slice(0, 300) : "" };
  };

  await sleep(1000);
  await measure("a mobile-mcp 1s after up", elements);

  await adb(target, ["install", "-r", probeApk()], 120000);
  await adb(target, ["shell", "pm", "grant", PKG, "android.permission.CAMERA"]);
  server = await startApp({ port: 5599, dir: mkdtempSync(join(tmpdir(), "crewcoexist-")) });
  await sleep(8000); // helper idle: let it release UiAutomation before the timed cases

  const screen = async () => { const s = await crew("screen", target, "--json"); return { ok: s.code === 0, error: s.code ? lastLine(s.out) : "" }; };
  await screen();
  await sleep(1000);
  await measure("b mobile-mcp 1s after crewdroid screen", elements);

  await sleep(8000);
  await screen();
  await sleep(5000);
  await measure("c mobile-mcp 5s after crewdroid screen", elements);

  const maestro = () => sh("maestro", ["test", "--device", target, "flows/probe-upload.yaml"], { shell: true }).then((m) => ({ ok: m.code === 0, error: m.code ? lastLine(m.out) : "" }));
  await sleep(8000);
  await crew("tap", target, "10", "10");
  await sleep(1000);
  await measure("d maestro 1s after crewdroid tap", maestro);

  await sleep(8000);
  await crew("tap", target, "10", "10");
  await sleep(5000);
  await measure("e maestro 5s after crewdroid tap", maestro);

  await sleep(8000);
  const flow = maestro(); // f: crewdroid screen while the flow runs; record that call, then let the flow end
  await sleep(3000);
  await measure("f crewdroid screen during maestro flow", screen);
  const m = await flow;
  console.log(`maestro flow in f: ${m.ok ? "ok" : "FAIL " + m.error}`);
  cases.at(-1).maestroOk = m.ok;
  ranAll = cases.length === 6;
} catch (e) {
  console.error("could not run: " + (e.stack ?? e));
} finally {
  mobile?.close();
  await server?.close?.();
  await down().catch((e) => console.error("down failed: " + e.message));
}

if (ranAll) {
  const date = new Date().toISOString();
  writeFileSync(join(root, "docs/measurements/coexist.json"), JSON.stringify({ cases, helperIdleMs: HELPER_IDLE_MS, date }, null, 2) + "\n");
  const md = ["# 도우미(T52)와 mobile-mcp·Maestro 공존 측정 (T61)", "",
    `${date.slice(0, 10)}, 에뮬레이터 2대 \`up\` 직후 첫 기기. 도우미는 요청 없이 ${HELPER_IDLE_MS} ms 지나면 UiAutomation 을 놓는다. 원자료: \`coexist.json\`.`, "",
    "| 사례 | 결과 | 걸린 시간(ms) | 오류 |", "|---|---|---|---|",
    ...cases.map((c) => `| ${c.name} | ${c.ok ? "성공" : "실패"} | ${c.ms} | ${(c.error ?? "").replace(/\|/g, "/")} |`), ""].join("\n");
  writeFileSync(join(root, "docs/measurements/coexist.md"), md);
  console.log("wrote docs/measurements/coexist.json and coexist.md");
  exitCode = 0;
}
process.exit(exitCode);
