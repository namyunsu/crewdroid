// T62: node scripts/gen-filler-apks.mjs [--count 150]
// Builds N tiny installed-app stand-ins dev.crewdroid.filler.f001..fNNN into load-app/build/fillers/ (cached: an existing APK
// is kept). Every 3rd one has code: a receiver for BOOT_COMPLETED / CONNECTIVITY_CHANGE / dev.crewdroid.filler.WAKE that
// schedules a periodic JobScheduler job, like the many apps on a real phone that wake up on boot and sync. The rest are
// resource-only packages (installed, never run). No Gradle: aapt2 + javac + d8 + jar + zipalign + apksigner.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { buildTool, sdkRoot } from "../src/sdk.ts";

const run = promisify(execFile);
const root = join(import.meta.dirname, "..");
export const FILLER_DIR = join(root, "load-app", "build", "fillers");
const count = Number(process.argv[process.argv.indexOf("--count") + 1]) || 150;
const win = process.platform === "win32";
// .bat tools need a shell on Windows (node refuses to spawn them directly since CVE-2024-27980)
const sh = (exe, args, cwd) => run(win && exe.endsWith(".bat") ? `"${exe}"` : exe, win && exe.endsWith(".bat") ? args.map((a) => `"${a}"`) : args, { cwd, windowsHide: true, shell: win && exe.endsWith(".bat"), maxBuffer: 16 << 20 });
const platforms = join(sdkRoot(), "platforms");
const androidJar = join(platforms, readdirSync(platforms).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0], "android.jar");
const tool = (n) => (win ? join(dirname(buildTool("aapt2")), `${n}.bat`) : buildTool(n)); // d8 / apksigner are .bat on Windows
const name = (i) => `dev.crewdroid.filler.f${String(i).padStart(3, "0")}`;
const hasCode = (i) => i % 3 === 0;

const work = join(FILLER_DIR, ".work");
mkdirSync(work, { recursive: true });
const missing = Array.from({ length: count }, (_, k) => k + 1).filter((i) => !existsSync(join(FILLER_DIR, `${name(i)}.apk`)));

// shared code (one classes.dex for every package with code; classes use absolute names, so the package name does not matter)
const dexDir = join(work, "dex");
if (missing.some(hasCode) && !existsSync(join(dexDir, "classes.dex"))) {
  const src = join(work, "src", "dev", "crewdroid", "filler");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "Boot.java"), `package dev.crewdroid.filler;
import android.app.job.JobInfo; import android.app.job.JobScheduler; import android.content.*;
public class Boot extends BroadcastReceiver {
  @Override public void onReceive(Context c, Intent i) {
    c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(1, new ComponentName(c, Job.class)).setPeriodic(15 * 60 * 1000L).setPersisted(false).build());
  }
}
`);
  writeFileSync(join(src, "Job.java"), `package dev.crewdroid.filler;
import android.app.job.JobParameters; import android.app.job.JobService;
public class Job extends JobService {
  static volatile long sink;
  @Override public boolean onStartJob(JobParameters p) { long x = 7; for (int i = 0; i < 1000000; i++) x = x * 31 + i; sink = x; return false; }
  @Override public boolean onStopJob(JobParameters p) { return false; }
}
`);
  const cls = join(work, "classes");
  rmSync(cls, { recursive: true, force: true });
  await run("javac", ["--release", "11", "-cp", androidJar, "-d", cls, join(src, "Boot.java"), join(src, "Job.java")], { windowsHide: true });
  mkdirSync(dexDir, { recursive: true });
  await sh(tool("d8"), ["--release", "--min-api", "31", "--lib", androidJar, "--output", dexDir, join(cls, "dev", "crewdroid", "filler", "Boot.class"), join(cls, "dev", "crewdroid", "filler", "Job.class")]);
}

const manifest = (i) => `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${name(i)}" android:versionCode="1" android:versionName="1.0">
  ${hasCode(i) ? '<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />' : ""}
  <application android:label="Filler ${i}" android:hasCode="${hasCode(i)}">${hasCode(i) ? `
    <receiver android:name="dev.crewdroid.filler.Boot" android:exported="true">
      <intent-filter><action android:name="android.intent.action.BOOT_COMPLETED" /><action android:name="android.net.conn.CONNECTIVITY_CHANGE" /><action android:name="dev.crewdroid.filler.WAKE" /></intent-filter>
    </receiver>
    <service android:name="dev.crewdroid.filler.Job" android:permission="android.permission.BIND_JOB_SERVICE" android:exported="false" />` : ""}
  </application>
</manifest>
`;

const ks = join(homedir(), ".android", "debug.keystore");
if (missing.length && !existsSync(ks)) throw new Error(`${ks} missing: build any app once with Gradle (it creates the debug keystore)`);
async function one(i) {
  const d = join(work, name(i));
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "AndroidManifest.xml"), manifest(i));
  const raw = join(d, "raw.apk"), aligned = join(d, "aligned.apk");
  await run(buildTool("aapt2"), ["link", "-o", raw, "-I", androidJar, "--manifest", join(d, "AndroidManifest.xml"), "--min-sdk-version", "31", "--target-sdk-version", "34"], { windowsHide: true });
  if (hasCode(i)) await run("jar", ["--update", "--no-manifest", "--file", raw, "-C", dexDir, "classes.dex"], { windowsHide: true });
  await run(buildTool("zipalign"), ["-f", "-p", "4", raw, aligned], { windowsHide: true });
  await sh(tool("apksigner"), ["sign", "--ks", ks, "--ks-pass", "pass:android", "--min-sdk-version", "31", aligned]);
  renameSync(aligned, join(FILLER_DIR, `${name(i)}.apk`));
  rmSync(d, { recursive: true, force: true });
}
const t0 = Date.now();
for (let k = 0; k < missing.length; k += 8) await Promise.all(missing.slice(k, k + 8).map(one));
console.log(`OK: ${count} filler APKs in ${FILLER_DIR} (${missing.length} built in ${Math.round((Date.now() - t0) / 1000)} s)`);
