import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { closeSync, existsSync, ftruncateSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_PARTITION, RAM_MB, avdHome, avdName } from "./avd.ts";
import { atdImages } from "./profiles.ts";
import { sdkRoot } from "./sdk.ts";
import { SNAPSHOT, prepare } from "./snapshot.ts";
import { claimEmulators } from "./up.ts";

const run = promisify(execFile);
const ps = (cmd: string) => run("powershell", ["-NoProfile", "-Command", cmd], { windowsHide: true, maxBuffer: 64 * 2 ** 20 }).then((r) => r.stdout);

// Real on-disk allocation (GetCompressedFileSizeW: sparse holes and NTFS compression excluded), summed over every file under each path.
export async function allocBytes(paths: string[]): Promise<number[]> {
  const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
  const out = await ps(`Add-Type -Namespace W -Name K -MemberDefinition '[DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern uint GetCompressedFileSizeW(string p, out uint h);';
    @(${list}) | ForEach-Object { $t=[int64]0; if (Test-Path -LiteralPath $_) { Get-ChildItem -LiteralPath $_ -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { $h=[uint32]0; $l=[W.K]::GetCompressedFileSizeW($_.FullName,[ref]$h); $t += [int64]$h*4294967296 + $l } }; $t }`);
  return out.trim().split(/\r?\n/).map(Number);
}

const CHUNK = 4 * 2 ** 20, UNIT = 64 * 1024; // NTFS sparse files allocate in 64 KiB units
const ZERO = Buffer.alloc(UNIT);
const hashFile = (f: string) => {
  const h = createHash("sha256"), fd = openSync(f, "r"), buf = Buffer.alloc(CHUNK);
  try { for (let n; (n = readSync(fd, buf, 0, CHUNK, null)) > 0;) h.update(buf.subarray(0, n)); } finally { closeSync(fd); }
  return h.digest("hex");
};

// Rewrites `file` as an NTFS sparse file: all-zero 64 KiB units become holes. Lossless: sha256 of the copy must equal the
// original's before it replaces it. Returns the sha256.
export async function sparsify(file: string): Promise<string> {
  const tmp = `${file}.slim-tmp`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, "");
  await run("fsutil", ["sparse", "setflag", tmp], { windowsHide: true });
  const h = createHash("sha256"), src = openSync(file, "r"), dst = openSync(tmp, "r+"), buf = Buffer.alloc(CHUNK);
  let pos = 0;
  try {
    for (let n; (n = readSync(src, buf, 0, CHUNK, pos)) > 0; pos += n) {
      h.update(buf.subarray(0, n));
      for (let i = 0; i < n; i += UNIT) {
        const u = buf.subarray(i, Math.min(i + UNIT, n));
        if (!u.equals(ZERO.subarray(0, u.length))) writeSync(dst, u, 0, u.length, pos + i);
      }
    }
    ftruncateSync(dst, pos);
  } finally { closeSync(src); closeSync(dst); }
  const sha256 = h.digest("hex");
  if (hashFile(tmp) !== sha256) { rmSync(tmp, { force: true }); throw new Error(`sparse copy of ${file} differs; original kept`); }
  const { atime, mtime } = statSync(file);
  renameSync(tmp, file);
  utimesSync(file, atime, mtime); // keep the image's timestamps
  return sha256;
}

// NTFS (LZNT1) compression, transparent to readers; the emulator boots from compressed images and snapshots (T15).
const compact = (paths: string[]) => run("compact", ["/c", "/q", ...paths], { windowsHide: true, maxBuffer: 16 * 2 ** 20 });

// System image dir (read-only for the emulator): every *.img sparse + compressed, then re-hashed. `<img>.sha256` holds the
// original content hash and marks the file done.
export async function slimImage(dir: string) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".img")).map((n) => join(dir, n))) {
    if (existsSync(`${f}.sha256`)) continue;
    const sha256 = await sparsify(f);
    await compact([f]);
    if (hashFile(f) !== sha256) throw new Error(`${f} changed after compression`);
    writeFileSync(`${f}.sha256`, `${sha256}\n`);
  }
}

