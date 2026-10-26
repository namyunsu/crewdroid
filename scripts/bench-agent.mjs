// T49 verify: node scripts/bench-agent.mjs (boots 1 device + a stock AVD 3 times; ~15 min)
// Agent driving benchmark, deterministic (no LLM). Task: open the Field Notes demo app, add a note "Fix pump #3", confirm it
// appears in the list. Same device (s24ultra, API 34), 5 runs per path, A and B interleaved, app data + server reset before
// each run (untimed). Both paths call the same crewdroid MCP server over stdio, so only the way of observing differs:
//   A (tree):       launch, screen (JSON tree), tap --text, type --into, tap --text, screen (confirm), logs (confirm SAVED)
//   B (screenshot): launch, then a shot (screencap -p PNG) after every action, taps by x,y. The x,y come from an untimed
//                   uiautomator dump standing in for the vision model's "find it in the image" (favours B: no misses, no time).
// Per step: wall time, observation payload bytes, estimated model input tokens (text chars/4; image: Anthropic vision formula).
// Then "time to first usable device": crewdroid `up` (1 device) vs a fresh stock google_atd AVD (Android Studio default
// flags, with a window): first boot, cold boot (-no-snapshot-load) and quick boot. The stock AVD is deleted afterwards.
// Writes docs/measurements/agent-bench.json and agent-bench.md.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { adb } from "../src/adb.ts";
import { avdHome, imagePackage } from "../src/avd.ts";
import { launchEmulator } from "../src/emulator.ts";
import { findNodes } from "../src/input.ts";
import { listProcesses } from "../src/platform.ts";
import { screen } from "../src/screen.ts";
import { sdkRoot } from "../src/sdk.ts";
import { pngSize } from "../src/shot.ts";
import { down } from "../src/up.ts";
import { startApp } from "../sample/server/app.ts";

const root = join(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "crewbench-"));
const PKG = "dev.crewdroid.demo", PORT = 5596, RUNS = 5, NOTE = "Fix pump #3", PROFILE = "s24ultra", API = 34;
const STOCK = "bench-stock-34", STOCK_PORT = 5592;
const DOC = "https://docs.claude.com/en/docs/build-with-claude/vision";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

// Anthropic vision: an image whose long edge is > 1568 px (or > ~1600 tokens) is scaled down keeping the aspect ratio first;
// then tokens ≈ width * height / 750.
function imageTokens(w, h) {
  const s = Math.min(1, 1568 / Math.max(w, h));
  return Math.round(Math.min(1600, (w * s * h * s) / 750));
}
const textTokens = (chars) => Math.ceil(chars / 4);

// 1. APK (Field Notes, T48)
execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["-p", join(root, "demo-app"), "assembleDebug", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });
const apk = join(root, "demo-app/build/outputs/apk/debug/crewdroid-demo-debug.apk");

let client, serial, server, upSeconds, upAgainSeconds, dev;
const failures = { A: [], B: [] };

// One MCP call, timed; what the model would read = every content item of the result.
async function call(name, args, timeout = 120000) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const seconds = (Date.now() - t0) / 1000;
  let bytes = 0, tokens = 0, chars = 0;
  const images = [];
  for (const c of r.content ?? []) {
    if (c.type === "text") { chars += c.text.length; bytes += Buffer.byteLength(c.text); tokens += textTokens(c.text.length); }
    if (c.type === "image") {
      const png = Buffer.from(c.data, "base64"), { width, height } = pngSize(png), t = imageTokens(width, height);
      images.push({ width, height, bytes: png.length, tokens: t });
      bytes += png.length; tokens += t;
    }
  }
  const text = r.content?.find((c) => c.type === "text")?.text ?? "";
  return { name, seconds, bytes, tokens, chars, images, isError: !!r.isError, text };
}

// Untimed: where the vision model would have to find `query` in the screenshot (centre of the matching node).
async function locate(query) {
  const nodes = (await screen(serial)).nodes, m = findNodes(nodes, query, "text");
  if (m.length !== 1) throw new Error(`locate '${query}': ${m.length} matches`);
  const [l, t, r, b] = m[0].bounds;
  return { x: Math.round((l + r) / 2), y: Math.round((t + b) / 2) };
}

