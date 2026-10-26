# Agent driving benchmark: tree (crewdroid) vs screenshots (T49)

Date: 2026-10-26 · raw: `agent-bench.json` · script: `node scripts/bench-agent.mjs`
Device: s24ultra (Physical size: 1080x2340), API 34, `emulator-5580` · app: Field Notes (`demo-app/`) · 5 runs per path, interleaved.

Task: open the Field Notes demo app, add a note 'Fix pump #3', confirm it appears in the list. Deterministic, no LLM. These numbers are **observation cost and latency**, not a model's success rate.

- **A (crewdroid way):** `screen` (JSON accessibility tree) to observe, `tap --text` / `type --into` to act, `screen` + `logs` to confirm.
- **B (screenshot way, how pixel-based agents and computer-use drive an emulator window):** `screencap -p` PNG after every action, taps by x,y.
  B's x,y come from an untimed uiautomator dump standing in for the vision model's "find the button in the image": no misses, no time. This favours B.
- Both paths go through the same crewdroid MCP server over stdio; only the observation differs. Model think time is not counted on either side.
- Tokens: text = characters / 4; image = Anthropic's vision formula, long edge scaled to <= 1568 px, then tokens ≈ width × height / 750 (https://docs.claude.com/en/docs/build-with-claude/vision). One 1080x2340 screenshot = 1513 tokens (239578 PNG bytes).

## Per task (mean of 5/5 A and 5/5 B successful runs)

| Metric | A: tree (crewdroid) | B: screenshots | B / A |
|---|---|---|---|
| Estimated model input tokens | 9695 | 6212 | 0.64x |
| Wall time (s) | 23.91 | 10.26 | 0.43x |
| Tool calls | 7 | 8 | 1.14x |
| Observation payload (bytes) | 38793 | 922820 | 23.79x |

## Per step (mean)

| Path | Step | Tool | Seconds | Bytes | Tokens |
|---|---|---|---|---|---|
| A | launch | launch | 6.22 | 198 | 50 |
| A | observe (tree) | screen | 3.55 | 11119 | 2778 |
| A | tap New note | tap | 3.27 | 256 | 64 |
| A | type into title | type | 4.4 | 268 | 67 |
| A | tap Save | tap | 3.2 | 252 | 63 |
| A | confirm (tree) | screen | 2.98 | 11374 | 2841 |
| A | confirm (logs) | logs | 0.29 | 15326 | 3832 |
| B | launch | launch | 5.93 | 198 | 50 |
| B | observe (shot) | shot | 0.87 | 239434 | 1530 |
| B | tap New note (x,y) | tap | 0.29 | 56 | 14 |
| B | observe (shot) | shot | 0.81 | 244865 | 1530 |
| B | type | type | 0.82 | 56 | 14 |
| B | observe (shot) | shot | 0.61 | 181034 | 1530 |
| B | tap Save (x,y) | tap | 0.23 | 56 | 14 |
| B | confirm (shot) | shot | 0.69 | 257121 | 1530 |

## Runs

| Path | Run | OK | Seconds | Tokens | Calls |
|---|---|---|---|---|---|
| A | 1 | yes | 29.12 | 10370 | 7 |
| A | 2 | yes | 27.36 | 10129 | 7 |
| A | 3 | yes | 21.96 | 9295 | 7 |
| A | 4 | yes | 20.1 | 9500 | 7 |
| A | 5 | yes | 20.99 | 9181 | 7 |
| B | 1 | yes | 14.29 | 6212 | 8 |
| B | 2 | yes | 10.87 | 6212 | 8 |
| B | 3 | yes | 8.87 | 6212 | 8 |
| B | 4 | yes | 8.61 | 6212 | 8 |
| B | 5 | yes | 8.65 | 6212 | 8 |

Failure modes seen: none in these runs.
Failure modes not exercised (B gets them for free here): a vision model misreading a button's position or text, tapping during the
bottom-sheet animation, re-taking a screenshot to check. A's `tap --text` fails with the list of candidates instead of tapping the wrong spot.

## Time to first usable device

| Way | Time to ready |
|---|---|
| `crewdroid up --profile s24ultra --api 34` (returns when the device is ready) | 8.5 s |
| Stock AVD, cold boot (`-no-snapshot-load`) | 24.2 s |
| Stock AVD, first boot of the fresh AVD | 41.9 s |
| Stock AVD, quick boot (snapshot Android Studio saves on exit) | 5.8 s |

Stock AVD: avdmanager create avd -d medium_phone -k "system-images;android-34;google_atd;x86_64" + hw.gpu.mode=auto, hw.keyboard=yes; window shown (minimized), deleted afterwards. Flags: `-netdelay none -netspeed full -avd bench-stock-34 -port 5592` (Android Studio's standalone launch; `-port` added to stay off other emulators). Measured: command start -> sys.boot_completed=1 (stock) / `up` returned, device ready (crewdroid), wall seconds. Same machine as the A/B runs, measured right after them.
Cold boot over `up`: 2.8x.

## Where the cost goes

- A: one `screen` result = 2778 tokens (11119 bytes of pretty-printed JSON), one `logs` result = 3832 tokens. B: one screenshot = 1513 tokens.
- A: every call that reads the tree (`screen`, `tap --text`, `type --into`) runs `uiautomator dump` on the device: 3.5 s each on average, 5 per task. A `shot` takes 0.7 s.
- B pays nothing here for finding the buttons (untimed dump, 9.1 s per task left out); a real vision model would add its own image-reading time and misses.

## What this means for an agent

1. Observation tokens per task: tree 9695 vs screenshots 6212: screenshots are 1.56x fewer tokens here.
2. Tool time per task: tree 23.91 s vs screenshots 10.26 s: screenshots are 2.33x faster here; tree taps go by text and fail with candidates instead of hitting a guessed pixel.
3. A ready device: `crewdroid up` 8.5 s vs stock emulator cold boot 24.2 s (2.8x; stock quick boot 5.8 s, fresh first boot 41.9 s).
