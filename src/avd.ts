import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sdkRoot } from "./sdk.ts";

export const avdHome = () => process.env.ANDROID_AVD_HOME || join(process.env.USERPROFILE || process.env.HOME || "", ".android", "avd");

// image "android-34/google_atd" -> AVD "crew-android-34-google_atd", sdk package "system-images;android-34;google_atd;x86_64"
export const avdName = (image: string) => `crew-${image.replace("/", "-")}`;
export const imagePackage = (image: string) => `system-images;${image.replace("/", ";")};x86_64`;

const bat = (n: string) => join(sdkRoot(), "cmdline-tools", "latest", "bin", process.platform === "win32" ? `${n}.bat` : n);

function exec(cmd: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((res, rej) => {
    // AI NOTE: .bat files need a shell on Windows (node refuses to spawn them directly since CVE-2024-27980)
    const p = spawn(cmd, args, { shell: process.platform === "win32", windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (c) => (c === 0 ? res(out) : rej(new Error(`${cmd} exit ${c}: ${out.slice(-500)}`))));
    p.stdin.end(stdin ?? "");
  });
}

export function imageInstalled(image: string): boolean {
  return existsSync(join(sdkRoot(), "system-images", ...image.split("/"), "x86_64", "system.img"));
}

export async function installImage(image: string) {
  await exec(`"${bat("sdkmanager")}"`, [`"${imagePackage(image)}"`], "y\n".repeat(10));
}

// RAM knobs (T16, docs/measurements/ram.md). CREWDROID_KNOBS (JSON) overrides them for the sweep in scripts/check-ram.mjs.
// A changed knob changes slimSettings(), so up()/slim re-prepare the base snapshots.
// AI NOTE: without -lowram the emulator raises hw.ramSize to 2048 (API 31) / 2560 MB (API 34/36). 768 MB failed the private-app
// call and 832 MB broke makeDistinct's framework restart on API 36; API 31 is not in the private-app call and runs at 768.
// Disabling the host Vulkan feature saved ~170 MiB per emulator (T16).
export const KNOBS: { ramMB: number; ramMBByApi: Record<string, number>; lowRam: boolean; heapMB: number; audio: boolean; sensors: boolean; gpu: string; fileBacked: boolean; vulkan: boolean; coldBoot: boolean } = {
  ramMB: 896, ramMBByApi: { "31": 768 }, lowRam: true, heapMB: 0, audio: true, sensors: true, gpu: "host", fileBacked: false, vulkan: false, coldBoot: false,
  ...JSON.parse(process.env.CREWDROID_KNOBS || "{}"),
};
// guest RAM (hw.ramSize and -memory) for an image or AVD name; the quickboot RAM image scales with it (T15)
export const ramMB = (imageOrAvd: string) => KNOBS.ramMBByApi[imageOrAvd.match(/android-(\d+)/)?.[1] ?? ""] ?? KNOBS.ramMB;
export const DATA_PARTITION = "2G"; // userdata size; was 10G. AI NOTE: emulator 37.1 rewrites it to 6G at boot (T15, slim.md)

const SENSORS = ["hw.accelerometer_uncalibrated", "hw.gyroscope", "hw.sensors.gyroscope_uncalibrated", "hw.sensors.humidity", "hw.sensors.light",
  "hw.sensors.magnetic_field", "hw.sensors.magnetic_field_uncalibrated", "hw.sensors.orientation", "hw.sensors.pressure", "hw.sensors.proximity", "hw.sensors.temperature", "hw.gps"];
const yn = (b: boolean) => (b ? "yes" : "no");

export const CONFIG: Record<string, string> = {
  "hw.lcd.width": "1080", "hw.lcd.height": "2340", "hw.lcd.density": "420",
  "hw.cpu.ncore": "2", "hw.camera.back": "emulated", "hw.camera.front": "none", "disk.dataPartition.size": DATA_PARTITION,
  "hw.audioInput": yn(KNOBS.audio), "hw.audioOutput": yn(KNOBS.audio), ...Object.fromEntries(SENSORS.map((k) => [k, yn(KNOBS.sensors)])),
  ...(KNOBS.heapMB ? { "vm.heapSize": `${KNOBS.heapMB}M` } : {}),
};

// Creates the crewdroid AVD (idempotent) and returns its name. -cores/-memory are also passed at launch (see launchArgs).
export async function createAvd(image: string): Promise<string> {
  const name = avdName(image);
  const dir = join(avdHome(), `${name}.avd`);
  if (!existsSync(dir)) {
    await exec(`"${bat("avdmanager")}"`, ["create", "avd", "-n", name, "-k", `"${imagePackage(image)}"`, "--force"], "no\n");
  }
  const ini = join(dir, "config.ini");
  let text = readFileSync(ini, "utf8");
  for (const [k, v] of Object.entries({ ...CONFIG, "hw.ramSize": String(ramMB(image)) })) {
    const re = new RegExp(String.raw`^${k.replace(/\./g, "\\.")}\s*=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
  }
  writeFileSync(ini, text);
  return name;
}

export const launchArgs = (name: string, port: number) =>
  ["-avd", name, "-port", String(port), "-no-window", "-no-audio", "-no-snapshot", "-gpu", "host", "-camera-back", "emulated", "-cores", "2", "-memory", String(ramMB(name))];
