# Agent driving benchmark: tree (crewdroid) vs screenshots (T49, re-measured T54)

Date: 2026-10-29 · raw: `agent-bench.json` · script: `node scripts/bench-agent.mjs`
Device: s24ultra (Physical size: 1080x2340), API 34, `emulator-5580` · app: Field Notes (`demo-app/`) · 5 runs per path, interleaved.

Task: open the Field Notes demo app, add a note 'Fix pump #3', confirm it appears in the list. Deterministic, no LLM. These numbers are **observation cost and latency**, not a model's success rate.

- **A (crewdroid way, T54 defaults):** `screen` once (compact outline), then `tap --text` / `type --into` / `tap --text`; each returns the settled new screen, which is the next observation (Save's returned screen shows the new card). `logs` (default view) confirms the app's `SAVED` line. No other calls.
- **B (screenshot way, how pixel-based agents and computer-use drive an emulator window), unchanged since T49:** `screencap -p` PNG after every action, taps by x,y; `tap` / `type` with `screen:false`, i.e. returning only the point as in T49.
  B's x,y come from an untimed uiautomator dump standing in for the vision model's "find the button in the image": no misses, no time. B's shot after a tap does not wait for the screen to settle and B's confirm reads the last image for free (untimed dump). These favour B.
- Both paths go through the same crewdroid MCP server over stdio; only the observation differs. Model think time is not counted on either side.
- Tokens: text = characters / 4; image = Anthropic's vision formula, long edge scaled to <= 1568 px, then tokens ≈ width × height / 750 (https://docs.claude.com/en/docs/build-with-claude/vision). One 1080x2340 screenshot = 1513 tokens (242621 PNG bytes).

## Per task (mean of 5/5 A and 5/5 B successful runs), before (T49, 2026-10-26, commit 1274c6b) and after

| Metric | A before (T49) | A after | B before (T49) | B after | B / A after |
|---|---|---|---|---|---|
| Estimated model input tokens | 9695 | 1882 | 6212 | 6183 | 3.29x |
| Wall time (s) | 23.91 | 10.58 | 10.26 | 10.46 | 0.99x |
| Tool calls | 7 | 6.2 | 8 | 8 | 1.29x |
| Observation payload (bytes) | 38793 | 7545 | 922820 | 931301 | 123.43x |

## Per call, path A (mean seconds; reported, not gated: the <= 0.5 s wish of request 2026-10-27 task 1)

| Tool | T49 | T54 | <= 0.5 s wish |
|---|---|---|---|
| `screen` | 3.27 | 0.52 | not met |
| `tap` | 3.24 | 1.31 | not met |
| `type` | 4.4 | 0.48 | met |
| `logs` | 0.29 | 0.25 | - |

`tap` and `type` include the returned screen: the helper waits on the device until no accessibility event came for 150 ms and the tree reads the same 50 ms later.

## Per step (mean)

| Path | Step | Tool | Runs | Seconds | Bytes | Tokens |
|---|---|---|---|---|---|---|
| A | launch | launch | 5 | 6.61 | 198 | 50 |
| A | observe (screen) | screen | 5 | 0.48 | 1704 | 424 |
| A | tap New note (+screen) | tap | 5 | 1.58 | 399 | 100 |
| A | type into title (+screen) | type | 5 | 0.48 | 419 | 105 |
| A | tap Save (+screen) | tap | 5 | 1.04 | 1725 | 429 |
| A | confirm (logs) | logs | 5 | 0.25 | 2752 | 687 |
| A | re-check (screen; Save's screen lacked the note) | screen | 1 | 0.69 | 1736 | 432 |
| B | launch | launch | 5 | 6.11 | 198 | 50 |
| B | observe (shot) | shot | 5 | 0.85 | 242689 | 1530 |
| B | tap New note (x,y) | tap | 5 | 0.23 | 15 | 4 |
| B | observe (shot) | shot | 5 | 1 | 246237 | 1530 |
| B | type | type | 5 | 0.65 | 19 | 5 |
| B | observe (shot) | shot | 5 | 0.67 | 184047 | 1530 |
| B | tap Save (x,y) | tap | 5 | 0.18 | 15 | 4 |
| B | confirm (shot) | shot | 5 | 0.76 | 258082 | 1530 |

## Runs

| Path | Run | OK | Seconds | Tokens | Calls |
|---|---|---|---|---|---|
| A | 1 | yes | 11.9 | 1826 | 6 |
| A | 2 | yes | 11.72 | 2304 | 7 |
| A | 3 | yes | 12.21 | 1826 | 6 |
| A | 4 | yes | 8.83 | 1740 | 6 |
| A | 5 | yes | 8.22 | 1712 | 6 |
| B | 1 | yes | 11.56 | 6183 | 8 |
| B | 2 | yes | 13.6 | 6183 | 8 |
| B | 3 | yes | 10.41 | 6183 | 8 |
| B | 4 | yes | 8.57 | 6183 | 8 |
| B | 5 | yes | 8.15 | 6183 | 8 |

Failure modes seen: none in these runs.
Failure modes not exercised (B gets them for free here): a vision model misreading a button's position or text, tapping during the
bottom-sheet animation, re-taking a screenshot to check. A's `tap --text` fails with the list of candidates instead of tapping the wrong spot.

## API 36 (one run per path, s24ultra)

| Path | OK | Seconds | Tokens | Per call (s) |
|---|---|---|---|---|
| A | yes | 19.11 | 2543 | observe (screen) 1.96; tap New note (+screen) 3.76; type into title (+screen) 1.43; tap Save (+screen) 2.03; confirm (logs) 0.39 |
| B | yes | 19.27 | 6183 | observe (shot) 1.54; tap New note (x,y) 0.28; type 3.32; tap Save (x,y) 1.13; confirm (shot) 1.49 |

## Robustness: other screens at font 1.3, no re-deriving

A taps by text as on s24ultra; B reuses the x,y it learned on s24ultra (New note 819,2205; Save 540,2193). Same API 34 device, `wm size` / `wm density` of the profile and `font_scale 1.3`, one run each.

| Profile | Screen | A (by text) | B (s24ultra coordinates) |
|---|---|---|---|
| fold5-main | 1812x2176@420 | pass | FAIL: tap New note (x,y): error: point (819, 2205) is outside the screen 1812x2176 |
| flip6-cover | 720x748@320 | pass | FAIL: tap New note (x,y): error: point (819, 2205) is outside the screen 720x748 |

## Time to first usable device

| Way | Time to ready |
|---|---|
| `crewdroid up --profile s24ultra --api 34` (returns when the device is ready) | 8.4 s |
| Stock AVD, cold boot (`-no-snapshot-load`) | 22.3 s |
| Stock AVD, first boot of the fresh AVD | 35.5 s |
| Stock AVD, quick boot (snapshot Android Studio saves on exit) | 5.7 s |

Stock AVD: avdmanager create avd -d medium_phone -k "system-images;android-34;google_atd;x86_64" + hw.gpu.mode=auto, hw.keyboard=yes; window shown (minimized), deleted afterwards. Flags: `-netdelay none -netspeed full -avd bench-stock-34 -port 5592` (Android Studio's standalone launch; `-port` added to stay off other emulators). Measured: command start -> sys.boot_completed=1 (stock) / `up` returned, device ready (crewdroid), wall seconds. Same machine as the A/B runs, measured right after them.
Cold boot over `up`: 2.7x.

## Where the cost goes

- A: one `screen` outline = 424 tokens (1704 bytes), one default `logs` = 687 tokens; each action's returned screen is in its row above. B: one screenshot = 1513 tokens.
- A: the tree comes from the on-device helper (T52), not `uiautomator dump`. A `shot` takes 0.8 s.
- Both: `launch` (am start -W, then a 2 s crash check) is 6.61 s of A's 10.58 s and 6.11 s of B's 10.46 s.
- Per-call wish not met for `screen` (0.52 s), `tap` (1.31 s): most of it is the app's own transition after the tap (measured in T54 by polling the tree after a tap: Field Notes' editor sheet is in the tree 0.3-0.6 s after the tap on this emulator; Save closes the sheet and animates the new card in, 300 ms), plus the 150 ms quiet period that makes the returned screen a settled one.
- B pays nothing here for finding the buttons (untimed dump, 1.3 s per task left out); a real vision model would add its own image-reading time and misses.

## What this means for an agent

1. Observation tokens per task: tree 1882 vs screenshots 6183: the tree path is 3.29x fewer tokens.
2. Tool time per task: tree 10.58 s vs screenshots 10.46 s: screenshots are 1.01x faster here (gate, user 2026-10-29 "time tie allowed": A <= B x 1.1 = 11.51 s, met; the 5-run spread is about +-3 s); tree taps go by text and fail with candidates instead of hitting a guessed pixel.
3. A ready device: `crewdroid up` 8.4 s vs stock emulator cold boot 22.3 s (2.7x; stock quick boot 5.7 s, fresh first boot 35.5 s).
