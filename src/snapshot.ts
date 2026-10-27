import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adb } from "./adb.ts";
import { KNOBS, type Spec, avdHome, coresOf, createAvd, imageDir, imageInstalled, installImage, ramMB } from "./avd.ts";
import { launchEmulator } from "./emulator.ts";
import { waitBoot } from "./measure.ts";
import { killMatching } from "./platform.ts";
import { MARK, slimAvd, slimImage } from "./slim.ts";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const PKG = "dev.crewdroid.probe";
export const probeApk = () => join(import.meta.dirname, "..", "probe-app/app/build/outputs/apk/debug/app-debug.apk");
export const SNAPSHOT = "default_boot"; // quickboot snapshot name; -read-only instances load it automatically

// AI NOTE: no -no-snapshot here (avd.ts launchArgs has it): snapshots must stay enabled to save/load default_boot.
export function start(name: string, port: number, readOnly: boolean, extra: string[] = [], window = false) {
  const args = ["-avd", name, "-port", String(port), ...(window ? [] : ["-no-window"]), "-no-audio", "-gpu", KNOBS.gpu, "-camera-back", "emulated", "-cores", String(coresOf(name)), "-memory", String(ramMB(name)),
    "-feature", `${KNOBS.fileBacked ? "" : "-"}QuickbootFileBacked,${KNOBS.vulkan ? "" : "-"}Vulkan`, ...(KNOBS.lowRam ? ["-lowram"] : []),
    ...(readOnly ? ["-read-only", ...(KNOBS.coldBoot ? ["-no-snapshot-load"] : [])] : ["-no-snapshot-save"]), ...extra];
  return launchEmulator(args, join(tmpdir(), `crewdroid-${name}-${port}.log`), window);
}

export async function killAll(name: string, serials: string[]) {
  for (const s of serials) await adb(s, ["emu", "kill"], 10000).catch(() => {});
  await sleep(5000);
  await killMatching(`(^|[ @"])${name}([ "]|$)`).catch(() => {});
}

// Boots the base AVD once (writable), installs the probe app, saves a clean snapshot, shuts down, then slims it (T15):
// image sparse + compressed first, old snapshots dropped, AVD files compressed after the save.
export async function prepare(image: string, port = 5580, tries = 3, spec: Spec = {}): Promise<{ avd: string; snapshot: string; bootSeconds: number }> {
  if (!imageInstalled(image)) await installImage(image);
  await slimImage(imageDir(image));
  const name = await createAvd(image, spec);
  const dir = join(avdHome(), `${name}.avd`);
  const serial = `emulator-${port}`;
  if (!existsSync(probeApk())) throw new Error(`probe apk missing: ${probeApk()} (run gradlew assembleDebug in probe-app/)`);
  rmSync(join(dir, MARK), { force: true });
  rmSync(join(dir, "snapshots"), { recursive: true, force: true }); // stale snapshots + file-backed ram.img (2.5 GB each)
  let bootSeconds: number;
  try {
    // cold boot on wiped data: re-preparing must not start from the old snapshot, and a new disk.dataPartition.size applies.
    // AI NOTE: ANDROID_SNAPSHOT_COMPRESS=1 (emulator's own snapshot compression) saved a 47 % smaller ram.bin, but clones
    // restored from it stayed `adb offline` (API 34, T15). NTFS compression in slimAvd() is used instead.
    await start(name, port, false, ["-no-snapshot-load", "-wipe-data"]);
    bootSeconds = await waitBoot(serial, Date.now());
    await sleep(10000); // let boot-time jobs settle so the snapshot is clean
    await adb(serial, ["install", "-r", probeApk()], 120000);
    await adb(serial, ["shell", "pm", "grant", PKG, "android.permission.CAMERA"]);
    // AI NOTE: API 36 with 768 MB guest RAM wrote no settings_ssaid.xml during prepare, which makeDistinct edits (T16);
    // the probe's ANDROID_ID read makes SettingsProvider create it.
    await adb(serial, ["shell", "am", "start", "-W", "-n", `${PKG}/.ProbeActivity`, "--es", "check", "id"], 60000);
    await sleep(5000);
    await adb(serial, ["shell", "am", "force-stop", PKG]);
    // AI NOTE: on an API 31 clone restored from a non-root snapshot, `adb root` leaves the device offline for good;
    // saving the snapshot with adbd already root makes the clone's `adb root` a no-op.
    await adb(serial, ["root"], 20000);
    await sleep(3000);
    // Zero the guest's free RAM so the snapshot's ram.bin is mostly zero pages (NTFS stores them as nothing): drop the page
    // cache, fill a tmpfs file with zeros up to MemFree - 512 MB, delete it (the kernel does not zero pages on free).
    // AI NOTE: with a 256 MB margin the API 31 clone restored from the snapshot stayed `adb offline` every time (T15).
    await adb(serial, ["shell", "sync; echo 3 > /proc/sys/vm/drop_caches; set -- $(grep MemFree /proc/meminfo); dd if=/dev/zero of=/dev/crew-zero bs=1048576 count=$(( $2 / 1024 - 512 )) 2>/dev/null; rm -f /dev/crew-zero"], 120000);
    await adb(serial, ["emu", "avd", "snapshot", "save", SNAPSHOT], 120000);
  } finally {
    await killAll(name, [serial]);
  }
  await slimAvd(dir);
  // AI NOTE: some saved snapshots (T16: 3 of ~12 prepares, API 34 and 36, any RAM size) restore with adbd stuck: every clone
  // stays `adb offline` and `adb reconnect` does not help; preparing again fixes it. Cause [모름], so test one clone and retry.
  if (!(await cloneBoots(name, port))) {
    rmSync(join(dir, MARK), { force: true });
    if (tries <= 1) throw new Error(`${name}: clones of the saved snapshot stay adb offline`);
    console.error(`${name}: clone of the new snapshot stayed offline; preparing again`);
    return prepare(image, port, tries - 1, spec);
  }
  return { avd: name, snapshot: SNAPSHOT, bootSeconds };
}

async function cloneBoots(name: string, port: number) {
  const serial = `emulator-${port}`;
  try {
    await start(name, port, true, ["-no-boot-anim"]);
    await waitBoot(serial, Date.now(), 90000);
    return true;
  } catch { return false; } finally { await killAll(name, [serial]); }
}
