import { existsSync } from "node:fs";
import { join } from "node:path";

const FALLBACK = "C:/Users/NYS/scoop/apps/android-clt/current";

export function sdkRoot(): string {
  const root = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || FALLBACK;
  if (!existsSync(root)) throw new Error(`Android SDK not found: ${root}`);
  return root;
}

const exe = (n: string) => (process.platform === "win32" ? `${n}.exe` : n);
export const adbPath = () => join(sdkRoot(), "platform-tools", exe("adb"));
export const emulatorPath = () => join(sdkRoot(), "emulator", exe("emulator"));
