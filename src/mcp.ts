import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z, type ZodRawShape } from "zod";
import { adb } from "./adb.ts";
import { hammer } from "./hammer.ts";
import { judge } from "./judge.ts";
import { NET_STATES, setNet } from "./net.ts";
import { loadProfiles } from "./profiles.ts";
import { runScenario } from "./scenario.ts";
import { down, up, upDefaults } from "./up.ts";

const run = promisify(execFile);

// A feature module adds MCP tools by exporting `mcpTools: Tool[]`; serve() picks up every src/*.ts that does.
// `long` tools get a `timeoutSec` input and should print progress with console.error (sent as logging notifications).
// `content` (optional) turns the result into MCP content items (e.g. an image); without it the result is sent as JSON text.
export type ContentItem = { type: "text"; text: string } | { type: "image"; mimeType: string; data: string };
export interface Tool { name: string; description: string; input: ZodRawShape; long?: boolean; run(args: any): Promise<unknown>; content?(result: any): ContentItem[] }

// Running crew emulators. AI NOTE: same process query as down() in up.ts (crew-* AVD on the command line); profile is
// recovered by matching the device's current wm size/density against profiles/galaxy.json (up() does not record it).
export async function devices(): Promise<{ serial: string; avd: string; api: number | null; profile: string; size: string; density: string; screen: string; booted: boolean }[]> {
  const ps = `ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'emulator|qemu' -and $_.CommandLine -match '(^|[ @"])crew-[^ "]+([ "]|$)' } | ForEach-Object { $_.CommandLine })`;
  const { stdout } = await run("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
  const byPort = new Map<number, string>();
  for (const cmd of JSON.parse(stdout.trim() || "[]") as string[]) {
    const port = Number(cmd.match(/-port\s+(\d+)/)?.[1]);
    const avd = cmd.match(/(?:^|[ @"])(crew-[^ "]+)/)?.[1];
    if (port > 0 && avd) byPort.set(port, avd);
  }
  const profiles = loadProfiles();
  const wm = async (serial: string, what: string) => {
    const out = await adb(serial, ["shell", "wm", what], 5000, false).catch(() => "");
    return (out.match(/Override \w+: (\S+)/) ?? out.match(/Physical \w+: (\S+)/))?.[1] ?? "";
  };
  return Promise.all([...byPort].sort(([a], [b]) => a - b).map(async ([port, avd]) => {
    const serial = `emulator-${port}`;
    const [size, density] = [await wm(serial, "size"), await wm(serial, "density")];
    const match = profiles.filter((p) => `${p.width}x${p.height}` === size && String(p.density) === density).map((p) => p.name);
    const booted = (await adb(serial, ["shell", "getprop", "sys.boot_completed"], 5000, false).catch(() => "")).trim() === "1";
    return { serial, avd, api: Number(avd.match(/android-(\d+)/)?.[1]) || null, profile: match.join(",") || "unknown", size, density, screen: `${size}@${density}`, booted };
  }));
}

const core: Tool[] = [
  { name: "devices", description: "Use to find the emulator-<port> serial every other tool needs, or to check what is already running. Returns [{serial, avd, api, profile, screen, booted}]; empty = call up.", input: {}, run: () => devices() },
  {
    name: "up", long: true, description: "Start of the loop: boot headless emulators (1-3 min). No args = ONE device (s24ultra, newest API <= 36), the right choice for building/checking an app; count > 1 mixes Galaxy profiles and Android versions. Returns {devices:[{serial, api, profile, wmSize}]}; pass serial to every other tool.",
    input: { count: z.number().int().min(1).optional(), api: z.number().int().optional().describe("pin the image API, e.g. 31|34|36"), profiles: z.array(z.string()).optional().describe("profile names from profiles/galaxy.json"), basePort: z.number().int().default(5580) },
    run: (a) => { const d = upDefaults(a); return up(d.count, a.basePort, d.names, false, { api: d.api }); },
  },
  { name: "down", description: "End of the loop: kill every crewdroid (crew-*) emulator. Always call it when finished. Returns {killed: pids, ports}.", input: {}, run: () => down() },
  {
    name: "net", description: "Set one emulator's network state.",
    input: { serial: z.string().describe("emulator-<port>"), state: z.enum(NET_STATES as [string, ...string[]]), seed: z.number().int().default(1) },
    run: (a) => setNet(a.serial, a.state, a.seed),
  },
  {
    name: "judge", description: "Judge server data against rules (unique / count / noLostUpdate). ok=false lists violations.",
    input: { rules: z.string().default("judge/sample.rules.json"), source: z.string().describe("server base URL (GETs /export) or JSON file") },
    run: (a) => judge(a.rules, a.source),
  },
  {
    name: "hammer", description: "Virtual users hit a server API concurrently, then judge the result.",
    input: { url: z.string(), users: z.number().int().default(10), repeat: z.number().int().default(5), jitter: z.number().default(50), retryRate: z.number().default(0.1), seed: z.number().int().default(1), rules: z.string().optional() },
    run: (a) => hammer(a),
  },
  {
    name: "run", long: true, description: "Run a multi-device scenario file: up, app, network schedule, judge, down (minutes).",
    input: { file: z.string().describe("e.g. scenarios/photo-upload.json"), seed: z.number().int().default(1), count: z.number().int().default(3), basePort: z.number().int().default(5580), serverPort: z.number().int().default(5599) },
    run: (a) => runScenario(a.file, a),
  },
];

async function moduleTools(): Promise<Tool[]> {
  const dir = import.meta.dirname;
  const out: Tool[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "cli.ts" && f !== "mcp.ts")) {
    const m = await import(pathToFileURL(join(dir, f)).href);
    if (Array.isArray(m.mcpTools)) out.push(...m.mcpTools);
  }
  return out;
}

const text = (s: string, isError = false) => ({ content: [{ type: "text" as const, text: s }], isError });

export async function serve() {
  const server = new McpServer({ name: "crewdroid", version: "0.0.1" }, { capabilities: { logging: {} } });
  // AI NOTE: stdout is the JSON-RPC channel. Library progress lines go to stderr and, as logging notifications, to the client.
  const err = console.error.bind(console);
  console.log = console.error = (...a: unknown[]) => {
    err(...a);
    server.sendLoggingMessage({ level: "info", logger: "crewdroid", data: a.map(String).join(" ") }).catch(() => {});
  };
  for (const t of [...core, ...(await moduleTools())]) {
    const input = t.long ? { ...t.input, timeoutSec: z.number().int().min(1).default(900) } : t.input;
    server.registerTool(t.name, { description: t.description, inputSchema: input }, async (a: any) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        const work = t.run(a);
        const r = t.long
          ? await Promise.race([work, new Promise((_, no) => { timer = setTimeout(() => no(new Error(`${t.name} timed out after ${a.timeoutSec}s (emulators may still run; call down)`)), a.timeoutSec * 1000); })])
          : await work;
        return t.content ? { content: t.content(r), isError: false } : text(JSON.stringify(r ?? null, null, 2));
      } catch (e) {
        return text(`error: ${e instanceof Error ? e.message : String(e)}`, true);
      } finally {
        clearTimeout(timer);
      }
    });
  }
  await server.connect(new StdioServerTransport());
}