// Untimed reset: fresh server data, app data cleared, so every run starts from the same empty list.
async function reset(i) {
  if (server) await new Promise((ok) => server.close(ok));
  server = await startApp({ port: PORT, dir: join(work, `server-${i}`) });
  await adb(serial, ["shell", `pm clear ${PKG}`]);
  await sleep(1000);
}

const launchArgs = () => ({ serial, pkg: PKG, restart: true, extras: ["--es", "server", `http://10.0.2.2:${PORT}`] });

async function runA() {
  const steps = [];
  const step = async (label, name, args) => { const s = await call(name, args); steps.push({ step: label, ...s }); if (s.isError) throw new Error(`${label}: ${s.text.slice(0, 300)}`); return s; };
  await step("launch", "launch", launchArgs());
  await step("observe (tree)", "screen", { serial });
  await step("tap New note", "tap", { serial, text: "New note" });
  await step("type into title", "type", { serial, text: NOTE, into: "title" });
  await step("tap Save", "tap", { serial, text: "Save" });
  const s = await step("confirm (tree)", "screen", { serial });
  const l = await step("confirm (logs)", "logs", { serial, pkg: PKG, since: "1m" });
  const inList = JSON.parse(s.text).nodes.some((n) => n.text === NOTE), saved = JSON.parse(l.text).lines.some((x) => /^SAVED /.test(x.message));
  if (!inList || !saved) throw new Error(`confirm: inList=${inList} SAVED=${saved}`);
  return steps;
}

async function runB() {
  const steps = [];
  let untimed = 0;
  const step = async (label, name, args) => { const s = await call(name, args); steps.push({ step: label, ...s }); if (s.isError) throw new Error(`${label}: ${s.text.slice(0, 300)}`); return s; };
  const find = async (q) => { const t0 = Date.now(); const p = await locate(q); untimed += (Date.now() - t0) / 1000; return p; };
  const png = (k) => join(work, `b-${k}.png`);
  await step("launch", "launch", launchArgs());
  await step("observe (shot)", "shot", { serial, file: png(1) });
  await step("tap New note (x,y)", "tap", { serial, ...(await find("New note")) });
  await step("observe (shot)", "shot", { serial, file: png(2) }); // title field has focus: the model sees the cursor there
  await step("type", "type", { serial, text: NOTE });
  await step("observe (shot)", "shot", { serial, file: png(3) });
  await step("tap Save (x,y)", "tap", { serial, ...(await find("Save")) });
  await step("confirm (shot)", "shot", { serial, file: png(4) });
  const t0 = Date.now();
  const inList = (await screen(serial)).nodes.some((n) => n.text === NOTE); // what the model would have to read in the last image
  untimed += (Date.now() - t0) / 1000;
  if (!inList) throw new Error(`confirm: '${NOTE}' not on screen`);
  return Object.assign(steps, { untimed });
}

function summary(path, runs) {
  const ok = runs.filter((r) => r.ok);
  const per = (f) => r2(mean(ok.map((r) => f(r.steps))));
  const labels = ok[0]?.steps.map((s) => s.step) ?? [];
  return {
    path, runs: runs.length, ok: ok.length,
    tokensPerTask: Math.round(mean(ok.map((r) => r.steps.reduce((a, s) => a + s.tokens, 0)))),
    secondsPerTask: per((st) => st.reduce((a, s) => a + s.seconds, 0)),
    toolCallsPerTask: per((st) => st.length),
    payloadBytesPerTask: Math.round(mean(ok.map((r) => r.steps.reduce((a, s) => a + s.bytes, 0)))),
    observeCallsPerTask: per((st) => st.filter((s) => /observe|confirm/.test(s.step)).length),
    images: ok[0]?.steps.flatMap((s) => s.images).slice(0, 1) ?? [],
    steps: labels.map((label, i) => ({
      step: label, tool: ok[0].steps[i].name,
      seconds: r2(mean(ok.map((r) => r.steps[i].seconds))), bytes: Math.round(mean(ok.map((r) => r.steps[i].bytes))), tokens: Math.round(mean(ok.map((r) => r.steps[i].tokens))),
    })),
    perRun: runs.map((r) => ({ run: r.run, ok: r.ok, seconds: r2(r.steps.reduce((a, s) => a + s.seconds, 0)), tokens: r.steps.reduce((a, s) => a + s.tokens, 0), bytes: r.steps.reduce((a, s) => a + s.bytes, 0), calls: r.steps.length, ...(r.untimed ? { untimedLocateSeconds: r2(r.untimed) } : {}), ...(r.error ? { error: r.error } : {}) })),
    failures: failures[path],
  };
}

