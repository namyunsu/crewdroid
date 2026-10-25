---
name: android-apk
description: Read an Android APK without running it, or find out why it will not install or start. Use when the install fails (INSTALL_FAILED_..., "older sdk", "no certificates"), the wrong version is on the device, you need the package name, minSdk/targetSdk, permissions, exported activities or deep-link filters, or "what is actually installed on this emulator?".
license: MIT
---
<!-- Commands fenced as `bash verify` are run on a crew device (API 34) by scripts/check-skills.mjs with $SERIAL/$PKG/$APK substituted. -->
# android-apk: what is in this APK, what is installed?

Placeholders: `$SERIAL` = `emulator-<port>` (never a USB phone serial), `$PKG` = the package, `$APK` = a host path to the `.apk`.
In a checkout without the package installed, `crewdroid` = `npx tsx src/cli.ts`.

## Recipe

1. Manifest summary on the host (no device needed; uses `aapt2` from the newest SDK build-tools).
```bash verify
crewdroid apk $APK
```
   - Line 1 `<package> <versionName> (<versionCode>) minSdk=<n> targetSdk=<n>`: the package name to use everywhere else, and the API range.
     A device below `minSdk` refuses the install (`INSTALL_FAILED_OLDER_SDK`).
   - `permissions:` every `<uses-permission>`; a runtime one (CAMERA, LOCATION, ...) still needs a grant (android-permissions-intents).
   - `exported:` activities other apps / `adb am start -n` may start. Not listed = only the app itself can start it.
   - `deep links:` `scheme://host/path` of each VIEW filter; `none` = no link will ever open this app.
   - Errors: `not found` = wrong path; `aapt2 not found` = install an SDK build-tools package.

2. Same as JSON for scripts.
```bash verify
crewdroid apk $APK --json | grep -E '"package"|"minSdk"|"targetSdk"'
```

3. Install (or reinstall keeping data) and read the result line.
```bash verify
adb -s $SERIAL install -r $APK | grep Success
```
   `Success` = done. Common failures:
   `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (signed with another key: `adb -s $SERIAL uninstall $PKG` first, data is lost),
   `INSTALL_FAILED_VERSION_DOWNGRADE` (add `-d`), `INSTALL_FAILED_OLDER_SDK` (device API < minSdk: pick another profile),
   `INSTALL_PARSE_FAILED_NO_CERTIFICATES` (unsigned build), `INSTALL_FAILED_INSUFFICIENT_STORAGE` (free space on `/data`).

4. What is installed right now (version, SDK levels, install time)?
```bash verify
adb -s $SERIAL shell dumpsys package $PKG | grep -m6 -E 'versionCode|versionName|minSdk|targetSdk|lastUpdateTime'
```
   `versionCode=<n> minSdk=<n> targetSdk=<n>` on one line. If this differs from step 1, the device runs an older build:
   reinstall. Crew devices start from a snapshot, so a freshly booted device may hold an old build of your app.

5. Pull the installed APK back and read it (when you do not have the file).
```bash verify
adb -s $SERIAL pull "$(adb -s $SERIAL shell pm path $PKG | head -1 | sed 's/^package://' | tr -d '\r')" installed.apk
crewdroid apk installed.apk | head -1
```
   `pm path` prints `package:/data/app/.../base.apk`; split APKs print several lines (base first).

6. Which activity starts first: `adb -s $SERIAL shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER $PKG`
   (last line `<pkg>/<activity>`; see android-permissions-intents).

## What this cannot tell you
Code behaviour (decompile with jadx / Android Studio's APK Analyzer for that), runtime-registered receivers, whether App Links verify
against the real site, or resources/strings beyond the manifest.
