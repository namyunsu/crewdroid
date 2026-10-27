---
name: android-vibe-loop
description: Build an Android app and check it on a headless emulator in a loop - install, launch, see the screen, tap, type, read the logs. Use when asked to "run/test my Android app", "see the app screen", "the app does not start", "build and check on a phone", or to try a UI change on a device without Android Studio.
license: MIT
---
<!-- Commands fenced as `bash verify` are run on a crew device (API 34) by scripts/check-skills.mjs with $SERIAL/$PKG/$APK set. -->
# android-vibe-loop: build, run, look, poke, read logs

One headless emulator, driven only through crewdroid (MCP tools or CLI). No Android Studio, no mobile-mcp.
`$SERIAL` = `emulator-<port>` (never a USB phone serial), `$PKG` = the app package, `$APK` = the built .apk on the host.
In a checkout without the package installed, `crewdroid` = `npx tsx src/cli.ts`. Every CLI command takes `--json`.

## The loop

| Step | MCP tool | CLI |
|---|---|---|
| 0. SDK present? (once per machine) | `setup` {} (dry run) | `crewdroid setup --dry-run` / `--yes` to install |
| 1. Boot one device (1-3 min) | `up` {} -> `devices[0].serial` | `crewdroid up` |
| 2. Install the new build | `install` {target, apk} | `crewdroid install $SERIAL $APK [--grant]` |
| 3. Start / restart the app | `launch` {serial, pkg, restart:true} | `crewdroid launch $SERIAL $PKG --restart` |
| 4a. Read the screen (tree) | `screen` {serial} | `crewdroid screen $SERIAL` |
| 4b. Look at the screen (pixels) | `shot` {serial} -> image | `crewdroid shot $SERIAL [file.png]` |
| 5. Poke it | `tap` {serial, text\|id\|x,y}, `type` {serial, text, into}, `swipe`, `key` | `crewdroid tap $SERIAL --text Send`, `crewdroid type $SERIAL hi --into name`, `crewdroid swipe $SERIAL up`, `crewdroid key $SERIAL back` |
| 6. What did the app print? | `logs` {serial, pkg, since:"1m"} | `crewdroid logs $SERIAL $PKG --since 1m` |
| 7. Finished | `down` {} | `crewdroid down` |

Edit code, rebuild, then repeat 2-6 on the same device; boot (`up`) only once. Always `down` at the end.
`devices` lists what is already running (serial, api, profile) if you lost the serial.

Pick `screen` before `tap`/`type`: it gives text, id and bounds of each element. Use `shot` only to judge how it looks
(layout, colours, clipping); do not guess tap coordinates from a picture when the tree has the element.

```bash verify
crewdroid install $SERIAL $APK --json | grep -q '"ok": true'
crewdroid launch $SERIAL $PKG --restart --json -- --es check form | grep -q '"crashed": false'
crewdroid screen $SERIAL | grep -q 'Send'
crewdroid type $SERIAL 'skill loop' --into name --json > /dev/null
crewdroid tap $SERIAL --text Send --json > /dev/null
sleep 1
crewdroid logs $SERIAL $PKG --since 1m --json | grep -q 'FORM skill loop'
```

## Reading the results

- `launch` -> `crashed:false`: the process is alive 2 s after start. `crashed:true` comes with `crash: {exception, topFrame}`:
  the app died on start. Read `logs` (since 1m) for the stack, fix, rebuild, go to step 2. `crash: null` = gone without a
  Java crash (native crash, killed, `finish()`): see android-triage. `totalTime` = start time in ms.
- `blackRelaunch` (in `shot` and `screen`): `{black:false}` is normal. `{black:true, recovered:true}` = the API 31 emulator
  left the screen black after a relaunch and crewdroid fixed it (ADR 0005): not an app bug, continue.
  `recovered:false` = still black: `launch` again without `restart`, or use API 34/36 (`up --api 34`).
- `tap` by text: exact match wins, else case-insensitive contains. `N matches for text 'X'; pass --index N` lists the
  candidates: retry with `index` (0-based) or a unique `id`. `no match for text 'X'; on screen:` lists what is there:
  the screen is not the one you expected (check `screen` focus) or the label differs.
- `tap` x,y outside the screen fails with the reason. `type` sets any text (Korean too) through the on-device helper
  (`via: "helper"`); `via: "fallback"` = helper not answering, then non-ASCII fails with the reason.
- `logs` shows only this app's lines (its pid). `note: ... not running` = the app is gone; lines come from its last pid.
- `install` -> `ok:false` with `INSTALL_FAILED_*`: see android-apk.
- Compose apps: ids appear in `screen` only with `testTagsAsResourceId = true`; otherwise tap by text.

## When to switch skills

- App dies, ANR, killed in background: [android-triage](../android-triage/SKILL.md).
- Blank or wrong screen, element not found, cut-off text: [android-screen](../android-screen/SKILL.md).
- Permission dialogs, deep links: [android-permissions-intents](../android-permissions-intents/SKILL.md).
- Install fails, manifest questions: [android-apk](../android-apk/SKILL.md).
- Slow start, jank, memory: [android-perf](../android-perf/SKILL.md).
- Other screen sizes / Android versions: `up --profile fold8-main`, `up --api 31`, `fold`/`unfold`.
- Several users, offline sync, duplicates: [crewdroid](../crewdroid/SKILL.md) and
  [android-offline-concurrency](../android-offline-concurrency/SKILL.md).

## What this cannot tell you

No Play services, Chrome, camera or launcher on ATD images; no real GPU (frame numbers are relative); typed text is set
on the field (no keyboard app, no per-key events). Check those on a real phone.
