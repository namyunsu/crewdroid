import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import type { Tool } from "./mcp.ts";

export const APP_WHAT = ["perm", "open", "links", "clear", "backup", "restore", "pressure", "fill-storage"] as const;
export const PRESSURE = ["doze", "standby", "trim", "bg-restrict", "battery-saver", "reset"] as const;
export const BUCKETS: Record<string, number> = { active: 10, working_set: 20, frequent: 30, rare: 40, restricted: 45 };
export const TRIM_LEVELS = ["HIDDEN", "RUNNING_MODERATE", "BACKGROUND", "RUNNING_LOW", "MODERATE", "RUNNING_CRITICAL", "COMPLETE"] as const;
const TRANSPORT = "com.android.localtransport/.LocalTransport";
const FILL = "/data/local/tmp/crewdroid-fill";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// adb exits non-zero for pm/am/appops failures but prints a Java stack; keep the first line that says what went wrong
async function sh(s: string, cmd: string): Promise<string> {
  try { return await adb(s, ["shell", cmd]); } catch (e: any) {
    const text = String(e.stdout || e.stderr || e.message).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    throw new Error(`${cmd.split(" ").slice(0, 2).join(" ")}: ${text.find((l) => /^(java|android)[\w.]*(Exception|Error): /.test(l)) ?? text.find((l) => /Exception|Error|Failed|Unknown|unknown/.test(l)) ?? text[0] ?? "failed"}`);
  }
}
const must = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg); };
async function settle<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  let v = await read();
  for (const t0 = Date.now(); !ok(v) && Date.now() - t0 < ms;) { await sleep(300); v = await read(); }
  return v;
}

// ---- validation (all before adb) ----
const PKG_RE = /^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/;
export function permName(v: string | undefined): string {
  if (v && /^[A-Z][A-Z0-9_]*$/.test(v)) return `android.permission.${v}`; // CAMERA -> android.permission.CAMERA
  if (v && PKG_RE.test(v)) return v;
  throw new Error(`bad permission name '${v ?? ""}' (CAMERA or android.permission.CAMERA)`);
}
export function domainName(v: string | undefined): string {
  if (!v || !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(v)) throw new Error(`bad domain '${v ?? ""}' (probe.crewdroid.example)`);
  return v;
}
export function uriArg(v: string | undefined): string {
  if (!v || !/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s'"\\`$;&|<>]+$/.test(v)) throw new Error(`bad uri '${v ?? ""}' (scheme://host/path, no spaces or shell characters)`);
  return v;
}
export function gb(v: string | undefined): number {
  const n = Number(v);
  if (v === undefined || v.trim() === "" || !Number.isFinite(n) || n < 0.1 || n > 100) throw new Error(`fill-storage size must be a number of GB 0.1..100 (or 'free'), got '${v ?? ""}'`);
  return n;
}

// ---- parsers / readers ----
// "runtime permissions:" block of `dumpsys package`: "    android.permission.CAMERA: granted=true, flags=[...]"
export function parsePerms(dump: string): { name: string; granted: boolean }[] {
  const lines = dump.split(/\r?\n/), i = lines.findIndex((l) => /^\s*runtime permissions:/.test(l));
  const out: { name: string; granted: boolean }[] = [];
  for (let k = i + 1; i >= 0 && k < lines.length; k++) {
    const m = lines[k].match(/^\s+([\w.]+): granted=(true|false)/);
    if (!m) break;
    out.push({ name: m[1], granted: m[2] === "true" });
  }
  return out;
}
// `pm get-app-links <pkg>`: "Domain verification state:" then "      probe.crewdroid.example: approved"
export function parseLinks(out: string): Record<string, string> {
  const lines = out.split(/\r?\n/), i = lines.findIndex((l) => /^\s*Domain verification state:/.test(l));
  const r: Record<string, string> = {};
  for (let k = i + 1; i >= 0 && k < lines.length; k++) {
    const m = lines[k].match(/^\s+([^\s:]+): (\S+)\s*$/);
    if (!m) break;
    r[m[1]] = m[2];
  }
  return r;
}
export function parseDfAvailKB(out: string): number {
  const n = Number(out.trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/)[3]);
  if (!Number.isFinite(n)) throw new Error(`cannot parse 'df -k /data': ${out}`);
  return n;
}
const perms = async (s: string, pkg: string) => parsePerms(await sh(s, `dumpsys package ${pkg}`));
const links = async (s: string, pkg: string) => parseLinks(await sh(s, `pm get-app-links ${pkg}`));
const deep = async (s: string) => (await sh(s, "dumpsys deviceidle get deep")).trim();
const bucket = async (s: string, pkg: string) => {
  const v = (await sh(s, `am get-standby-bucket ${pkg}`)).trim();
  return /^\d+$/.test(v) ? Number(v) : (Object.hasOwn(BUCKETS, v.toLowerCase()) ? BUCKETS[v.toLowerCase()] : NaN);
};
const bgOp = async (s: string, pkg: string) => (await sh(s, `appops get ${pkg} RUN_ANY_IN_BACKGROUND`)).match(/RUN_ANY_IN_BACKGROUND: (\w+)/)?.[1] ?? "?";
const lowPower = async (s: string) => (await sh(s, "settings get global low_power")).trim();
const availKB = async (s: string) => parseDfAvailKB(await sh(s, "df -k /data"));

