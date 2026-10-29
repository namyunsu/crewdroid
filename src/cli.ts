import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { measure } from "./measure.ts";
import { judge } from "./judge.ts";
import { prepare } from "./snapshot.ts";
import { identity } from "./identity.ts";
import { hammer } from "./hammer.ts";
import { flakyLoop, setNet, type NetCommand, type Transport } from "./net.ts";
import { claimEmulators, down, measureUp, up, upDefaults } from "./up.ts";
import { runScenario } from "./scenario.ts";
import { slim } from "./slim.ts";
import { triage } from "./triage.ts";
import { screen, screenText } from "./screen.ts";
import { perf } from "./perf.ts";
import { apk } from "./apk.ts";
import { fold } from "./fold.ts";
import { envSet } from "./env.ts";
import { appRun } from "./app.ts";
import { setup, type StepName } from "./setup.ts";
import { install, launch, logLine, logs, logsHint } from "./appctl.ts";
import { actionLine, key, swipe, tap, type, withScreen } from "./input.ts";
import { shot } from "./shot.ts";
import { setLoad } from "./load.ts";
import { proxyLog, proxyServe, proxyStart, proxyStop } from "./proxy.ts";
import { layout, layoutText } from "./layout.ts";

// AI NOTE: `env` takes negative numbers (geo -122.08 37.4) that parseArgs would read as options, so its args are parsed by hand.
const envArgs = process.argv[2] === "env" ? process.argv.slice(3) : undefined;
const { positionals, values } = parseArgs({
  args: envArgs ? ["env"] : undefined,
  allowPositionals: true,
  options: {
    avd: { type: "string" }, "base-port": { type: "string", default: "5580" },
    out: { type: "string" }, json: { type: "boolean", default: false },
    "idle-seconds": { type: "string", default: "60" },
    rules: { type: "string" }, source: { type: "string" }, log: { type: "string" }, target: { type: "string" }, port: { type: "string" }, devices: { type: "string" }, proxy: { type: "string" }, "lose-acks": { type: "string" },
    image: { type: "string" }, screen: { type: "string", multiple: true }, "profiles-file": { type: "string" }, profiles: { type: "string" }, up: { type: "string" }, count: { type: "string" }, api: { type: "string" }, profile: { type: "string" }, "no-distinct": { type: "boolean", default: false }, window: { type: "boolean", default: false }, cores: { type: "string" }, ram: { type: "string" }, load: { type: "string" }, "keep-apps": { type: "boolean", default: false },
    url: { type: "string" }, users: { type: "string", default: "10" }, repeat: { type: "string", default: "5" },
    jitter: { type: "string", default: "50" }, "retry-rate": { type: "string", default: "0.1" }, seed: { type: "string", default: "1" },
    "server-port": { type: "string", default: "5599" }, help: { type: "boolean", default: false }, version: { type: "boolean", default: false },
    app: { type: "string" }, pkg: { type: "boolean", default: false }, heap: { type: "string" }, png: { type: "string" }, activity: { type: "string" },
    sdk: { type: "string" }, images: { type: "string" }, only: { type: "string" }, "dry-run": { type: "boolean", default: false }, yes: { type: "boolean", default: false },
    grant: { type: "boolean", default: false }, restart: { type: "boolean", default: false }, since: { type: "string" }, level: { type: "string" }, seconds: { type: "string" },
    text: { type: "string" }, id: { type: "string" }, index: { type: "string" }, into: { type: "string" }, times: { type: "string" },
    bounds: { type: "boolean", default: false }, all: { type: "boolean", default: false }, "no-screen": { type: "boolean", default: false },
    flow: { type: "string" }, fonts: { type: "string" },
    to: { type: "string" }, during: { type: "string" },
  },
});

const COMMANDS = "up, devices, down, slim, measure, judge, proxy, prepare, identity, hammer, net, load, run, triage, screen, perf, apk, fold, unfold, env, app, setup, install, launch, logs, shot, layout, tap, type, swipe, key, version, mcp";

