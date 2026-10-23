import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adbPath } from "./sdk.ts";

const run = promisify(execFile);

// AI NOTE: a USB phone is plugged in. Every adb call must pass this guard so only emulators are ever targeted.
export function assertSerial(serial: string): string {
  if (!/^emulator-\d+$/.test(serial)) throw new Error(`adb target must be emulator-<port>: '${serial}'`);
  return serial;
}

// adb's own transport errors: the command never reached the device's service, so running it again is safe.
// AI NOTE: seen once in 4 scenario runs (T15-2, `am broadcast` -> "error: closed", no other run on the host, emulator alive);
// cause [모름]. Pollers that expect "offline" during boot pass retry=false so boot times are not stretched.
const TRANSPORT = /error: closed|device offline/;

export async function adb(serial: string, args: string[], timeoutMs = 30000, retry = true): Promise<string> {
  assertSerial(serial);
  for (let i = 0; ; i++) {
    try {
      const { stdout } = await run(adbPath(), ["-s", serial, ...args], { timeout: timeoutMs, windowsHide: true });
      return stdout.trim();
    } catch (e: any) {
      if (!retry || i >= 2 || !TRANSPORT.test(`${e.stderr ?? ""}${e.message ?? ""}`)) throw e;
      console.error(`adb ${serial} ${args[0]}: ${String(e.stderr || e.message).trim().split("\n").at(-1)}; retry ${i + 1}/2 in 3 s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
