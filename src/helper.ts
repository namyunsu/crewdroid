import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adb, assertSerial } from "./adb.ts";

// On-device helper (T52, ADR 0007): agent-helper/ is an instrumentation APK that keeps a UiAutomation connection and answers
// GET /tree, /size, /health and POST /tap, /swipe, /key, /text on the device's 127.0.0.1:DEVICE_PORT, reached through
// `adb forward tcp:<free host port>`. screen/tap/type/swipe/key use it when it answers and fall back to uiautomator/input.
export const HELPER_PKG = "dev.crewdroid.agent";
export const HELPER_VERSION = 5; // = versionCode in agent-helper/build.gradle.kts
export const DEVICE_PORT = 6790;
export const helperApk = () => join(import.meta.dirname, "..", "agent-helper/build/outputs/apk/release/crewdroid-agent-release.apk");
const RETRY_AFTER_MS = 5 * 60000; // a failed start is not retried on every command
// a helper started this recently may still be installing / connecting (a fresh 3-device boot took 10-20 s): wait, do not fall back
const START_WINDOW_MS = 45000;

export class HelperError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// Host port per serial, shared by CLI processes through a file; the MCP server also keeps it in memory.
type State = { port?: number; startedAt?: number; failedAt?: number; reason?: string };
const stateFile = (serial: string) => join(tmpdir(), `crewdroid-helper-${serial}.json`);
const readState = (serial: string): State => { try { return JSON.parse(readFileSync(stateFile(serial), "utf8")); } catch { return {}; } };
const save = (serial: string, st: State) => writeFileSync(stateFile(serial), JSON.stringify(st));
const ports = new Map<string, number>();
const warned = new Set<string>();
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`; // one device-shell word

// `adb forward --list` lines: "<serial> tcp:<host> tcp:<device>"
export const forwardPort = (list: string, serial: string) => Number(list.split("\n").map((l) => l.trim().split(/\s+/)).find((w) => w[0] === serial && w[2] === `tcp:${DEVICE_PORT}`)?.[1]?.slice(4)) || undefined;

async function request(serial: string, port: number, method: string, path: string, body?: object, timeoutMs = 15000) {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, body: body && JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    headers: { "x-serial": serial, ...(body ? { "content-type": "application/json" } : {}) },
  });
  const j: any = await r.json();
  if (!r.ok) throw new HelperError(r.status, j.error ?? `HTTP ${r.status}`);
  return j;
}

// existing forward to the helper port, or a new one on a free host port (adb binds it to 127.0.0.1)
// NOTE (T66): a fixed host port per emulator below the OS ephemeral range (Windows 49152+, Linux 32768+), any free one only
// if that is taken. Maestro takes its driver port from the ephemeral range (ServerSocket(0)); with our forward there too, its
// driver polls reached the helper once (logcat "Broken pipe" every second while Maestro waited for its driver) [inferred].
export const hostPort = (serial: string) => DEVICE_PORT + 10 + Number(assertSerial(serial).slice(9)) - 5554;
const forward = async (serial: string) => forwardPort(await adb(serial, ["forward", "--list"]), serial) ??
  await adb(serial, ["forward", `tcp:${hostPort(serial)}`, `tcp:${DEVICE_PORT}`]).then(() => hostPort(serial), async () => Number(await adb(serial, ["forward", "tcp:0", `tcp:${DEVICE_PORT}`])));

// Forward, then /health. Throws when the helper does not answer.
async function connect(serial: string): Promise<number> {
  const port = await forward(serial);
  await request(serial, port, "GET", "/health", undefined, 1000);
  ports.set(serial, port);
  save(serial, { port });
  return port;
}

async function ready(serial: string, ms: number): Promise<number> {
  for (const t0 = Date.now(); ;) {
    try { return await connect(serial); } catch (e) { if (Date.now() - t0 > ms) throw e; }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// 421: the port now forwards to another device; 503: another automation client (a Maestro flow, uiautomator) holds UiAutomation
const unreachable = (e: any) => !(e instanceof HelperError) || e.status === 421 || e.status === 503;
const missed = new Map<string, string>();
// why the last call() on this serial returned undefined ("busy: ..." while another tool holds UiAutomation), undefined after a success
export const helperMiss = (serial: string) => missed.get(serial);

// The helper's answer, or undefined when it is not reachable (the caller then uses today's path). Errors the helper
// reports itself (bad key, no focused field) are thrown as HelperError.
export async function call<T = any>(serial: string, method: "GET" | "POST", path: string, body?: object, timeoutMs?: number): Promise<T | undefined> {
  assertSerial(serial);
  let st = readState(serial);
  if (st.failedAt && Date.now() - st.failedAt < RETRY_AFTER_MS) return note(serial, st.reason ?? "start failed");
  const left = st.startedAt ? st.startedAt + START_WINDOW_MS - Date.now() : 0;
  if (left > 0) {
    try { await ready(serial, left); } catch {
      const reason = `no answer within ${START_WINDOW_MS / 1000} s of its start (device log /data/local/tmp/crewdroid-agent.log)`;
      save(serial, { failedAt: Date.now(), reason });
      return note(serial, reason);
    }
    st = readState(serial);
  }
  const cached = ports.get(serial) ?? st.port;
  let reason = "";
  for (const known of cached ? [cached, undefined] : [undefined]) { // a cached port may be stale: then look it up once
    try {
      const r = await request(serial, known ?? (await connect(serial)), method, path, body, timeoutMs);
      missed.delete(serial);
      return r;
    } catch (e: any) {
      // NOTE: a timed-out POST may have been carried out; running the fallback too could tap twice
      if (!unreachable(e) || (e.name === "TimeoutError" && method === "POST")) throw e;
      if (e.status === 503) return note(serial, `busy: ${e.message}`); // the helper is fine; the port stays cached
      ports.delete(serial);
      reason = e.cause?.code ?? e.message;
    }
  }
  return note(serial, reason);
}

function note(serial: string, reason: string): undefined {
  if (!warned.has(serial)) console.error(`helper not answering on ${serial} (${reason}); using uiautomator/input`);
  warned.add(serial);
  missed.set(serial, reason);
  return undefined;
}

// Push the APK, then on the device and detached from this process: install when the versionCode differs, (re)start.
// Returns once started (2 adb calls); the first command waits for it (START_WINDOW_MS), waitMs > 0 waits here.
// Never throws: a failed start leaves the fallback.
// NOTE: installing and waiting from the host made `up` 6-15 s slower on a fresh boot (dexopt + first-boot jobs, T52).
export async function startHelper(serial: string, waitMs = 0): Promise<{ ok: boolean; port?: number; seconds: number; ready?: boolean; note?: string }> {
  const t0 = Date.now(), seconds = () => Math.round((Date.now() - t0) / 100) / 10;
  try {
    if (!existsSync(helperApk())) throw new Error(`helper APK missing (${helperApk()}); build it with: probe-app/gradlew -p agent-helper assembleRelease`);
    const remote = "/data/local/tmp/crewdroid-agent.apk";
    await adb(serial, ["push", helperApk(), remote], 60000);
    const run = `v=$(dumpsys package ${HELPER_PKG} | grep -m1 -o 'versionCode=[0-9]*'); [ "$v" = versionCode=${HELPER_VERSION} ] || pm install -r ${remote}; ` +
      `exec am instrument -w --no-hidden-api-checks -e port ${DEVICE_PORT} -e serial ${serial} ${HELPER_PKG}/.Runner`;
    // the old helper is stopped before this returns, so it cannot answer the first /health in its successor's place
    await adb(serial, ["shell", `am force-stop ${HELPER_PKG}; setsid nohup sh -c ${q(run)} >/data/local/tmp/crewdroid-agent.log 2>&1 </dev/null &`]);
    const port = await forward(serial);
    ports.set(serial, port);
    save(serial, { port, startedAt: Date.now() });
    if (waitMs) await ready(serial, waitMs);
    return { ok: true, port, seconds: seconds(), ready: waitMs > 0 };
  } catch (e: any) {
    const reason = `start failed: ${e.cause?.code ?? e.message}`;
    save(serial, { failedAt: Date.now(), reason });
    return { ok: false, seconds: seconds(), note: reason };
  }
}

// Fast path through the helper; when it is not reachable the old path, then a restart so the next command is fast again.
// NOTE: the restart comes after `slow`: a helper holding UiAutomation makes `uiautomator dump` fail. `slow` may itself
// have restarted it (tap's fallback runs screen()), hence the /health look first.
export async function orFallback<T extends object>(serial: string, fast: () => Promise<T | undefined>, slow: () => Promise<T>): Promise<T & { via: "helper" | "fallback"; fallbackReason?: string }> {
  const r = await fast();
  if (r !== undefined) return { ...r, via: "helper" };
  const fallbackReason = helperMiss(serial);
  const out = await slow();
  if ((await call(serial, "GET", "/health")) === undefined && !readState(serial).failedAt) await startHelper(serial);
  return { ...out, via: "fallback", fallbackReason };
}

// Builds agent-helper/ with the probe's Gradle wrapper (npm prepack, check-helper).
export function buildHelper() {
  const root = join(import.meta.dirname, "..");
  execFileSync(join(root, "probe-app", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["-p", join(root, "agent-helper"), "assembleRelease", "--console=plain", "-q"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });
  return helperApk();
}
