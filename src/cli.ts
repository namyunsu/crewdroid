import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { measure } from "./measure.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    avd: { type: "string" }, "base-port": { type: "string", default: "5580" },
    out: { type: "string" }, json: { type: "boolean", default: false },
    "idle-seconds": { type: "string", default: "60" },
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
  throw new Error(`unknown command: ${cmd ?? "(none)"}  (available: measure)`);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(values.json ? JSON.stringify({ ok: false, error: msg }) : `error: ${msg}`);
  process.exit(1);
});
