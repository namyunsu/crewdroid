import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Where `crewdroid setup` installs when no env var says otherwise; sdkRoot() falls back to it only once it exists.
export const defaultSdk = () => join(homedir(), ".crewdroid", "android-sdk");

export function sdkRoot(): string {
  const root = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || (existsSync(defaultSdk()) ? defaultSdk() : "");
  if (!root) throw new Error("Android SDK not found: set ANDROID_SDK_ROOT or ANDROID_HOME to your SDK directory, or run `crewdroid setup`");
  if (!existsSync(root)) throw new Error(`Android SDK not found: ${root} (from ANDROID_SDK_ROOT / ANDROID_HOME)`);
  return root;
}

const exe = (n: string) => (process.platform === "win32" ? `${n}.exe` : n);
export const adbPath = () => join(sdkRoot(), "platform-tools", exe("adb"));
export const emulatorPath = () => join(sdkRoot(), "emulator", exe("emulator"));

// A build-tools binary (aapt2, ...) from the newest <sdk>/build-tools/<version> that has it.
export function buildTool(name: string): string {
  const dir = join(sdkRoot(), "build-tools");
  const vers = existsSync(dir) ? readdirSync(dir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
  for (const v of vers) if (existsSync(join(dir, v, exe(name)))) return join(dir, v, exe(name));
  throw new Error(`${name} not found in ${dir}: install build-tools (sdkmanager "build-tools;35.0.0")`);
}
