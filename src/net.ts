import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { adb, assertSerial } from "./adb.ts";

export type NetState = "airplane" | "nodata" | "slow" | "flaky" | "online";
export const NET_STATES: NetState[] = ["airplane", "nodata", "slow", "flaky", "online"];
// T63: which link is up (wifi = the emulator's "AndroidWifi" AP on wlan0, cellular = the modem on eth0), a handover
// between them, and Wi-Fi marked metered. ADR 0009.
export type LinkState = "wifi" | "cellular" | "both" | "none";
export const LINK_STATES: LinkState[] = ["wifi", "cellular", "both", "none"];
export const NET_COMMANDS = [...NET_STATES, ...LINK_STATES, "handover", "metered"] as const;
export type NetCommand = (typeof NET_COMMANDS)[number];
export type Transport = "wifi" | "cellular" | "none";

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
// T63: the same qdisc on wlan0 shapes the Wi-Fi link (VirtWifi ignores the console values too).
async function shape(serial: string, slow: boolean, ifaces = ["eth0"]) {
  await adb(serial, ["emu", "network", "speed", slow ? SLOW.speed : "full"]);
  await adb(serial, ["emu", "network", "delay", slow ? SLOW.delay : "none"]);
  for (const i of ["eth0", "wlan0"]) await sh(serial, `tc qdisc del dev ${i} root`);
  if (slow) for (const i of ifaces) await sh(serial, `tc qdisc add dev ${i} root handle 1: netem delay ${SLOW.delay}ms && tc qdisc add dev ${i} parent 1: handle 2: tbf rate ${SLOW.speed}kbit burst 16kb latency 400ms`);
}

