import { z } from "zod";
import { adb, assertSerial } from "./adb.ts";
import type { Tool } from "./mcp.ts";

export const ENV_WHAT = ["geo", "battery", "rotate", "sensor", "dark", "font", "locale", "gsm", "sms", "call", "show"] as const;
export const GSM_DATA = ["home", "roaming", "searching", "denied", "off", "on"] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sh = (s: string, cmd: string) => adb(s, ["shell", cmd]);
// AI NOTE: `adb emu` exits 0 even when the console says "KO: ...", so the output is checked.
const emu = async (s: string, ...a: string[]) => {
  const out = await adb(s, ["emu", ...a]);
  if (/^KO/m.test(out)) throw new Error(`emu ${a.join(" ")}: ${out.split(/\r?\n/).find((l) => l.startsWith("KO"))}`);
  return out;
};

export function num(v: string | undefined, name: string, min: number, max: number, int = false): number {
  const n = Number(v);
  if (v === undefined || v.trim() === "" || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new Error(`${name} must be ${int ? "an integer" : "a number"} ${min}..${max}, got '${v ?? ""}'`);
  return n;
}
const phone = (v: string | undefined, name: string) => {
  if (!v || !/^\+?\d{1,20}$/.test(v)) throw new Error(`${name} must be digits (optional leading +), got '${v ?? ""}'`);
  return v;
};
export function parseAccel(v: string | undefined): number[] {
  const p = (v ?? "").split(":");
  if (p.length !== 3) throw new Error(`acceleration must be x:y:z (m/s^2, -100..100), got '${v ?? ""}'`);
  return p.map((x) => num(x, "acceleration axis", -100, 100));
}
const must = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg); };
// poll `read` until `ok` or ms elapsed; returns the last value either way (the caller decides what a miss means)
async function settle<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  let v = await read();
  for (const t0 = Date.now(); !ok(v) && Date.now() - t0 < ms;) { await sleep(300); v = await read(); }
  return v;
}

