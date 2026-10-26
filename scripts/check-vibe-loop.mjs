// T39 verify: node scripts/check-vibe-loop.mjs
// Drives ONLY the crewdroid MCP server over stdio with the official SDK client, the way an AI agent runs the vibe-coding loop:
// setup (dry run) -> up {} -> install probe -> launch check=form -> shot -> screen -> type + tap -> logs -> launch check=crash -> down.
// Prints each step's wall time and the total (target < 3 min). Always downs its emulators.
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { down } from "../src/up.ts";
import { PKG, probeApk } from "../src/snapshot.ts";

const root = join(import.meta.dirname, "..");
const cli = join(root, "src", "cli.ts");
const tmp = mkdtempSync(join(tmpdir(), "crewvibe-"));
const errs = [], times = [];
const claim = (ok, text) => { console.log(`${ok ? "PASS" : "FAIL"} ${text}`); if (!ok) errs.push(text); };
const json = (r) => { try { return JSON.parse(r.content?.find((c) => c.type === "text")?.text ?? "null"); } catch { return null; } };

let client, serial;
// One MCP tool call, timed. Long tools (up) need more than the SDK's 60 s default request timeout.
async function step(name, args, timeoutMs = 120000) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
  const sec = (Date.now() - t0) / 1000;
  times.push([name, sec]);
  console.log(`  ${name} ${sec.toFixed(1)} s${r.isError ? ` ERROR ${r.content?.[0]?.text?.slice(0, 300)}` : ""}`);
  return r;
}

const T0 = Date.now();
try {
  await down(); // also makes this process the lock owner; the server inherits CREWDROID_OWNER through env
  client = new Client({ name: "check-vibe-loop", version: "0.0.1" });
  // the SDK client passes only a few env vars by default; the server needs ANDROID_HOME the way a real MCP client hands it over
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", cli, "mcp"], env: process.env }));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  const need = ["setup", "up", "devices", "install", "launch", "shot", "screen", "tap", "type", "swipe", "key", "logs", "down"];
  claim(need.every((n) => tools.includes(n)), `listTools has ${need.join(", ")}${need.filter((n) => !tools.includes(n)).map((n) => ` (missing ${n})`).join("")}`);

  let r = await step("setup", {});
  let j = json(r);
  claim(!r.isError && j?.dryRun === true && j.steps.length > 0 && j.steps.every((s) => s.status === "present"), `setup dry run: ${j?.steps?.map((s) => `${s.step}=${s.status}`).join(" ")}`);

  r = await step("up", {}, 900000);
  j = json(r);
  serial = j?.devices?.[0]?.serial;
  claim(!r.isError && j?.devices?.length === 1, `up {} -> ${j?.devices?.map((d) => `${d.serial} ${d.profile} API ${d.api}`).join(" | ")}`);
  if (!serial) throw new Error("no device");

  r = await step("install", { target: serial, apk: probeApk() });
  j = json(r);
  claim(!r.isError && j?.ok === true, `install probe: ${j?.results?.map((x) => `${x.serial} ${x.result}`).join(" ")}`);

  r = await step("launch", { serial, pkg: PKG, restart: true, extras: ["--es", "check", "form"] });
  j = json(r);
  claim(!r.isError && j?.crashed === false, `launch check=form: crashed=${j?.crashed} totalTime=${j?.totalTime}`);

  r = await step("shot", { serial, file: join(tmp, "shot.png") });
  const im = r.content?.find((c) => c.type === "image");
  claim(!r.isError && im?.mimeType === "image/png" && im.data.length > 1000, `shot -> image item ${im?.mimeType} ${im?.data?.length ?? 0} b64 chars`);

  r = await step("screen", { serial });
  j = json(r);
  const send = j?.nodes?.find((n) => n.text === "Send");
  claim(!r.isError && !!send, `screen finds Send: ${send ? `${send.cls} ${send.bounds}` : "not found"} (focus ${j?.focus})`);

  const text = "vibe loop 1";
  r = await step("type", { serial, text, into: "name" });
  claim(!r.isError, `type "${text}" into name`);
  r = await step("tap", { serial, text: "Send" });
  claim(!r.isError, `tap Send`);
  await new Promise((ok) => setTimeout(ok, 1000));
  r = await step("logs", { serial, pkg: PKG, since: "1m" });
  j = json(r);
  const form = j?.lines?.filter((l) => l.tag === "CrewProbe" && l.message.startsWith("FORM")).map((l) => l.message) ?? [];
  claim(!r.isError && form.includes(`FORM ${text}`), `logs since 1m has "CrewProbe FORM ${text}": ${JSON.stringify(form)}`);

  r = await step("launch", { serial, pkg: PKG, restart: true, extras: ["--es", "check", "crash"] });
  j = json(r);
  claim(!r.isError && j?.crashed === true, `launch --restart check=crash -> crashed=${j?.crashed} ${j?.crash ? `${j.crash.exception} @ ${j.crash.topFrame}` : ""}`);

  r = await step("down", {}, 120000);
  claim(!r.isError, `down`);
  serial = null;
} catch (e) {
  claim(false, `error: ${e.stack ?? e}`);
} finally {
  await client?.close().catch(() => {});
  if (serial !== null) await down().catch((e) => console.log(`down failed: ${e.message}`));
  rmSync(tmp, { recursive: true, force: true });
}
const total = (Date.now() - T0) / 1000;
console.log(`steps: ${times.map(([n, s]) => `${n} ${s.toFixed(1)}s`).join(", ")}`);
console.log(`total loop: ${total.toFixed(1)} s (target < 180 s${total < 180 ? "" : ", MISSED"})`);
if (errs.length) { console.log(`FAIL: ${errs.length} claims failed`); process.exit(1); }
console.log("OK: vibe-coding loop runs end to end over MCP");
