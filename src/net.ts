import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { adb, assertSerial } from "./adb.ts";

export type NetState = "airplane" | "nodata" | "slow" | "flaky" | "online";
export const NET_STATES: NetState[] = ["airplane", "nodata", "slow", "flaky", "online"];

// ~1 Mbit/s + 300 ms latency (1MB upload ~9 s vs ~0.2 s online).
const SLOW = { speed: "1024", delay: "300" };

const sh = (serial: string, cmd: string) => adb(serial, ["shell", cmd]).catch(() => "");
const wifi = (serial: string, on: boolean) => sh(serial, `svc wifi ${on ? "enable" : "disable"}`);
const data = (serial: string, on: boolean) => sh(serial, `svc data ${on ? "enable" : "disable"}`);
// AI NOTE: `cmd connectivity airplane-mode` exists on API 30+; older images only honour the setting + broadcast.
async function airplane(serial: string, on: boolean) {
  const out = await adb(serial, ["shell", `cmd connectivity airplane-mode ${on ? "enable" : "disable"}`]).catch((e) => String(e));
  if (/error|exception|unknown/i.test(out)) {
    await sh(serial, `settings put global airplane_mode_on ${on ? 1 : 0}`);
    await sh(serial, `am broadcast -a android.intent.action.AIRPLANE_MODE --ez state ${on}`);
  }
}
// AI NOTE: emulator 37.1.11 accepts `network speed/delay` (status shows it) but does not slow guest traffic (measured: 1MB upload
// 130 ms at "gsm"), so the console values are set for the modem and a guest `tc` qdisc on eth0 (needs adb root, done in `up`) does the real work.
async function shape(serial: string, slow: boolean) {
  await adb(serial, ["emu", "network", "speed", slow ? SLOW.speed : "full"]);
  await adb(serial, ["emu", "network", "delay", slow ? SLOW.delay : "none"]);
  await sh(serial, "tc qdisc del dev eth0 root");
  if (slow) await sh(serial, `tc qdisc add dev eth0 root handle 1: netem delay ${SLOW.delay}ms && tc qdisc add dev eth0 parent 1: handle 2: tbf rate ${SLOW.speed}kbit burst 16kb latency 400ms`);
}

// What the guest's ConnectivityService reports: the default network ("none" = apps cannot connect) and the transport
// of every connected network (MOBILE, WIFI).
async function links(serial: string) {
  const out = await adb(serial, ["shell", "dumpsys connectivity | grep -E 'Active default network|^ *NetworkAgentInfo\\{'; true"]);
  return {
    def: out.match(/Active default network: (\S+)/)?.[1] ?? "none",
    nets: out.split(/\r?\n/).map((l) => l.match(/^\s*NetworkAgentInfo\{.*?ni\{(\w+)/)?.[1]).filter(Boolean) as string[],
  };
}
type Links = Awaited<ReturnType<typeof links>>;
const REACHED: Record<Exclude<NetState, "flaky">, (l: Links) => boolean> = {
  online: (l) => l.def !== "none",
  slow: (l) => l.def !== "none" && l.nets.includes("MOBILE") && !l.nets.includes("WIFI"), // only the shaped cellular link
  airplane: (l) => l.def === "none",
  nodata: (l) => l.def === "none",
};
// AI NOTE (T45): svc/airplane switches are asynchronous, and after `up` (makeDistinct restarts the framework) the API 31
// cellular link appears 20-80 s late and flaps; returning before the guest shows the state let uploads run in the wrong one.
// Waits until the state holds for 3 s in a row.
async function settle(serial: string, state: Exclude<NetState, "flaky">, timeoutS: number) {
  const t0 = Date.now();
  let since = 0, l: Links = { def: "none", nets: [] };
  while (Date.now() - t0 < timeoutS * 1000) {
    l = await links(serial);
    if (!REACHED[state](l)) since = 0;
    else if (!since) since = Date.now();
    else if (Date.now() - since >= 3000) return Math.round((Date.now() - t0) / 100) / 10;
    await sleep(500);
  }
  throw new Error(`net ${state}: ${serial} not in that state after ${timeoutS} s (default network ${l.def}, connected: ${l.nets.join(",") || "none"})`);
}

// ---- flaky: per-device seeded schedule, run by a detached worker so `net <serial> flaky` returns at once ----
export function mulberry32(a: number) {
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Seed mixes in the emulator port, so two devices given the same --seed still never share a schedule.
export function flakySchedule(serial: string, seed: number, n = 8): { on: boolean; ms: number }[] {
  const rnd = mulberry32((seed * 7919 + Number(assertSerial(serial).slice(9)) * 104729) | 0);
  return Array.from({ length: n }, (_, i) => ({ on: i % 2 === 1, ms: 2000 + Math.floor(rnd() * 4000) })); // starts with an off phase
}
const pidFile = (serial: string) => join(tmpdir(), "crewdroid", `flaky-${assertSerial(serial)}.pid`);
export function stopFlaky(serial: string) {
  const f = pidFile(serial);
  if (!existsSync(f)) return false;
  try { process.kill(Number(readFileSync(f, "utf8"))); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e; } // ESRCH = loop already exited
  rmSync(f, { force: true });
  return true;
}
export async function flakyLoop(serial: string, seed: number) {
  const sched = flakySchedule(serial, seed, 1000);
  for (const ph of sched) {
    await wifi(serial, ph.on); await data(serial, ph.on);
    await new Promise((r) => setTimeout(r, ph.ms));
  }
}

export async function setNet(serial: string, state: NetState, seed = 1) {
  assertSerial(serial);
  if (!NET_STATES.includes(state)) throw new Error(`unknown state '${state}' (${NET_STATES.join("|")})`);
  stopFlaky(serial);
  // AI NOTE (T45): take the network away first and put the rest back only after it is gone. Going through "online"
  // first un-shaped the link while `svc data disable` was still pending, so slow -> nodata let a buffered upload finish.
  if (state === "airplane") await airplane(serial, true);
  else if (state === "nodata") { await wifi(serial, false); await data(serial, false); }
  // AI NOTE: console `network speed/delay` only shapes the emulated cellular modem, not VirtWifi, so wifi must be off for slow to bite.
  else if (state === "slow") { await shape(serial, true); await wifi(serial, false); }
  let seconds = state === "airplane" || state === "nodata" ? await settle(serial, state, 60) : 0;
  if (state !== "airplane") await airplane(serial, false);
  if (state === "online" || state === "flaky") await wifi(serial, true);
  if (state !== "nodata") await data(serial, true);
  if (state !== "slow") await shape(serial, false);
  if (state === "online" || state === "slow") seconds = await settle(serial, state, 120);
  if (state === "flaky") {
    mkdirSync(join(tmpdir(), "crewdroid"), { recursive: true });
    const cli = join(import.meta.dirname, "cli.ts");
    const p = spawn(process.execPath, [cli, "net", serial, "flaky-loop", "--seed", String(seed)], { detached: true, stdio: "ignore", windowsHide: true });
    p.unref();
    writeFileSync(pidFile(serial), String(p.pid));
  }
  return { serial, state, seed, settledSeconds: seconds, schedule: state === "flaky" ? flakySchedule(serial, seed, 6) : undefined };
}
