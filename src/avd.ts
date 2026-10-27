import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostAbi } from "./platform.ts";
import { sdkRoot } from "./sdk.ts";

export const avdHome = () => process.env.ANDROID_AVD_HOME || join(process.env.USERPROFILE || process.env.HOME || "", ".android", "avd");
process.env.ANDROID_AVD_HOME = avdHome(); // avdmanager and emulator (children) then use the same folder crewdroid reads; newer avdmanager may pick another home otherwise

// image "android-34/google_atd" -> AVD "crew-android-34-google_atd", sdk package "system-images;android-34;google_atd;<host abi>"
// AI NOTE: a quickboot snapshot saved with one -memory/-cores does not load with another ("starting from scratch. Reason:
// different AVD configuration", docs/measurements/spec.md), so a non-default spec gets its own base AVD + snapshot:
// "crew-android-34-google_atd-r2048-c4". The default spec keeps the old name (T64).
export interface Spec { ramMB?: number; cores?: number }
export const CORES = 2; // default guest CPUs
export const avdName = (image: string, spec: Spec = {}) => {
  const base = `crew-${image.replace("/", "-")}`, r = spec.ramMB ?? ramMB(image), c = spec.cores ?? CORES;
  return r === ramMB(image) && c === CORES ? base : `${base}-r${r}-c${c}`;
};
export const coresOf = (avd: string) => Number(avd.match(/-r\d+-c(\d+)$/)?.[1]) || CORES;
export const imagePackage = (image: string) => `system-images;${image.replace("/", ";")};${hostAbi()}`;
export const imageDir = (image: string) => join(sdkRoot(), "system-images", ...image.split("/"), hostAbi());

const q = (s: string) => (process.platform === "win32" ? `"${s}"` : s); // quotes only for the Windows shell; spawn without a shell takes them literally
const bat = (n: string) => join(sdkRoot(), "cmdline-tools", "latest", "bin", process.platform === "win32" ? `${n}.bat` : n);

function exec(cmd: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((res, rej) => {
    // AI NOTE: .bat files need a shell on Windows (node refuses to spawn them directly since CVE-2024-27980)
    const p = spawn(cmd, args, { shell: process.platform === "win32", windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", rej);
    p.on("close", (c) => (c === 0 ? res(out) : rej(new Error(`${cmd} exit ${c}: ${out.slice(-500)}`))));
    p.stdin.end(stdin ?? "");
  });
}

export function imageInstalled(image: string): boolean {
  return existsSync(join(imageDir(image), "system.img"));
}

export async function installImage(image: string) {
  await exec(q(bat("sdkmanager")), [q(imagePackage(image))], "y\n".repeat(10));
}

// RAM knobs (T16, docs/measurements/ram.md). CREWDROID_KNOBS (JSON) overrides them for the sweep in scripts/check-ram.mjs.
// A changed knob changes slimSettings(), so up()/slim re-prepare the base snapshots.
// AI NOTE: without -lowram the emulator raises hw.ramSize to 2048 (API 31) / 2560 MB (API 34/36). 768 MB failed the private-app
// call and 832 MB broke makeDistinct's framework restart on API 36; API 31 is not in the private-app call and runs at 768.
// Disabling the host Vulkan feature saved ~170 MiB per emulator (T16).
// "host" everywhere we measured; a Linux host with no display server (CI runner, headless server; /dev/dri may still exist) cannot start the host renderer
// ("Could not start renderer"), so it falls back to software. CREWDROID_GPU overrides.
function hostGpu(): string {
  return process.env.CREWDROID_GPU || (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? "swiftshader_indirect" : "host");
}
export const KNOBS: { ramMB: number; ramMBByApi: Record<string, number>; lowRam: boolean; heapMB: number; audio: boolean; sensors: boolean; gpu: string; fileBacked: boolean; vulkan: boolean; coldBoot: boolean } = {
  ramMB: 896, ramMBByApi: { "31": 768 }, lowRam: true, heapMB: 0, audio: true, sensors: true, gpu: hostGpu(), fileBacked: false, vulkan: false, coldBoot: false,
  ...JSON.parse(process.env.CREWDROID_KNOBS || "{}"),
};
// guest RAM (hw.ramSize and -memory) for an image or AVD name; the quickboot RAM image scales with it (T15)
export const ramMB = (imageOrAvd: string) => Number(imageOrAvd.match(/-r(\d+)-c\d+$/)?.[1]) || (KNOBS.ramMBByApi[imageOrAvd.match(/android-(\d+)/)?.[1] ?? ""] ?? KNOBS.ramMB);
export const MAX_RAM_MB = 8192;

// --ram / --cores (or profile ramMB / cores) limits, checked before anything launches. The minimum RAM is the image's
// default (T16: API 34/36 need >= 896 MB with -lowram, API 31 runs at 768).
export function checkSpec(image: string, spec: Spec, host: { cpus: number; freeMB: number }) {
  const { ramMB: r, cores: c } = spec, min = ramMB(image);
  if (r !== undefined) {
    if (!Number.isInteger(r) || r < min) throw new Error(`--ram ${r}: ${image} needs at least ${min} MB (integer MB)`);
    if (r > MAX_RAM_MB) throw new Error(`--ram ${r}: at most ${MAX_RAM_MB} MB`);
    if (r > host.freeMB) throw new Error(`--ram ${r}: above free host RAM (${Math.floor(host.freeMB)} MB)`);
  }
  if (c !== undefined && (!Number.isInteger(c) || c < 1 || c > host.cpus)) throw new Error(`--cores ${c}: must be 1..${host.cpus} (host logical CPUs)`);
}
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
export async function createAvd(image: string, spec: Spec = {}): Promise<string> {
  const name = avdName(image, spec);
  const dir = join(avdHome(), `${name}.avd`);
  if (!existsSync(dir)) {
    // -p: the AVD folder lands where avdHome() reads it (on the CI runner avdmanager picked another home: config.ini ENOENT)
    const out = await exec(q(bat("avdmanager")), ["create", "avd", "-n", name, "-k", q(imagePackage(image)), "-p", q(dir), "--force"], "no\n");
    if (!existsSync(join(dir, "config.ini"))) throw new Error(`avdmanager did not create ${dir}: ${out.slice(-500)}`);
    // the emulator finds an AVD by <name>.ini in ANDROID_AVD_HOME; avdmanager on the Linux CI runner wrote it elsewhere
    const pointer = join(avdHome(), `${name}.ini`);
    if (!existsSync(pointer)) writeFileSync(pointer, `avd.ini.encoding=UTF-8\npath=${dir}\npath.rel=avd/${name}.avd\ntarget=${image.split("/")[0]}\n`);
  }
  const ini = join(dir, "config.ini");
  let text = readFileSync(ini, "utf8");
  for (const [k, v] of Object.entries({ ...CONFIG, "hw.ramSize": String(ramMB(name)), "hw.cpu.ncore": String(coresOf(name)) })) {
    const re = new RegExp(String.raw`^${k.replace(/\./g, "\\.")}\s*=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
  }
  writeFileSync(ini, text);
  return name;
}

export const launchArgs = (name: string, port: number) =>
  ["-avd", name, "-port", String(port), "-no-window", "-no-audio", "-no-snapshot", "-gpu", KNOBS.gpu, "-camera-back", "emulated", "-cores", String(coresOf(name)), "-memory", String(ramMB(name))];