// ---- readers: used by every setter (read-back) and by `show` ----
const battery = async (s: string) => { const d = await sh(s, "dumpsys battery"); return { level: Number(d.match(/level: (\d+)/)?.[1]), ac: /AC powered: true/.test(d) }; };
// wm = WindowManager's own copy of the lock (dumpsys window), which can differ from the settings (see rotate)
const rotation = async (s: string) => ({
  auto: (await sh(s, "settings get system accelerometer_rotation")).trim(), user: (await sh(s, "settings get system user_rotation")).trim(),
  wm: (await sh(s, "dumpsys window displays | grep mUserRotationMode")).match(/mUserRotationMode=USER_ROTATION_LOCKED mUserRotation=ROTATION_(\d+)/)?.[1] ?? "free",
});
const dark = async (s: string) => (await sh(s, "cmd uimode night")).match(/Night mode: (\w+)/)?.[1] ?? "?";
const font = async (s: string) => { const v = (await sh(s, "settings get system font_scale")).trim(); return v === "null" ? 1 : Number(v); };
const gsmData = async (s: string) => (await emu(s, "gsm", "status")).match(/data state:\s*(\w+)/)?.[1] ?? "?";
const accel = async (s: string) => (await emu(s, "sensor", "get", "acceleration")).match(/acceleration = (\S+)/)?.[1] ?? "?";
const callState = async (s: string) => {
  const d = await sh(s, "dumpsys telephony.registry | grep -E 'mCallState|mCallIncomingNumber'");
  return { state: Number(d.match(/mCallState=(\d)/)?.[1]), number: d.match(/mCallIncomingNumber=(\S*)/)?.[1] ?? "" }; // 0 idle, 1 ringing, 2 offhook
};
const lastSms = async (s: string) => (await sh(s, "dumpsys isms | grep EVENT_NEW_SMS").catch(() => "")).trim().split(/\r?\n/).at(-1) ?? "";
const appLocales = async (s: string, pkg: string) => (await sh(s, `cmd locale get-app-locales ${pkg}`)).match(/\[(.*)\]/)?.[1] ?? "";
// AI NOTE: the emulator GNSS only pushes a `geo fix` to an app that is requesting location; without one dumpsys keeps the previous
// "last location" (or null). So this is the last fix Android saw, not proof the newest fix arrived. The probe's check=env asks for a fix.
const geoSeen = async (s: string) => {
  const d = await sh(s, "dumpsys location");
  const m = d.slice(Math.max(0, d.indexOf("gps provider:"))).match(/last location=Location\[gps (-?[\d.]+),(-?[\d.]+)/);
  return { enabled: (await sh(s, "cmd location is-location-enabled")).trim() === "true", lat: m ? Number(m[1]) : null, lon: m ? Number(m[2]) : null };
};

export async function envShow(serial: string) {
  assertSerial(serial);
  const [b, r, d, f, g, a, c, geo, api] = await Promise.all([battery(serial), rotation(serial), dark(serial), font(serial), gsmData(serial), accel(serial), callState(serial), geoSeen(serial), sh(serial, "getprop ro.build.version.sdk")]);
  const props = (await sh(serial, "getprop persist.sys.locale; getprop ro.product.locale")).split(/\r?\n/);
  return { serial, what: "show", api: Number(api), geo, battery: b, rotation: r, acceleration: a, dark: d, font: f, locale: { persist: props[0] || null, product: props[1] || null }, gsmData: g, call: c };
}

// what: geo <lon> <lat> [alt] | battery <0-100> [ac|unplugged] | rotate <0-3> | sensor acceleration x:y:z | dark on|off | font <scale>
//       locale <pkg> <tags> | gsm data <state> | gsm signal <0-31> | sms <from> <text> | call <number> [accept|cancel] | show
export async function envSet(serial: string, what: string, args: string[], opt: { hold?: number } = {}): Promise<Record<string, unknown>> {
  assertSerial(serial);
  const bad = (m: string) => new Error(`${m}  (env <serial> ${ENV_WHAT.join("|")})`);
  switch (what) {
    case "geo": {
      const lon = num(args[0], "longitude", -180, 180), lat = num(args[1], "latitude", -90, 90);
      const alt = args[2] === undefined ? [] : [String(num(args[2], "altitude", -1000, 100000))];
      await emu(serial, "geo", "fix", String(lon), String(lat), ...alt);
      await sh(serial, "cmd location set-location-enabled true");
      const seen = await settle(() => geoSeen(serial), (v) => v.lat !== null && Math.abs(v.lat - lat) < 1e-3 && Math.abs(v.lon! - lon) < 1e-3, 3000);
      must(seen.enabled, `${serial}: location is still disabled after set-location-enabled true`);
      return { serial, what, lon, lat, locationEnabled: true, androidLastFix: seen.lat === null ? null : `${seen.lat},${seen.lon}`, delivered: seen.lat !== null && Math.abs(seen.lat - lat) < 1e-3 && Math.abs(seen.lon! - lon) < 1e-3 };
    }
    case "battery": {
      const level = num(args[0], "battery level", 0, 100, true);
      const mode = args[1];
      if (mode !== undefined && mode !== "ac" && mode !== "unplugged") throw bad(`battery mode must be ac|unplugged, got '${mode}'`);
      await emu(serial, "power", "capacity", String(level));
      if (mode) await emu(serial, "power", "ac", mode === "ac" ? "on" : "off");
      const b = await settle(() => battery(serial), (v) => v.level === level && (!mode || v.ac === (mode === "ac")));
      must(b.level === level, `${serial}: battery level reads ${b.level}, wanted ${level}`);
      must(!mode || b.ac === (mode === "ac"), `${serial}: AC powered reads ${b.ac}, wanted ${mode === "ac"}`);
      return { serial, what, level: b.level, ac: b.ac };
    }
    case "rotate": {
      const n = num(args[0], "rotation", 0, 3, true);
      await sh(serial, "settings put system accelerometer_rotation 0");
      await sh(serial, `settings put system user_rotation ${n}`);
      // AI NOTE: on API 36 WindowManager kept its old user rotation after the setting changed while no window was up (a later launch rotated back and
      // rewrote the setting), so the lock is also set through WindowManager itself.
      await sh(serial, `wm user-rotation lock ${n}`);
      const r = await settle(() => rotation(serial), (v) => v.auto === "0" && v.user === String(n) && v.wm === String(n * 90));
      must(r.auto === "0" && r.user === String(n) && r.wm === String(n * 90), `${serial}: rotation reads accelerometer_rotation=${r.auto} user_rotation=${r.user} windowmanager=${r.wm}, wanted 0 / ${n} / ${n * 90}`);
      return { serial, what, userRotation: n, accelerometerRotation: 0 };
    }
    case "sensor": {
      if (args[0] !== "acceleration") throw bad(`only 'sensor acceleration x:y:z' is supported, got '${args[0] ?? ""}'`);
      const want = parseAccel(args[1]);
      await emu(serial, "sensor", "set", "acceleration", want.join(":"));
      const got = await accel(serial);
      const nums = got.split(":").map(Number);
      must(nums.length === 3 && nums.every((x, i) => Math.abs(x - want[i]) < 1e-3), `${serial}: acceleration reads ${got}, wanted ${want.join(":")}`);
      return { serial, what, acceleration: got };
    }
    case "dark": {
      if (args[0] !== "on" && args[0] !== "off") throw bad(`dark must be on|off, got '${args[0] ?? ""}'`);
      await sh(serial, `cmd uimode night ${args[0] === "on" ? "yes" : "no"}`);
      const d = await settle(() => dark(serial), (v) => v === (args[0] === "on" ? "yes" : "no"));
      must(d === (args[0] === "on" ? "yes" : "no"), `${serial}: night mode reads '${d}', wanted ${args[0] === "on" ? "yes" : "no"}`);
      return { serial, what, dark: args[0] === "on" };
    }
    case "font": {
      const scale = num(args[0], "font scale", 0.5, 3);
      await sh(serial, `settings put system font_scale ${scale}`);
      const f = await font(serial);
      must(Math.abs(f - scale) < 1e-6, `${serial}: font_scale reads ${f}, wanted ${scale}`);
      return { serial, what, font: f };
    }
    case "locale": {
      const [pkg, tags] = args;
      if (!pkg || !/^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(pkg)) throw bad(`locale needs a package name, got '${pkg ?? ""}'`);
      if (!tags || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*(,[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*)*$/.test(tags)) throw bad(`locale tags must be BCP-47 separated by commas (ko-KR,en), got '${tags ?? ""}'`);
      const api = Number(await sh(serial, "getprop ro.build.version.sdk"));
      must(api >= 33, `${serial}: per-app locales need API 33+ (this device is API ${api}); there is no shell command for the device-wide locale`);
      await sh(serial, `cmd locale set-app-locales ${pkg} --locales ${tags}`);
      const got = await appLocales(serial, pkg);
      must(got.toLowerCase() === tags.toLowerCase(), `${serial}: app locales of ${pkg} read '${got}', wanted '${tags}'`);
      return { serial, what, pkg, locales: got };
    }
    case "gsm": {
      if (args[0] === "data") {
        const st = args[1] as (typeof GSM_DATA)[number];
        if (!GSM_DATA.includes(st)) throw bad(`gsm data must be ${GSM_DATA.join("|")}, got '${args[1] ?? ""}'`);
        await emu(serial, "gsm", "data", st);
        const want = st === "off" ? "unregistered" : st === "on" ? "home" : st; // console: off = unregistered, on = home
        const got = await settle(() => gsmData(serial), (v) => v === want);
        must(got === want, `${serial}: gsm data state reads '${got}', wanted '${want}'`);
        return { serial, what: "gsm data", state: got };
      }
      if (args[0] === "signal") {
        const rssi = num(args[1], "signal", 0, 31, true);
        const hold = opt.hold === undefined ? 0 : num(String(opt.hold), "--hold seconds", 1, 3600, true);
        // AI NOTE: the console applies the value for 15 s only, so --hold re-sends every 10 s. No read-back exists: the guest
        // SignalStrength did not follow the value in 4 tries (T20), so the only check is the console "OK".
        const t0 = Date.now();
        do {
          await emu(serial, "gsm", "signal", String(rssi));
          if (hold) await sleep(Math.min(10000, Math.max(0, hold * 1000 - (Date.now() - t0))));
        } while (Date.now() - t0 < hold * 1000);
        return { serial, what: "gsm signal", rssi, heldSeconds: hold, verified: "console ack only" };
      }
      throw bad(`gsm needs 'data <state>' or 'signal <0-31>', got '${args[0] ?? ""}'`);
    }
    case "sms": {
      const from = phone(args[0], "sender"), text = args.slice(1).join(" ");
      if (!text || /[\r\n]/.test(text) || text.length > 160) throw bad("sms text must be 1..160 characters on one line");
      const before = await lastSms(serial);
      await emu(serial, "sms", "send", from, text);
      const after = await settle(() => lastSms(serial), (v) => v !== before);
      must(after !== before, `${serial}: sms was sent to the console but the guest's inbound SMS handler recorded nothing new`);
      return { serial, what, from, text, received: true };
    }
    case "call": {
      const number = phone(args[0], "number"), act = args[1] ?? "dial";
      if (!["dial", "accept", "cancel"].includes(act)) throw bad(`call action must be accept|cancel, got '${act}'`);
      const want = act === "dial" ? 1 : act === "accept" ? 2 : 0;
      await emu(serial, "gsm", act === "dial" ? "call" : act, number);
      const c = await settle(() => callState(serial), (v) => v.state === want);
      must(c.state === want, `${serial}: call state reads ${c.state}, wanted ${want} (0 idle, 1 ringing, 2 offhook)`);
      must(act !== "dial" || c.number === number.replace(/^\+/, "") || c.number === number, `${serial}: incoming number reads '${c.number}', wanted '${number}'`);
      return { serial, what, number, action: act, callState: ["idle", "ringing", "offhook"][c.state] };
    }
    case "show": return envShow(serial);
    default: throw bad(`unknown env item '${what}'`);
  }
}

export const mcpTools: Tool[] = [{
  name: "env", description: "Change or read a crewdroid emulator's environment: geo <lon> <lat> [alt], battery <0-100> [ac|unplugged], rotate <0-3>, sensor acceleration x:y:z, dark on|off, font <scale>, locale <pkg> <tags> (API 33+), gsm data <home|roaming|searching|denied|off|on>, gsm signal <0-31>, sms <from> <text>, call <number> [accept|cancel], show. Every setter reads the state back and errors on mismatch.",
  input: { serial: z.string().describe("emulator-<port>"), what: z.enum(ENV_WHAT), args: z.array(z.string()).default([]), holdSeconds: z.number().int().min(1).max(3600).optional().describe("gsm signal only: keep re-sending for this long") },
  run: (a) => envSet(a.serial, a.what, a.args, { hold: a.holdSeconds }),
}];
