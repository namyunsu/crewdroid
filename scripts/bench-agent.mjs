// T49/T54 verify: node scripts/bench-agent.mjs (boots 1 device, then API 36 once, then a stock AVD 3 times; ~20 min)
// Agent driving benchmark, deterministic (no LLM). Task: open the Field Notes demo app, add a note "Fix pump #3", confirm it
// appears in the list. Same device (s24ultra, API 34), 5 runs per path, A and B interleaved, app data + server reset before
// each run (untimed). Both paths call the same crewdroid MCP server over stdio, so only the way of observing differs:
//   A (tree, T54 defaults): launch, screen (compact outline), tap --text / type --into / tap --text whose returned screens are
//                   the observations, logs (default view) to confirm SAVED. The note in Save's returned screen confirms the list.
//   B (screenshot, exactly as T49): launch, then a shot (screencap -p PNG) after every action, taps by x,y. The x,y come from an
//                   untimed uiautomator dump standing in for the vision model's "find it in the image" (favours B: no misses, no time).
// Then once on API 36 (both paths), and a robustness row: fold5-main and flip6-cover at font 1.3, A by text, B by the
// s24ultra coordinates it learned (no re-deriving).
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
import { loadProfiles } from "../src/profiles.ts";
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
const ROBUST = ["fold5-main", "flip6-cover"], ROBUST_FONT = 1.3;
// T49's result (commit 1274c6b, docs/measurements/agent-bench.json of 2026-10-26), kept as "before"
const BEFORE = {
  date: "2026-10-26", commit: "1274c6b",
  A: { tokensPerTask: 9695, secondsPerTask: 23.91, toolCallsPerTask: 7, payloadBytesPerTask: 38793, perCall: { screen: 3.27, tap: 3.24, type: 4.4, logs: 0.29 } },
  B: { tokensPerTask: 6212, secondsPerTask: 10.26, toolCallsPerTask: 8, payloadBytesPerTask: 922820 },
};
const PER_CALL_MAX = 0.5; // s, screen / tap / type each (T54)
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

// T54: the defaults an agent gets now: compact `screen`, actions that return the settled screen, short `logs`. No extra calls.
async function runA() {
  const steps = [];
  const step = async (label, name, args) => { const s = await call(name, args); steps.push({ step: label, ...s }); if (s.isError) throw new Error(`${label}: ${s.text.slice(0, 300)}`); return s; };
  await step("launch", "launch", launchArgs());
  await step("observe (screen)", "screen", { serial });
  await step("tap New note (+screen)", "tap", { serial, text: "New note" });
  await step("type into title (+screen)", "type", { serial, text: NOTE, into: "title" });
  let s = await step("tap Save (+screen)", "tap", { serial, text: "Save" });
  // NOTE (T54): the app inserts the card after its async list diff; on a busy emulator the returned screen can settle
  // (150 ms quiet) before that. An agent then looks once more: counted as an extra call, not hidden.
  if (!s.text.includes(JSON.stringify(NOTE))) s = await step("re-check (screen; Save's screen lacked the note)", "screen", { serial });
  const l = await step("confirm (logs)", "logs", { serial, pkg: PKG });
  // the returned outline names the new card; the default log view has the app's `SAVED <id>` line
  const inList = s.text.includes(JSON.stringify(NOTE)), saved = /^\S+ I FieldNotes: SAVED /m.test(l.text);
  if (!inList || !saved) throw new Error(`confirm: inList=${inList} SAVED=${saved}`);
  return steps;
}

