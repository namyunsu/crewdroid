// On-device screen recording for N emulators: start screenrecord, stop it, wait until the mp4 is closed, pull it (T16-2).
import { statSync } from "node:fs";
import { join } from "node:path";
import { adb } from "./adb.ts";

const REC = "/sdcard/crewdroid-rec.mp4";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Starts `screenrecord` on each serial; the returned stop() ends them and resolves to dir/<serial>.mp4 per serial.
export function record(serials: string[], dir: string) {
  // NOTE: --bugreport draws a timestamp overlay, so frames keep coming; without it a static screen records 0 frames and fails.
  const runs = serials.map((s) => adb(s, ["shell", "screenrecord", "--bugreport", "--bit-rate", "4000000", "--time-limit", "180", REC], 200000).catch(() => {}));
  return async () => {
    await Promise.all(serials.map((s) => adb(s, ["shell", "pkill", "-INT", "screenrecord"]).catch(() => {})));
    await Promise.race([Promise.all(runs), sleep(30000)]);
    const files: string[] = [];
    for (const s of serials) files.push(await pull(s, join(dir, `${s}.mp4`)));
    return files;
  };
}

// NOTE: T16-1 lost the GIF to one `adb pull` failing with empty stderr on emulator-5574 (-lowram, 896 MB) right after the
// call; the old code pulled once, 60 s timeout, without checking screenrecord had exited. SIGINT only asks it to finish the
// mp4 (moov atom), so wait until the process is gone and the size holds across 2 polls, then pull with retries + size check.
async function settled(serial: string): Promise<number> {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const pid = await adb(serial, ["shell", "pidof screenrecord || true"]).catch(() => "?");
    const size = Number(await adb(serial, ["shell", `stat -c %s ${REC} 2>/dev/null || echo -1`]).catch(() => "-1"));
    if (!pid && size > 0 && size === last) return size;
    last = size;
    await sleep(1000);
  }
  throw new Error(`${serial}: ${REC} not settled after 60 s (size ${last})`);
}

async function pull(serial: string, file: string): Promise<string> {
  const size = await settled(serial);
  for (let i = 1; ; i++) {
    try {
      await adb(serial, ["pull", REC, file], 120000);
      if (statSync(file).size === size) return file;
      throw new Error(`pulled ${statSync(file).size} of ${size} bytes`);
    } catch (e: any) {
      const why = e.killed ? "timeout 120 s" : String(e.stderr || e.message).trim().split("\n").at(-1);
      if (i >= 3) throw new Error(`${serial}: pull ${REC} failed 3 times, last: ${why}`);
      console.error(`${serial}: pull ${REC} try ${i}/3 failed (${why}); retry in 3 s`);
      await sleep(3000);
    }
  }
}
