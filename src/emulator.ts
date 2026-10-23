import { spawn } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { emulatorPath } from "./sdk.ts";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

// Every emulator launch goes through here. Same as private-app avd-up.ps1: Start-Process -WindowStyle Hidden.
// Node's detached spawn left the grandchild qemu-system-*-headless.exe with a visible console window (2026-10-23).
// Returns the launcher PID; down()/killAll() match instances by their `crew-*` command line, not by this PID.
// AI NOTE: powershell's stdout/stderr are ignored and the PID goes through a file. With execFile, the emulator
// inherited the pipe and the promise never resolved (up hung after launch).
export async function launchEmulator(args: string[], log: string, window = false): Promise<number> {
  const pidFile = `${log}.pid`;
  const ps = `$p = Start-Process -FilePath ${q(emulatorPath())} -ArgumentList @(${args.map(q).join(",")}) -WindowStyle ${window ? "Minimized" : "Hidden"} -PassThru -RedirectStandardOutput ${q(log)} -RedirectStandardError ${q(log + ".err")}; Set-Content -LiteralPath ${q(pidFile)} -Value $p.Id`;
  await new Promise<void>((ok, fail) => {
    const p = spawn("powershell", ["-NoProfile", "-Command", ps], { stdio: "ignore", windowsHide: true });
    p.on("error", fail);
    p.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`emulator launch failed (powershell exit ${code})`))));
  });
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  unlinkSync(pidFile);
  if (!pid) throw new Error(`emulator launch returned no PID`);
  return pid;
}
