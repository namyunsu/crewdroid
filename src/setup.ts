import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statfsSync, statSync } from "node:fs";
import { arch as osArch, platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { imageAbi } from "./platform.ts";
import { defaultSdk } from "./sdk.ts";
import { compatWarning } from "./compat.ts";
import type { Tool } from "./mcp.ts";

export const STEPS = ["jdk", "cmdline-tools", "platform-tools", "emulator", "images"] as const;
export type StepName = (typeof STEPS)[number];
const REPO_XML = "https://dl.google.com/android/repository/repository2-3.xml";
const IMG_XML = "https://dl.google.com/android/repository/sys-img/google_atd/sys-img2-3.xml";
// Used only when repository2-3.xml cannot be read.
const PINNED_CMDLINE_BUILD = "11076708";
// NOTE: without this Google serves gzip and Content-Length is the compressed size, which never matches the unpacked bytes.
const IDENTITY = { "accept-encoding": "identity" };

// --- pure mapping (test/setup.test.ts) ---
const win = (p: string) => p === "win32";
export const repoOs = (p: string) => (win(p) ? "windows" : p === "darwin" ? "macosx" : "linux"); // repository XML <host-os>
export const adoptiumOs = (p: string) => (win(p) ? "windows" : p === "darwin" ? "mac" : "linux");
export const adoptiumArch = (a: string) => (a === "arm64" ? "aarch64" : "x64");
export { imageAbi };
export const jreUrl = (p: string, a: string) => `https://api.adoptium.net/v3/binary/latest/17/ga/${adoptiumOs(p)}/${adoptiumArch(a)}/jre/hotspot/normal/eclipse`;
export const cmdlineUrl = (build: string, p: string) => `https://dl.google.com/android/repository/commandlinetools-${win(p) ? "win" : p === "darwin" ? "mac" : "linux"}-${build}_latest.zip`;
export const imagePackage = (api: string, a: string) => `system-images;android-${api};google_atd;${imageAbi(a)}`;
export const imageDir = (sdk: string, api: string, a: string) => join(sdk, "system-images", `android-${api}`, "google_atd", imageAbi(a));
const exe = (n: string, p: string = process.platform) => (win(p) ? `${n}.exe` : n);

export function parseCmdlineBuild(xml: string): string | undefined {
  const block = xml.match(/<remotePackage path="cmdline-tools;latest">[\s\S]*?<\/remotePackage>/)?.[0];
  return block?.match(/commandlinetools-\w+-(\d+)_latest\.zip/)?.[1];
}

// Download size of the first revision of `path` for this host (sizes of one archive, compressed).
export function parseSize(xml: string, path: string, hostOs: string, arch = "x64"): number | null {
  const block = xml.match(new RegExp(`<remotePackage path="${path.replace(/[;.]/g, "\\$&")}">[\\s\\S]*?</remotePackage>`))?.[0];
  if (!block) return null;
  const archives = [...block.matchAll(/<archive>([\s\S]*?)<\/archive>/g)].map((m) => m[1]);
  const pick = (a: string) => {
    const os = a.match(/<host-os>(\w+)<\/host-os>/)?.[1], ar = a.match(/<host-arch>(\w+)<\/host-arch>/)?.[1];
    return (!os || os === hostOs) && (!ar || ar === arch);
  };
  const size = (archives.find(pick) ?? archives.find((a) => pick(a.replace(/<host-arch>.*?<\/host-arch>/, ""))))?.match(/<size>(\d+)<\/size>/)?.[1];
  return size ? Number(size) : null;
}

export interface Planned { step: StepName; present: boolean }
// Which of the wanted steps are already there. `has` answers a path probe; javaOk says a JDK >= 17 is usable.
export function planSteps(sdk: string, only: StepName[], images: string[], arch: string, platform: string, javaOk: boolean, has: (p: string) => boolean): Planned[] {
  const present: Record<StepName, boolean> = {
    jdk: javaOk,
    "cmdline-tools": has(join(sdk, "cmdline-tools", "latest", "bin", win(platform) ? "sdkmanager.bat" : "sdkmanager")),
    "platform-tools": has(join(sdk, "platform-tools", exe("adb", platform))),
    emulator: has(join(sdk, "emulator", exe("emulator", platform))),
    images: images.every((api) => has(join(imageDir(sdk, api, arch), "system.img"))),
  };
  return STEPS.filter((s) => only.includes(s)).map((step) => ({ step, present: present[step] }));
}

// --- impure helpers ---
const log = (m: string) => console.error(`[setup] ${m}`);
const q = (s: string) => (win(process.platform) ? `"${s}"` : s);

function javaMajor(bin: string): number {
  const r = spawnSync(bin, ["-version"], { encoding: "utf8", windowsHide: true });
  const v = (r.stderr + r.stdout).match(/version "(\d+)(?:\.(\d+))?/);
  return r.error || !v ? 0 : v[1] === "1" ? Number(v[2]) : Number(v[1]);
}
const jreHome = (sdk: string) => (existsSync(join(sdk, "jre", "Contents", "Home")) ? join(sdk, "jre", "Contents", "Home") : join(sdk, "jre"));
// A JAVA_HOME for sdkmanager, or undefined when no JDK >= 17 exists. Never touches the user's environment.
export function findJava(sdk: string): string | undefined {
  const own = jreHome(sdk);
  if (existsSync(join(own, "bin", exe("java"))) && javaMajor(join(own, "bin", "java")) >= 17) return own;
  const jh = process.env.JAVA_HOME;
  if (jh && javaMajor(join(jh, "bin", "java")) >= 17) return jh;
  if (javaMajor("java") >= 17) return "";  // on PATH; sdkmanager finds it itself
  return undefined;
}

async function headSize(url: string): Promise<number | null> {
  try {
    const n = Number((await fetch(url, { method: "HEAD", headers: IDENTITY })).headers.get("content-length"));
    return n > 0 ? n : null;
  } catch { return null; }
}
const text = async (url: string) => (await fetch(url)).text();

// Download to <dest>.part, rename once the size matches Content-Length.
async function download(url: string, dest: string) {
  const r = await fetch(url, { headers: IDENTITY });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${url}`);
  const want = Number(r.headers.get("content-length") || 0);
  const part = dest + ".part";
  await pipeline(Readable.fromWeb(r.body as any), createWriteStream(part));
  if (want && statSync(part).size !== want) throw new Error(`download of ${url} is ${statSync(part).size} bytes, expected ${want}`);
  renameSync(part, dest);
}

function extract(file: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  // NOTE: Windows bsdtar (System32) reads zip; GNU tar from Git for Windows does not, so call it by full path.
  const [cmd, args] = file.endsWith(".zip")
    ? win(process.platform) ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", file, "-C", dest]] : ["unzip", ["-q", "-o", file, "-d", dest]]
    : ["tar", ["-xzf", file, "-C", dest]];
  const r = spawnSync(cmd as string, args as string[], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || String(r.error)).slice(-300)}`);
}

function sdkmanager(sdk: string, javaHome: string | undefined, pkgs: string[]): Promise<void> {
  const bin = join(sdk, "cmdline-tools", "latest", "bin", win(process.platform) ? "sdkmanager.bat" : "sdkmanager");
  return new Promise((res, rej) => {
    // NOTE: .bat files need a shell on Windows (node refuses to spawn them directly since CVE-2024-27980)
    const p = spawn(q(bin), [`--sdk_root=${q(sdk)}`, ...pkgs.map(q)], { shell: win(process.platform), windowsHide: true, env: javaHome ? { ...process.env, JAVA_HOME: javaHome } : process.env });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(`sdkmanager exit ${c}: ${out.slice(-500)}`))));
    p.stdin.end("y\n".repeat(30)); // accepts the licence prompts; consent was taken before
  });
}

