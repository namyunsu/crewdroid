import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CREW_RE, allocBytes, hostAbi, killTree, launchDetached, listProcesses, parsePs, procStats } from "../src/platform.ts";
import { imagePackage } from "../src/setup.ts";

// captured on a Mac (paths shortened): launcher + qemu child of crew-android-34-google_atd, an unrelated adb, a non-crew AVD
const PS = `  101     1  20480   0.0   0:00.52 /Users/u/sdk/emulator/emulator -avd crew-android-34-google_atd -port 5580 -no-window -read-only
  102   101 2097152  12.5   1:02.25 /Users/u/sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd crew-android-34-google_atd -port 5580 -no-window -read-only
  200     1   8192   0.1   0:01.00 /Users/u/sdk/platform-tools/adb -s emulator-5580 shell crew-android-34-google_atd
  300     1  40960   1.0 1-00:00:01 /Users/u/sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64 -avd Pixel_8 -port 5554`;

test("arm64 hosts use the arm64-v8a image, x64 the x86_64 one", () => {
  assert.equal(hostAbi("arm64"), "arm64-v8a");
  assert.equal(hostAbi("x64"), "x86_64");
  assert.equal(imagePackage("34", "arm64"), "system-images;android-34;google_atd;arm64-v8a");
});

test("parsePs reads pid, rss bytes and cumulative cpu seconds", () => {
  const r = parsePs(PS);
  assert.equal(r.length, 4);
  assert.deepEqual(r[1], { pid: 102, ppid: 101, rss: 2097152 * 1024, cpuSec: 62.25, cmd: r[1].cmd });
  assert.equal(r[3].cpuSec, 86401);
});

const fakeExec = (calls: string[][], stdout: string) => async (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return { stdout }; };

test("darwin/linux list crew-* emulator processes with ps; adb and non-crew AVDs are not matched", async () => {
  for (const p of ["darwin", "linux"]) {
    const calls: string[][] = [];
    const rows = await listProcesses(CREW_RE, p, fakeExec(calls, PS));
    assert.deepEqual(rows.map((r) => r.pid), [101, 102]);
    assert.deepEqual(calls[0], ["ps", "-axo", "pid=,ppid=,rss=,%cpu=,time=,command="]);
    const st = await procStats(`-port 5580([ "]|$)`, p, fakeExec([], PS));
    assert.equal(Math.round(st.reduce((a, r) => a + r.cpu, 0) * 100), 6277);
  }
});

test("Windows lists, measures and kills with the PowerShell commands", async () => {
  const calls: string[][] = [];
  await listProcesses(CREW_RE, "win32", fakeExec(calls, `[{"pid":7,"cmd":"x -avd crew-a"}]`));
  await procStats("re", "win32", fakeExec(calls, "[]"));
  await killTree([7], "win32", fakeExec(calls, ""));
  await allocBytes(["C:\\x"], "win32", fakeExec(calls, "0"));
  assert.ok(calls.every((c) => c[0] === "powershell"));
  assert.match(calls[0][3], /Get-CimInstance Win32_Process/);
  assert.equal(calls[2][3], "Stop-Process -Id 7 -Force");
  assert.match(calls[3][3], /GetCompressedFileSizeW/);
});

test("darwin measures disk with du -sk", async () => {
  const calls: string[][] = [];
  const dir = mkdtempSync(join(tmpdir(), "crew-plat-"));
  assert.deepEqual(await allocBytes([dir, join(dir, "missing")], "darwin", fakeExec(calls, "12\t" + dir)), [12 * 1024, 0]);
  assert.deepEqual(calls, [["du", "-sk", dir]]);
});

test("launchDetached: Windows goes through Start-Process, darwin/linux spawn detached with the log as stdio", async () => {
  const dir = mkdtempSync(join(tmpdir(), "crew-plat-")), log = join(dir, "emu.log");
  const seen: any[] = [];
  const sp: any = (cmd: string, args: string[], opts: any) => {
    seen.push({ cmd, args, opts });
    const p: any = new EventEmitter();
    p.pid = 4242; p.unref = () => (p.unrefd = true);
    if (cmd === "powershell") { writeFileSync(`${log}.pid`, "77\n"); setImmediate(() => p.emit("exit", 0)); }
    return p;
  };
  assert.equal(await launchDetached("C:\\sdk\\emulator.exe", ["-avd", "crew-a"], log, false, "win32", sp), 77);
  assert.equal(seen[0].cmd, "powershell");
  assert.match(seen[0].args[2], /Start-Process -FilePath 'C:\\sdk\\emulator.exe' -ArgumentList @\('-avd','crew-a'\) -WindowStyle Hidden/);
  for (const p of ["darwin", "linux"]) {
    assert.equal(await launchDetached("/sdk/emulator/emulator", ["-avd", "crew-a", "-no-window"], log, false, p, sp), 4242);
    const s = seen.at(-1);
    assert.equal(s.cmd, "/sdk/emulator/emulator");
    assert.equal(s.opts.detached, true);
    assert.equal(s.opts.stdio[0], "ignore");
    assert.equal(typeof s.opts.stdio[1], "number");
  }
  assert.equal(readFileSync(log, "utf8"), "");
});
