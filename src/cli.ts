import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { measure } from "./measure.ts";
import { judge } from "./judge.ts";
import { prepare } from "./snapshot.ts";
import { identity } from "./identity.ts";
import { hammer } from "./hammer.ts";
import { flakyLoop, setNet, type NetState } from "./net.ts";
import { claimEmulators, down, measureUp, up, upDefaults } from "./up.ts";
import { runScenario } from "./scenario.ts";
import { slim } from "./slim.ts";
import { triage } from "./triage.ts";
import { screen } from "./screen.ts";
import { perf } from "./perf.ts";
import { apk } from "./apk.ts";
import { fold } from "./fold.ts";
import { envSet } from "./env.ts";
import { appRun } from "./app.ts";
import { setup, type StepName } from "./setup.ts";
import { install, launch, logs } from "./appctl.ts";
import { key, swipe, tap, type } from "./input.ts";
import { shot } from "./shot.ts";

// AI NOTE: `env` takes negative numbers (geo -122.08 37.4) that parseArgs would read as options, so its args are parsed by hand.
const envArgs = process.argv[2] === "env" ? process.argv.slice(3) : undefined;
const { positionals, values } = parseArgs({
  args: envArgs ? ["env"] : undefined,
  allowPositionals: true,
  options: {
    avd: { type: "string" }, "base-port": { type: "string", default: "5580" },
    out: { type: "string" }, json: { type: "boolean", default: false },
    "idle-seconds": { type: "string", default: "60" },
    rules: { type: "string" }, source: { type: "string" },
    image: { type: "string" }, screen: { type: "string", multiple: true }, "profiles-file": { type: "string" }, profiles: { type: "string" }, up: { type: "string" }, count: { type: "string" }, api: { type: "string" }, profile: { type: "string" }, "no-distinct": { type: "boolean", default: false }, window: { type: "boolean", default: false },
    url: { type: "string" }, users: { type: "string", default: "10" }, repeat: { type: "string", default: "5" },
    jitter: { type: "string", default: "50" }, "retry-rate": { type: "string", default: "0.1" }, seed: { type: "string", default: "1" },
    "server-port": { type: "string", default: "5599" }, help: { type: "boolean", default: false },
    app: { type: "string" }, pkg: { type: "boolean", default: false }, heap: { type: "string" }, png: { type: "string" }, activity: { type: "string" },
    sdk: { type: "string" }, images: { type: "string" }, only: { type: "string" }, "dry-run": { type: "boolean", default: false }, yes: { type: "boolean", default: false },
    grant: { type: "boolean", default: false }, restart: { type: "boolean", default: false }, since: { type: "string" }, level: { type: "string" }, seconds: { type: "string" },
    text: { type: "string" }, id: { type: "string" }, index: { type: "string" }, into: { type: "string" }, times: { type: "string" },
  },
});

const COMMANDS = "up, devices, down, slim, measure, judge, prepare, identity, hammer, net, run, triage, screen, perf, apk, fold, unfold, env, app, setup, install, launch, logs, shot, tap, type, swipe, key, mcp";