async function consent(yes: boolean) {
  if (yes) return;
  if (!process.stdin.isTTY) throw new Error("Android SDK licences must be accepted: rerun with --yes (non-interactive)");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const a = await rl.question("Install Android SDK components? You accept the licences at https://developer.android.com/studio/terms [y/N] ");
  rl.close();
  if (!/^y/i.test(a)) throw new Error("Android SDK licences not accepted: nothing installed");
}

function hostChecks(sdk: string) {
  let freeGB: number | null = null;
  try {
    let d = sdk;
    while (!existsSync(d) && dirname(d) !== d) d = dirname(d);
    const s = statfsSync(d);
    freeGB = Math.round((s.bavail * s.bsize) / 2 ** 30);
  } catch { /* unsupported fs */ }
  const em = join(sdk, "emulator", exe("emulator"));
  const r = existsSync(em) ? spawnSync(em, ["-accel-check"], { encoding: "utf8", windowsHide: true }) : undefined;
  return {
    freeDiskGB: freeGB,
    accel: r ? { ok: r.status === 0, detail: r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(:|0|accel)$/.test(l)).join(" ") } : { ok: null, detail: "emulator not installed yet" },
  };
}

export interface SetupOpts { sdk?: string; images?: string[]; only?: StepName[]; dryRun?: boolean; yes?: boolean }

