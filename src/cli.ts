import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { measure } from "./measure.ts";
import { judge } from "./judge.ts";
import { prepare } from "./snapshot.ts";
import { identity } from "./identity.ts";
import { hammer } from "./hammer.ts";
import { down, measureUp, up } from "./up.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    avd: { type: "string" }, "base-port": { type: "string", default: "5580" },
    out: { type: "string" }, json: { type: "boolean", default: false },
    "idle-seconds": { type: "string", default: "60" },
    rules: { type: "string" }, source: { type: "string" },
    image: { type: "string" }, profiles: { type: "string" }, up: { type: "string" }, count: { type: "string", default: "3" }, "no-distinct": { type: "boolean", default: false },
    url: { type: "string" }, users: { type: "string", default: "10" }, repeat: { type: "string", default: "5" },
    jitter: { type: "string", default: "50" }, "retry-rate": { type: "string", default: "0.1" }, seed: { type: "string", default: "1" },
  },
});

async function main() {
  const [cmd] = positionals;
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
    const r = cmd === "prepare" ? await prepare(values.image, port) : await identity(values.image, Number(values.count), port, !values["no-distinct"]);
    const text = JSON.stringify(r, null, 2);
    if (values.out) writeFileSync(values.out, text + "\n");
    console.log(values.json || cmd === "prepare" ? text : `collisions: ${(r as any).collisions.join(",") || "none"}; still same after: ${(r as any).stillSame.join(",") || "none"}`);
    return;
  }
  if (cmd === "up") {
    const r = await up(Number(values.count), Number(values["base-port"]), values.profiles?.split(","));
    console.log(values.json ? JSON.stringify(r, null, 2) : r.devices.map((d) => `${d.serial} ${d.profile} API ${d.api} ${d.width}x${d.height}@${d.density}`).join("\n"));
    return;
  }
  if (cmd === "down") {
    const r = await down();
    console.log(values.json ? JSON.stringify(r) : `killed ${r.killed.length} processes (ports: ${r.ports.join(",") || "none"})`);
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
  throw new Error(`unknown command: ${cmd ?? "(none)"}  (available: up, down, measure, judge, prepare, identity, hammer)`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(values.json ? JSON.stringify({ ok: false, error: msg }) : `error: ${msg}`);
  process.exit(1);
});