export const MARK = "crewdroid-slim.json";
export const slimSettings = () => ({ ramMB: RAM_MB, dataPartition: DATA_PARTITION, fileBackedRam: false, zeroFreeRam: "MemFree-512MB", ntfsCompressed: true });

// Base AVD after prepare() saved its snapshot (emulator stopped): compress every file (snapshot RAM, userdata qcow2, ...).
// Clones only read these files. The marker records the settings the snapshot was made with.
export async function slimAvd(dir: string) {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name)); };
  walk(dir);
  await compact(files);
  writeFileSync(join(dir, MARK), JSON.stringify(slimSettings()) + "\n");
}

// True if the AVD's snapshot was made by this version's prepare() with the current settings.
export function avdSlim(dir: string) {
  try {
    return JSON.stringify(JSON.parse(readFileSync(join(dir, MARK), "utf8"))) === JSON.stringify(slimSettings()) && existsSync(join(dir, "snapshots", SNAPSHOT, "ram.bin"));
  } catch { return false; }
}

// any AVD instance (crew or not); the launcher's short-lived `emulator -kill <pid> -sleep 20` helper does not count
const anyEmulator = async () => (await ps(`@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'emulator|qemu' -and $_.CommandLine -match ' -avd ' }).Count`)).trim() !== "0";

export function slimPaths() {
  const images = atdImages().map((x) => ({ ...x, imageDir: join(sdkRoot(), "system-images", ...x.image.split("/"), "x86_64"), avdDir: join(avdHome(), `${avdName(x.image)}.avd`) }));
  return { images, temp: join(tmpdir(), "AndroidEmulator") }; // temp: where -read-only clones keep their overlays
}

// Allocated bytes of every installed google_atd image, its crew base AVD, and the emulator temp dir.
export async function diskUse() {
  const { images, temp } = slimPaths();
  const b = await allocBytes([...images.flatMap((x) => [x.imageDir, x.avdDir]), temp]);
  const rows = images.map((x, i) => ({ image: x.image, imageBytes: b[2 * i], avdBytes: b[2 * i + 1] }));
  const tempBytes = b.at(-1)!;
  return { images: rows, tempBytes, totalBytes: rows.reduce((a, r) => a + r.imageBytes + r.avdBytes, 0) + tempBytes };
}

// `crewdroid slim`: (1) system images sparse + NTFS-compressed (content hash kept); (2) base AVDs whose snapshot is not slim
// are re-prepared by prepare() (old snapshots deleted, cold boot on wiped data, hw.ramSize RAM_MB, no file-backed RAM,
// files compressed); (3) leftover clone overlays in the emulator temp dir deleted. Idempotent; allocation after each step.
export async function slim(basePort = 5580) {
  claimEmulators();
  if (await anyEmulator()) throw new Error("an emulator is running; stop it first (crewdroid down): slim rewrites images and base AVDs");
  const { images, temp } = slimPaths();
  const steps: { step: string; totalBytes: number }[] = [];
  const mark = async (step: string) => { const d = await diskUse(); steps.push({ step, totalBytes: d.totalBytes }); return d; };
  const before = await mark("before");
  for (const x of images) await slimImage(x.imageDir);
  await mark("images sparse + compressed");
  const prepared: string[] = [];
  for (const x of images.filter((x) => !avdSlim(x.avdDir))) {
    await prepare(x.image, basePort);
    prepared.push(x.image);
  }
  await mark("base AVDs re-prepared + compressed");
  // no emulator runs (checked above), so every TMP* overlay is a leftover of a killed clone
  if (existsSync(temp)) for (const n of readdirSync(temp).filter((n) => n.startsWith("TMP"))) rmSync(join(temp, n), { force: true });
  const after = await mark("stale clone overlays deleted");
  return { date: new Date().toISOString(), settings: slimSettings(), prepared, steps, before, after };
}
