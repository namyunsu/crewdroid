---
name: android-triage
description: The Android app crashed, closed by itself, froze, showed "App isn't responding" (ANR), or was killed in the background on an emulator. Finds the exception and top stack frame, ANR reasons, the system's exit reason, the app's last log lines, and can pull a heap dump. Use when someone says "the app died", "it force-closed", "it hangs", "ANR", "it restarts by itself".
license: MIT
---
<!-- Commands fenced as `bash verify` are run on a crew device (API 34) by scripts/check-skills.mjs with $SERIAL/$PKG substituted. -->
# android-triage: why did the app die?

Placeholders: `$SERIAL` = `emulator-<port>` (never a USB phone serial), `$PKG` = the app package (e.g. `dev.crewdroid.probe`).
In a checkout without the package installed, `crewdroid` = `npx tsx src/cli.ts`.

## Recipe

1. Clear old logs, then reproduce the problem. Below, the crewdroid probe app's built-in crash stands in for "do what the user did".
```bash verify
adb -s $SERIAL logcat -c
adb -s $SERIAL shell am start -n $PKG/.ProbeActivity --es check crash
sleep 4
```
   `am start` prints `Starting: Intent {...}` even when the app dies right after; a crash only shows up in the next step.

2. Read the triage summary.
```bash verify
crewdroid triage $SERIAL --app $PKG | tee triage.txt
grep '^CRASH' triage.txt
```
   Output lines:
   - `CRASH <time> <pkg> <exception>` then `  at <frame>`: one fatal exception from `logcat -b crash`. The frame is the first one inside the app's own package (else the first frame). Open that file/line first.
   - `ANR <time> <pkg> pid=<n> <reason>`: the main thread was blocked (input not handled in 5 s, broadcast in 10 s, service start in 20 s).
   - `N crashes, M ANRs, top: <text>`: the summary; `0 crashes, 0 ANRs` means the app was not killed by an exception or ANR: go to step 3.

   Next step: crash -> fix the exception at the top frame; ANR -> step 4.

3. Ask the system why the process ended (kept across logcat wipes and reboots of the app, API 30+).
```bash verify
adb -s $SERIAL shell dumpsys activity exit-info $PKG | grep -m5 -E 'reason=|description='
```
   `reason=4 (APP CRASH(EXCEPTION))` crash, `reason=5 (APP CRASH(NATIVE))` native crash (look for a tombstone), `reason=6 (ANR)`,
   `reason=3 (LOW MEMORY)` killed for memory, `reason=8 (PERMISSION CHANGE)` a permission was revoked, `reason=10 (USER REQUESTED)` force-stop / `pm clear`.
   `crewdroid triage --json` has the same list under `exits`.

4. ANR details: `crewdroid triage $SERIAL --app $PKG --json` -> `anrs[]` (`source: "logcat"` or `"exit-info"`) and `anrTraces[]`
   (headers of `/data/anr/anr_*`, readable because `crewdroid up` runs `adb root`; `"unreadable"` otherwise). Pull one trace and read the
   `"main"` thread stack: the frame under `at` is what blocked it.
```bash
adb -s $SERIAL shell ls /data/anr
adb -s $SERIAL pull /data/anr/<file> anr.txt
```

5. The app's last 200 log lines (lines that name `$PKG` or one of its pids): `crewdroid triage $SERIAL --app $PKG --json` -> `recentLog`.
   Look just above the crash for the request / state that led to it.

6. Memory growth or OutOfMemoryError: dump the heap while the app runs, then open the `.hprof` in Android Studio (Profiler -> Load).
```bash verify
adb -s $SERIAL shell am start -W -n $PKG/.ProbeActivity
crewdroid triage $SERIAL --app $PKG --heap app.hprof --json | grep '"bytes"'
```
   `--heap` needs the app running (`... is not running` -> start it first).

7. Clean up for the next step.
```bash verify
adb -s $SERIAL shell am force-stop $PKG
```

## Same thing with raw adb
```bash
adb -s $SERIAL logcat -b crash -d -v threadtime          # FATAL EXCEPTION blocks
adb -s $SERIAL logcat -d -v threadtime | grep -A2 'ActivityManager: ANR in'
adb -s $SERIAL shell am dumpheap $PKG /data/local/tmp/h.hprof && adb -s $SERIAL pull /data/local/tmp/h.hprof
```

## What this cannot tell you
Why the code threw (only where), a crash that happened before the last `logcat -c` with no exit-info record left, native crash
symbols (tombstones need the app's unstripped `.so`), or a hang that never reached the 5 s ANR limit (use android-perf for slowness).
