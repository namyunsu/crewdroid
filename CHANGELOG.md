# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `setup`: installs the Android SDK pieces (JDK 17, cmdline-tools, platform-tools, emulator, google_atd images); `--dry-run` and `--yes`.
- `up` with no flags boots one device (s24ultra on the newest installed API <= 36); `devices` lists it.
- `install`, `launch` (start time, crash summary) and `logs` (one app's logcat lines) for building and checking an app on a device.
- `shot`, `tap`, `type`, `swipe` and `key` to see and drive the screen; the same names are MCP tools.
- `android-vibe-loop` agent skill and `scripts/check-vibe-loop.mjs`, which runs the whole loop over MCP.
- Vibe-coding demo GIF (`docs/demo/vibe.gif`, made by `scripts/demo-vibe.mjs`).

### Changed
- Node >= 22 is required.
- API 31 images: the black screen after a relaunch is detected and recovered (`launch --restart`, `shot`, `screen`).

## [0.1.0]

First release: N headless emulators with mixed Galaxy profiles and Android versions, per-device network states, scenario runner, server-data judge (`unique` / `count` / `noLostUpdate`), MCP server and agent skills.
