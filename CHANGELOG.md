# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- `up` from an npm install failed on first use with `probe apk missing`: the package shipped without the probe APK that base-image preparation installs. `npm pack` now builds it and the package includes it.
- `load` from an npm install failed: the package had neither the load app and filler APKs nor the sources to build them. They are now built by `npm pack` and shipped; without them `load` says so instead of failing in Gradle. The filler generator takes `javac` and `jar` from `JAVA_HOME` when it is set.

## [0.2.3] - 2026-11-03

### Fixed
- `setup` on macOS downloaded a cmdline-tools URL that no longer exists (since cmdline-tools 22 the Mac zips are per CPU); it now takes the file name from Google's repository.
- `setup` failed at once on a machine with no `java` on PATH, and `up` then failed creating the AVD ("JAVA_HOME is not set"); both now use the JRE `setup` installed.
- Emulator 37.2 never finished booting with `-gpu host` and Vulkan off; from 37.2 on Vulkan stays on (3 devices +668 MB idle, about +220 MB each). 37.1 and older keep the old flags.
- The tray badge counted every started device; it now counts the ones still running.

### Added
- CI runs the real `setup` and AVD creation on macOS.

## [0.2.2] - 2026-11-02

### Added
- Windows tray icon while devices run: a badge with the device count, click for each device and the last command. 51 MB and 0.17 % of one core; exits on `down` or when the emulators die. `CREWDROID_NO_TRAY=1` turns it off. Launch flags are unchanged.

### Changed
- `up` runs base-image preparation inside its failure path: a failed first-time prepare now stops what it started.

## [0.2.1] - 2026-11-02

### Added
- `up --wifi`: each device can get its own Wi-Fi (31 of 33 measured device boots, +9.4 % idle RAM; default stays one at a time). `net wifi` retries the connection when it fails (T74, T83).
- `examples/daeri/` and `docs/measurements/daeri-trial.md`: one app built by an agent on both sides, with the files to repeat it.

### Changed
- CLI commands load on demand, so `crewdroid --version` starts in 79 ms; README rows now time the installed command (T79).

### Fixed
- `judge --rules judge/proxy.rules.json` failed with `ENOENT` outside this repo; it now falls back to the bundled file.
- `type --into "<label>"` failed with `2 matches` on Material fields; it now prefers the editable node.

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
