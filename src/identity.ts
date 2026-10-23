import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adb } from "./adb.ts";
import { avdName } from "./avd.ts";
import { waitBoot } from "./measure.ts";
import { PKG, killAll, probeApk, sleep, start } from "./snapshot.ts";

export interface Identity {
  serial: string; androidId: string; appAndroidId: string; roSerialno: string; roBootSerialno: string; wifiMac: string; hostname: string;
}
const KEYS = ["androidId", "appAndroidId", "roSerialno", "roBootSerialno", "wifiMac", "hostname"] as const;

const sh = (s: string, cmd: string) => adb(s, ["shell", cmd]).catch((e) => `(error: ${String(e).slice(0, 80)})`);

export async function read(serial: string): Promise<Identity> {
  await adb(serial, ["shell", "am", "force-stop", PKG]);
  await adb(serial, ["logcat", "-c"]);
  await adb(serial, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`, "--es", "check", "id"]);
  let app = "(none)";
  for (let i = 0; i < 20 && app === "(none)"; i++) {
    await sleep(500);
    app = (await adb(serial, ["logcat", "-d", "-s", "CrewProbe:I"])).match(/CrewProbe: ID ok (\S+)/)?.[1] ?? "(none)";
  }
  return {
    serial,
    androidId: await sh(serial, "settings get secure android_id"),
    appAndroidId: app,
    roSerialno: await sh(serial, "getprop ro.serialno"),
    roBootSerialno: await sh(serial, "getprop ro.boot.serialno"),
    wifiMac: await sh(serial, "cat /sys/class/net/wlan0/address"),
    hostname: await sh(serial, "getprop net.hostname"),
  };
}

// Boots `count` read-only clones (3 s apart) from the saved snapshot, runs fn, always kills them.
export async function withClones<T>(image: string, count: number, basePort: number, fn: (serials: string[]) => Promise<T>) {
  const name = avdName(image);
  const serials = Array.from({ length: count }, (_, i) => `emulator-${basePort + 2 * i}`);
  try {
    const t0 = Date.now();
    for (const [i, s] of serials.entries()) { start(name, basePort + 2 * i, true); await sleep(3000); }
    await Promise.all(serials.map((s) => waitBoot(s, t0)));
    await sleep(5000);
    // AI NOTE: shell cannot read wlan0's MAC (netlink permission denied); the ATD image allows adb root, so every clone runs adbd as root.
    for (const s of serials) await adb(s, ["root"], 20000);
    await sleep(3000);
    return await fn(serials);
  } finally {
    await killAll(name, serials);
  }
}

// Makes this clone's values distinct. Returns notes about values that could not be changed.
export async function makeDistinct(serial: string, idx: number): Promise<string[]> {
  const notes: string[] = [];
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  const tmp = join(tmpdir(), `crew-ssaid-${idx}.xml`), ssaid = "/data/system/users/0/settings_ssaid.xml";
  // Per-app ANDROID_ID = HMAC(userkey, package+signature); the userkey (64 hex chars) lives in settings_ssaid.xml (binary XML, same-length edit is safe).
  await adb(serial, ["pull", ssaid, tmp]);
  const buf = readFileSync(tmp).toString("latin1");
  const key = buf.match(/[0-9A-F]{64}/)?.[0];
  if (!key) notes.push("userkey not found in settings_ssaid.xml: per-app ANDROID_ID unchanged");
  else {
    writeFileSync(tmp, Buffer.from(buf.replaceAll(key, `${hex(idx)}`.repeat(32).toUpperCase()), "latin1"));
    await adb(serial, ["push", tmp, ssaid]);
    await adb(serial, ["shell", `chown system:system ${ssaid}; restorecon ${ssaid}; setprop sys.boot_completed 0; stop; start`]);
    await sleep(5000);
    await waitBoot(serial, Date.now(), 120000);
    await sleep(5000);
    await adb(serial, ["root"], 20000).catch(() => {});
    await sleep(3000);
    await adb(serial, ["uninstall", PKG]); // drops the cached per-app entry so it is regenerated from the new userkey
    await adb(serial, ["install", probeApk()], 120000);
  }
  await adb(serial, ["shell", "settings", "put", "secure", "android_id", `c0ffee00000000${hex(idx)}`]);
  await adb(serial, ["shell", `ip link set wlan0 down; ip link set wlan0 address 02:15:b2:00:00:${hex(idx)}; ip link set wlan0 up`]).catch((e) => notes.push(`wifi mac: ${e}`));
  await adb(serial, ["shell", "setprop", "net.hostname", `crew-${idx}`]).catch((e) => notes.push(`hostname: ${e}`));
  return notes;
}

export async function identity(image: string, count: number, basePort: number, distinct = true) {
  return withClones(image, count, basePort, async (serials) => {
    const before = await Promise.all(serials.map(read));
    const collisions = KEYS.filter((k) => new Set(before.map((b) => b[k])).size < before.length);
    let after: Identity[] | null = null, notes: string[] = [];
    if (distinct && collisions.length) {
      notes = (await Promise.all(serials.map((s, i) => makeDistinct(s, i + 1)))).flat();
      after = await Promise.all(serials.map(read));
    }
    const stillSame = after ? KEYS.filter((k) => new Set(after!.map((b) => b[k])).size < after!.length) : collisions;
    return { date: new Date().toISOString(), image, count, before, collisions, after, stillSame, notes };
  });
}
