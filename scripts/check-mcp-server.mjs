// usage: node scripts/check-mcp-server.mjs -> spawns `crewdroid mcp` over stdio with the SDK client (no emulator needed):
// listTools has devices/judge/net/up; judge on a BUGGY export fixture reports violations; net rejects a USB-phone serial;
// devices returns a JSON array. Exit 0 only if all hold.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Shape of GET /export from sample/server with BUGGY=1 after a retried upload, a lost upload and two edits of one version.
const fixture = {
  uploads: [{ id: 1, key: "k1", clientId: "c1" }, { id: 2, key: "k1", clientId: "c1" }, { id: 3, key: "k2", clientId: "c2" }],
  records: [{ id: "r1", version: 2, value: "edit-by-c3", clientId: "c3" }],
  acks: [{ id: 1, key: "k1", clientId: "c1" }, { id: 2, key: "k1", clientId: "c1" }, { id: 3, key: "k2", clientId: "c2" }, { id: 4, key: "k3", clientId: "c3" }],
  writes: [
    { id: "r1", baseVersion: 0, version: 1, clientId: "c1", value: "created" },
    { id: "r1", baseVersion: 1, version: 2, clientId: "c2", value: "edit-by-c2" },
    { id: "r1", baseVersion: 1, version: 2, clientId: "c3", value: "edit-by-c3" },
  ],
};
const source = join(mkdtempSync(join(tmpdir(), "crew-mcp-")), "buggy-export.json");
writeFileSync(source, JSON.stringify(fixture));

const client = new Client({ name: "check-mcp-server", version: "0.0.1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/cli.ts", "mcp"] }));
let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) fail++; };
try {
  const names = (await client.listTools()).tools.map((t) => t.name);
  console.log(`tools: ${names.join(", ")}`);
  ok(["devices", "judge", "net", "up"].every((n) => names.includes(n)), "listTools has devices, judge, net, up");

  const j = await client.callTool({ name: "judge", arguments: { rules: "judge/sample.rules.json", source } });
  const jt = j.content[0].text;
  const rules = JSON.parse(jt).violations.map((v) => v.rule);
  console.log(`judge isError=${j.isError} violations=${JSON.stringify(rules)}`);
  ok(j.isError === false && ["unique(key)", "count(acks)", "noLostUpdate(id,baseVersion)"].every((r) => rules.includes(r)), "judge: isError false, dup/missing/lost update in text");

  const n = await client.callTool({ name: "net", arguments: { serial: "R3CT1234", state: "online" } });
  console.log(`net isError=${n.isError} text=${n.content[0].text}`);
  ok(n.isError === true && n.content[0].text.includes("adb target must be emulator-<port>"), "net R3CT1234: isError true with the guard message");

  const d = await client.callTool({ name: "devices", arguments: {} });
  console.log(`devices isError=${d.isError} text=${d.content[0].text.replace(/\s+/g, " ")}`);
  ok(d.isError === false && Array.isArray(JSON.parse(d.content[0].text)), "devices: JSON array");
} finally {
  await client.close();
}
console.log(fail ? `FAIL: ${fail} check(s)` : "OK: crewdroid mcp serves devices/judge/net/up over stdio");
process.exit(fail ? 1 : 0);