// --- stock AVD (Android Studio defaults), measured after crewdroid is down ---
const avdmanager = () => join(sdkRoot(), "cmdline-tools", "latest", "bin", process.platform === "win32" ? "avdmanager.bat" : "avdmanager");
function avdm(args, stdin = "") {
  return new Promise((ok, no) => {
    // AI NOTE: .bat needs a shell on Windows (same as src/avd.ts)
    const p = spawn(`"${avdmanager()}"`, args, { shell: process.platform === "win32", windowsHide: true });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (c) => (c === 0 ? ok(out) : no(new Error(`avdmanager ${args[0]} exit ${c}: ${out.slice(-400)}`))));
    p.stdin.end(stdin);
  });
}
const stockSerial = `emulator-${STOCK_PORT}`;
const stockProcs = () => listProcesses(STOCK);
async function killStock() {
  await adb(stockSerial, ["emu", "kill"], 10000, false).catch(() => {});
  for (let i = 0; i < 120 && (await stockProcs()).length; i++) await sleep(1000); // quick-boot snapshot save on exit
  for (const { pid } of await stockProcs()) try { process.kill(pid); } catch {}
}
async function stockBoot(label, extra) {
  // Android Studio's standalone launch line: emulator -netdelay none -netspeed full -avd <name> (+ -port to stay off 5554/5580+)
  const args = ["-netdelay", "none", "-netspeed", "full", "-avd", STOCK, "-port", String(STOCK_PORT), ...extra];
  const t0 = Date.now();
  await launchEmulator(args, join(work, `stock-${label}.log`), true);
  let done = false;
  while (!done && Date.now() - t0 < 600000) {
    done = (await adb(stockSerial, ["shell", "getprop", "sys.boot_completed"], 5000, false).catch(() => "")).trim() === "1";
    if (!done) await sleep(500);
  }
  const seconds = r1((Date.now() - t0) / 1000);
  await killStock();
  // AI NOTE: one quick boot (snapshot saved by the cold boot's exit) never reached boot_completed in 600 s, the run before took
  // 5.8 s; cause unknown. A boot that does not finish is recorded as a failure (seconds null), not hidden.
  console.log(`stock ${label}: ${done ? `${seconds} s` : "did not complete in 600 s"}`);
  return { label, flags: args.join(" "), seconds: done ? seconds : null, ...(done ? {} : { error: "sys.boot_completed not 1 after 600 s" }) };
}