// B's x,y from its first s24ultra run: what an agent that learned them would reuse on another screen (robustness row)
let learned;
async function runB(fixed) {
  const steps = [];
  let untimed = 0;
  const step = async (label, name, args) => { const s = await call(name, args); steps.push({ step: label, ...s }); if (s.isError) throw new Error(`${label}: ${s.text.slice(0, 300)}`); return s; };
  const find = async (q) => { if (fixed) return fixed[q]; const t0 = Date.now(); const p = await locate(q); untimed += (Date.now() - t0) / 1000; (learned ??= {})[q] ??= p; return p; };
  const png = (k) => join(work, `b-${k}.png`);
  await step("launch", "launch", launchArgs());
  await step("observe (shot)", "shot", { serial, file: png(1) });
  // screen:false = T49's tap/type, which returned only the point (T53 made returning the new screen the default)
  await step("tap New note (x,y)", "tap", { serial, ...(await find("New note")), screen: false });
  await step("observe (shot)", "shot", { serial, file: png(2) }); // title field has focus: the model sees the cursor there
  await step("type", "type", { serial, text: NOTE, screen: false });
  await step("observe (shot)", "shot", { serial, file: png(3) });
  await step("tap Save (x,y)", "tap", { serial, ...(await find("Save")), screen: false });
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
  // key = label + its occurrence in the run (B observes 3 times); a step only some runs needed is averaged over those
  const keyed = (r) => r.steps.map((s, i) => [`${s.step}#${r.steps.slice(0, i).filter((x) => x.step === s.step).length}`, s]);
  const labels = [...new Set(ok.flatMap((r) => keyed(r).map(([k]) => k)))];
  return {
    path, runs: runs.length, ok: ok.length,
    tokensPerTask: Math.round(mean(ok.map((r) => r.steps.reduce((a, s) => a + s.tokens, 0)))),
    secondsPerTask: per((st) => st.reduce((a, s) => a + s.seconds, 0)),
    toolCallsPerTask: per((st) => st.length),
    payloadBytesPerTask: Math.round(mean(ok.map((r) => r.steps.reduce((a, s) => a + s.bytes, 0)))),
    observeCallsPerTask: per((st) => st.filter((s) => /observe|confirm/.test(s.step)).length),
    images: ok[0]?.steps.flatMap((s) => s.images).slice(0, 1) ?? [],
    steps: labels.map((label) => {
      const xs = ok.map((r) => keyed(r).find(([k]) => k === label)?.[1]).filter(Boolean);
      return { step: xs[0].step, tool: xs[0].name, runs: xs.length, seconds: r2(mean(xs.map((s) => s.seconds))), bytes: Math.round(mean(xs.map((s) => s.bytes))), tokens: Math.round(mean(xs.map((s) => s.tokens))) };
    }),
    perCall: Object.fromEntries(["screen", "tap", "type", "logs", "shot"].map((t) => [t, ok.flatMap((r) => r.steps.filter((s) => s.name === t).map((s) => s.seconds))]).filter(([, xs]) => xs.length).map(([t, xs]) => [t, r2(mean(xs))])),
    perRun: runs.map((r) => ({ run: r.run, ok: r.ok, seconds: r2(r.steps.reduce((a, s) => a + s.seconds, 0)), tokens: r.steps.reduce((a, s) => a + s.tokens, 0), bytes: r.steps.reduce((a, s) => a + s.bytes, 0), calls: r.steps.length, ...(r.untimed ? { untimedLocateSeconds: r2(r.untimed) } : {}), ...(r.error ? { error: r.error } : {}) })),
    failures: failures[path],
  };
}

