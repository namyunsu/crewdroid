// T12 verify: boots one crewdroid emulator (up --count 1), asserts every emulator/qemu process of a crew-* AVD has MainWindowHandle 0,
// then kills it with `down`. Exit 0 only if at least one process was seen and all had no window.
// usage: node scripts/check-hidden.mjs [--base-port 5580]
import { spawnSync, execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
const { values } = parseArgs({ options: { "base-port": { type: "string", default: "5580" } } });
const cli = ["--import", "tsx", "src/cli.ts"];
const psRows = () => {
  const ps = `$r = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'emulator|qemu' -and $_.CommandLine -match '(^|[ @"])crew-[^ "]+([ "]|$)' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; hwnd = if ($p) { [int64]$p.MainWindowHandle } else { -1 } } }); ConvertTo-Json -Compress -InputObject $r`;
  const out = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", windowsHide: true }).trim();
  return JSON.parse(out || "[]");
};

let up;
try {
  const r = spawnSync(process.execPath, [...cli, "up", "--count", "1", "--base-port", values["base-port"], "--json"], { encoding: "utf8", windowsHide: true, maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) throw new Error(`up failed (exit ${r.status}): ${r.stderr.slice(-800)}`);
  up = JSON.parse(r.stdout);
  const rows = psRows();
  console.log(JSON.stringify(rows));
  if (!rows.length) throw new Error("no crew-* emulator/qemu process found after up");
  const visible = rows.filter((x) => x.hwnd !== 0);
  if (visible.length) throw new Error(`visible windows: ${JSON.stringify(visible)}`);
  console.log(`OK: ${rows.length} crew-* emulator/qemu processes, all MainWindowHandle 0`);
} finally {
  const d = spawnSync(process.execPath, [...cli, "down", "--json"], { encoding: "utf8", windowsHide: true });
  if (d.status !== 0) console.error(`down failed (exit ${d.status}): ${d.stderr}`);
  const left = psRows();
  if (left.length) { console.error(`FAIL: crew-* processes left after down: ${JSON.stringify(left)}`); process.exitCode = 1; }
}
if (process.exitCode) process.exit(process.exitCode);