const A = [], B = [];
let firstDevice;
try {
  await down(); // lock owner; the MCP server child inherits CREWDROID_OWNER through env
  client = new Client({ name: "bench-agent", version: "0.0.1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", join(root, "src/cli.ts"), "mcp"], env: process.env }));
  let t0 = Date.now();
  let r = await client.callTool({ name: "up", arguments: { profiles: [PROFILE], api: API } }, undefined, { timeout: 900000 });
  upSeconds = r1((Date.now() - t0) / 1000);
  if (r.isError) throw new Error(`up: ${r.content?.[0]?.text}`);
  dev = JSON.parse(r.content[0].text).devices[0];
  serial = dev.serial;
  r = await client.callTool({ name: "install", arguments: { target: serial, apk } }, undefined, { timeout: 300000 });
  if (r.isError) throw new Error(`install: ${r.content?.[0]?.text}`);
  // untimed warm-up: first start after install (dex2oat, first layout) would only add noise to run 1
  await reset(0);
  await call("launch", launchArgs());
  await sleep(3000);

  for (let i = 1; i <= RUNS; i++) {
    for (const [path, fn, list] of [["A", runA, A], ["B", runB, B]]) {
      await reset(`${path}${i}`);
      try {
        const steps = await fn();
        list.push({ run: i, ok: true, steps, untimed: steps.untimed });
      } catch (e) {
        failures[path].push(`run ${i}: ${e.message}`);
        list.push({ run: i, ok: false, steps: [], error: e.message });
      }
      const last = list.at(-1);
      console.log(`${path}${i}: ${last.ok ? `${r2(last.steps.reduce((a, s) => a + s.seconds, 0))} s, ${last.steps.reduce((a, s) => a + s.tokens, 0)} tokens, ${last.steps.length} calls` : `FAIL ${last.error}`}`);
    }
  }

  // time to first usable device, crewdroid: a second `up` after down (base snapshot surely prepared by then)
  await call("down", {});
  t0 = Date.now();
  r = await client.callTool({ name: "up", arguments: { profiles: [PROFILE], api: API } }, undefined, { timeout: 900000 });
  upAgainSeconds = r1((Date.now() - t0) / 1000);
  if (r.isError) throw new Error(`up (timed): ${r.content?.[0]?.text}`);
  const ready = JSON.parse(r.content[0].text).devices[0];
  await call("down", {});
  await client.close(); client = undefined;

  // stock
  if (existsSync(join(avdHome(), `${STOCK}.avd`))) throw new Error(`${STOCK} already exists; delete it first`);
  await avdm(["create", "avd", "-n", STOCK, "-k", `"${imagePackage(`android-${API}/google_atd`)}"`, "-d", "medium_phone"], "no\n");
  const ini = join(avdHome(), `${STOCK}.avd`, "config.ini");
  // what Android Studio's Device Manager writes on top of avdmanager's defaults
  writeFileSync(ini, readFileSync(ini, "utf8").trimEnd().replace(/^hw\.(gpu\.enabled|gpu\.mode|keyboard)=.*\n?/gm, "") + "\nhw.gpu.enabled=yes\nhw.gpu.mode=auto\nhw.keyboard=yes\n");
  const boots = [];
  try {
    boots.push(await stockBoot("first boot (fresh AVD)", []));
    boots.push(await stockBoot("cold boot", ["-no-snapshot-load"]));
    boots.push(await stockBoot("quick boot (snapshot saved on exit)", []));
  } finally {
    await killStock();
    await avdm(["delete", "avd", "-n", STOCK]).catch((e) => console.error(String(e.message)));
    rmSync(join(avdHome(), `${STOCK}.avd`), { recursive: true, force: true });
    rmSync(join(avdHome(), `${STOCK}.ini`), { force: true });
  }
  firstDevice = {
    crewdroidSeconds: upAgainSeconds, crewdroidCmd: `crewdroid up --profile ${PROFILE} --api ${API}`, crewdroidReadySeconds: ready.readySeconds, crewdroidFirstUpSeconds: upSeconds,
    stockSeconds: boots[1].seconds, stockFirstBootSeconds: boots[0].seconds, stockQuickBootSeconds: boots[2].seconds, stock: boots,
    stockAvd: `avdmanager create avd -d medium_phone -k "${imagePackage(`android-${API}/google_atd`)}" + hw.gpu.mode=auto, hw.keyboard=yes; window shown (minimized), deleted afterwards`,
    measure: "command start -> sys.boot_completed=1 (stock) / `up` returned, device ready (crewdroid), wall seconds",
  };
} finally {
  if (client) { await client.callTool({ name: "down", arguments: {} }).catch(() => {}); await client.close().catch(() => {}); }
  await down();
  if (server) await new Promise((ok) => server.close(ok));
  if ((await stockProcs()).length) await killStock();
}

