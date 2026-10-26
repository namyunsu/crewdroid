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
  },
});

const COMMANDS = "up, devices, down, slim, measure, judge, prepare, identity, hammer, net, run, triage, screen, perf, apk, fold, unfold, env, app, mcp";

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
  if (cmd === "mcp") return (await import("./mcp.ts")).serve(); // stdio MCP server; stays up until stdin closes
  throw new Error(`unknown command: ${cmd ?? "(none)"}  (available: ${COMMANDS})`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(values.json || envArgs?.includes("--json") ? JSON.stringify({ ok: false, error: msg }) : `error: ${msg}`);
  process.exit(1);
});
