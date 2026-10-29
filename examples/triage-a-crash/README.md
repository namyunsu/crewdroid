# triage-a-crash

Start an app on a fresh emulator, make it crash, and read the crash from one command. The bundled probe app crashes on purpose when launched with `check=crash`.

## Commands

```bash
./probe-app/gradlew -p probe-app assembleDebug      # builds probe-app/app/build/outputs/apk/debug/app-debug.apk
npx crewdroid up --json                             # one device, e.g. emulator-5580
npx crewdroid install emulator-5580 probe-app/app/build/outputs/apk/debug/app-debug.apk
npx crewdroid launch emulator-5580 dev.crewdroid.probe -- --es check crash
npx crewdroid triage emulator-5580 --app dev.crewdroid.probe
npx crewdroid logs emulator-5580 dev.crewdroid.probe --since 1m
npx crewdroid down
```

`launch` reports `crashed` for the start itself. `triage` reads the crash buffer, ANRs and exit reasons and ends with a one-line summary. `logs` shows only this app's lines (level >= I, last 40, stack traces cut); after a crash it reads the dead process's last pid.

## Output

Real output, captured on an API 34 `google_atd` emulator (timestamps and the device serial differ on your machine):

```
$ npx crewdroid install emulator-5580 probe-app/app/build/outputs/apk/debug/app-debug.apk
emulator-5580 dev.crewdroid.probe Success

$ npx crewdroid launch emulator-5580 dev.crewdroid.probe -- --es check crash
dev.crewdroid.probe/.ProbeActivity COLD TotalTime=1817ms CRASHED: java.lang.IllegalStateException: crewdroid probe crash (check=crash)

$ npx crewdroid triage emulator-5580 --app dev.crewdroid.probe
CRASH 10-29 02:49:37.016 dev.crewdroid.probe java.lang.IllegalStateException: crewdroid probe crash (check=crash)
  at dev.crewdroid.probe.ProbeActivity.onCreate$lambda$6(ProbeActivity.kt:49)
1 crashes, 0 ANRs, top: java.lang.IllegalStateException: crewdroid probe crash (check=crash)

$ npx crewdroid logs emulator-5580 dev.crewdroid.probe --since 1m
dev.crewdroid.probe is not running; showing lines from its last pid 2416 (logcat -b all)
02:55:14.893 I viewroot_draw_event: [VRI[ProbeActivity],reportDrawFinished seqId=0]
02:55:14.930 E AndroidRuntime: FATAL EXCEPTION: main
02:55:14.930 E AndroidRuntime: Process: dev.crewdroid.probe, PID: 2416
02:55:14.930 E AndroidRuntime: java.lang.IllegalStateException: crewdroid probe crash (check=crash)
02:55:14.930 E AndroidRuntime: 	at dev.crewdroid.probe.ProbeActivity.onCreate$lambda$6(ProbeActivity.kt:49)
02:55:14.930 E AndroidRuntime: 	at dev.crewdroid.probe.ProbeActivity.$r8$lambda$7skYiBj0izHVuetU7gmCTTtY030(Unknown Source:0)
02:55:14.930 E AndroidRuntime: 	at dev.crewdroid.probe.ProbeActivity$$ExternalSyntheticLambda4.run(D8$$SyntheticClass:0)
02:55:14.930 E AndroidRuntime:   … 8 frames cut
02:55:15.136 I Process: Sending signal. PID: 2416 SIG: 9
```

Add `--json` to any of these for the full result (`crashes`, `anrs`, `exits`, `recentLog`, `summary`).
