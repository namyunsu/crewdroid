import { readFileSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { adb } from "./adb.ts";
import { judge } from "./judge.ts";
import { mulberry32, setNet, stopFlaky, type NetState } from "./net.ts";
import { PKG, probeApk, sleep } from "./snapshot.ts";
import { down, up } from "./up.ts";

export interface Scenario {
  name: string; repeat: number; delayMs: [number, number]; photoBytes: number; records: string[];
  network: { states: NetState[]; badMs: [number, number]; onlineMs: [number, number] };
  drainTimeoutS: number; rules: string;
}
export interface RunOptions { count?: number; basePort?: number; seed?: number; serverPort?: number; profiles?: string[]; onReady?: (serials: string[]) => void; beforeDown?: () => Promise<void> }

const bc = (serial: string, action: string, ...extras: string[]) =>
  adb(serial, ["shell", "am", "broadcast", "--include-stopped-packages", "-n", `${PKG}/.SampleReceiver`, "-a", `dev.crewdroid.sample.${action}`, ...extras]);
const probeLog = async (serial: string) => (await adb(serial, ["logcat", "-d", "-s", "CrewProbe:I"]).catch(() => ""))
  .split(/\r?\n/).map((l) => l.replace(/^.*?CrewProbe\s*:\s*/, "").trim()).filter(Boolean);
// Pending outbox entries (*.json under filesDir/outbox); -1 if unreadable. `up` already ran `adb root`.
async function outbox(serial: string) {
  const out = await adb(serial, ["shell", `ls /data/data/${PKG}/files/outbox`]).catch(() => undefined);
  return out === undefined ? -1 : out.split(/\s+/).filter((f) => f.endsWith(".json")).length;
}

// Host-wide CPU% (all cores) and used RAM, sampled every 2 s; keeps the peak.
function hostPeak() {
  const ticks = () => cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: a.idle + c.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
  let prev = ticks(), cpu = 0, ram = totalmem() - freemem();
  const timer = setInterval(() => {
    const now = ticks();
    cpu = Math.max(cpu, 100 * (1 - (now.idle - prev.idle) / (now.total - prev.total || 1)));
    ram = Math.max(ram, totalmem() - freemem());
    prev = now;
  }, 2000);
  return () => { clearInterval(timer); return { peakCpuPercent: Math.round(cpu), peakRamMB: Math.round(ram / 1048576), totalRamMB: Math.round(totalmem() / 1048576), cores: cpus().length }; };
}

export async function runScenario(file: string, { count = 3, basePort = 5580, seed = 1, serverPort = 5599, profiles, onReady, beforeDown }: RunOptions = {}) {
  const sc = JSON.parse(readFileSync(file, "utf8")) as Scenario;
  const rules = resolve(dirname(resolve(file)), sc.rules);
  const server = `http://10.0.2.2:${serverPort}`;
  const t0 = Date.now();
  const stopPeak = hostPeak();
  let serials: string[] = [];
  try {
    const r = await up(count, basePort, profiles);
    serials = r.devices.map((d) => d.serial);
    for (const s of serials) {
      await setNet(s, "online");
      await adb(s, ["install", "-r", probeApk()], 120000); // snapshot may hold an older probe build
      await adb(s, ["logcat", "-G", "16M"]); await adb(s, ["logcat", "-c"]);
      await adb(s, ["shell", "svc", "power", "stayon", "true"]);
      await adb(s, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`]); // keeps the outbox thread's process in the foreground
    }
    for (const s of serials) {
      for (let i = 0; !(await probeLog(s)).some((l) => /^OUTBOX \d+$/.test(l)); i++) { if (i > 60) throw new Error(`${s}: sample app did not start`); await sleep(1000); }
    }

    onReady?.(serials); // T29: the demo recorder starts here, once every sample app is up
    const f0 = Date.now();
    const at = () => Math.round((Date.now() - f0) / 100) / 10;
    const between = (rnd: () => number, [lo, hi]: [number, number]) => lo + Math.floor(rnd() * (hi - lo));
    const timelines: { t: number; state: NetState }[][] = serials.map(() => []);

    // Device k: its own seeded pauses, no shared start signal (ADR 0002).
    const flow = async (s: string, k: number) => {
      const rnd = mulberry32(seed * 100003 + k * 7919);
      await sleep(between(rnd, sc.delayMs));
      for (let i = 0; i < sc.repeat; i++) {
        await bc(s, "PHOTO", "--es", "id", `${s}-p${i}`, "--ei", "size", String(sc.photoBytes), "--es", "server", server);
        await sleep(between(rnd, sc.delayMs));
        await bc(s, "READ", "--es", "server", server);
        await sleep(between(rnd, sc.delayMs));
        const rec = sc.records[Math.floor(rnd() * sc.records.length)];
        await bc(s, "EDIT", "--es", "id", rec, "--es", "value", `${s}-${i}`, "--es", "server", server);
        await sleep(between(rnd, sc.delayMs));
      }
    };
    // Device k walks every bad state once, starting at state k (so no two devices share an order), with seeded
    // durations and online gaps in between.
    const network = async (s: string, k: number) => {
      const rnd = mulberry32(seed * 104729 + k * 15485863);
      const n = sc.network.states.length;
      await sleep(between(rnd, sc.network.onlineMs));
      for (let j = 0; j < n; j++) {
        const state = sc.network.states[(k + j) % n];
        timelines[k].push({ t: at(), state });
        await setNet(s, state, seed * 31 + k);
        await sleep(between(rnd, sc.network.badMs));
        timelines[k].push({ t: at(), state: "online" });
        await setNet(s, "online");
        await sleep(between(rnd, sc.network.onlineMs));
      }
    };
    await Promise.all(serials.flatMap((s, k) => [flow(s, k), network(s, k)]));

    // Drain: everyone online, nudge the outbox, wait until no device has a pending entry.
    for (const s of serials) await bc(s, "SYNC");
    const d0 = Date.now();
    let left = await Promise.all(serials.map(outbox));
    while (left.some((n) => n !== 0) && Date.now() - d0 < sc.drainTimeoutS * 1000) {
      await sleep(3000);
      left = await Promise.all(serials.map(outbox));
    }
    const drainSeconds = Math.round((Date.now() - d0) / 1000);
    const drained = left.every((n) => n === 0);
    await sleep(2000);
    const j = await judge(rules, `http://127.0.0.1:${serverPort}`);

    const devices = await Promise.all(r.devices.map(async (d, k) => {
      const log = await probeLog(d.serial);
      const n = (w: string) => log.filter((l) => l.startsWith(w + " ")).length;
      return {
        serial: d.serial, profile: d.profile, model: d.model, api: d.api, image: d.image, screen: `${d.width}x${d.height}@${d.density}`,
        network: timelines[k], outboxLeft: left[k],
        log: { SAVED: n("SAVED"), SYNCED: n("SYNCED"), RETRY: n("RETRY"), CONFLICT: n("CONFLICT"), DROPPED: n("DROPPED") },
      };
    }));
    return {
      scenario: sc.name, file, seed, server, date: new Date().toISOString(), ok: drained && j.ok, drained, drainSeconds,
      devices, judge: j, wallSeconds: Math.round((Date.now() - t0) / 1000), host: stopPeak(),
    };
  } finally {
    stopPeak();
    for (const s of serials) stopFlaky(s);
    await beforeDown?.(); // T29: the recorder must pull its mp4 before down() kills the clones
    await down();
  }
}
