import { readFileSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { launchDetached } from "./platform.ts";

// Gives back the RAM and CPU of devices nobody uses (~1.4 GB each; idle CPU creeps up the longer they run). CLI and MCP `up`
// start this detached watcher; it runs `down` after N minutes without a crewdroid command, or as soon as the MCP server that
// ran `up` is gone (the agent session ended without `down`). A running command (run, layout, hammer...) refreshes the
// activity file every minute, so it is never cut off. The watcher exits when the devices are gone or a newer `up` replaced it.
// Library calls of up() (check-*.mjs scripts) start none. `--idle-minutes 0` / CREWDROID_IDLE_MINUTES=0 = keep them.
export const DEFAULT_IDLE_MINUTES = 60;
export const ACTIVITY = () => join(tmpdir(), "crewdroid-activity");
const PID = () => join(tmpdir(), "crewdroid-reaper.pid");

export function idleMinutes(flag?: string | number) {
  const v = Number(flag ?? process.env.CREWDROID_IDLE_MINUTES ?? DEFAULT_IDLE_MINUTES);
  if (!Number.isFinite(v) || v < 0) throw new Error(`--idle-minutes must be 0 (never) or more, got '${flag}'`);
  return v;
}

const touch = () => { try { writeFileSync(ACTIVITY(), ""); } catch { /* best effort */ } };
// Marks a command as running until the returned function is called.
export function busy(): () => void {
  touch();
  const t = setInterval(touch, 60000);
  t.unref();
  return () => { clearInterval(t); touch(); };
}

export async function startReaper(ports: number[], minutes: number, owner?: number) {
  if (!minutes || !ports.length) return;
  touch();
  const bin = join(import.meta.dirname, "..", "bin", "crewdroid.mjs");
  await launchDetached(process.execPath, [bin, "reap", "--ports", ports.join(","), "--idle-minutes", String(minutes), ...(owner ? ["--owner", String(owner)] : [])], join(tmpdir(), "crewdroid-reaper.log")).catch((e) => console.error(`WARN idle watcher not started (${e.message}); call down when finished`));
  console.error(`devices stop by themselves after ${minutes} min without a crewdroid command${owner ? " or when this MCP server exits" : ""} (--idle-minutes 0 = never)`);
}

const listening = (port: number) => new Promise<boolean>((ok) => {
  const s = connect(port, "127.0.0.1", () => { s.destroy(); ok(true); }).on("error", () => ok(false));
  s.setTimeout(2000, () => { s.destroy(); ok(false); });
});
const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };

// The watcher loop (`crewdroid reap`). Returns why it stopped.
export async function reap(ports: number[], minutes: number, owner?: number, tickMs = 30000, pidFile = PID()) {
  writeFileSync(pidFile, String(process.pid));
  const { alive, down } = await import("./up.ts");
  const t0 = Date.now();
  for (let misses = 0; ;) {
    await sleep(tickMs);
    if (readFileSync(pidFile, "utf8").trim() !== String(process.pid)) return "replaced by a newer up";
    misses = (await Promise.all(ports.map(listening))).some(Boolean) ? 0 : misses + 1;
    if (misses >= 2) return "devices gone";
    const idle = Date.now() - Math.max(t0, mtime(ACTIVITY()));
    const why = owner && !alive(owner) ? `MCP server pid ${owner} that ran up exited` : idle >= minutes * 60000 ? `no crewdroid command for ${minutes} min` : "";
    if (!why) continue;
    try {
      const r = await down();
      return `${why}: down stopped ports ${r.ports.join(",") || "none"}`;
    } catch (e: any) {
      console.error(`${new Date().toISOString()} ${why}, down failed (${e.message}); retrying`); // e.g. another run holds the lock
    }
  }
}
