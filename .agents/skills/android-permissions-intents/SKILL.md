---
name: android-permissions-intents
description: An Android permission is denied or the dialog never appears, a deep link or App Link does not open the app, "No Activity found", an intent opens the wrong screen, or an exported activity / broadcast receiver does not react. Grants and revokes runtime permissions, checks what an intent resolves to, and starts activities and broadcasts on an emulator.
license: MIT
---
<!-- Commands fenced as `bash verify` are run on a crew device (API 34) by scripts/check-skills.mjs with $SERIAL/$PKG substituted. -->
# android-permissions-intents: permissions, intents, deep links

Placeholders: `$SERIAL` = `emulator-<port>` (never a USB phone serial), `$PKG` = the app package.
These are raw `pm` / `am` lines. The planned `app` command of crewdroid (todo T21) will wrap them with read-back checks; until then use these.

## Permissions

1. See what the app asked for and what it holds.
```bash verify
adb -s $SERIAL shell dumpsys package $PKG | grep -E 'android.permission.CAMERA'
```
   Under `requested permissions:` = declared in the manifest. Under `runtime permissions:` the line
   `android.permission.CAMERA: granted=false, flags=[...]` is the current state. Not listed at all = not in the manifest: no grant can help;
   add `<uses-permission>`.
   `flags=[ USER_FIXED ]` = the user chose "Don't ask again": the app's request dialog will not show again until you revoke or clear.

2. Grant, check, revoke, check.
```bash verify
adb -s $SERIAL shell pm grant $PKG android.permission.CAMERA
adb -s $SERIAL shell dumpsys package $PKG | grep 'android.permission.CAMERA: granted=true'
adb -s $SERIAL shell pm revoke $PKG android.permission.CAMERA
adb -s $SERIAL shell dumpsys package $PKG | grep 'android.permission.CAMERA: granted=false'
```
   `pm grant` prints nothing on success. `Exception ... not a changeable permission type` = it is an install-time (normal) permission;
   `has not requested permission` = missing from the manifest. Revoking kills the app's process (exit reason PERMISSION CHANGE).
   To see the app's own request dialog again: `adb -s $SERIAL shell pm reset-permissions -p $PKG` or `pm clear $PKG` (wipes data too).

## Intents and activities

3. What would the launcher start? (also: which activity is the entry point)
```bash verify
adb -s $SERIAL shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER $PKG | tail -1
```
   Last line `<pkg>/<activity>` = the launcher activity; `No activity found` = no MAIN/LAUNCHER filter (or the package is not installed).

4. Start an exact component with extras and wait for it.
```bash verify
adb -s $SERIAL shell am start -W -n $PKG/.ProbeActivity --es check id | grep 'Status: ok'
```
   `am start` exits 0 even when it fails: always read the output. `Error type 3 ... does not exist` = wrong class name;
   `Permission Denial ... not exported` = the activity has `exported=false` (start it from inside the app, or check android-apk);
   `Warning: Activity not started, its current task has been brought to the front` = it was already on top (add `-S` to restart).

## Deep links and App Links

5. Does a link resolve to any activity? Check before opening it.
```bash verify
adb -s $SERIAL shell cmd package resolve-activity --brief -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d crewdroid://probe/x | tail -1 | grep "$PKG/"
```
   (The probe app declares `crewdroid://probe/...`, so this prints its activity.) A matching app prints `<pkg>/<activity>`.
   `No activity found` = no `<intent-filter>` with `VIEW` + `BROWSABLE` + `DEFAULT` and a matching `<data scheme/host/path>`;
   list the app's filters with `crewdroid apk <file.apk>` (android-apk) and compare scheme, host and path exactly.

6. Open it the way a browser would.
```bash
adb -s $SERIAL shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'crewdroid://probe/x'
adb -s $SERIAL shell am start -W -a android.intent.action.VIEW -d "'https://example.com/p?a=1&b=2'" $PKG
```
   `Error: Activity not started, unable to resolve Intent` = same as `No activity found`. Quote twice when the URI has `&` or `?`
   (once for your shell, once for the device shell). Adding `$PKG` at the end limits resolution to that app.
   ATD images have no Chrome: an `https` link that no app claims has nowhere to go.

7. App Links (`https` + `android:autoVerify="true"`, API 31+): verification needs the site's `/.well-known/assetlinks.json`, which an
   emulator usually cannot reach. Check the state, then force it for testing:
```bash
adb -s $SERIAL shell pm get-app-links $PKG                        # Domain verification state: <domain>: verified | none | 1024 ...
adb -s $SERIAL shell pm set-app-links --package $PKG 2 <domain>   # 2 = approved (test only)
adb -s $SERIAL shell pm set-app-links --package $PKG 0 all        # back to none
```
   Empty output = the app declares no autoVerify domains.

## Broadcasts

8. Send an explicit broadcast (reaches a stopped app only with `--include-stopped-packages`).
```bash verify
adb -s $SERIAL shell am broadcast --include-stopped-packages -n $PKG/.SampleReceiver -a dev.crewdroid.sample.SYNC | grep 'Broadcast completed'
```
   `Broadcast completed: result=0` = delivered. Implicit broadcasts (no `-n`) are not delivered to manifest receivers on API 26+.

9. Clean up.
```bash verify
adb -s $SERIAL shell am force-stop $PKG
```

## What this cannot tell you
Whether the app handles a permission denial gracefully (drive the UI and watch android-triage), real App Link verification against
your server, or intents fired by other apps/system events you did not send yourself.
