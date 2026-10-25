import { existsSync } from "node:fs";
import { join } from "node:path";

export function sdkRoot(): string {
  const root = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (!root) throw new Error("Android SDK not found: set ANDROID_SDK_ROOT or ANDROID_HOME to your SDK directory");
  if (!existsSync(root)) throw new Error(`Android SDK not found: ${root} (from ANDROID_SDK_ROOT / ANDROID_HOME)`);
  return root;
}

const exe = (n: string) => (process.platform === "win32" ? `${n}.exe` : n);
export const adbPath = () => join(sdkRoot(), "platform-tools", exe("adb"));
export const emulatorPath = () => join(sdkRoot(), "emulator", exe("emulator"));