// --- stock AVD (Android Studio defaults), measured after crewdroid is down ---
const avdmanager = () => join(sdkRoot(), "cmdline-tools", "latest", "bin", process.platform === "win32" ? "avdmanager.bat" : "avdmanager");
function avdm(args, stdin = "") {
  return new Promise((ok, no) => {
    // NOTE: .bat needs a shell on Windows (same as src/avd.ts)
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
  // NOTE: one quick boot (snapshot saved by the cold boot's exit) never reached boot_completed in 600 s, the run before took
  // 5.8 s; cause unknown. A boot that does not finish is recorded as a failure (seconds null), not hidden.
  console.log(`stock ${label}: ${done ? `${seconds} s` : "did not complete in 600 s"}`);
  return { label, flags: args.join(" "), seconds: done ? seconds : null, ...(done ? {} : { error: "sys.boot_completed not 1 after 600 s" }) };
}

const A = [], B = [];
let firstDevice, api36, robustness = [];
// one A and one B run, untimed setup first; { ok, seconds, tokens, error }
async function once(path, fn) {
  await reset(`${path}-${Date.now()}`);
  try { const st = await fn(); return { ok: true, seconds: r2(st.reduce((a, s) => a + s.seconds, 0)), tokens: st.reduce((a, s) => a + s.tokens, 0), perCall: Object.fromEntries(st.filter((s) => s.name !== "launch").map((s) => [s.step, r2(s.seconds)])) }; }
  catch (e) { return { ok: false, error: e.message.slice(0, 300) }; }
}
async function upOne(api) {
  const r = await client.callTool({ name: "up", arguments: { profiles: [PROFILE], api } }, undefined, { timeout: 900000 });
  if (r.isError) throw new Error(`up api ${api}: ${r.content?.[0]?.text}`);
  const d = JSON.parse(r.content[0].text).devices[0];
  const i = await client.callTool({ name: "install", arguments: { target: d.serial, apk } }, undefined, { timeout: 300000 });
  if (i.isError) throw new Error(`install: ${i.content?.[0]?.text}`);
  return d;
}
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

  // robustness: other screens at font 1.3, same strategy as on s24ultra (A by text, B by the coordinates it learned)
  for (const name of ROBUST) {
    const p = loadProfiles().find((x) => x.name === name);
    await adb(serial, ["shell", `wm size ${p.width}x${p.height} && wm density ${p.density} && settings put system font_scale ${ROBUST_FONT}`]);
    await sleep(1500);
    const a = await once("A", runA), b = learned ? await once("B", () => runB(learned)) : { ok: false, error: "no learned coordinates (every s24ultra B run failed)" };
    robustness.push({ profile: name, screen: `${p.width}x${p.height}@${p.density}`, font: ROBUST_FONT, A: a, B: b });
    console.log(`robustness ${name} font ${ROBUST_FONT}: A ${a.ok ? "pass" : `FAIL ${a.error}`} | B ${b.ok ? "pass" : `FAIL ${b.error}`}`);
  }
  await adb(serial, ["shell", `wm size reset && wm density reset && settings put system font_scale 1.0`]);

  // once on API 36 (both paths), same profile
  await call("down", {});
  const d36 = await upOne(36), keep = serial;
  serial = d36.serial;
  await reset("36-warm"); await call("launch", launchArgs()); await sleep(3000);
  api36 = { api: 36, serial, A: await once("A", runA), B: await once("B", () => runB()) };
  console.log(`API 36: A ${api36.A.ok ? `${api36.A.seconds} s, ${api36.A.tokens} tokens` : `FAIL ${api36.A.error}`} | B ${api36.B.ok ? `${api36.B.seconds} s, ${api36.B.tokens} tokens` : `FAIL ${api36.B.error}`}`);
  serial = keep;

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
  perCallTarget: { maxSeconds: PER_CALL_MAX, ...Object.fromEntries(["screen", "tap", "type"].map((t) => [t, { seconds: jA.perCall[t], ok: jA.perCall[t] <= PER_CALL_MAX }])) },
  api36, robustness, before: BEFORE,
  firstDevice,
};
writeFileSync(join(root, "docs/measurements/agent-bench.json"), JSON.stringify(j, null, 2) + "\n");

const img = jB.images[0];
const fd = firstDevice;
const sec = (x) => (x == null ? "did not finish in 600 s" : `${x} s`);
const tree = jA.steps.find((s) => s.tool === "screen"), logsStep = jA.steps.find((s) => s.tool === "logs");
const pc = j.perCallTarget, bf = BEFORE;
const pass = (x) => (x.ok ? "pass" : `FAIL: ${x.error}`);
const slowest = ["screen", "tap", "type"].filter((t) => !pc[t].ok);
// which side wins, worded from the numbers (no fixed claim)
const cmp = (a, b, what) => (a < b ? `the tree path is ${r2(b / a)}x ${what}` : a > b ? `screenshots are ${r2(a / b)}x ${what} here` : "equal");
const md = `# Agent driving benchmark: tree (crewdroid) vs screenshots (T49, re-measured T54)

Date: ${j.date.slice(0, 10)} · raw: \`agent-bench.json\` · script: \`node scripts/bench-agent.mjs\`
Device: ${PROFILE} (${dev?.wmSize}), API ${API}, \`${serial}\` · app: Field Notes (\`demo-app/\`) · ${RUNS} runs per path, interleaved.

Task: ${j.task}. Deterministic, no LLM. These numbers are **observation cost and latency**, not a model's success rate.

- **A (crewdroid way, T54 defaults):** \`screen\` once (compact outline), then \`tap --text\` / \`type --into\` / \`tap --text\`; each returns the settled new screen, which is the next observation (Save's returned screen shows the new card). \`logs\` (default view) confirms the app's \`SAVED\` line. No other calls.
- **B (screenshot way, how pixel-based agents and computer-use drive an emulator window), unchanged since T49:** \`screencap -p\` PNG after every action, taps by x,y; \`tap\` / \`type\` with \`screen:false\`, i.e. returning only the point as in T49.
  B's x,y come from an untimed uiautomator dump standing in for the vision model's "find the button in the image": no misses, no time. B's shot after a tap does not wait for the screen to settle and B's confirm reads the last image for free (untimed dump). These favour B.
- Both paths go through the same crewdroid MCP server over stdio; only the observation differs. Model think time is not counted on either side.
- Tokens: text = characters / 4; image = Anthropic's vision formula, long edge scaled to <= 1568 px, then tokens ≈ width × height / 750 (${DOC}).${img ? ` One ${img.width}x${img.height} screenshot = ${img.tokens} tokens (${img.bytes} PNG bytes).` : ""}

## Per task (mean of ${jA.ok}/${jA.runs} A and ${jB.ok}/${jB.runs} B successful runs), before (T49, ${bf.date}, commit ${bf.commit}) and after

| Metric | A before (T49) | A after | B before (T49) | B after | B / A after |
|---|---|---|---|---|---|
| Estimated model input tokens | ${bf.A.tokensPerTask} | ${jA.tokensPerTask} | ${bf.B.tokensPerTask} | ${jB.tokensPerTask} | ${j.ratio.tokens}x |
| Wall time (s) | ${bf.A.secondsPerTask} | ${jA.secondsPerTask} | ${bf.B.secondsPerTask} | ${jB.secondsPerTask} | ${j.ratio.seconds}x |
| Tool calls | ${bf.A.toolCallsPerTask} | ${jA.toolCallsPerTask} | ${bf.B.toolCallsPerTask} | ${jB.toolCallsPerTask} | ${j.ratio.toolCalls}x |
| Observation payload (bytes) | ${bf.A.payloadBytesPerTask} | ${jA.payloadBytesPerTask} | ${bf.B.payloadBytesPerTask} | ${jB.payloadBytesPerTask} | ${j.ratio.payloadBytes}x |

## Per call, path A (mean seconds; reported, not gated: the <= ${PER_CALL_MAX} s wish of request 2026-10-27 task 1)

| Tool | T49 | T54 | <= ${PER_CALL_MAX} s wish |
|---|---|---|---|
${["screen", "tap", "type"].map((t) => `| \`${t}\` | ${bf.A.perCall[t]} | ${pc[t].seconds} | ${pc[t].ok ? "met" : "not met"} |`).join("\n")}
| \`logs\` | ${bf.A.perCall.logs} | ${jA.perCall.logs} | - |

\`tap\` and \`type\` include the returned screen: the helper waits on the device until no accessibility event came for 150 ms and the tree reads the same 50 ms later.

## Per step (mean)

| Path | Step | Tool | Runs | Seconds | Bytes | Tokens |
|---|---|---|---|---|---|---|
${[jA, jB].flatMap((p) => p.steps.map((s) => `| ${p.path} | ${s.step} | ${s.tool} | ${s.runs} | ${s.seconds} | ${s.bytes} | ${s.tokens} |`)).join("\n")}

## Runs

| Path | Run | OK | Seconds | Tokens | Calls |
|---|---|---|---|---|---|
${[jA, jB].flatMap((p) => p.perRun.map((r) => `| ${p.path} | ${r.run} | ${r.ok ? "yes" : `no: ${r.error}`} | ${r.seconds} | ${r.tokens} | ${r.calls} |`)).join("\n")}

Failure modes seen: ${[...jA.failures.map((f) => `A ${f}`), ...jB.failures.map((f) => `B ${f}`)].join("; ") || "none in these runs"}.
Failure modes not exercised (B gets them for free here): a vision model misreading a button's position or text, tapping during the
bottom-sheet animation, re-taking a screenshot to check. A's \`tap --text\` fails with the list of candidates instead of tapping the wrong spot.

## API 36 (one run per path, ${PROFILE})

| Path | OK | Seconds | Tokens | Per call (s) |
|---|---|---|---|---|
${api36 ? ["A", "B"].map((k) => `| ${k} | ${api36[k].ok ? "yes" : `no: ${api36[k].error}`} | ${api36[k].seconds ?? "-"} | ${api36[k].tokens ?? "-"} | ${Object.entries(api36[k].perCall ?? {}).map(([s, v]) => `${s} ${v}`).join("; ")} |`).join("\n") : "| - | not run | | | |"}

## Robustness: other screens at font ${ROBUST_FONT}, no re-deriving

A taps by text as on ${PROFILE}; B reuses the x,y it learned on ${PROFILE} (${learned ? Object.entries(learned).map(([q, p]) => `${q} ${p.x},${p.y}`).join("; ") : "none"}). Same API ${API} device, \`wm size\` / \`wm density\` of the profile and \`font_scale ${ROBUST_FONT}\`, one run each.

| Profile | Screen | A (by text) | B (${PROFILE} coordinates) |
|---|---|---|---|
${robustness.map((r) => `| ${r.profile} | ${r.screen} | ${pass(r.A)} | ${pass(r.B)} |`).join("\n")}

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

- A: one \`screen\` outline = ${tree.tokens} tokens (${tree.bytes} bytes), one default \`logs\` = ${logsStep.tokens} tokens; each action's returned screen is in its row above. B: one screenshot = ${img?.tokens} tokens.
- A: the tree comes from the on-device helper (T52), not \`uiautomator dump\`. A \`shot\` takes ${r1(mean(jB.steps.filter((s) => s.tool === "shot").map((s) => s.seconds)))} s.
- Both: \`launch\` (am start -W, then a 2 s crash check) is ${jA.steps[0].seconds} s of A's ${jA.secondsPerTask} s and ${jB.steps[0].seconds} s of B's ${jB.secondsPerTask} s.
${slowest.length ? `- Per-call wish not met for ${slowest.map((t) => `\`${t}\` (${pc[t].seconds} s)`).join(", ")}: most of it is the app's own transition after the tap (measured in T54 by polling the tree after a tap: Field Notes' editor sheet is in the tree 0.3-0.6 s after the tap on this emulator; Save closes the sheet and animates the new card in, 300 ms), plus the 150 ms quiet period that makes the returned screen a settled one.` : "- Per-call wish met for screen, tap and type."}
- B pays nothing here for finding the buttons (untimed dump, ${r1(mean(jB.perRun.filter((r) => r.ok).map((r) => r.untimedLocateSeconds ?? 0)))} s per task left out); a real vision model would add its own image-reading time and misses.

## What this means for an agent

1. Observation tokens per task: tree ${jA.tokensPerTask} vs screenshots ${jB.tokensPerTask}: ${cmp(jA.tokensPerTask, jB.tokensPerTask, "fewer tokens")}.
2. Tool time per task: tree ${jA.secondsPerTask} s vs screenshots ${jB.secondsPerTask} s: ${cmp(jA.secondsPerTask, jB.secondsPerTask, "faster")} (gate, user 2026-10-29 "time tie allowed": A <= B x 1.1 = ${r2(jB.secondsPerTask * 1.1)} s, ${jA.secondsPerTask <= jB.secondsPerTask * 1.1 ? "met" : "missed"}; the 5-run spread is about +-3 s); tree taps go by text and fail with candidates instead of hitting a guessed pixel.
3. A ready device: \`crewdroid up\` ${fd.crewdroidSeconds} s vs stock emulator cold boot ${fd.stockSeconds} s (${r1(fd.stockSeconds / fd.crewdroidSeconds)}x; stock quick boot ${sec(fd.stockQuickBootSeconds)}, fresh first boot ${sec(fd.stockFirstBootSeconds)}).
`;
writeFileSync(join(root, "docs/measurements/agent-bench.md"), md);
try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }); } catch (e) { console.error(`temp dir left: ${e.message}`); }
console.log(`A ${jA.ok}/${jA.runs}: ${jA.tokensPerTask} tokens, ${jA.secondsPerTask} s, ${jA.toolCallsPerTask} calls | B ${jB.ok}/${jB.runs}: ${jB.tokensPerTask} tokens, ${jB.secondsPerTask} s, ${jB.toolCallsPerTask} calls | first device: crewdroid ${fd.crewdroidSeconds} s, stock cold ${fd.stockSeconds} s`);
console.log(`per call (A): ${["screen", "tap", "type"].map((t) => `${t} ${pc[t].seconds} s ${pc[t].ok ? "ok" : "not met"}`).join(", ")} (wish <= ${PER_CALL_MAX} s, not gated)`);
if (jA.ok < RUNS || jB.ok < RUNS) process.exitCode = 1;
