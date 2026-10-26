import { createHash } from "node:crypto";
import { closeSync, existsSync, ftruncateSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_PARTITION, KNOBS, avdHome, avdName, imageDir } from "./avd.ts";
import { allocBytes, listProcesses, ntfs, ntfsCompress, ntfsSparseFlag } from "./platform.ts";
import { atdImages } from "./profiles.ts";
import { SNAPSHOT, prepare } from "./snapshot.ts";
import { claimEmulators } from "./up.ts";

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
  await ntfsSparseFlag(tmp);
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

// NTFS (LZNT1) compression is transparent to readers; the emulator boots from compressed images and snapshots (T15).
// System image dir (read-only for the emulator): every *.img sparse + compressed, then re-hashed. `<img>.sha256` holds the
// original content hash and marks the file done. No-op off Windows.
export async function slimImage(dir: string) {
  if (!ntfs()) return;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".img")).map((n) => join(dir, n))) {
    if (existsSync(`${f}.sha256`)) continue;
    const sha256 = await sparsify(f);
    await ntfsCompress([f]);
    if (hashFile(f) !== sha256) throw new Error(`${f} changed after compression`);
    writeFileSync(`${f}.sha256`, `${sha256}\n`);
  }
}

export const MARK = "crewdroid-slim.json";
// coldBoot only changes how clones start, not the snapshot
export const slimSettings = () => ({ ...KNOBS, coldBoot: undefined, dataPartition: DATA_PARTITION, zeroFreeRam: "MemFree-512MB", ntfsCompressed: ntfs() });

// Base AVD after prepare() saved its snapshot (emulator stopped): compress every file (snapshot RAM, userdata qcow2, ...).
// Clones only read these files. The marker records the settings the snapshot was made with.
export async function slimAvd(dir: string) {
  const files: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name)); };
  walk(dir);
  if (ntfs()) await ntfsCompress(files);
  writeFileSync(join(dir, MARK), JSON.stringify(slimSettings()) + "\n");
}

// True if the AVD's snapshot was made by this version's prepare() with the current settings.
export function avdSlim(dir: string) {
  try {
    return JSON.stringify(JSON.parse(readFileSync(join(dir, MARK), "utf8"))) === JSON.stringify(slimSettings()) && existsSync(join(dir, "snapshots", SNAPSHOT, "ram.bin"));
  } catch { return false; }
}

// any AVD instance (crew or not); the launcher's short-lived `emulator -kill <pid> -sleep 20` helper does not count
const anyEmulator = async () => (await listProcesses(" -avd ")).length > 0;

export function slimPaths() {
  const images = atdImages().map((x) => ({ ...x, imageDir: imageDir(x.image), avdDir: join(avdHome(), `${avdName(x.image)}.avd`) }));
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
// are re-prepared by prepare() (old snapshots deleted, cold boot on wiped data, hw.ramSize ramMB(), no file-backed RAM,
// files compressed); (3) leftover clone overlays in the emulator temp dir deleted. Idempotent; allocation after each step.
export async function slim(basePort = 5580) {
  claimEmulators();
  if (await anyEmulator()) throw new Error("an emulator is running; stop it first (crewdroid down): slim rewrites images and base AVDs");
  const { images, temp } = slimPaths();
  const steps: { step: string; totalBytes: number }[] = [];
  const mark = async (step: string) => { const d = await diskUse(); steps.push({ step, totalBytes: d.totalBytes }); return d; };
  const before = await mark("before");
  for (const x of images) await slimImage(x.imageDir);
  await mark(ntfs() ? "images sparse + compressed" : "images (sparse + compress skipped: NTFS only)");
  const prepared: string[] = [];
  for (const x of images.filter((x) => !avdSlim(x.avdDir))) {
    await prepare(x.image, basePort);
    prepared.push(x.image);
  }
  await mark("base AVDs re-prepared + compressed");
  // no emulator runs (checked above), so every TMP* overlay is a leftover of a killed clone
  if (existsSync(temp)) for (const n of readdirSync(temp).filter((n) => n.startsWith("TMP"))) rmSync(join(temp, n), { force: true });
  const after = await mark("stale clone overlays deleted");
  return { date: new Date().toISOString(), settings: slimSettings(), prepared, steps, before, after, ...(ntfs() ? {} : { skipped: "NTFS only" }) };
}
