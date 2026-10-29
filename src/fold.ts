import { z } from "zod";
import { adb } from "./adb.ts";
import type { Tool } from "./mcp.ts";
import { loadProfiles, type Profile, type Screen } from "./profiles.ts";

export type Side = "cover" | "main";

// The fold pair whose cover or main screen is the device's current size (`wm size` output). Pure, for tests.
export function foldPair(wmSize: string, profiles: Profile[]): { profile: Profile; from: string } {
  const m = wmSize.match(/Override size: (\d+x\d+)/) ?? wmSize.match(/Physical size: (\d+x\d+)/);
  const from = m?.[1] ?? "?";
  const is = (s: Screen) => `${s.width}x${s.height}` === from;
  const profile = profiles.find((p) => p.fold && (is(p.fold.cover) || is(p.fold.main)));
  if (!profile) throw new Error(`screen ${from} is not a fold/flip screen; boot one with e.g. \`up --profiles fold5-main,flip6-cover\``);
  return { profile, from };
}

// NOTE: ATD has no working fold: on the crew base AVD `adb emu fold` says "KO: Device is not foldable", and even a
// pixel_fold AVD (hw.sensor.hinge*) only flips the device state while the app stays on the inner display (ADR 0006).
// So fold/unfold swap wm size + density: the app gets a real configuration change, but no hinge, posture or half-open.
export async function fold(serial: string, to: Side) {
  const { profile, from } = foldPair(await adb(serial, ["shell", "wm", "size"]), loadProfiles());
  const s = profile.fold![to];
  await adb(serial, ["shell", "wm", "size", `${s.width}x${s.height}`]);
  await adb(serial, ["shell", "wm", "density", String(s.density)]);
  const [size, density] = [await adb(serial, ["shell", "wm", "size"]), await adb(serial, ["shell", "wm", "density"])];
  if (!size.includes(`${s.width}x${s.height}`) || !density.includes(String(s.density))) throw new Error(`${serial}: wm reads back '${size}' '${density}', wanted ${s.width}x${s.height}@${s.density}`);
  return { serial, profile: profile.name, state: to, from, to: `${s.width}x${s.height}`, density: s.density, mechanism: "wm size/density" };
}

export const mcpTools: Tool[] = [{
  name: "fold", description: "Fold (cover screen) or unfold (main screen) a fold/flip-profile emulator: the app gets a configuration change with the new size. No hinge/posture emulation on ATD.",
  input: { serial: z.string().describe("emulator-<port>"), to: z.enum(["cover", "main"]).describe("cover = folded, main = unfolded") },
  run: (a) => fold(a.serial, a.to),
}];