// What the guest's ConnectivityService reports: the default network ("none" = apps cannot connect), the transport of
// every CONNECTED network (MOBILE, WIFI; a Wi-Fi stuck in CONNECTING without an address does not count) and whether
// the default one is metered.
export function parseLinks(out: string) {
  const def = out.match(/Active default network: (\S+)/)?.[1] ?? "none";
  const agents = out.split(/\r?\n/).map((l) => l.match(/^\s*NetworkAgentInfo\{network\{(\d+)\}.*?ni\{(\w+)(?:\[\w*\])? (\w+)/)?.slice(1).concat(/NOT_METERED/.test(l) ? "unmetered" : "metered")).filter(Boolean) as string[][];
  const up = agents.filter((a) => a[2] === "CONNECTED");
  const d = up.find((a) => a[0] === def);
  const transport: Transport = !d ? "none" : d[1] === "WIFI" ? "wifi" : "cellular";
  return { def: d ? def : "none", nets: up.map((a) => a[1]), transport, metered: !!d && d[3] === "metered" };
}
const links = async (serial: string) => parseLinks(await adb(serial, ["shell", "dumpsys connectivity | grep -E 'Active default network|^ *NetworkAgentInfo\\{'; true"]));
type Links = ReturnType<typeof parseLinks>;
const only = (l: Links, t: string) => l.nets.length === 1 && l.nets[0] === t;
const REACHED: Record<Exclude<NetState, "flaky"> | LinkState, (l: Links) => boolean> = {
  online: (l) => l.def !== "none",
  slow: (l) => l.def !== "none" && l.nets.includes("MOBILE") && !l.nets.includes("WIFI"), // only the shaped cellular link (Wi-Fi chosen: REACHED.wifi)
  airplane: (l) => l.def === "none",
  nodata: (l) => l.def === "none",
  none: (l) => l.def === "none",
  wifi: (l) => l.transport === "wifi" && only(l, "WIFI"),
  cellular: (l) => l.transport === "cellular" && only(l, "MOBILE"),
  both: (l) => l.transport === "wifi" && l.nets.includes("MOBILE"), // Android prefers validated Wi-Fi as the default
};
// AI NOTE (T45): svc/airplane switches are asynchronous, and after `up` (makeDistinct restarts the framework) the API 31
// cellular link appears 20-80 s late and flaps; returning before the guest shows the state let uploads run in the wrong one.
// Waits until the state holds for 3 s in a row.
async function settle(serial: string, state: keyof typeof REACHED, timeoutS: number, reached = REACHED[state]) {
  const t0 = Date.now();
  let since = 0, l: Links = { def: "none", nets: [], transport: "none", metered: false };
  while (Date.now() - t0 < timeoutS * 1000) {
    l = await links(serial);
    if (!reached(l)) since = 0;
    else if (!since) since = Date.now();
    else if (Date.now() - since >= 3000) return Math.round((Date.now() - t0) / 100) / 10;
    await sleep(500);
  }
  // AI NOTE (T63): read-only clones of one snapshot share the virtio-wifi MAC on the emulator's shared Wi-Fi medium, so
  // with 2+ devices only one gets a Wi-Fi address (ADR 0009).
  const hint = /wifi|both/.test(state) || (state === "slow" && l.nets.includes("WIFI")) ? "; Wi-Fi gets an address on one crewdroid device at a time (ADR 0009)" : "";
  throw new Error(`net ${state}: ${serial} not in that state after ${timeoutS} s (default network ${l.transport}, connected: ${l.nets.join(",") || "none"})${hint}`);
}
const SSID = "AndroidWifi"; // the emulator's built-in open access point
async function transport(serial: string) {
  const l = await links(serial);
  return { default: l.transport, connected: l.nets.map((n) => (n === "WIFI" ? "wifi" : "cellular")), metered: l.metered };
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
// The link chosen by `net wifi|cellular|both|none|handover`, kept as a guest property so it dies with the device
// ("" = never chosen: slow/flaky behave as before T63). `online` clears it.
const chosen = async (serial: string) => (await sh(serial, "getprop debug.crewdroid.link")).trim();
const choose = (serial: string, link: string) => sh(serial, `setprop debug.crewdroid.link '${link}'`);
const radio = (serial: string, t: Exclude<Transport, "none">, on: boolean) => (t === "wifi" ? wifi(serial, on) : data(serial, on));

export async function flakyLoop(serial: string, seed: number) {
  const sched = flakySchedule(serial, seed, 1000);
  const link = await chosen(serial);
  for (const ph of sched) {
    if (link !== "cellular") await wifi(serial, ph.on);
    if (link !== "wifi") await data(serial, ph.on);
    await new Promise((r) => setTimeout(r, ph.ms));
  }
}

export interface NetOptions { to?: Transport; during?: number; metered?: boolean }
export async function setNet(serial: string, state: NetCommand, seed = 1, opt: NetOptions = {}) {
  assertSerial(serial);
  if (!(NET_COMMANDS as readonly string[]).includes(state)) throw new Error(`unknown state '${state}' (${NET_COMMANDS.join("|")})`);
  stopFlaky(serial);
  let seconds = 0;
  if ((LINK_STATES as string[]).includes(state)) {
    const st = state as LinkState;
    const [w, d] = [st === "wifi" || st === "both", st === "cellular" || st === "both"];
    await airplane(serial, false);
    await shape(serial, false);
    // take away first, then add (same lesson as T45 below)
    if (!w) await wifi(serial, false);
    if (!d) await data(serial, false);
    if (w) await wifi(serial, true);
    if (d) await data(serial, true);
    await choose(serial, st);
    seconds = await settle(serial, st, 120);
  } else if (state === "handover") seconds = await handover(serial, opt.to, opt.during ?? 0);
  else if (state === "metered") seconds = await metered(serial, opt.metered);
  else seconds = await setState(serial, state as NetState, seed);
  return { serial, state, seed, settledSeconds: seconds, schedule: state === "flaky" ? flakySchedule(serial, seed, 6) : undefined, link: (await chosen(serial)) || "default", transport: await transport(serial) };
}

async function setState(serial: string, state: NetState, seed: number) {
  const link = state === "slow" || state === "flaky" ? await chosen(serial) : "";
  const onWifi = link === "wifi", onCell = link === "cellular";
  // AI NOTE (T45): take the network away first and put the rest back only after it is gone. Going through "online"
  // first un-shaped the link while `svc data disable` was still pending, so slow -> nodata let a buffered upload finish.
  if (state === "airplane") await airplane(serial, true);
  else if (state === "nodata") { await wifi(serial, false); await data(serial, false); }
  else if (state === "slow" && onWifi) await shape(serial, true, ["wlan0"]);
  // AI NOTE: console `network speed/delay` only shapes the emulated cellular modem, not VirtWifi, so wifi must be off for slow to bite.
  else if (state === "slow") { await shape(serial, true); await wifi(serial, false); }
  let seconds = state === "airplane" || state === "nodata" ? await settle(serial, state, 60) : 0;
  if (state !== "airplane") await airplane(serial, false);
  if (((state === "online" || state === "flaky") && !onCell) || (state === "slow" && onWifi)) await wifi(serial, true);
  if (state !== "nodata" && !onWifi) await data(serial, true);
  if (state !== "slow") await shape(serial, false);
  if (state === "online") await choose(serial, "");
  if (state === "online" || state === "slow") seconds = await settle(serial, state, 120, state === "slow" && onWifi ? REACHED.wifi : undefined);
  if (state === "flaky") {
    mkdirSync(join(tmpdir(), "crewdroid"), { recursive: true });
    const cli = join(import.meta.dirname, "cli.ts");
    const p = spawn(process.execPath, [cli, "net", serial, "flaky-loop", "--seed", String(seed)], { detached: true, stdio: "ignore", windowsHide: true });
    p.unref();
    writeFileSync(pidFile(serial), String(p.pid));
  }
  return seconds;
}

// Moves the default network from one link to the other while apps keep running. during = 0: make-before-break (the new
// link is connected before the old one goes, as a phone walking out of Wi-Fi range with mobile data on); during > 0:
// break-before-make with that many ms without any link in between.
async function handover(serial: string, to: Transport | undefined, during: number) {
  if (!Number.isInteger(during) || during < 0) throw new Error(`net handover: --during must be a whole number of ms >= 0, got '${during}'`);
  const from = (await links(serial)).transport;
  if (from === "none") throw new Error(`net handover: ${serial} has no active link to hand over from (net wifi|cellular first)`);
  const target = to ?? (from === "wifi" ? "cellular" : "wifi");
  if (target !== "wifi" && target !== "cellular") throw new Error(`net handover: --to must be wifi|cellular, got '${target}'`);
  if (target === from) throw new Error(`net handover: ${serial} is already on ${from}`);
  if (during > 0) {
    await radio(serial, from, false);
    await sleep(during);
    await radio(serial, target, true);
  } else {
    await radio(serial, target, true);
    await settle(serial, target, 120, (l) => l.nets.includes(target === "wifi" ? "WIFI" : "MOBILE"));
    await radio(serial, from, false);
  }
  await choose(serial, target);
  return settle(serial, target, 120);
}

// Marks the emulator's Wi-Fi network metered (or not) for apps: re-saves "AndroidWifi" with/without the metered flag,
// which reconnects Wi-Fi once. Read back from the default network's capabilities (NOT_METERED missing = metered).
async function metered(serial: string, on: boolean | undefined) {
  if (on === undefined) throw new Error("usage: net <serial> metered on|off");
  if (!(await links(serial)).nets.includes("WIFI")) throw new Error(`net metered: ${serial} has no Wi-Fi link up (net wifi|both first)`);
  const out = await adb(serial, ["shell", `cmd wifi connect-network ${SSID} open${on ? " -m" : ""}`]).catch((e) => String(e));
  if (/exception|unknown|error/i.test(out)) throw new Error(`net metered: cmd wifi connect-network failed on ${serial}: ${out.trim()}`);
  return settle(serial, "wifi", 120, (l) => l.transport === "wifi" && l.metered === on);
}
