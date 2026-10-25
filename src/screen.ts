import { resolve } from "node:path";
import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import type { Tool } from "./mcp.ts";

export interface UiNode { cls: string; text: string; desc: string; id: string; bounds: [number, number, number, number]; clickable: boolean; depth: number }

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

// `uiautomator dump` XML -> flat list in document order with nesting depth. Compact: layout-only nodes (no text, desc, id and
// not clickable) are dropped, their children keep their real depth.
export function parseUiDump(xml: string): UiNode[] {
  const out: UiNode[] = [];
  let depth = -1;
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0] === "</node>") { depth--; continue; }
    depth++;
    const a: Record<string, string> = {};
    for (const x of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[x[1]] = unxml(x[2]);
    const b = (a.bounds?.match(/-?\d+/g) ?? [0, 0, 0, 0]).map(Number) as UiNode["bounds"];
    const n = { cls: a.class ?? "", text: a.text ?? "", desc: a["content-desc"] ?? "", id: a["resource-id"] ?? "", bounds: b, clickable: a.clickable === "true", depth };
    if (n.text || n.desc || n.id || n.clickable) out.push(n);
    if (m[2] === "/") depth--;
  }
  return out;
}

export async function screen(serial: string, png?: string) {
  assertSerial(serial);
  const win = await adb(serial, ["shell", "dumpsys window | grep mCurrentFocus; true"]);
  const focus = win.match(/mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/)?.[1] ?? (win.match(/mCurrentFocus=(\S+)/)?.[1] ?? "");
  const remote = "/data/local/tmp/crewdroid-ui.xml";
  const dump = await adb(serial, ["shell", `uiautomator dump ${remote} >/dev/null && cat ${remote}`], 60000);
  if (!dump.includes("<hierarchy")) throw new Error(`uiautomator dump failed on ${serial}: ${dump.slice(0, 300)}`);
  let pngOut: string | undefined;
  if (png) {
    await adb(serial, ["shell", "screencap -p /data/local/tmp/crewdroid-screen.png"]);
    await adb(serial, ["pull", "/data/local/tmp/crewdroid-screen.png", resolve(png)], 60000);
    pngOut = resolve(png);
  }
  return {
    serial, focus, nodes: parseUiDump(dump), png: pngOut,
    note: "Compose: Modifier.testTag shows as id only under Modifier.semantics { testTagsAsResourceId = true }; otherwise only text/desc",
  };
}

export const mcpTools: Tool[] = [{
  name: "screen", description: "What is on screen: focused window (dumpsys window) and a compact accessibility tree from uiautomator ({cls,text,desc,id,bounds,clickable,depth}); optional PNG.",
  input: { serial: z.string().describe("emulator-<port>"), png: z.string().optional().describe("host path for a screenshot") },
  run: (a) => screen(a.serial, a.png),
}];
