import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adbPath } from "./sdk.ts";

const run = promisify(execFile);

// AI NOTE: a USB phone is plugged in. Every adb call must pass this guard so only emulators are ever targeted.
export function assertSerial(serial: string): string {
  if (!/^emulator-\d+$/.test(serial)) throw new Error(`adb target must be emulator-<port>: '${serial}'`);
  return serial;
}

export async function adb(serial: string, args: string[], timeoutMs = 30000): Promise<string> {
  assertSerial(serial);
  const { stdout } = await run(adbPath(), ["-s", serial, ...args], { timeout: timeoutMs, windowsHide: true });
  return stdout.trim();
}
