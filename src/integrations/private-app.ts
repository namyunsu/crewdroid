// private-app multi-user e2e on crewdroid devices (T11). private-app is read/run only: its global-setup runs
// avd-up.ps1, which kills only emulators whose AVD is old-avd-* and skips booting a port that is already a device,
// so crewdroid instances on 5570/5572/5574 survive and only get the APK installed.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { adb } from "../adb.ts";

export const PRIVATE_APP_BASE_PORT = 5570; // TECH_SERIALS in private-app tests/e2e/multi/harness.ts
// Three aspect ratios (1080x2340, 1812x2176, 1080x2520) on API 34/34/36; the APK's minSdk is 24.
// AI NOTE: not s22 (API 31): on the API 31 ATD image the private-app call screen (SurfaceViews) is black in every GPU mode tried
// (host, swiftshader_indirect, angle_indirect, guest, cold boot, no camera) and screenrecord shows a grey window (T13-3).
// s24ultra is the same 1080x2340 size on API 34.
export const PRIVATE_APP_PROFILES = ["s24ultra", "fold5-main", "flip7-main"];
export const private-appServerDir = () => process.env.ISB_PRIVATE_APP_SERVER || join(import.meta.dirname, "..", "..", "..", "private-app", "private-app-server");

export interface SpecRun { ok: boolean; exit: number; wallSeconds: number; testSeconds: number | null; totalSeconds: number | null; output: string }

// `npm run e2e:multi -- --grep <grep>`; ok = exit 0 and the suite's own E2E_MULTI_OK line. onStart fires when Playwright
// starts the tests (global-setup done).
export function runSpec(grep = "@techs", onStart?: () => void): Promise<SpecRun> {
  const t0 = Date.now();
  return new Promise((res) => {
    const p = spawn("npm", ["run", "e2e:multi", "--", "--grep", grep], { cwd: private-appServerDir(), shell: true, windowsHide: true });
    let output = "";
    let started = false;
    const on = (d: Buffer) => {
      output += d;
      process.stderr.write(d);
      if (!started && /Running \d+ tests? using/.test(output)) { started = true; onStart?.(); }
    };
    p.stdout.on("data", on);
    p.stderr.on("data", on);
    p.on("close", (code) => {
      const exit = code ?? 1;
      const sec = (m: RegExpMatchArray | null) => (m ? Math.round(Number(m[1]) * (m[2] === "m" ? 60 : 1) * 10) / 10 : null);
      res({
        ok: exit === 0 && output.includes("E2E_MULTI_OK"), exit, output,
        wallSeconds: Math.round((Date.now() - t0) / 100) / 10,
        testSeconds: sec(output.match(/ok \d+ .*\(([\d.]+)(s|m)\)/)), totalSeconds: sec(output.match(/\d+ passed \(([\d.]+)(s|m)\)/)),
      });
    });
  });
}

const REC = "/sdcard/crewdroid-rec.mp4";

// Starts `screenrecord` on each serial; the returned stop() ends them (SIGINT finalizes the mp4) and pulls to dir/<serial>.mp4.
export function record(serials: string[], dir: string) {
  // AI NOTE: --bugreport draws a timestamp overlay, so frames keep coming; without it a static screen records 0 frames and fails.
  const runs = serials.map((s) => adb(s, ["shell", "screenrecord", "--bugreport", "--bit-rate", "4000000", "--time-limit", "180", REC], 200000).catch(() => {}));
  return async () => {
    for (const s of serials) await adb(s, ["shell", "pkill", "-INT", "screenrecord"]).catch(() => {});
    await Promise.all(runs);
    const files: string[] = [];
    for (const s of serials) {
      const f = join(dir, `${s}.mp4`);
      await adb(s, ["pull", REC, f], 60000);
      files.push(f);
    }
    return files;
  };
}
