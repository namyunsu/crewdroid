import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { measure } from "./measure.ts";
import { judge } from "./judge.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    avd: { type: "string" }, "base-port": { type: "string", default: "5580" },
    out: { type: "string" }, json: { type: "boolean", default: false },
    "idle-seconds": { type: "string", default: "60" },
    rules: { type: "string" }, source: { type: "string" },
  },
});

async function main() {
  const [cmd] = positionals;
  if (cmd === "measure") {
    if (!values.avd) throw new Error("--avd a,b,c required");
    const r = await measure(values.avd.split(","), Number(values["base-port"]), Number(values["idle-seconds"]));
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
  throw new Error(`unknown command: ${cmd ?? "(none)"}  (available: measure, judge)`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(values.json ? JSON.stringify({ ok: false, error: msg }) : `error: ${msg}`);
  process.exit(1);
});
