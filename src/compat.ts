import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// T68: the toolchain every check-*.mjs was last run on. Keep in step with docs/compat.md (scripts/check-versions.mjs compares them).
export const VERIFIED = { emulator: "37.1", images: { "31": "1", "34": "1", "36": "1" } as Record<string, string> };

const rev = (dir: string) => readFileSync(join(dir, "source.properties"), "utf8").match(/^Pkg\.Revision=(.+)$/m)?.[1]?.trim();

// One WARN line (or undefined) when the installed emulator major.minor or a google_atd image revision differs from VERIFIED.
export function compatWarning(sdk: string): string | undefined {
  const diffs: string[] = [];
  try {
    const em = existsSync(join(sdk, "emulator", "source.properties")) ? rev(join(sdk, "emulator")) : undefined;
    if (em && em.split(".").slice(0, 2).join(".") !== VERIFIED.emulator) diffs.push(`emulator ${em} (verified ${VERIFIED.emulator}.x)`);
    const sys = join(sdk, "system-images");
    for (const d of existsSync(sys) ? readdirSync(sys) : []) {
      const api = d.replace("android-", ""), dir = join(sys, d, "google_atd");
      for (const abi of existsSync(dir) ? readdirSync(dir) : []) {
        const r = existsSync(join(dir, abi, "source.properties")) ? rev(join(dir, abi)) : undefined;
        if (r && VERIFIED.images[api] && r !== VERIFIED.images[api]) diffs.push(`google_atd android-${api} revision ${r} (verified ${VERIFIED.images[api]})`);
      }
    }
  } catch { return undefined; } // a warning must never break a command
  return diffs.length ? `WARN not the verified toolchain (docs/compat.md): ${diffs.join("; ")}` : undefined;
}
