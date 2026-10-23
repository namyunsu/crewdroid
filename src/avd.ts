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

export const RAM_MB = 1536; // guest RAM (hw.ramSize and -memory); the quickboot RAM image scales with it (T15)
export const DATA_PARTITION = "2G"; // userdata size; was 10G. AI NOTE: emulator 37.1 rewrites it to 6G at boot (T15, slim.md)

export const CONFIG: Record<string, string> = {
  "hw.lcd.width": "1080", "hw.lcd.height": "2340", "hw.lcd.density": "420",
  "hw.cpu.ncore": "2", "hw.ramSize": String(RAM_MB), "hw.camera.back": "emulated", "disk.dataPartition.size": DATA_PARTITION,
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
  for (const [k, v] of Object.entries(CONFIG)) {
    const re = new RegExp(String.raw`^${k.replace(/\./g, "\\.")}\s*=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
  }
  writeFileSync(ini, text);
  return name;
}

export const launchArgs = (name: string, port: number) =>
  ["-avd", name, "-port", String(port), "-no-window", "-no-audio", "-no-snapshot", "-gpu", "host", "-camera-back", "emulated", "-cores", "2", "-memory", String(RAM_MB)];
