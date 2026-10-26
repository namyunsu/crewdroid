import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { assertSerial } from "./adb.ts";
import type { Tool } from "./mcp.ts";
import { unblack } from "./screen.ts";
import { adbPath } from "./sdk.ts";

const run = promisify(execFile);

// PNG signature + IHDR width/height (big-endian at 16/20)
export function pngSize(b: Buffer): { width: number; height: number } {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString("latin1", 12, 16) !== "IHDR") throw new Error(`not a PNG (${b.length} bytes: ${b.subarray(0, 60).toString("latin1").trim()})`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const p2 = (n: number) => String(n).padStart(2, "0");
export const stamp = (d = new Date()) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

export async function shot(serial: string, file?: string) {
  assertSerial(serial);
  const blackRelaunch = await unblack(serial); // ADR 0005: API 31 black-after-relaunch is recovered first, not captured
  const { stdout } = await run(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 2 ** 28, timeout: 60000, windowsHide: true });
  const size = pngSize(stdout);
  const path = resolve(file ?? `crewdroid-${serial}-${stamp()}.png`);
  writeFileSync(path, stdout);
  return { serial, path, ...size, bytes: stdout.length, blackRelaunch };
}

export const mcpTools: Tool[] = [{
  name: "shot", description: "Use to SEE the screen (pixels: layout, colours, clipping). Returns an image item (PNG, also saved to file or ./crewdroid-<serial>-<time>.png) and a text line with path and size. To find a button or text to tap, use screen instead. On API 31 a fully black screen after an app relaunch (emulator bug, ADR 0005) is recovered first.",
  input: { serial: z.string().describe("emulator-<port>"), file: z.string().optional().describe("host path for the PNG") },
  run: (a) => shot(a.serial, a.file),
  content: (r: Awaited<ReturnType<typeof shot>>) => [
    { type: "image", mimeType: "image/png", data: readFileSync(r.path).toString("base64") },
    { type: "text", text: `${r.path} ${r.width}x${r.height}${r.blackRelaunch.black ? ` blackRelaunch=${r.blackRelaunch.recovered ? "recovered" : "NOT recovered"}` : ""}` },
  ],
}];