async function useLocalTransport(s: string) {
  const list = await sh(s, "bmgr list transports");
  must(list.includes(TRANSPORT), `${s}: backup needs ${TRANSPORT}, which this image does not have (transports: ${list.split(/\r?\n/).map((l) => l.trim().replace(/^\* /, "")).filter(Boolean).join(", ") || "none"})`);
  await sh(s, "bmgr enable true");
  await sh(s, `bmgr transport ${TRANSPORT}`);
  must(/currently enabled/.test(await sh(s, "bmgr enabled")), `${s}: Backup Manager is still disabled after bmgr enable true`);
  must(new RegExp(`\\* ${TRANSPORT.replace(/[./]/g, "\\$&")}`).test(await sh(s, "bmgr list transports")), `${s}: LocalTransport is not the selected transport`);
}

// what: perm grant|revoke|show [perm…] | open <uri> | links show|force <domain>|reset | clear | backup | restore
//       pressure doze|standby <bucket>|trim <level>|bg-restrict|battery-saver|reset | fill-storage <GB>|free
export async function appRun(serial: string, pkg: string, what: string, args: string[], opt: { pkg?: boolean } = {}): Promise<Record<string, unknown>> {
  assertSerial(serial);
  const bad = (m: string) => new Error(`${m}  (app <serial> <pkg> ${APP_WHAT.join("|")})`);
  if (!PKG_RE.test(pkg ?? "")) throw bad(`bad package name '${pkg ?? ""}'`);
  switch (what) {
    case "perm": {
      const [act, ...rest] = args;
      if (act !== "grant" && act !== "revoke" && act !== "show") throw bad(`perm needs grant|revoke|show, got '${act ?? ""}'`);
      const names = rest.map(permName);
      if (act !== "show" && !names.length) throw bad(`perm ${act} needs at least one permission`);
      if (act === "show") {
        const all = await perms(serial, pkg);
        const list = names.length ? names.map((n) => all.find((p) => p.name === n) ?? (() => { throw new Error(`${serial}: ${n} is not a runtime permission of ${pkg}`); })()) : all;
        return { serial, what, pkg, permissions: list };
      }
      for (const n of names) await sh(serial, `pm ${act} ${pkg} ${n}`);
      const want = act === "grant";
      const got = await settle(() => perms(serial, pkg), (v) => names.every((n) => v.find((p) => p.name === n)?.granted === want));
      const miss = names.filter((n) => got.find((p) => p.name === n)?.granted !== want);
      must(!miss.length, `${serial}: ${miss.join(", ")} reads granted=${!want} after pm ${act}${miss.some((n) => !got.some((p) => p.name === n)) ? ` (not requested by ${pkg}: pm ${act} did not fail on this image)` : ""}`);
      return { serial, what, pkg, action: act, permissions: names.map((n) => ({ name: n, granted: want })) };
    }
    case "open": {
      const uri = uriArg(args[0]);
      const nothing = new Error(`${serial}: No Activity found to handle ${uri}${opt.pkg ? ` in ${pkg}` : ""} (ATD has no Chrome)`);
      const out = await sh(serial, `am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d '${uri}'${opt.pkg ? ` -p ${pkg}` : ""} 2>&1`).catch((e) => { throw /unable to resolve/.test(e.message) ? nothing : e; }); // 2>&1: Error/Warning lines go to stderr
      // AI NOTE: am start exits 0 (API 34) or 255 (API 36) when nothing can handle the intent; the answer is in its text.
      if (/^Error: Activity not started, unable to resolve/m.test(out)) throw nothing;
      must(!/^Error/m.test(out), `${serial}: ${out.split(/\r?\n/).find((l) => l.startsWith("Error"))}`);
      const warn = out.split(/\r?\n/).find((l) => l.startsWith("Warning"));
      // a running app in the same task only has its task brought to the front: it never sees the new uri (force-stop it first)
      return { serial, what, uri, started: true, delivered: warn ? false : true, ...(warn ? { note: warn } : {}) };
    }
    case "links": {
      const api = Number(await sh(serial, "getprop ro.build.version.sdk"));
      must(api >= 31, `${serial}: links needs API 31+ (this device is API ${api})`);
      const [act, dom] = args;
      if (act === "show") return { serial, what, pkg, domains: await links(serial, pkg) };
      if (act === "force") {
        const d = domainName(dom);
        await sh(serial, `pm set-app-links --package ${pkg} 2 ${d}`);
        const got = await settle(() => links(serial, pkg), (v) => v[d] === "approved");
        must(got[d] === "approved", `${serial}: ${d} reads '${got[d] ?? "not declared by " + pkg}' after set-app-links, wanted approved`);
        return { serial, what, pkg, domain: d, state: got[d] };
      }
      if (act === "reset") {
        await sh(serial, `pm set-app-links --package ${pkg} 0 all`);
        const got = await settle(() => links(serial, pkg), (v) => Object.values(v).every((x) => x === "none"));
        must(Object.values(got).every((x) => x === "none"), `${serial}: domain states after reset: ${JSON.stringify(got)}`);
        return { serial, what, pkg, domains: got };
      }
      throw bad(`links needs show|force <domain>|reset, got '${act ?? ""}'`);
    }
    case "clear": {
      must(/Success/.test(await sh(serial, `pm clear ${pkg}`)), `${serial}: pm clear ${pkg} did not report Success`);
      // read-back through run-as (debuggable apps only); other apps get pm's own Success as the only evidence
      let left: number | null = null;
      try { left = Number((await sh(serial, `run-as ${pkg} sh -c 'find files cache code_cache databases shared_prefs -type f 2>/dev/null | wc -l'`)).trim()); } catch { /* not debuggable */ }
      must(left === null || left === 0, `${serial}: ${left} file(s) still in ${pkg}'s data dirs after pm clear`);
      return { serial, what, pkg, filesLeft: left, verified: left === null ? "pm Success only (app is not debuggable)" : "run-as listing" };
    }
    case "backup": {
      await useLocalTransport(serial);
      const out = await sh(serial, `bmgr backupnow ${pkg}`);
      must(/Backup finished with result: Success/.test(out) && out.includes(`Package ${pkg} with result: Success`), `${serial}: bmgr backupnow ${pkg}: ${out.split(/\r?\n/).slice(-2).join(" | ")}`);
      const sets = (await sh(serial, "bmgr list sets")).split(/\r?\n/).filter((l) => /^\s*\S+ : /.test(l));
      must(sets.length > 0, `${serial}: backup reported Success but bmgr list sets is empty`);
      return { serial, what, pkg, transport: TRANSPORT, sets: sets.map((l) => l.trim()) };
    }
    case "restore": {
      await useLocalTransport(serial);
      const sets = (await sh(serial, "bmgr list sets")).split(/\r?\n/).map((l) => l.match(/^\s*(\S+) : /)?.[1]).filter(Boolean) as string[];
      must(sets.length > 0, `${serial}: no restore set on LocalTransport; run 'app ${serial} ${pkg} backup' first`);
      const token = sets.at(-1)!;
      const out = await sh(serial, `bmgr restore ${token} ${pkg}`);
      must(/restoreFinished: 0/.test(out), `${serial}: bmgr restore ${token} ${pkg}: ${out.split(/\r?\n/).slice(-3).join(" | ")}`);
      return { serial, what, pkg, token, restored: true };
    }
    case "pressure": return pressure(serial, pkg, args, bad);
    case "fill-storage": {
      if (args[0] === "free") {
        const size = Number((await sh(serial, `stat -c %s ${FILL} 2>/dev/null || echo 0`)).trim());
        const before = await availKB(serial);
        await sh(serial, `rm -f ${FILL}`);
        const after = await settle(() => availKB(serial), (v) => v - before >= size / 1024 * 0.95);
        must(after - before >= (size / 1024) * 0.95, `${serial}: free space grew by ${after - before} KB after removing a ${Math.round(size / 1024)} KB fill file`);
        return { serial, what, freedMB: Math.round((after - before) / 1024), availableMB: Math.round(after / 1024) };
      }
      const size = gb(args[0]), mb = Math.round(size * 1024);
      await sh(serial, `rm -f ${FILL}`);
      const before = await availKB(serial);
      try { await sh(serial, `fallocate -l ${mb}M ${FILL}`); } catch (e) { await sh(serial, `rm -f ${FILL}`); throw new Error(`${serial}: cannot fill ${size} GB (${before >> 10} MB free): ${(e as Error).message}`); }
      const after = await settle(() => availKB(serial), (v) => before - v >= mb * 1024 * 0.95);
      must(before - after >= mb * 1024 * 0.95, `${serial}: df /data dropped ${(before - after) >> 10} MB, wanted ${mb} MB`);
      return { serial, what, filledMB: Math.round((before - after) / 1024), availableMB: Math.round(after / 1024) };
    }
    default: throw bad(`unknown app item '${what}'`);
  }
}

