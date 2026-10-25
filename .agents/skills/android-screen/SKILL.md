---
name: android-screen
description: What is on the Android emulator screen right now? Use when the screen is blank or black, the wrong screen is showing, a button cannot be found or tapped, text is cut off on one device size, or a UI test cannot find an element. Gives the focused window, a compact accessibility tree with bounds, and a screenshot.
license: MIT
---
<!-- Commands fenced as `bash verify` are run on a crew device (API 34) by scripts/check-skills.mjs with $SERIAL/$PKG substituted. -->
# android-screen: what is on the screen?

Placeholders: `$SERIAL` = `emulator-<port>` (never a USB phone serial), `$PKG` = the app package.
In a checkout without the package installed, `crewdroid` = `npx tsx src/cli.ts`.

## Recipe

1. Bring up the screen you want to look at (here: the probe app's one-button screen).
```bash verify
adb -s $SERIAL shell am start -W -n $PKG/.ProbeActivity --es check anr | grep 'Status: ok'
```
   `Status: ok` = the activity started. `Error: Activity not started` / `does not exist` = wrong component (check it with android-apk).
   (Do not tap this button: the probe's `check=anr` button blocks the main thread on purpose.)

2. Which window has focus, and the tree under it.
```bash verify
crewdroid screen $SERIAL --png screen.png | tee screen.txt
grep -i 'probe button' screen.txt
```
   - `focus: <pkg>/<activity>`: the window that gets input. If it is not your app (`NotificationShade`, `Application Not Responding: ...`,
     a permission dialog `com.android.permissioncontroller/...`), that window is what the user sees.
   - Each next line: `<indent><Class> "<text|desc|id>" [l,t,r,b] clickable`. Indent = nesting depth; layout-only nodes are dropped.
   - `[l,t,r,b]` are real pixels of this device. Tap the centre: `adb -s $SERIAL shell input tap <(l+r)/2> <(t+b)/2>`.
   - `--json` gives `nodes[]` as `{cls, text, desc, id, bounds, clickable, depth}`; `screen.png` is the screenshot.

3. Compare against the device size (bounds outside it = off-screen / cut off; crewdroid profiles override the size).
```bash verify
adb -s $SERIAL shell wm size
adb -s $SERIAL shell wm density
```
   `Override size:` / `Override density:` (when present) are what the app sees; `Physical ...` is the base AVD. A profile whose size
   equals the base AVD shows only `Physical size`.

4. Blank or black screen? Decide which case it is:
```bash verify
adb -s $SERIAL shell dumpsys window | grep mCurrentFocus
adb -s $SERIAL shell dumpsys activity activities | grep -m2 -E 'topResumedActivity|ResumedActivity'
```
   - Focus is your activity but the tree has no nodes: the app draws nothing (empty layout, failed load, still on a splash). Check its log
     (android-triage step 5).
   - Focus is `null` / `mCurrentFocus=null`: no window yet or the app just died (android-triage).
   - The tree has your nodes but the PNG is black: a SurfaceView/GL surface on this image (ATD renders without a GPU; on API 31 ATD SurfaceView content
     has been seen not to render at all).

5. Jetpack Compose: `Modifier.testTag("x")` appears as `id` only with `Modifier.semantics { testTagsAsResourceId = true }` on a parent;
   otherwise find nodes by `text` / `desc`.

6. Clean up.
```bash verify
adb -s $SERIAL shell am force-stop $PKG
```

## Driving the screen
- Maestro (one flow on several devices): `maestro test --device $SERIAL flow.yaml`; `maestro --device $SERIAL hierarchy` prints the same tree.
- mobile-mcp: every tool takes `device: "$SERIAL"`; Maestro MCP takes `device_id: "$SERIAL"`. Always pass an emulator serial.

## What this cannot tell you
Pixels inside a SurfaceView/WebView/game canvas (they are not in the accessibility tree), animations between dumps, or whether the
layout looks right to a person: open `screen.png` and look, or compare two device sizes side by side.
