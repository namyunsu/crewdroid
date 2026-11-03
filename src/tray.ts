import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Windows tray icon for the hidden emulators: up writes the state file and starts src/tray.ps1, every command writes one
// activity line, down removes both and the icon quits by itself. Launch flags do not change. CREWDROID_NO_TRAY=1 turns it off.
const dir = () => process.env.CREWDROID_TRAY_DIR || tmpdir();
export const TRAY_STATE = () => join(dir(), "crewdroid-tray.json");
export const TRAY_ACTIVITY = () => join(dir(), "crewdroid-tray.last");
const off = (platform: string) => platform !== "win32" || !!process.env.CREWDROID_NO_TRAY;

export type TrayDevice = { serial: string; port: number; profile: string; api: number };

export function trayState(status: "starting" | "ready", devices: TrayDevice[], platform: string = process.platform) {
  if (!off(platform)) writeFileSync(TRAY_STATE(), JSON.stringify({ status, pid: process.pid, devices }));
}

// Command and serial only: `type` arguments can be passwords and these files are plain text.
export function trayAction(cmd: string, target?: string) {
  if (["devices", "mcp", "up", "down", "reap"].includes(cmd) || !existsSync(TRAY_STATE())) return;
  writeFileSync(TRAY_ACTIVITY(), target ? `${cmd} ${target}` : cmd);
}

export function trayClear() {
  for (const f of [TRAY_STATE(), TRAY_ACTIVITY()]) rmSync(f, { force: true });
}

// Only one icon runs (mutex in tray.ps1). The icon is a convenience: failing to start it never fails `up`.
// NOTE: Start-Process as in platform.ts launchDetached; powershell under Node's detached spawn exits at once without running the script.
export function startTray(platform: string = process.platform, sp: typeof spawn = spawn) {
  if (off(platform)) return;
  const args = `-NoProfile -ExecutionPolicy Bypass -Sta -File "${join(import.meta.dirname, "tray.ps1")}" -State "${TRAY_STATE()}" -Activity "${TRAY_ACTIVITY()}"`;
  const p = sp("powershell", ["-NoProfile", "-Command", `Start-Process powershell -WindowStyle Hidden -ArgumentList '${args.replaceAll("'", "''")}'`], { stdio: "ignore", windowsHide: true });
  p.on("error", () => {});
  p.unref();
}
