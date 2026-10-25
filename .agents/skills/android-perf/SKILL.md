---
name: android-perf
description: The Android app starts slowly, scrolling or animation stutters (jank, dropped frames), the UI feels laggy, or memory keeps growing. Measures cold start time, frame times with jank percentage and p50/p90/p99, and memory (PSS, Java and native heap) on an emulator, and compares two builds or two device profiles.
license: MIT
---
<!-- Commands fenced as `bash verify` are run on a crew device (API 34) by scripts/check-skills.mjs with $SERIAL/$PKG substituted. -->
# android-perf: slow start, jank, memory

Placeholders: `$SERIAL` = `emulator-<port>` (never a USB phone serial), `$PKG` = the app package.
In a checkout without the package installed, `crewdroid` = `npx tsx src/cli.ts`.

Read every number relatively: crew devices are ATD images rendering without a GPU, so compare build A vs build B (or device X vs Y)
on the same machine, never against a real phone's numbers.

## Recipe

1. One cold start + 3 s of running, launcher activity.
```bash verify
crewdroid perf $SERIAL $PKG | tee perf.txt
grep -E 'TotalTime=[1-9]' perf.txt
```
   One line: `<pkg>/<activity> COLD TotalTime=<ms> | frames=<n> jank=<%> p50/p90/p99=<ms> | PSS=<KB> java=<KB> native=<KB>`.
   - `COLD` = process was started fresh (`-S` killed it first). `WARM`/`HOT` = it was still alive: the time is not a cold start.
   - `TotalTime` = launch until the first frame of the activity. Repeat 3-5 times and take the median; the first run after boot is slower.
   - `frames` = frames rendered in the 3 s; `jank` = share of frames that missed their deadline; p90/p99 = slow tail frame times.
   - `PSS` total / Java heap / native heap after the start. Growing across repeats of the same flow = leak suspect (android-triage step 6 heap).

2. A specific screen: pass the activity and `am start` extras after `--` (here: the probe's deliberately janky screen).
```bash verify
crewdroid perf $SERIAL $PKG --activity .ProbeActivity -- --es check jank | tee jank.txt
grep -E 'frames=[1-9]' jank.txt
```
   Compare `jank=` and `p90` with step 1: a screen doing ~50 ms of work per frame shows most frames janky and p50 >= 50 ms.
   `--json` gives `start{totalTime,launchState}`, `frames{frames,jankyFrames,jankPercent,p50Ms,p90Ms,p99Ms}`, `memory{pssTotalKB,...}`.

3. Measure only one interaction: reset the frame counters, do the interaction, read them.
```bash verify
adb -s $SERIAL shell dumpsys gfxinfo $PKG reset
sleep 2
adb -s $SERIAL shell dumpsys gfxinfo $PKG | grep -E 'Total frames rendered|Janky frames|90th percentile'
```
   Do the scroll/tap (Maestro flow, `adb -s $SERIAL shell input swipe 500 1500 500 500`) between `reset` and the read.

4. Memory detail.
```bash verify
adb -s $SERIAL shell dumpsys meminfo $PKG | grep -E 'TOTAL PSS|Java Heap|Native Heap'
```
   `Java Heap` growing = objects kept alive (views, bitmaps, listeners); `Native Heap` growing = bitmaps/NDK/WebView.

5. Compare device profiles: run step 1 on each serial from `crewdroid up --count 3 --json` (different screens and API levels) and
   compare medians. Different `TotalTime` per API level is normal; a jump on one profile only points at layout/resources for that size.

6. Clean up.
```bash verify
adb -s $SERIAL shell am force-stop $PKG
```

## Same thing with raw adb
```bash
adb -s $SERIAL shell am start -S -W -n $PKG/.MainActivity      # TotalTime / WaitTime
adb -s $SERIAL shell dumpsys gfxinfo $PKG framestats            # per-frame timestamps (ns)
```

## What this cannot tell you
Real-device absolute timings (no GPU, host CPU shared by all emulators), why a frame was slow (use a Perfetto / Android Studio CPU trace),
or startup cost hidden behind a splash screen that finishes after the first frame (measure to your own "ready" log line instead).
