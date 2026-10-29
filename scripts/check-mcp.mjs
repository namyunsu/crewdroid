// T06 verify: node scripts/check-mcp.mjs [--base-port 5580]
// Needs `crewdroid up` running. Starts mobile-mcp and `maestro mcp` exactly as .mcp.json declares them (stdio JSON-RPC),
// checks the crewdroid emulator serials show up in both, snapshots the probe app on one serial, and records how
// maestro's `run` picks a device. Exit 0 only if every claim holds.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { adb } from "../src/adb.ts";
import { PKG, probeApk, sleep } from "../src/snapshot.ts";

const { values: v } = parseArgs({ options: { "base-port": { type: "string", default: "5580" } } });
const errs = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const servers = JSON.parse(readFileSync(new URL("../.mcp.json", import.meta.url), "utf8")).mcpServers;

// Minimal MCP stdio client: newline-delimited JSON-RPC, enough for initialize + tools/call.
async function connect(name) {
  const s = servers[name];
  // NOTE: shell:true so npx.cmd / the scoop maestro shim resolve on Windows; args are our own fixed strings.
  const p = spawn([s.command, ...s.args].join(" "), { shell: true, stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...s.env }, windowsHide: true });
  let buf = ""; let id = 0; const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("{")) continue; // server logs on stdout would not be JSON
      const m = JSON.parse(line); waiting.get(m.id)?.(m);
    }
  });
  const rpc = (method, params) => new Promise((ok, fail) => {
    const n = ++id, t = setTimeout(() => fail(new Error(`${name} ${method} timeout`)), 120000);
    waiting.set(n, (m) => { clearTimeout(t); ok(m); });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "check-mcp", version: "0" } });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    // -> { error: bool, text: string }
    async call(tool, args) {
      const r = await rpc("tools/call", { name: tool, arguments: args });
      return { error: !!r.error || !!r.result?.isError, text: r.error?.message ?? r.result.content.map((c) => c.text ?? "").join("\n") };
    },
    close: () => spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => p.kill()),
  };
}

// crewdroid serials = consecutive even ports from the base port that answer adb (never the USB phone or other emulators).
const serials = [];
for (let port = Number(v["base-port"]); ; port += 2) {
  const s = `emulator-${port}`;
  if (!(await adb(s, ["get-state"], 5000).then((o) => o === "device", () => false))) break;
  serials.push(s);
}
claim(serials.length >= 2, `crewdroid emulators running: ${serials.join(",") || "none"} (run crewdroid up --count 2 first)`);
if (serials.length < 2) process.exit(1);

for (const s of serials) { // `up` boots the snapshot's older probe app: install the current APK
  await adb(s, ["install", "-r", probeApk()], 120000);
  await adb(s, ["shell", "pm", "grant", PKG, "android.permission.CAMERA"]);
}

const mobile = await connect("mobile-mcp");
const maestro = await connect("maestro");
try {
  const list = await mobile.call("mobile_list_available_devices", {});
  const ids = list.error ? [] : JSON.parse(list.text).devices.map((d) => d.id);
  claim(serials.every((s) => ids.includes(s)), `mobile-mcp lists ${serials.join(",")} (all ids: ${ids.join(",")})`);

  const target = serials[0];
  let snap = { text: "" };
  for (let i = 0; i < 5 && !/android:id\/content/.test(snap.text); i++) { // the probe window is short-lived: relaunch until captured
    const launched = await mobile.call("mobile_launch_app", { device: target, packageName: PKG });
    if (launched.error) { console.log(launched.text); break; }
    await sleep(500);
    snap = await mobile.call("mobile_list_elements_on_screen", { device: target });
  }
  console.log(`--- accessibility snapshot of ${PKG} on ${target}\n${snap.text}\n---`);
  claim(!snap.error && /android:id\/content/.test(snap.text), `mobile-mcp accessibility snapshot of the probe app on ${target}`);

  const ml = await maestro.call("list_devices", {});
  const devs = ml.error ? [] : JSON.parse(ml.text).devices;
  const live = devs.filter((d) => d.connected).map((d) => d.device_id);
  claim(serials.every((s) => live.includes(s)), `maestro list_devices has ${serials.join(",")} connected (connected: ${live.join(",")})`);

  const flow = `appId: ${PKG}\n---\n- launchApp`;
  const noId = await maestro.call("run", { yaml: flow });
  claim(noId.error && /device_id is required/.test(noId.text), `maestro run without device_id is rejected: '${noId.text}'`);
  const other = serials[1];
  const withId = await maestro.call("run", { device_id: other, yaml: flow });
  claim(!withId.error && JSON.parse(withId.text).device_id === other, `maestro run device_id=${other} ran on that serial: ${withId.text}`);
} finally {
  mobile.close(); maestro.close();
}
if (errs.length) { console.error("FAIL:\n" + errs.join("\n")); process.exit(1); }
console.log("OK: mobile-mcp and maestro mcp reach the crewdroid emulators");
process.exit(0);