export async function setup(o: SetupOpts = {}) {
  const envSdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  const sdk = o.sdk ?? envSdk ?? defaultSdk();
  const only = o.only ?? [...STEPS];
  for (const s of only) if (!STEPS.includes(s)) throw new Error(`unknown step "${s}" (steps: ${STEPS.join(", ")})`);
  const images = o.images ?? ["34"];
  const platform = process.platform, arch = osArch();
  const plan = planSteps(sdk, only, images, arch, platform, findJava(sdk) !== undefined, existsSync);
  const missing = plan.filter((p) => !p.present).map((p) => p.step);
  const imgMissing = images.filter((api) => !existsSync(join(imageDir(sdk, api, arch), "system.img")));
  const result: Record<string, any> = { sdk, dryRun: !!o.dryRun, steps: [] as any[] };
  const set = (step: StepName, status: string, extra: object = {}) => result.steps.push({ step, status, ...extra });

  if (o.dryRun) {
    const [repo, img] = missing.length ? await Promise.all([text(REPO_XML).catch(() => ""), text(IMG_XML).catch(() => "")]) : ["", ""];
    const build = parseCmdlineBuild(repo) ?? PINNED_CMDLINE_BUILD, hostOs = repoOs(platform), hostArch = arch === "arm64" ? "aarch64" : "x64";
    for (const { step, present } of plan) {
      if (present) { set(step, "present"); continue; }
      let size: number | null = null;
      if (step === "jdk") size = await headSize(jreUrl(platform, arch));
      else if (step === "cmdline-tools") size = await headSize(cmdlineUrl(build, platform));
      else if (step === "images") size = imgMissing.reduce((n, api) => n + (parseSize(img, imagePackage(api, arch), hostOs) ?? 0), 0) || null;
      else size = parseSize(repo, step, hostOs, hostArch);
      set(step, "missing", { downloadBytes: size });
    }
  } else {
    if (missing.some((s) => s !== "jdk")) await consent(!!o.yes);
    let javaHome = findJava(sdk);
    for (const { step, present } of plan) {
      if (present) { set(step, "present"); continue; }
      try {
        mkdirSync(sdk, { recursive: true });
        log(`${step}: installing`);
        if (step === "jdk") {
          const zip = join(sdk, process.platform === "win32" ? "jre.zip" : "jre.tar.gz"), tmp = join(sdk, ".jre-tmp");
          await download(jreUrl(platform, arch), zip);
          rmSync(tmp, { recursive: true, force: true });
          extract(zip, tmp);
          rmSync(join(sdk, "jre"), { recursive: true, force: true });
          renameSync(join(tmp, readdirSync(tmp)[0]), join(sdk, "jre"));
          rmSync(tmp, { recursive: true, force: true }); rmSync(zip, { force: true });
          javaHome = findJava(sdk);
        } else if (step === "cmdline-tools") {
          const build = parseCmdlineBuild(await text(REPO_XML).catch(() => "")) ?? PINNED_CMDLINE_BUILD;
          const zip = join(sdk, "cmdline-tools.zip"), tmp = join(sdk, ".cmdline-tmp");
          await download(cmdlineUrl(build, platform), zip);
          rmSync(tmp, { recursive: true, force: true });
          extract(zip, tmp);
          mkdirSync(join(sdk, "cmdline-tools"), { recursive: true });
          rmSync(join(sdk, "cmdline-tools", "latest"), { recursive: true, force: true });
          renameSync(join(tmp, "cmdline-tools"), join(sdk, "cmdline-tools", "latest"));
          rmSync(tmp, { recursive: true, force: true }); rmSync(zip, { force: true });
        } else {
          // sdkmanager needs a JDK 17; none found means the jdk step was left out by --only
          if (javaHome === undefined) throw new Error("no JDK >= 17 found: include the jdk step (drop --only or add jdk to it)");
          await sdkmanager(sdk, javaHome || undefined, step === "images" ? imgMissing.map((api) => imagePackage(api, arch)) : [step]);
        }
        set(step, "installed");
      } catch (e) {
        throw new Error(`setup step ${step} failed: ${e instanceof Error ? e.message : e}${result.steps.length ? ` (done before: ${result.steps.map((s: any) => s.step).join(", ")})` : ""}`);
      }
    }
  }
  result.host = hostChecks(sdk);
  const compat = compatWarning(sdk);
  if (compat) console.error(compat);
  if (!envSdk || envSdk !== sdk) result.envLine = `ANDROID_SDK_ROOT=${sdk}`;
  return result;
}

export const mcpTools: Tool[] = [{
  name: "setup", description: "Use first on a new machine, or when up fails for a missing SDK/image: checks/installs the Android SDK pieces crewdroid needs (JDK 17 for sdkmanager, command-line tools, platform-tools, emulator, google_atd images). Dry run by default: returns steps [{step, status: present|missing, downloadBytes}]; yes:true installs and accepts the SDK licences.",
  input: {
    sdk: z.string().optional().describe("SDK directory (default ANDROID_SDK_ROOT / ANDROID_HOME, else ~/.crewdroid/android-sdk)"),
    images: z.array(z.string()).optional().describe('Android API levels of google_atd images, default ["34"]'),
    only: z.array(z.enum(STEPS)).optional().describe("limit to these steps"),
    yes: z.boolean().optional().describe("install for real and accept the SDK licences"),
  },
  run: (a) => setup({ sdk: a.sdk, images: a.images, only: a.only, yes: a.yes, dryRun: !a.yes }),
}];
