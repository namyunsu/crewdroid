import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adb } from "./adb.ts";
import { avdName, createAvd, imageInstalled, installImage } from "./avd.ts";
import { waitBoot } from "./measure.ts";
import { emulatorPath } from "./sdk.ts";

const run = promisify(execFile);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const PKG = "dev.crewdroid.probe";
export const probeApk = () => join(import.meta.dirname, "..", "probe-app/app/build/outputs/apk/debug/app-debug.apk");
export const SNAPSHOT = "default_boot"; // quickboot snapshot name; -read-only instances load it automatically

// AI NOTE: no -no-snapshot here (avd.ts launchArgs has it): snapshots must stay enabled to save/load default_boot.
export function start(name: string, port: number, readOnly: boolean, extra: string[] = []) {
  const args = ["-avd", name, "-port", String(port), "-no-window", "-no-audio", "-gpu", "host", "-camera-back", "emulated", "-cores", "2", "-memory", "2048", ...(readOnly ? ["-read-only"] : ["-no-snapshot-save"]), ...extra];
  const log = openSync(join(tmpdir(), `crewdroid-${name}-${port}.log`), "w");
  spawn(emulatorPath(), args, { detached: true, stdio: ["ignore", log, "ignore"], windowsHide: true }).unref();
}

export async function killAll(name: string, serials: string[]) {
  for (const s of serials) await adb(s, ["emu", "kill"], 10000).catch(() => {});
  await sleep(5000);
  await run("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '(^|[ @"])${name}([ "]|$)' -and $_.Name -match 'emulator|qemu' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { windowsHide: true }).catch(() => {});
}

// Boots the base AVD once (writable), installs the probe app, saves a clean snapshot, shuts down.
export async function prepare(image: string, port = 5580) {
  if (!imageInstalled(image)) await installImage(image);
  const name = await createAvd(image);
  const serial = `emulator-${port}`;
  if (!existsSync(probeApk())) throw new Error(`probe apk missing: ${probeApk()} (run gradlew assembleDebug in probe-app/)`);
  try {
    start(name, port, false);
    const bootSeconds = await waitBoot(serial, Date.now());
    await sleep(10000); // let boot-time jobs settle so the snapshot is clean
    await adb(serial, ["install", "-r", probeApk()], 120000);
    await adb(serial, ["shell", "pm", "grant", PKG, "android.permission.CAMERA"]);
    await adb(serial, ["emu", "avd", "snapshot", "save", SNAPSHOT], 120000);
    return { avd: name, snapshot: SNAPSHOT, bootSeconds };
  } finally {
    await killAll(name, [serial]);
  }
}
