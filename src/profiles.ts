import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sdkRoot } from "./sdk.ts";

export interface Profile {
  name: string; model: string; width: number; height: number; density: number;
  minAndroid: string; minApi: number; densitySource: "blisk" | "yesviz" | "chrome" | "unverified"; note?: string;
  fold?: Record<"cover" | "main", Screen>; // foldables: both screens, switched by `crewdroid fold|unfold` (ADR 0006)
}
export interface Screen { width: number; height: number; density: number }

const galaxy = () => JSON.parse(readFileSync(join(import.meta.dirname, "..", "profiles", "galaxy.json"), "utf8"));
export const loadProfiles = (): Profile[] => galaxy().profiles;

// "1920x720@160" -> Profile. Density is optional: derived so the short side is ~360dp (px / 360 * 160).
export function parseScreen(spec: string): Profile {
  const m = /^(\d+)x(\d+)(?:@(\d+))?$/.exec(spec.trim());
  if (!m) throw new Error(`bad --screen '${spec}': expected WIDTHxHEIGHT[@DENSITY], e.g. 1920x720@160`);
  const [width, height] = [Number(m[1]), Number(m[2])];
  const density = m[3] ? Number(m[3]) : Math.round((Math.min(width, height) / 360) * 160);
  if (!width || !height || !density) throw new Error(`bad --screen '${spec}': width, height and density must be > 0`);
  return { name: `${width}x${height}@${density}`, model: "custom screen", width, height, density, minAndroid: "any", minApi: 0, densitySource: "unverified" };
}

// User profile file, same schema as galaxy.json ({ profiles: [...] }). Bad entries fail before anything is launched.
export function loadProfilesFile(file: string): Profile[] {
  const list = JSON.parse(readFileSync(file, "utf8")).profiles;
  if (!Array.isArray(list) || !list.length) throw new Error(`${file}: needs a non-empty "profiles" array`);
  return list.map((p: any, i: number) => {
    for (const k of ["width", "height", "density"]) if (!Number.isInteger(p?.[k]) || p[k] <= 0) throw new Error(`${file}: profiles[${i}].${k} must be a positive integer`);
    if (!p.name) throw new Error(`${file}: profiles[${i}].name missing`);
    return { model: p.name, minAndroid: "any", minApi: 0, densitySource: "unverified", ...p } as Profile;
  });
}

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
