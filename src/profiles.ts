import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sdkRoot } from "./sdk.ts";

export interface Profile {
  name: string; model: string; width: number; height: number; density: number;
  minAndroid: string; minApi: number; densitySource: "blisk" | "yesviz" | "chrome" | "unverified"; note?: string;
}

const galaxy = () => JSON.parse(readFileSync(join(import.meta.dirname, "..", "profiles", "galaxy.json"), "utf8"));
export const loadProfiles = (): Profile[] => galaxy().profiles;

// APIs whose screen can stay black after a force-stop + immediate relaunch (`am start -S`), SurfaceView or not (ADR 0005).
export const relaunchBlackApis = (): number[] => galaxy().relaunchBlackApis ?? [];

// Installed google_atd x86_64 images, e.g. [{ image: "android-31/google_atd", api: 31 }], sorted by API.
export function atdImages(): { image: string; api: number }[] {
  const root = join(sdkRoot(), "system-images");
  return readdirSync(root)
    .filter((d) => /^android-\d+$/.test(d) && existsSync(join(root, d, "google_atd", "x86_64", "system.img")))
    .map((d) => ({ image: `${d}/google_atd`, api: Number(d.slice(8)) }))
    .sort((a, b) => a.api - b.api);
}

export interface Slot { profile: Profile; image: string; api: number; belowMinApi: boolean }

// Device i gets profile i (cycling); its image is the oldest installed API >= the profile's launch API that is not
// already used with the same profile. No image new enough -> newest image, flagged belowMinApi.
export function assign(count: number, profiles: Profile[], images: { image: string; api: number }[]): Slot[] {
  if (!images.length) throw new Error("no google_atd image installed");
  const used = new Set<string>();
  return Array.from({ length: count }, (_, i) => {
    const profile = profiles[i % profiles.length];
    const ok = images.filter((x) => x.api >= profile.minApi);
    const cands = ok.length ? ok : [images[images.length - 1]];
    const pick = cands.find((x) => !used.has(`${profile.name}@${x.api}`)) ?? cands[0];
    used.add(`${profile.name}@${pick.api}`);
    return { profile, image: pick.image, api: pick.api, belowMinApi: !ok.length };
  });
}
