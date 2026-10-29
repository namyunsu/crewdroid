# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-10-29

### Added
- `setup`: installs the Android SDK pieces (JDK 17, cmdline-tools, platform-tools, emulator, google_atd images); `--dry-run` and `--yes`.
- `up` with no flags boots one device (s24ultra on the newest installed API <= 36); `devices` lists it.
- `install`, `launch` (start time, crash summary) and `logs` (one app's logcat lines) for building and checking an app on a device.
- `shot`, `tap`, `type`, `swipe` and `key` to see and drive the screen; the same names are MCP tools.
- `android-vibe-loop` agent skill and `scripts/check-vibe-loop.mjs`, which runs the whole loop over MCP.
- Vibe-coding demo GIF (`docs/demo/vibe.gif`, made by `scripts/demo-vibe.mjs`).
- On-device agent helper for fast screen reads and taps, with uiautomator as fallback (T52). Read times are in the README table.
- `screen` prints a compact outline and returns the changed screen after each action; `logs` shows the last 40 lines by default (T53).
- `run` on any APK: per-device Maestro flows, intents or adb commands with a network schedule, drain, and judge (T55). Flags form without a scenario file: `run --apk --flow --server` (T77).
- `proxy` recording HTTP proxy and `judge --log`: duplicate success, lost update, lost write and idle rules on the request log, with no app or server change (T69).
- `layout`: broken-screen sweep of an installed app over 5 Galaxy profiles x 3 font sizes (wrap, clip, offscreen, overlap, small targets) (T67).
- Device conditions: `net wifi|cellular|both|none` with handover and metered Wi-Fi (T63); `load off|low|mid|high` (T62); `up --cores --ram` (T64).
- CI on Windows, macOS and Linux, plus a Linux emulator smoke test (T58). A version tag publishes to npm and the MCP Registry (T68).
- `docs/measurements/atd-limits.md`: what the google_atd images lack (camera, browser, Play services) and what that breaks, with the README Limits section (T76).

### Changed
- Node >= 22 is required.
- Agent benchmark (`docs/measurements/agent-bench.md`): one add-a-note task takes 1,882 tokens with the tree path vs 6,183 with screenshots; time is a tie (10.58 s vs 10.46 s). The tree path also passes the fold and flip checks, the screenshot path fails both (T54).
- README opens with the develop-and-check loop and your own app; the bundled sample is the try-it-first path (T76).
- Ready time, idle CPU and disk were measured for 1 and 3 devices against stock google_atd and Android Studio's default AVD (T70, T72, T75; `docs/measurements/`).
- API 31 images: the black screen after a relaunch is detected and recovered (`launch --restart`, `shot`, `screen`).

## [0.1.0]

First release: N headless emulators with mixed Galaxy profiles and Android versions, per-device network states, scenario runner, server-data judge (`unique` / `count` / `noLostUpdate`), MCP server and agent skills.
