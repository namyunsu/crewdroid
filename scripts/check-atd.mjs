// T02 verify: boots the crew ATD AVD, runs CAMERA / PICKER / UPLOAD probe checks, prints a table.
// Exit 0 only when every check produced a result line (ok or fail both count: this is a measurement).
// usage: node scripts/check-atd.mjs --image android-34/google_atd --port 5580 [--server-port 5599] [--keep]
import { spawn, execFileSync } from "node:child_process";
import { existsSync, openSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { deflateSync } from "node:zlib";
import { adb } from "../src/adb.ts";
import { avdName, createAvd, imageInstalled, installImage, launchArgs } from "../src/avd.ts";
import { emulatorPath } from "../src/sdk.ts";
import { startServer } from "../sample/server/server.ts";

const { values: v } = parseArgs({ options: { image: { type: "string" }, port: { type: "string", default: "5580" }, "server-port": { type: "string", default: "5599" }, out: { type: "string" } } });
if (!v.image) throw new Error("--image required, e.g. android-34/google_atd");
const port = Number(v.port), serial = `emulator-${port}`, sport = Number(v["server-port"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = join(import.meta.dirname, "..");
const PKG = "dev.crewdroid.probe";

function png() { // 96x96 gradient PNG, no image libs needed
  const w = 96, raw = Buffer.alloc((w * 3 + 1) * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; raw.writeUIntBE((x * 2 << 16) | (y * 2 << 8) | 128, o + 1 + x * 3, 3); }
  const crc = (b) => { let c, t = ~0; for (const x of b) { c = (t ^ x) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; t = (t >>> 8) ^ c; } return ~t >>> 0; };
  const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]); const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([l, b, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function waitBoot() {
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    try { if ((await adb(serial, ["shell", "getprop", "sys.boot_completed"], 5000)) === "1") return (Date.now() - t0) / 1000; } catch {}
    await sleep(1000);
  }
  throw new Error("boot timeout");
}

// picks the first image tile in whatever picker UI is on screen (resource-id/content-desc heuristics from the real ATD dump)
async function tapFirstImage() {
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    await adb(serial, ["shell", "uiautomator", "dump", "/sdcard/ui.xml"], 20000).catch(() => {});
    const xml = await adb(serial, ["shell", "cat", "/sdcard/ui.xml"], 20000).catch(() => "");
    if (process.env.DUMP_UI) console.error(xml.slice(0, 8000));
    const nodes = [...xml.matchAll(/<node [^>]*>/g)].map((m) => m[0]);
    const hit = nodes.find((n) => /crew-test|icon_thumbnail|Photo taken/i.test(n) && /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.test(n) && !/documents_root|toolbar/.test(n));
    if (hit) {
      const [, a, b, c, d] = hit.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).map(Number);
      await adb(serial, ["shell", "input", "tap", String(Math.round((a + c) / 2)), String(Math.round((b + d) / 2))]);
      return hit;
    }
  }
  return null;
}

const rawLines = [], table = [];
let emu, server;
try {
  if (!imageInstalled(v.image)) await installImage(v.image);
  const name = await createAvd(v.image);
  server = await startServer(sport, join(tmpdir(), "crewdroid-upload"));
  const apk = join(root, "probe-app/app/build/outputs/apk/debug/app-debug.apk");
  if (!existsSync(apk)) execFileSync(process.platform === "win32" ? "gradlew.bat" : "./gradlew", ["assembleDebug", "--console=plain"], { cwd: join(root, "probe-app"), stdio: "inherit", shell: process.platform === "win32" });

  emu = spawn(emulatorPath(), launchArgs(name, port), { detached: true, stdio: ["ignore", openSync(join(tmpdir(), `crewdroid-${name}.log`), "w"), "ignore"], windowsHide: true });
  emu.unref();
  console.error(`booted in ${(await waitBoot()).toFixed(1)}s`);
  await sleep(5000);
  await adb(serial, ["install", "-r", apk], 120000);
  await adb(serial, ["shell", "pm", "grant", PKG, "android.permission.CAMERA"]);
  mkdirSync(join(tmpdir(), "crewdroid"), { recursive: true });
  const img = join(tmpdir(), "crewdroid", "crew-test.png");
  writeFileSync(img, png());
  await adb(serial, ["push", img, "/sdcard/Pictures/crew-test.png"]);
  await adb(serial, ["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", "file:///sdcard/Pictures/crew-test.png"]);
  await sleep(2000);

  const result = async (check, extra = [], between) => {
    await adb(serial, ["shell", "am", "force-stop", PKG]);
    await adb(serial, ["logcat", "-c"]);
    await adb(serial, ["shell", "am", "start", "-n", `${PKG}/.ProbeActivity`, "--es", "check", check, ...extra]);
    if (between) await between();
    const re = new RegExp(`CrewProbe: ${check.toUpperCase()} (ok|fail)`);
    for (let i = 0; i < 60; i++) {
      const log = await adb(serial, ["logcat", "-d", "-s", "CrewProbe:I"]);
      const line = log.split(/\r?\n/).find((l) => re.test(l));
      if (line) { rawLines.push(line.trim()); return line.slice(line.indexOf(check.toUpperCase())).trim(); }
      await sleep(1000);
    }
    return null;
  };
  const r = {
    CAMERA: await result("camera"),
    PICKER: await result("picker", [], async () => { const hit = await tapFirstImage(); console.error(`picker tap node: ${hit ?? "none"}`); }),
    UPLOAD: await result("upload", ["--es", "url", `http://10.0.2.2:${sport}/upload`]),
  };
  for (const [k, line] of Object.entries(r)) table.push({ check: k, result: line ?? "(no line)" });
  console.table(table);
  console.log(rawLines.join("\n"));
  if (v.out) writeFileSync(v.out, rawLines.join("\n") + "\n");
  process.exitCode = table.every((t) => t.result !== "(no line)") ? 0 : 1;
} catch (e) {
  console.error(`error: ${e.stack ?? e}`);
  process.exitCode = 1;
} finally {
  await adb(serial, ["emu", "kill"], 10000).catch(() => {});
  server?.close();
  await sleep(5000);
  try { execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '(^|[ @"])${avdName(v.image)}([ "]|$)' -and $_.Name -match 'emulator|qemu' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { windowsHide: true }); } catch {}
  process.exit(process.exitCode);
}
