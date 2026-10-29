# `crewdroid layout` (T67, FR-39)

`crewdroid layout <serial> <pkg>` restarts one installed app on ONE device for every profile x font combination and judges
the screen it opens (or the screen a Maestro flow ends on, `--flow`) from the accessibility tree. Default matrix:
`s24ultra`, `fold5-cover`, `fold5-main`, `flip6-cover`, `trifold-main` x font 1.0 / 1.3 / 2.0 = 15 combos. Profile =
`wm size` + `wm density`, font = `env font`, app = force-stop, 2 s, start (`launch --restart`). The device's size, density
and font scale are put back afterwards. Exit 1 when any combo has a finding; a PNG with the finding boxes in red is written
only for those combos.

## Signals and their limits

The tree comes from the on-device helper in layout mode (`GET /tree?layout=1`, helper versionCode 5): every node (layout-only
ones too, so parents are exact), `hidden:true` for nodes not visible to the user, and for every node with text `chars` = the
screen box of each of its first 200 characters from `AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY` (the
accessibility text-location extra; `null` = no visible part). No screenshot is used to decide.

| kind | rule | limits |
|---|---|---|
| `wrap` (a) | a button label (text that is or sits in a `Button`/`Chip`/`Tab`, or in a Compose clickable with a same-size `Button` role node) whose character boxes span 2+ line tops; or any text with a line break between two letters/digits (a word split across lines) | prose that wraps between words is not a finding; texts drawn without the extra (custom `onDraw`, canvas, WebView) are not checked |
| `clip` (a) | ellipsized: non-space characters with zero-width boxes (how an ellipsized `TextView` reports its hidden tail); cut: some characters have no visible part while others do, and no scroll container is above the text | editable fields are skipped (they scroll their text); Compose's ellipsis was not seen in the runs below |
| `offscreen` (b) | a node with text, description or a click handler whose bounds lie outside the screen (a node pushed past an edge reports clamped, inverted bounds, e.g. `[45,7562,331,2340]`, and `hidden:true`), with no scrollable ancestor | only reported for the outermost such node; a node only partly past the edge is clamped by Android to the edge, so it shows up as `clip` on its text, not here |
| `overlap` (c) | two elements (clickable nodes, or texts not inside a clickable) that are not ancestor/descendant overlap by more than 20 % of the smaller one | elements covering half the screen or more (scrims, containers) are left out |
| `target` (d) | clickable node smaller than 48 dp in width or height (dp = px x 160 / density) | nodes touching the screen edge or their scroll container's edge are skipped (partly scrolled out) |
| `crash` | the app process is gone 2 s after the start | |

`--flow`: `maestro test --device <serial> --no-reinstall-driver <flow>` after each start. That leaves Maestro's driver
(`dev.mobile.maestro`) running and holding UiAutomation (measured: the helper was still refused 60 s later), so `layout`
force-stops that driver after its own flow and restarts the helper. Maestro absent -> exit 1 `--flow needs Maestro, which is
not on PATH`.

## Detection proof (probe fixtures)

`adb shell am start -n dev.crewdroid.probe/.ProbeActivity --es check layout-bad|layout-ok`, through
`crewdroid layout <serial> dev.crewdroid.probe -- --es check layout-bad`.

- `layout-bad`: 15 of 15 combos show all five kinds: `Synchronize all field notes now` in a 150 dp button wraps (2-3 lines),
  `Pending upload for North field pump house` ellipsized (19-28 of 41 characters not drawn), `Unreachable` below a
  non-scrolling column (`offscreen`), `Left`/`Right` overlap 50 %, a 24x24 dp `tiny` button.
  In one of four full check runs 14 of 15 combos had all five kinds (which combo missed which kind was not recorded; the
  check now prints it); the other three runs had 15 of 15.
- `layout-ok` (same controls, full-width buttons, a ScrollView, 48 dp button): 0 findings on 15 combos.

## Time (s24ultra clone, API 36, 2 cores, 896 MB; 2026-10-29)

| run | combos | total | per combo |
|---|---|---|---|
| probe `layout-ok` | 15 | 81.5-88.1 s | 5.4-6.3 s |
| probe `layout-bad` (15 PNGs written) | 15 | 117.9-119.7 s | 6.9-7.9 s |
| Tasks.org 15.12 | 15 | 98.9 s | 5.7-7.1 s |
| probe `layout-bad` with `--flow` (Maestro) | 2 | 48.9 s | ~21 s |

Most of a combo is the restart itself (force-stop, 2 s, `am start -W`, 2 s crash check); the tree read is well under 1 s.

## Non-demo app: Tasks.org (F-Droid)

`org.tasks` 15.12 (versionCode 151202), `https://f-droid.org/repo/org.tasks_151202.apk`, downloaded into a fresh directory,
sha256 `ed972cc1cec3456a11992435a3fcf132d1311f1e8dfd27758265122fbc206ce0`, 28,580,639 bytes. After `pm clear org.tasks` its
launch screen is the welcome screen (Compose: logo, `Add account`, `Continue without sync`, `Import Tasks.org backup`).
One command:

```
crewdroid install emulator-5580 org.tasks_151202.apk
crewdroid layout emulator-5580 org.tasks
```

Result: exit 1, 5 of 15 combos with findings, all `wrap` (11): the three pill buttons wrap their labels.

| combo | findings |
|---|---|
| s24ultra font 2.0 | `Import Tasks.org backup` wraps to 2 lines |
| fold5-cover font 2.0 | `Continue without sync`, `Import Tasks.org backup` wrap to 2 lines |
| flip6-cover font 1.0 | `Continue without sync` 2 lines, `Import Tasks.org backup` 3 lines |
| flip6-cover font 1.3 | `Add account` 2, `Continue without sync` 3, `Import Tasks.org backup` 3 lines |
| flip6-cover font 2.0 | `Add account` 2, `Continue without sync` 4 (`Continu` / `e` / `without` / `sync`: the word is split), `Import Tasks.org backup` 2 lines (rest scrolled out) |
| other 10 combos | clean |

Checked against the PNGs: on flip6-cover (360 dp wide) the buttons sit in a ~180 dp column next to the logo, so the labels
wrap and at font 2.0 "Continue" breaks inside the word; on s24ultra at 2.0 only `Import Tasks.org backup` wraps. These are
real wraps; whether a 2-line pill label is a bug is the app's call (the command reports, it does not grade). No overlap,
offscreen, clip or small-target findings on this screen.

Reproduce everything: `node scripts/check-layout-cmd.mjs [--apk org.tasks_151202.apk --pkg org.tasks]`.