async function main() {
  const [cmd] = positionals;
  if (values.help || cmd === "help") return console.log(`usage: crewdroid <command> [options]\ncommands: ${COMMANDS}\nexample: crewdroid up (one device) | crewdroid up --count 3 | crewdroid up --api 31 | crewdroid up --cores 4 --ram 2048 | crewdroid up --load mid`);
  if (values.version || cmd === "version") {
    const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
    return console.log(values.json ? JSON.stringify({ version }) : version);
  }
  if (cmd === "measure") {
    if (!values.avd && !values.up) throw new Error("--avd a,b,c or --up N required");
    const r = values.up
      ? await measureUp(Number(values.up), Number(values["base-port"]), Number(values["idle-seconds"]), values.profiles?.split(","))
      : await measure(values.avd!.split(","), Number(values["base-port"]), Number(values["idle-seconds"]));
    const text = JSON.stringify(r, null, 2);
    if (values.out) writeFileSync(values.out, text + "\n");
    console.log(values.json ? text : r.devices.map((d) => `${d.avd} disk=${d.diskBytes} boot=${d.bootSeconds}s ram=${d.ramMB}MB cpu=${d.cpuPercent}%`).join("\n"));
    return;
  }
  if (cmd === "judge") {
    if (!values.rules || (!values.source && !values.log)) throw new Error("--rules <file> and --source <url|file> (server data) and/or --log <proxy.jsonl> (request log) required");
    const r = await judge(values.rules, values.source, values.log);
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const v of r.violations) console.log(`VIOLATION ${v.table} ${v.rule}: ${v.message}\n${v.rows.map((x) => "  " + JSON.stringify(x)).join("\n")}`);
      console.log(r.ok ? `OK: ${r.rules} rules, 0 violations` : `FAIL: ${r.violations.length} violations`);
    }
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "proxy") {
    const [, action] = positionals;
    const num = (k: "port" | "lose-acks" | "seed") => (values[k] === undefined ? undefined : Number(values[k]));
    const o = { target: values.target!, port: num("port"), devices: values.devices?.split(","), log: values.log, loseAcks: num("lose-acks"), seed: num("seed") };
    if ((action === "start" || action === "serve") && !values.target) throw new Error("--target http://host:port required");
    if (action === "serve") return proxyServe({ ...o, log: o.log! }); // internal: the detached worker `proxy start` spawns
    if (action === "start") {
      const r = await proxyStart(o);
      console.log(values.json ? JSON.stringify(r, null, 2) : `proxy pid ${r.pid} -> ${r.target}, log ${r.log}\n${r.ports.map((x) => `${x.device} -> 10.0.2.2:${x.port}`).join("\n")}\n${r.note}`);
    } else if (action === "stop") {
      const r = await proxyStop();
      console.log(values.json ? JSON.stringify(r, null, 2) : r.stopped ? `proxy stopped; cleared ${r.cleared.join(",") || "no device"}; log ${r.log}` : "no proxy running");
    } else if (action === "log") {
      const r = proxyLog();
      console.log(values.json ? JSON.stringify(r, null, 2) : r.entries.map((e) => `${e.t} ${e.device} ${e.method} ${e.path} ${e.status}${e.cut ? " cut" : ""} ${e.ms}ms${e.key ? ` key=${e.key}` : ""}`).join("\n") || `no requests yet (${r.log})`);
    } else throw new Error("usage: proxy start --target http://host:port [--port 5590] [--devices emulator-5580,...] [--log file.jsonl] [--lose-acks 0..1] | proxy stop | proxy log");
    return;
  }
  if (cmd === "prepare" || cmd === "identity") {
    if (!values.image) throw new Error("--image android-34/google_atd required");
    const port = Number(values["base-port"]);
    claimEmulators();
    const r = cmd === "prepare" ? await prepare(values.image, port) : await identity(values.image, Number(values.count ?? 3), port, !values["no-distinct"]);
    const text = JSON.stringify(r, null, 2);
    if (values.out) writeFileSync(values.out, text + "\n");
    console.log(values.json || cmd === "prepare" ? text : `collisions: ${(r as any).collisions.join(",") || "none"}; still same after: ${(r as any).stillSame.join(",") || "none"}`);
    return;
  }
  if (cmd === "up") {
    const screens = values.screen?.flatMap((x) => x.split(","));
    const api = values.api === undefined ? undefined : Number(values.api);
    if (api !== undefined && !Number.isInteger(api)) throw new Error(`--api must be a number like 31|34|36, got '${values.api}'`);
    const num = (k: "cores" | "ram") => (values[k] === undefined ? undefined : Number(values[k]));
    const d = upDefaults({ count: values.count === undefined ? undefined : Number(values.count), profiles: (values.profiles ?? values.profile)?.split(","), api, screens, profilesFile: values["profiles-file"] });
    const r = await up(d.count, Number(values["base-port"]), d.names, values.window, { screens, profilesFile: values["profiles-file"], api: d.api, cores: num("cores"), ramMB: num("ram"), load: values.load });
    console.log(values.json ? JSON.stringify(r, null, 2) : r.devices.map((d) => `${d.serial} ${d.profile} API ${d.api} ${d.width}x${d.height}@${d.density} ${d.cores} cores ${d.ramMB} MB${d.load ? ` load ${d.load.level} MemAvailable ${d.load.guest.memAvailablePct}%` : ""}`).join("\n"));
    return;
  }
  if (cmd === "devices") {
    const r = await (await import("./mcp.ts")).devices();
    console.log(values.json ? JSON.stringify(r, null, 2) : r.map((d) => `${d.serial} API ${d.api} ${d.profile} ${d.screen} ${d.cores} cores ${d.ramMB} MB ${d.booted ? "booted" : "booting"}`).join("\n") || "no crewdroid emulators running");
    return;
  }
  if (cmd === "slim") {
    const r = await slim(Number(values["base-port"]));
    const text = JSON.stringify(r, null, 2);
    if (values.out) writeFileSync(values.out, text + "\n");
    console.log(values.json ? text : r.steps.map((s) => `${(s.totalBytes / 2 ** 30).toFixed(2)} GiB  ${s.step}`).join("\n"));
    return;
  }
  if (cmd === "down") {
    const r = await down();
    console.log(values.json ? JSON.stringify(r) : `killed ${r.killed.length} processes (ports: ${r.ports.join(",") || "none"})`);
    return;
  }
  if (cmd === "net") {
    const [, serial, state, onOff] = positionals;
    if (!serial || !state) throw new Error("usage: net <serial> airplane|nodata|slow|flaky|online [--seed N] | wifi|cellular|both|none | handover [--to wifi|cellular] [--during <ms>] | metered on|off");
    if (state === "flaky-loop") return flakyLoop(serial, Number(values.seed)); // internal: detached worker started by `net flaky`
    if (state === "metered" && onOff !== "on" && onOff !== "off") throw new Error("usage: net <serial> metered on|off");
    const r = await setNet(serial, state as NetCommand, Number(values.seed), { to: values.to as Transport | undefined, during: values.during ? Number(values.during) : undefined, metered: onOff ? onOff === "on" : undefined });
    console.log(values.json ? JSON.stringify(r, null, 2) : `${serial} -> ${state}${onOff ? ` ${onOff}` : ""} (default network ${r.transport.default}${r.transport.metered ? ", metered" : ""}; up: ${r.transport.connected.join(",") || "none"})`);
    return;
  }
  if (cmd === "load") {
    const [, serial, level] = positionals;
    if (!serial || !level) throw new Error("usage: load <serial> off|low|mid|high [--keep-apps]");
    const r = await setLoad(serial, level, { keepApps: values["keep-apps"] });
    const g = r.guest;
    console.log(values.json ? JSON.stringify(r, null, 2) : `${serial} load ${r.level}: MemAvailable ${g.memAvailableMB}/${g.memTotalMB} MB (${g.memAvailablePct}%) cpu busy ${g.cpuBusyPct}% load avg ${g.loadAverage.join(" ")} processes ${g.runningProcesses} (load app ${g.loadProcesses}) packages ${g.installedPackages} (fillers ${g.fillerPackages})`);
    return;
  }
  if (cmd === "hammer") {
    if (!values.url) throw new Error("--url <base> required");
    const r = await hammer({ url: values.url, users: Number(values.users), repeat: Number(values.repeat), jitter: Number(values.jitter), retryRate: Number(values["retry-rate"]), seed: Number(values.seed), rules: values.rules });
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.log(`requests=${r.requests} errors=${r.errors} conflicts=${r.conflicts} retries=${r.retries} ${r.seconds.toFixed(1)}s ${r.throughput} req/s seed=${r.seed}`);
      for (const v of r.judge.violations) console.log(`VIOLATION ${v.table} ${v.rule}: ${v.message}`);
      console.log(r.judge.ok ? `OK: ${r.judge.rules} rules, 0 violations` : `FAIL: ${r.judge.violations.length} violations`);
    }
    if (!r.judge.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "run") {
    const [, file] = positionals;
    if (!file) throw new Error("usage: run <scenario.json> [--seed N] [--count N (default: the file's devices.count, else 3)] [--server-port 5599] [--out file] [--proxy 5590 --log proxy.jsonl [--lose-acks 0..1]]");
    const proxy = values.proxy ? { port: Number(values.proxy), log: values.log ?? "proxy.jsonl", loseAcks: Number(values["lose-acks"] ?? 0) } : undefined;
    const r = await runScenario(file, { count: values.count ? Number(values.count) : undefined, basePort: Number(values["base-port"]), seed: Number(values.seed), serverPort: Number(values["server-port"]), profiles: values.profiles?.split(","), proxy });
    const text = JSON.stringify(r, null, 2);
    if (values.out) writeFileSync(values.out, text + "\n");
    if (values.json) console.log(text);
    else {
      for (const d of r.devices) console.log(`${d.serial} ${d.profile} API ${d.api} net: ${d.network.map((x) => `${x.t}s ${x.state}`).join(", ")} | ${Object.entries(d.log).map(([k, n]) => `${k}=${n}`).join(" ")}`);
      for (const v of r.judge.violations) console.log(`VIOLATION ${v.table} ${v.rule}: ${v.message}`);
      console.log(`${r.ok ? "OK" : "FAIL"}: drained=${r.drained} (${r.drainSeconds}s) violations=${r.judge.violations.length} wall=${r.wallSeconds}s peak cpu=${r.host.peakCpuPercent}% ram=${r.host.peakRamMB}MB seed=${r.seed}`);
    }
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "triage") {
    const [, serial] = positionals;
    if (!serial) throw new Error("usage: triage <serial> [--app <pkg>] [--heap <out.hprof>]");
    const r = await triage(serial, values.app, values.heap);
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const c of r.crashes) console.log(`CRASH ${c.time} ${c.pkg} ${c.exception}\n  at ${c.topFrame}`);
      for (const a of r.anrs) console.log(`ANR ${a.time} ${a.pkg} pid=${a.pid} ${a.reason.slice(0, 120)}`);
      console.log(r.summary);
    }
    return;
  }
  if (cmd === "screen") {
    const [, serial] = positionals;
    if (!serial) throw new Error("usage: screen <serial> [--png <file>] [--bounds]");
    const r = await screen(serial, values.png);
    console.log(values.json ? JSON.stringify(r, null, 2) : screenText(r, { bounds: values.bounds }));
    return;
  }
  if (cmd === "perf") {
    const [, serial, pkg, ...extras] = positionals; // extras after `--` go to am start, e.g. `-- --es check jank`
    if (!serial || !pkg) throw new Error("usage: perf <serial> <pkg> [--activity .Main] [-- <am start extras>]");
    const r = await perf(serial, pkg, values.activity, extras);
    console.log(values.json ? JSON.stringify(r, null, 2) : `${r.component} ${r.start.launchState} TotalTime=${r.start.totalTime}ms | frames=${r.frames.frames} jank=${r.frames.jankPercent}% p50/p90/p99=${r.frames.p50Ms}/${r.frames.p90Ms}/${r.frames.p99Ms}ms | PSS=${r.memory.pssTotalKB}KB java=${r.memory.javaHeapKB} native=${r.memory.nativeHeapKB}`);
    return;
  }
  if (cmd === "apk") {
    const [, file] = positionals;
    if (!file) throw new Error("usage: apk <file.apk>");
    const r = await apk(file);
    console.log(values.json ? JSON.stringify(r, null, 2) : `${r.package} ${r.versionName} (${r.versionCode}) minSdk=${r.minSdk} targetSdk=${r.targetSdk}\npermissions: ${r.permissions.join(", ")}\nexported: ${r.exportedActivities.join(", ")}\ndeep links: ${r.deepLinks.map((d) => `${d.schemes.join("|")}://${d.hosts.join("|")}${d.paths.join("|")}`).join(", ") || "none"}`);
    return;
  }
  if (cmd === "fold" || cmd === "unfold") {
    const [, serial] = positionals;
    if (!serial) throw new Error(`usage: ${cmd} <serial>  (fold = cover screen, unfold = main screen; fold/flip profiles only)`);
    const r = await fold(serial, cmd === "fold" ? "cover" : "main");
    console.log(values.json ? JSON.stringify(r, null, 2) : `${serial} ${r.profile} ${r.state}: ${r.from} -> ${r.to}@${r.density}`);
    return;
  }
  if (cmd === "env") {
    const a = envArgs!.filter((x) => x !== "--json"), hi = a.indexOf("--hold");
    const hold = hi >= 0 ? Number(a.splice(hi, 2)[1]) : undefined;
    const [serial, what, ...rest] = a;
    if (!serial || !what) throw new Error("usage: env <serial> geo|battery|rotate|sensor|dark|font|locale|gsm|sms|call|show [args] [--hold <sec>]");
    const r = await envSet(serial, what, rest, { hold });
    console.log(values.json || envArgs!.includes("--json") ? JSON.stringify(r, null, 2) : `${serial} ${Object.entries(r).filter(([k]) => k !== "serial").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")}`);
    return;
  }
  if (cmd === "app") {
    const [, serial, pkg, what, ...rest] = positionals;
    if (!serial || !pkg || !what) throw new Error("usage: app <serial> <pkg> perm|open|links|clear|backup|restore|pressure|fill-storage [args] [--pkg]");
    const r = await appRun(serial, pkg, what, rest, { pkg: values.pkg });
    console.log(values.json ? JSON.stringify(r, null, 2) : `${serial} ${Object.entries(r).filter(([k]) => k !== "serial").map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ")}`);
    return;
  }
  if (cmd === "setup") {
    const r = await setup({ sdk: values.sdk, images: values.images?.split(","), only: values.only?.split(",") as StepName[] | undefined, dryRun: values["dry-run"], yes: values.yes });
    const mb = (n?: number) => (n ? ` ${Math.round(n / 2 ** 20)} MB` : "");
    console.log(values.json ? JSON.stringify(r, null, 2) : [`sdk: ${r.sdk}`, ...r.steps.map((s: any) => `${s.step}: ${s.status}${mb(s.downloadBytes)}`), `accel: ${r.host.accel.ok === null ? "unknown" : r.host.accel.ok ? "ok" : "FAILED"} (${r.host.accel.detail}); free disk: ${r.host.freeDiskGB ?? "?"} GB`, ...(r.envLine ? [`add to your environment: ${r.envLine}`] : [])].join("\n"));
    return;
  }
  if (cmd === "install") {
    const [, target, file] = positionals;
    if (!target || !file) throw new Error("usage: install <serial|all> <apk> [--grant]");
    const r = await install(target, file, values.grant);
    console.log(values.json ? JSON.stringify(r, null, 2) : r.results.map((x) => `${x.serial} ${x.package ?? "?"} ${x.result}`).join("\n"));
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "launch") {
    const [, serial, pkg, ...extras] = positionals; // extras after `--` go to am start, e.g. `-- --es check crash`
    if (!serial || !pkg) throw new Error("usage: launch <serial> <pkg> [--activity .Main] [--restart] [-- <am start extras>]");
    const r = await launch(serial, pkg, { activity: values.activity, restart: values.restart, extras });
    console.log(values.json ? JSON.stringify(r, null, 2) : `${r.component} ${r.launchState} TotalTime=${r.totalTime}ms${r.crashed ? ` CRASHED: ${r.crash?.exception ?? "process gone, no crash record"}` : ""}`);
    return;
  }
  if (cmd === "logs") {
    const [, serial, pkg] = positionals;
    if (!serial || !pkg) throw new Error("usage: logs <serial> <pkg> [--since 60s|2m] [--level V|D|I|W|E] [--seconds N] [--all]");
    const r = await logs(serial, pkg, { since: values.since, level: values.level, seconds: values.seconds ? Number(values.seconds) : undefined, all: values.all });
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else { if (r.note) console.error(r.note); if (logsHint(r)) console.error(logsHint(r)); for (const l of r.lines) console.log(logLine(l)); }
    return;
  }
  if (cmd === "shot") {
    const [, serial, file] = positionals;
    if (!serial) throw new Error("usage: shot <serial> [file.png]");
    const r = await shot(serial, file);
    console.log(values.json ? JSON.stringify(r, null, 2) : `${r.path} ${r.width}x${r.height} ${r.bytes} bytes${r.blackRelaunch.black ? ` blackRelaunch: ${r.blackRelaunch.recovered ? "recovered" : "NOT recovered"} (ADR 0005)` : ""}`);
    return;
  }
  if (cmd === "tap") {
    const [, serial, x, y] = positionals;
    // `tap <serial> [3]` / `tap <serial> 3` / `tap <serial> --index 3` alone = line [3] of the last screen outline
    const n = y === undefined && x !== undefined ? x.replace(/^\[(\d+)\]$/, "$1") : values.text === undefined && values.id === undefined && x === undefined ? values.index : undefined;
    const t = values.text !== undefined ? { text: values.text } : values.id !== undefined ? { id: values.id } : n !== undefined ? { n: Number(n) } : x !== undefined && y !== undefined ? { x: Number(x), y: Number(y) } : undefined;
    if (!serial || !t) throw new Error("usage: tap <serial> <x> <y> | [n] (from the last screen) | --text <T> | --id <resource-id> [--index N] [--no-screen]");
    const r = await withScreen(serial, (s) => tap(serial, t, "n" in t || values.index === undefined ? undefined : Number(values.index), s), values["no-screen"]);
    console.log(values.json ? JSON.stringify(r, null, 2) : [actionLine("tap", r), ...(r.screen ? [r.screen] : [])].join("\n"));
    return;
  }
  if (cmd === "type") {
    const [, serial, text] = positionals;
    if (!serial || text === undefined) throw new Error("usage: type <serial> <text> [--into <text|id>] [--no-screen]  (non-ASCII needs the on-device helper)");
    const r = await withScreen(serial, (s) => type(serial, text, values.into, s), values["no-screen"]);
    console.log(values.json ? JSON.stringify(r, null, 2) : [actionLine("type", r), ...(r.screen ? [r.screen] : [])].join("\n"));
    return;
  }
  if (cmd === "swipe") {
    const [, serial, ...rest] = positionals;
    if (!serial || !rest.length) throw new Error("usage: swipe <serial> up|down|left|right [--times N] | swipe <serial> x1 y1 x2 y2 [ms]");
    const coords = rest.length >= 4;
    const r = await withScreen(serial, (s) => swipe(serial, { dir: coords ? undefined : rest[0], line: coords ? rest.slice(0, 4).map(Number) : undefined, ms: coords && rest[4] ? Number(rest[4]) : undefined, times: values.times ? Number(values.times) : undefined }, s), values["no-screen"]);
    console.log(values.json ? JSON.stringify(r, null, 2) : [actionLine("swipe", r), ...(r.screen ? [r.screen] : [])].join("\n"));
    return;
  }
  if (cmd === "key") {
    const [, serial, k] = positionals;
    if (!serial || !k) throw new Error("usage: key <serial> back|home|enter|delete|tab|menu|KEYCODE_*");
    const r = await withScreen(serial, (s) => key(serial, k, s), values["no-screen"]);
    console.log(values.json ? JSON.stringify(r, null, 2) : [actionLine("key", r), ...(r.screen ? [r.screen] : [])].join("\n"));
    return;
  }
  if (cmd === "layout") {
    const [, serial, pkg, ...extras] = positionals; // extras after `--` go to am start, e.g. `-- --es check layout-bad`
    if (!serial || !pkg) throw new Error("usage: layout <serial> <pkg> [--activity .X] [--flow flow.yaml] [--profiles a,b] [--fonts 1.0,1.3,2.0] [--out dir] [-- <am start extras>]");
    const fonts = values.fonts?.split(",").map(Number);
    const r = await layout(serial, pkg, { activity: values.activity, flow: values.flow, profiles: values.profiles?.split(","), fonts, extras, out: values.out });
    console.log(values.json ? JSON.stringify(r, null, 2) : layoutText(r));
    if (!r.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "mcp") return (await import("./mcp.ts")).serve(); // stdio MCP server; stays up until stdin closes
  throw new Error(`unknown command: ${cmd ?? "(none)"}  (available: ${COMMANDS})`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(values.json || envArgs?.includes("--json") ? JSON.stringify({ ok: false, error: msg }) : `error: ${msg}`);
  process.exit(1);
});