const jA = summary("A", A), jB = summary("B", B);
const ratio = (k) => r2(jB[k] / jA[k]);
const j = {
  date: new Date().toISOString(),
  task: `open the Field Notes demo app, add a note '${NOTE}', confirm it appears in the list`,
  device: { profile: PROFILE, api: API, serial, wmSize: dev?.wmSize },
  method: "deterministic, no LLM; both paths call the same crewdroid MCP server over stdio; app data and server data reset before every run (untimed); A and B interleaved. Model think time is not counted on either side. B's tap coordinates come from an untimed uiautomator dump (stands in for the vision model finding the button; favours B).",
  tokenEstimate: { text: "chars / 4 of every text item the tool returns (MCP sends JSON pretty-printed)", image: "long edge scaled to <= 1568 px (and <= ~1600 tokens), then width*height/750", doc: DOC },
  A: jA, B: jB,
  ratio: { tokens: ratio("tokensPerTask"), seconds: ratio("secondsPerTask"), payloadBytes: ratio("payloadBytesPerTask"), toolCalls: ratio("toolCallsPerTask") },
  firstDevice,
};
writeFileSync(join(root, "docs/measurements/agent-bench.json"), JSON.stringify(j, null, 2) + "\n");

const img = jB.images[0];
const fd = firstDevice;
const sec = (x) => (x == null ? "did not finish in 600 s" : `${x} s`);
const tree = jA.steps.find((s) => s.tool === "screen"), logsStep = jA.steps.find((s) => s.tool === "logs");
const dumpSteps = jA.steps.filter((s) => ["screen", "tap", "type"].includes(s.tool)); // A taps/types by text or id: each runs a dump
// which side wins, worded from the numbers (no fixed claim)
const cmp = (a, b, what) => (a < b ? `the tree path is ${r2(b / a)}x ${what}` : a > b ? `screenshots are ${r2(a / b)}x ${what} here` : "equal");
const md = `# Agent driving benchmark: tree (crewdroid) vs screenshots (T49)

Date: ${j.date.slice(0, 10)} · raw: \`agent-bench.json\` · script: \`node scripts/bench-agent.mjs\`
Device: ${PROFILE} (${dev?.wmSize}), API ${API}, \`${serial}\` · app: Field Notes (\`demo-app/\`) · ${RUNS} runs per path, interleaved.

Task: ${j.task}. Deterministic, no LLM. These numbers are **observation cost and latency**, not a model's success rate.

- **A (crewdroid way):** \`screen\` (JSON accessibility tree) to observe, \`tap --text\` / \`type --into\` to act, \`screen\` + \`logs\` to confirm.
- **B (screenshot way, how pixel-based agents and computer-use drive an emulator window):** \`screencap -p\` PNG after every action, taps by x,y.
  B's x,y come from an untimed uiautomator dump standing in for the vision model's "find the button in the image": no misses, no time. This favours B.
- Both paths go through the same crewdroid MCP server over stdio; only the observation differs. Model think time is not counted on either side.
- Tokens: text = characters / 4; image = Anthropic's vision formula, long edge scaled to <= 1568 px, then tokens ≈ width × height / 750 (${DOC}).${img ? ` One ${img.width}x${img.height} screenshot = ${img.tokens} tokens (${img.bytes} PNG bytes).` : ""}

## Per task (mean of ${jA.ok}/${jA.runs} A and ${jB.ok}/${jB.runs} B successful runs)

| Metric | A: tree (crewdroid) | B: screenshots | B / A |
|---|---|---|---|
| Estimated model input tokens | ${jA.tokensPerTask} | ${jB.tokensPerTask} | ${j.ratio.tokens}x |
| Wall time (s) | ${jA.secondsPerTask} | ${jB.secondsPerTask} | ${j.ratio.seconds}x |
| Tool calls | ${jA.toolCallsPerTask} | ${jB.toolCallsPerTask} | ${j.ratio.toolCalls}x |
| Observation payload (bytes) | ${jA.payloadBytesPerTask} | ${jB.payloadBytesPerTask} | ${j.ratio.payloadBytes}x |

## Per step (mean)

| Path | Step | Tool | Seconds | Bytes | Tokens |
|---|---|---|---|---|---|
${[jA, jB].flatMap((p) => p.steps.map((s) => `| ${p.path} | ${s.step} | ${s.tool} | ${s.seconds} | ${s.bytes} | ${s.tokens} |`)).join("\n")}

## Runs

| Path | Run | OK | Seconds | Tokens | Calls |
|---|---|---|---|---|---|
${[jA, jB].flatMap((p) => p.perRun.map((r) => `| ${p.path} | ${r.run} | ${r.ok ? "yes" : `no: ${r.error}`} | ${r.seconds} | ${r.tokens} | ${r.calls} |`)).join("\n")}

Failure modes seen: ${[...jA.failures.map((f) => `A ${f}`), ...jB.failures.map((f) => `B ${f}`)].join("; ") || "none in these runs"}.
Failure modes not exercised (B gets them for free here): a vision model misreading a button's position or text, tapping during the
bottom-sheet animation, re-taking a screenshot to check. A's \`tap --text\` fails with the list of candidates instead of tapping the wrong spot.

## Time to first usable device

| Way | Time to ready |
|---|---|
| \`${fd.crewdroidCmd}\` (returns when the device is ready) | ${sec(fd.crewdroidSeconds)} |
| Stock AVD, cold boot (\`-no-snapshot-load\`) | ${sec(fd.stockSeconds)} |
| Stock AVD, first boot of the fresh AVD | ${sec(fd.stockFirstBootSeconds)} |
| Stock AVD, quick boot (snapshot Android Studio saves on exit) | ${sec(fd.stockQuickBootSeconds)} |

Stock AVD: ${fd.stockAvd}. Flags: \`${fd.stock[0].flags}\` (Android Studio's standalone launch; \`-port\` added to stay off other emulators). Measured: ${fd.measure}. Same machine as the A/B runs, measured right after them.
Cold boot over \`up\`: ${r1(fd.stockSeconds / fd.crewdroidSeconds)}x.

## Where the cost goes

- A: one \`screen\` result = ${tree.tokens} tokens (${tree.bytes} bytes of pretty-printed JSON), one \`logs\` result = ${logsStep.tokens} tokens. B: one screenshot = ${img?.tokens} tokens.
- A: every call that reads the tree (\`screen\`, \`tap --text\`, \`type --into\`) runs \`uiautomator dump\` on the device: ${r1(mean(dumpSteps.map((s) => s.seconds)))} s each on average, ${dumpSteps.length} per task. A \`shot\` takes ${r1(mean(jB.steps.filter((s) => s.tool === "shot").map((s) => s.seconds)))} s.
- B pays nothing here for finding the buttons (untimed dump, ${r1(mean(jB.perRun.filter((r) => r.ok).map((r) => r.untimedLocateSeconds ?? 0)))} s per task left out); a real vision model would add its own image-reading time and misses.

## What this means for an agent

1. Observation tokens per task: tree ${jA.tokensPerTask} vs screenshots ${jB.tokensPerTask}: ${cmp(jA.tokensPerTask, jB.tokensPerTask, "fewer tokens")}.
2. Tool time per task: tree ${jA.secondsPerTask} s vs screenshots ${jB.secondsPerTask} s: ${cmp(jA.secondsPerTask, jB.secondsPerTask, "faster")}; tree taps go by text and fail with candidates instead of hitting a guessed pixel.
3. A ready device: \`crewdroid up\` ${fd.crewdroidSeconds} s vs stock emulator cold boot ${fd.stockSeconds} s (${r1(fd.stockSeconds / fd.crewdroidSeconds)}x; stock quick boot ${sec(fd.stockQuickBootSeconds)}, fresh first boot ${sec(fd.stockFirstBootSeconds)}).
`;
writeFileSync(join(root, "docs/measurements/agent-bench.md"), md);
try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }); } catch (e) { console.error(`temp dir left: ${e.message}`); }
console.log(`A ${jA.ok}/${jA.runs}: ${jA.tokensPerTask} tokens, ${jA.secondsPerTask} s, ${jA.toolCallsPerTask} calls | B ${jB.ok}/${jB.runs}: ${jB.tokensPerTask} tokens, ${jB.secondsPerTask} s, ${jB.toolCallsPerTask} calls | first device: crewdroid ${fd.crewdroidSeconds} s, stock cold ${fd.stockSeconds} s`);
if (jA.ok < RUNS || jB.ok < RUNS) process.exitCode = 1;