async function main() {
  const [cmd] = positionals;
  if (values.help || cmd === "help") return console.log(`usage: crewdroid <command> [options]\ncommands: ${COMMANDS}\nexample: crewdroid up (one device) | crewdroid up --count 3 | crewdroid up --api 31`);
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
    if (!values.rules || !values.source) throw new Error("--rules <file> --source <url|file> required");
    const r = await judge(values.rules, values.source);
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const v of r.violations) console.log(`VIOLATION ${v.table} ${v.rule}: ${v.message}\n${v.rows.map((x) => "  " + JSON.stringify(x)).join("\n")}`);
      console.log(r.ok ? `OK: ${r.rules} rules, 0 violations` : `FAIL: ${r.violations.length} violations`);
    }
    if (!r.ok) process.exitCode = 1;
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
    const d = upDefaults({ count: values.count === undefined ? undefined : Number(values.count), profiles: (values.profiles ?? values.profile)?.split(","), api, screens, profilesFile: values["profiles-file"] });
    const r = await up(d.count, Number(values["base-port"]), d.names, values.window, { screens, profilesFile: values["profiles-file"], api: d.api });
    console.log(values.json ? JSON.stringify(r, null, 2) : r.devices.map((d) => `${d.serial} ${d.profile} API ${d.api} ${d.width}x${d.height}@${d.density}`).join("\n"));
    return;
  }
  if (cmd === "devices") {
    const r = await (await import("./mcp.ts")).devices();
    console.log(values.json ? JSON.stringify(r, null, 2) : r.map((d) => `${d.serial} API ${d.api} ${d.profile} ${d.screen} ${d.booted ? "booted" : "booting"}`).join("\n") || "no crewdroid emulators running");
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
    const [, serial, state] = positionals;
    if (!serial || !state) throw new Error("usage: net <serial> airplane|nodata|slow|flaky|online [--seed N]");
    if (state === "flaky-loop") return flakyLoop(serial, Number(values.seed)); // internal: detached worker started by `net flaky`
    const r = await setNet(serial, state as NetState, Number(values.seed));
    console.log(values.json ? JSON.stringify(r, null, 2) : `${serial} -> ${state}`);
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
    if (!file) throw new Error("usage: run <scenario.json> [--seed N] [--count 3] [--server-port 5599] [--out file]");
    const r = await runScenario(file, { count: Number(values.count ?? 3), basePort: Number(values["base-port"]), seed: Number(values.seed), serverPort: Number(values["server-port"]), profiles: values.profiles?.split(",") });
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
    if (!serial) throw new Error("usage: screen <serial> [--png <file>]");
    const r = await screen(serial, values.png);
    console.log(values.json ? JSON.stringify(r, null, 2) : [...(r.blackRelaunch.black ? [`blackRelaunch: API 31 black screen after relaunch, ${r.blackRelaunch.recovered ? "recovered" : "NOT recovered"} (ADR 0005)`] : []), `focus: ${r.focus}`, ...r.nodes.map((n) => `${"  ".repeat(n.depth)}${n.cls.split(".").at(-1)} ${JSON.stringify(n.text || n.desc || n.id)} [${n.bounds}]${n.clickable ? " clickable" : ""}`)].join("\n"));
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
    if (!serial || !pkg) throw new Error("usage: logs <serial> <pkg> [--since 60s|2m] [--level V|D|I|W|E] [--seconds N]");
    const r = await logs(serial, pkg, { since: values.since, level: values.level, seconds: values.seconds ? Number(values.seconds) : undefined });
    if (values.json) console.log(JSON.stringify(r, null, 2));
    else { if (r.note) console.error(r.note); for (const l of r.lines) console.log(`${l.time} ${l.level} ${l.tag}: ${l.message}`); }
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
    const t = values.text !== undefined ? { text: values.text } : values.id !== undefined ? { id: values.id } : x !== undefined && y !== undefined ? { x: Number(x), y: Number(y) } : undefined;
    if (!serial || !t) throw new Error("usage: tap <serial> <x> <y> | --text <T> | --id <resource-id> [--index N]");
    const r = await tap(serial, t, values.index === undefined ? undefined : Number(values.index));
    console.log(values.json ? JSON.stringify(r, null, 2) : `tapped ${r.x},${r.y}${r.node ? ` ${JSON.stringify(r.node.text || r.node.desc)} id=${r.node.id || "-"} [${r.node.bounds}]` : ""}`);
    return;
  }
  if (cmd === "type") {
    const [, serial, text] = positionals;
    if (!serial || text === undefined) throw new Error("usage: type <serial> <text> [--into <text|id>]  (ASCII only)");
    const r = await type(serial, text, values.into);
    console.log(values.json ? JSON.stringify(r, null, 2) : `typed ${JSON.stringify(r.text)}${r.into ? ` into ${r.into.id || r.into.text}` : ""}`);
    return;
  }
  if (cmd === "swipe") {
    const [, serial, ...rest] = positionals;
    if (!serial || !rest.length) throw new Error("usage: swipe <serial> up|down|left|right [--times N] | swipe <serial> x1 y1 x2 y2 [ms]");
    const coords = rest.length >= 4;
    const r = await swipe(serial, { dir: coords ? undefined : rest[0], line: coords ? rest.slice(0, 4).map(Number) : undefined, ms: coords && rest[4] ? Number(rest[4]) : undefined, times: values.times ? Number(values.times) : undefined });
    console.log(values.json ? JSON.stringify(r, null, 2) : `swiped ${r.from} -> ${r.to} ${r.ms}ms x${r.times}`);
    return;
  }
  if (cmd === "key") {
    const [, serial, k] = positionals;
    if (!serial || !k) throw new Error("usage: key <serial> back|home|enter|delete|tab|menu|KEYCODE_*");
    const r = await key(serial, k);
    console.log(values.json ? JSON.stringify(r, null, 2) : `${r.key} -> focus ${r.focus}`);
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