async function pressure(serial: string, pkg: string, args: string[], bad: (m: string) => Error): Promise<Record<string, unknown>> {
  const what = "pressure", [kind, arg] = args;
  switch (kind) {
    case "doze": {
      await sh(serial, "dumpsys battery unplug"); // deep idle is refused while charging
      await sh(serial, "dumpsys deviceidle force-idle");
      const d = await settle(() => deep(serial), (v) => v === "IDLE");
      must(d === "IDLE", `${serial}: deviceidle deep state reads '${d}', wanted IDLE`);
      return { serial, what, kind, deep: d };
    }
    case "standby": {
      const code = BUCKETS[arg ?? ""];
      if (code === undefined) throw bad(`standby bucket must be ${Object.keys(BUCKETS).join("|")}, got '${arg ?? ""}'`);
      await sh(serial, `am set-standby-bucket ${pkg} ${arg}`);
      const b = await settle(() => bucket(serial, pkg), (v) => v === code);
      must(b === code, `${serial}: standby bucket of ${pkg} reads ${b}, wanted ${code} (${arg})`);
      return { serial, what, kind, pkg, bucket: arg, code: b };
    }
    case "trim": {
      const level = (arg ?? "").toUpperCase();
      if (!(TRIM_LEVELS as readonly string[]).includes(level)) throw bad(`trim level must be ${TRIM_LEVELS.join("|")}, got '${arg ?? ""}'`);
      // AI NOTE: no read-back exists on the device; am raises on an unknown level, a process that is not running, or a background
      // level sent to a foreground process. The probe app logs "CrewProbe TRIM <level>" when its callback runs.
      await sh(serial, `am send-trim-memory ${pkg} ${level}`);
      return { serial, what, kind, pkg, level, verified: "am ack only" };
    }
    case "bg-restrict": {
      await sh(serial, `appops set ${pkg} RUN_ANY_IN_BACKGROUND ignore`);
      const m = await settle(() => bgOp(serial, pkg), (v) => v === "ignore");
      must(m === "ignore", `${serial}: RUN_ANY_IN_BACKGROUND reads '${m}', wanted ignore`);
      return { serial, what, kind, pkg, runAnyInBackground: m };
    }
    case "battery-saver": {
      await sh(serial, "settings put global low_power 1");
      const v = await lowPower(serial);
      must(v === "1", `${serial}: low_power reads '${v}', wanted 1`);
      return { serial, what, kind, lowPower: v };
    }
    case "reset": {
      await sh(serial, "dumpsys deviceidle unforce");
      await sh(serial, "dumpsys battery reset");
      await sh(serial, `am set-standby-bucket ${pkg} active`);
      await sh(serial, `appops set ${pkg} RUN_ANY_IN_BACKGROUND default`);
      await sh(serial, "settings put global low_power 0");
      const [d, b, op, lp] = [await settle(() => deep(serial), (v) => v === "ACTIVE"), await settle(() => bucket(serial, pkg), (v) => v === BUCKETS.active), await bgOp(serial, pkg), await lowPower(serial)];
      must(d === "ACTIVE" && b === BUCKETS.active && op !== "ignore" && lp === "0", `${serial}: after reset deep=${d} bucket=${b} RUN_ANY_IN_BACKGROUND=${op} low_power=${lp}`);
      return { serial, what, kind, pkg, deep: d, bucket: b, runAnyInBackground: op, lowPower: lp };
    }
    default: throw bad(`pressure needs ${PRESSURE.join("|")}, got '${kind ?? ""}'`);
  }
}

export const mcpTools: Tool[] = [{
  name: "app", description: "Control an app on a crewdroid emulator: perm grant|revoke|show [perm…], open <uri> (deep link / App Link), links show|force <domain>|reset (API 31+), clear, backup, restore (LocalTransport), pressure doze|standby <active|working_set|frequent|rare|restricted>|trim <level>|bg-restrict|battery-saver|reset, fill-storage <GB>|free. Setters read the state back and error on mismatch.",
  input: { serial: z.string().describe("emulator-<port>"), pkg: z.string().describe("application id, e.g. dev.crewdroid.probe"), what: z.enum(APP_WHAT), args: z.array(z.string()).default([]), onlyThisPackage: z.boolean().optional().describe("open only: restrict the intent to pkg") },
  run: (a) => appRun(a.serial, a.pkg, a.what, a.args, { pkg: a.onlyThisPackage }),
}];
