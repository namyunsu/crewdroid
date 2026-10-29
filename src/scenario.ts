import { mkdirSync } from "node:fs";
import { cpus, freemem, tmpdir, totalmem } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { adb } from "./adb.ts";
import { judge } from "./judge.ts";
import { mulberry32, setNet, stopFlaky, type NetState } from "./net.ts";
import { setDeviceProxy, startProxy, type ProxyHandle } from "./proxy.ts";
import { drainDevice, loadScenario, PROXY_RULES, requestCount, runAction } from "./scenario-actions.ts";
import { PKG, probeApk, sleep } from "./snapshot.ts";
import { down, up } from "./up.ts";

export interface RunOptions { count?: number; basePort?: number; seed?: number; serverPort?: number; profiles?: string[]; onReady?: (serials: string[]) => void; beforeDown?: () => Promise<void>;
  // T69: route every device through the recording proxy (ports proxy.port + k) before the app starts; the app is not told.
  proxy?: { port: number; log: string; loseAcks?: number } }

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

// Two kinds of scenario file (src/scenario-actions.ts): "preset": "probe" drives the bundled probe app through its test receiver
// and reads its outbox (root); any other app is driven only by the file's own actions (Maestro flow, intent, adb) and judged on
// the T69 proxy log, so a release build works as is.
export async function runScenario(file: string, { count, basePort = 5580, seed = 1, serverPort = 5599, profiles, onReady, beforeDown, proxy }: RunOptions = {}) {
  const sc = loadScenario(file); // every check before any device boots: bad file -> exit 1 here
  const app = sc.kind === "app" ? sc : undefined, probe = sc.kind === "probe" ? sc : undefined;
  const at = (p: string) => (isAbsolute(p) ? p : resolve(dirname(resolve(file)), p));
  const rules = app ? (app.rules ? at(app.rules) : PROXY_RULES) : at(probe!.rules);
  const server = app ? app.server?.target : `http://10.0.2.2:${serverPort}`;
  const t0 = Date.now();
  const stopPeak = hostPeak();
  let serials: string[] = [];
  let px: ProxyHandle | undefined;
  try {
    const r = await up(count ?? app?.devices?.count ?? 3, basePort, profiles ?? app?.devices?.profiles, false, { api: app?.devices?.api });
    serials = r.devices.map((d) => d.serial);
    const target = app ? app.server?.target : proxy && `http://127.0.0.1:${serverPort}`;
    if (target) {
      const log = proxy?.log ?? join(tmpdir(), "crewdroid", `run-${Date.now()}.jsonl`);
      mkdirSync(dirname(resolve(log)), { recursive: true });
      px = await startProxy({ target, port: proxy?.port ?? app?.server?.proxyPort ?? 5590, devices: serials, log, loseAcks: proxy?.loseAcks, seed });
      for (const x of px.ports) await setDeviceProxy(x.device, x.port);
    }
    for (const s of serials) {
      await setNet(s, "online");
      if (!app) await adb(s, ["install", "-r", probeApk()], 120000); // snapshot may hold an older probe build
      else if (app.app.apk) await adb(s, ["install", "-r", "-g", at(app.app.apk)], 180000);
      await adb(s, ["logcat", "-G", "16M"]); await adb(s, ["logcat", "-c"]);
      await adb(s, ["shell", "svc", "power", "stayon", "true"]);
      if (!app) await adb(s, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`]); // keeps the outbox thread's process in the foreground
    }
    if (!app) {
      for (const s of serials) {
        for (let i = 0; !(await probeLog(s)).some((l) => /^OUTBOX \d+$/.test(l)); i++) { if (i > 60) throw new Error(`${s}: sample app did not start`); await sleep(1000); }
      }
    } else {
      // Setup (log in, point the app at the server) once per device, all devices at once; a failed setup makes the run meaningless.
      // AI NOTE: one retry per setup action: three Maestro drivers starting at once on 896 MB clones lost one adb connection
      // ("device offline") in the first T55 trial; the flow itself was fine.
      const once = (s: string, k: number, a: (typeof app.actions)[number]) => runAction(s, a, { serial: s, device: k, iter: -1 }, app.dir);
      await Promise.all(serials.map(async (s, k) => {
        for (const a of app.setup ?? []) await once(s, k, a).catch(() => sleep(5000).then(() => once(s, k, a))).catch((e) => { throw new Error(`${s} setup: ${(e as Error).message}`); });
      }));
    }

    onReady?.(serials); // T29: the demo recorder starts here, once every sample app is up
    const f0 = Date.now();
    const at_ = () => Math.round((Date.now() - f0) / 100) / 10;
    const between = (rnd: () => number, [lo, hi]: [number, number]) => lo + Math.floor(rnd() * (hi - lo));
    const timelines: { t: number; state: NetState; error?: string }[][] = serials.map(() => []);
    const stats = serials.map(() => ({ ok: 0, failed: 0, errors: [] as { iter: number; error: string }[] }));

    // Device k: its own seeded pauses, no shared start signal (ADR 0002).
    const flow = async (s: string, k: number) => {
      const rnd = mulberry32(seed * 100003 + k * 7919);
      await sleep(between(rnd, sc.delayMs));
      for (let i = 0; i < sc.repeat; i++) {
        if (app) {
          for (const a of app.actions) {
            // A failed action (flow step not found, intent refused) is counted and the loop goes on: under a bad network
            // that is often the finding itself. Any failure makes the run's ok false.
            await runAction(s, a, { serial: s, device: k, iter: i }, app.dir).then(() => stats[k].ok++, (e) => {
              stats[k].failed++;
              if (stats[k].errors.length < 5) stats[k].errors.push({ iter: i, error: (e as Error).message.slice(0, 300) });
            });
            await sleep(between(rnd, sc.delayMs));
          }
          continue;
        }
        await bc(s, "PHOTO", "--es", "id", `${s}-p${i}`, "--ei", "size", String(probe!.photoBytes), "--es", "server", server!);
        await sleep(between(rnd, sc.delayMs));
        await bc(s, "READ", "--es", "server", server!);
        await sleep(between(rnd, sc.delayMs));
        const rec = probe!.records[Math.floor(rnd() * probe!.records.length)];
        await bc(s, "EDIT", "--es", "id", rec, "--es", "value", `${s}-${i}`, "--es", "server", server!);
        await sleep(between(rnd, sc.delayMs));
      }
    };
    // Device k walks every bad state once, starting at state k (so no two devices share an order), with seeded
    // durations and online gaps in between.
    const net = sc.network;
    const network = async (s: string, k: number) => {
      if (!net) return;
      const rnd = mulberry32(seed * 104729 + k * 15485863);
      const n = net.states.length;
      // AI NOTE: one failed state switch must not end a 7-minute run: in a T55 check all three devices got adb "error: closed"
      // at the same moment and the third retry of `dumpsys connectivity` still failed. Retry once after 3 s, else note it.
      const apply = (state: NetState, ...a: [number?]) => setNet(s, state, ...a).catch(() => sleep(3000).then(() => setNet(s, state, ...a)))
        .catch((e) => { timelines[k].at(-1)!.error = (e as Error).message.split("\n")[0].slice(0, 200); });
      await sleep(between(rnd, net.onlineMs));
      for (let j = 0; j < n; j++) {
        const state = net.states[(k + j) % n];
        timelines[k].push({ t: at_(), state });
        await apply(state, seed * 31 + k);
        await sleep(between(rnd, net.badMs));
        timelines[k].push({ t: at_(), state: "online" });
        await apply("online");
        await sleep(between(rnd, net.onlineMs));
      }
    };
    await Promise.all(serials.flatMap((s, k) => [flow(s, k), network(s, k)]));

    let left: number[], drains: { drained: boolean; seconds: number }[];
    const d0 = Date.now();
    if (!app) {
      // Drain: everyone online, nudge the outbox, wait until no device has a pending entry.
      for (const s of serials) await bc(s, "SYNC");
      left = await Promise.all(serials.map(outbox));
      while (left.some((n) => n !== 0) && Date.now() - d0 < probe!.drainTimeoutS * 1000) {
        await sleep(3000);
        left = await Promise.all(serials.map(outbox));
      }
      drains = left.map((n) => ({ drained: n === 0, seconds: Math.round((Date.now() - d0) / 1000) }));
      await sleep(2000);
    } else {
      // Drain (default): no request from that device through the proxy for 20 s; or the app's own log line / on-screen text.
      drains = await Promise.all(serials.map((s) => drainDevice(s, app.drain ?? { idleSeconds: 20 }, px?.log)));
      left = [];
    }
    const drainSeconds = Math.round((Date.now() - d0) / 1000);
    const drained = drains.every((d) => d.drained);
    const j = await judge(rules, app ? app.source && (/^https?:/.test(app.source) ? app.source : at(app.source)) : `http://127.0.0.1:${serverPort}`, app ? px?.log : undefined);

    const devices = await Promise.all(r.devices.map(async (d, k) => {
      const base = { serial: d.serial, profile: d.profile, model: d.model, api: d.api, image: d.image, screen: `${d.width}x${d.height}@${d.density}`, network: timelines[k] };
      if (app) {
        return { ...base, drained: drains[k].drained, drainSeconds: drains[k].seconds, errors: stats[k].errors,
          log: { actionsOk: stats[k].ok, actionsFailed: stats[k].failed, requests: px ? requestCount(px.log, d.serial) : 0 } };
      }
      const log = await probeLog(d.serial);
      const n = (w: string) => log.filter((l) => l.startsWith(w + " ")).length;
      return {
        ...base, outboxLeft: left[k],
        log: { SAVED: n("SAVED"), SYNCED: n("SYNCED"), RETRY: n("RETRY"), CONFLICT: n("CONFLICT"), DROPPED: n("DROPPED") },
      };
    }));
    const actionsFailed = stats.reduce((a, x) => a + x.failed, 0);
    return {
      scenario: sc.name, file, seed, server, ...(app ? { app: app.app.package, rules } : {}), date: new Date().toISOString(), ok: drained && j.ok && actionsFailed === 0, drained, drainSeconds,
      devices, judge: j, proxy: px && { log: px.log, ports: px.ports, loseAcks: proxy?.loseAcks ?? 0 }, wallSeconds: Math.round((Date.now() - t0) / 1000), host: stopPeak(),
    };
  } finally {
    stopPeak();
    await px?.close();
    for (const s of serials) stopFlaky(s);
    await beforeDown?.(); // T29: the recorder must pull its mp4 before down() kills the clones
    await down();
  }
}
