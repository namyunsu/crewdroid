// Maestro drives, crewdroid makes the condition and judges.
// Boots 2 devices, runs flow.yaml on both with `maestro --device`, cuts the first device's network while its flow runs,
// restores it, waits for the app's retries to land, then runs `crewdroid judge` on the sample server's export.
// Needs: Maestro on PATH, demo APK built (see README), a free port 5599.  Usage: npx tsx examples/maestro-with-network-faults/run.mjs
import { execFile, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp } from "../../sample/server/app.ts";

const root = join(import.meta.dirname, "../..");
const here = import.meta.dirname;
const apk = join(root, "demo-app/build/outputs/apk/debug/crewdroid-demo-debug.apk");
const PORT = 5599;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const crew = (...args) => new Promise((ok, fail) => execFile(process.execPath, ["--import", "tsx", join(root, "src/cli.ts"), ...args, "--json"], { cwd: root, windowsHide: true }, (e, out, err) => (e && !args.includes("judge") ? fail(new Error(err || e.message)) : ok({ code: e ? e.code : 0, out }))));
let t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s] ${m}`);
const maestro = (serial) => new Promise((ok) => spawn("maestro", ["test", "--device", serial, join(here, "flow.yaml")], { stdio: "inherit", shell: process.platform === "win32" }).on("exit", (c) => { log(`maestro ${serial} finished, exit ${c}`); ok(c); }));

const server = await startApp({ port: PORT, dir: mkdtempSync(join(tmpdir(), "crew-example-")) });
let exitCode = 1;
try {
  const { devices } = JSON.parse((await crew("up", "--count", "2")).out);
  const [a, b] = devices.map((d) => d.serial);
  await crew("install", "all", apk);

  t0 = Date.now();
  const flows = Promise.all([maestro(a), maestro(b)]);
  await sleep(6000); // flow is past launch and typing; the Save tap happens while the network is down
  log("net airplane on " + a);
  await crew("net", a, "airplane");
  await sleep(8000);
  await crew("net", a, "online");
  log("net online on " + a);
  const codes = await flows;
  console.log(`maestro exit codes: ${a}=${codes[0]} ${b}=${codes[1]}`);

  await sleep(10000); // the app keeps retrying PUT /records/:id until the server answers
  const ex = await (await fetch(`http://127.0.0.1:${PORT}/export`)).json();
  log(`server holds ${ex.records.length} records, ${ex.writes.length} writes`);
  const j = await crew("judge", "--rules", join(here, "rules.json"), "--source", `http://127.0.0.1:${PORT}/export`);
  console.log(j.out.trim());
  exitCode = j.code;
} finally {
  server.close();
  await crew("down").catch(() => {});
}
process.exit(exitCode);
