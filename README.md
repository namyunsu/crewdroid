# crewdroid

[![ci](https://github.com/namyunsu/crewdroid/actions/workflows/ci.yml/badge.svg)](https://github.com/namyunsu/crewdroid/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/crewdroid)](https://www.npmjs.com/package/crewdroid) [![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.namyunsu%2Fcrewdroid-blue)](https://registry.modelcontextprotocol.io/v0/servers?search=crewdroid) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**An Android emulator your AI agent drives on under half the RAM of Android Studio's, with the phone's conditions set per device: network, battery, location, screen, font, Android version.**

crewdroid is for the build-and-check loop while you develop an app; a real phone is still where you test push notifications, Play services, Google sign-in and the camera app ([Limits](#limits-when-to-use-a-real-phone)).

[![15 s demo: crewdroid boots S24, Fold5 and Flip7 emulators on Android 14 and 16, cuts one phone's network while a note waits offline and syncs back, judges the server data (FAIL: 7 violations), then folds a device and turns on dark mode](docs/demo/hero.gif)](docs/demo/hero.mp4)

- **Faster to a tested app.** In one run per side, an AI agent built and 3-device tested the same app in 13 min 42 s on crewdroid and 40 min 30 s on Android Studio's default AVD, with the same result ([details](#one-app-built-by-an-agent-on-both)).
- **Light.** 1472 MB of host RAM and 2.09 GiB of disk per device, against 3388 MB and 7.29 GiB for Android Studio's default AVD; a screen read through the CLI takes 370.7 ms against 2074.1 ms ([table](#one-device-against-android-studios-default-emulator)).
- **Made for an agent.** `screen` returns a text outline (`[3] btn "Send" #send @540,1210`) in about a third of a screenshot's tokens (1882 vs 6183 per task), `tap --text Send` taps by name on any screen size, and every command is both a CLI with `--json` and an MCP tool.
- **Conditions on demand.** Per device: `net airplane|nodata|slow|flaky`, `env` battery / location / dark mode / font size / locale / rotation, Galaxy S24 · Fold · Flip screens with fold / unfold, Android 12 / 14 / 16, a used-phone `load`.

Also in the box: judging your server's data for duplicate, missing and silently overwritten records after a multi-device run, a layout sweep across screens and fonts, crash / ANR triage.

## One app, built by an agent on both

We gave an AI agent the same empty project, spec and buggy server twice: build a designated-driver app, check every feature on screen, fix what breaks, then test 3 drivers against the server. Same model, no human. One run per side, 2026-11-02 ([method and limits](docs/measurements/daeri-trial.md), [files to repeat it](examples/daeri/)).

| | Android Studio default AVD + adb + mobile-mcp | crewdroid |
|---|---|---|
| Empty project to finished 3-device test | 40 min 30 s | **13 min 42 s** |
| Bringing up 3 devices | 759 s | **41 s** |
| Server bugs found | 4 | 4 |
| Finished app, same scored run | passed | passed |

Same result, about a third of the time. Boot explains nearly half of the gap: without those 759 s the Studio side takes about 28 minutes, and an agent reusing a running emulator would not pay all of it. This is one run per side, not a benchmark.

The `run` command then took about 5 minutes for 3 devices x 5 rounds with network faults. It failed the buggy server 2 of 2 times and passed the fixed server 2 of 2 times.

## One device, against Android Studio's default emulator

If you found crewdroid because an AI agent on the stock emulator is slow, start here. One device, medians of 3 runs, measured on the same PC (raw runs in [`docs/measurements/single-vs-studio.json`](docs/measurements/single-vs-studio.json)):

| | Android Studio default AVD | crewdroid `up` |
|---|---|---|
| Disk (AVD + system image) | 7.29 GiB | **2.09 GiB** |
| Host RAM after ready | 3388 MB | **1472 MB** |
| Screen read in the MCP server (Studio side: `adb uiautomator dump`) | 2074.1 ms | **175.2 ms** |
| Screen read through the CLI | 2074.1 ms | **370.7 ms** |
| Screenshot in the MCP server (Studio side: `adb screencap`) | 723.7 ms | **286.3 ms** |
| Screenshot through the CLI | 723.7 ms | **445.6 ms** |
| Cold boot to `sys.boot_completed` | 25.1 s | 24.6 s |
| Idle CPU, 60 s (100 % = 1 core) | 200.5 % (runs: 42.5 to 383.1) | 213.3 % |
| Start from snapshot to `sys.boot_completed` | 5.3 s | 5.5 s |

Bold = crewdroid clearly ahead. Cold boot and snapshot boot are a tie, and idle CPU varies too much between runs to call. The CLI rows time the installed `crewdroid` command (`node bin/crewdroid.mjs`, a new node process per call; it starts in 79 ms, `--version`); the MCP rows time calls to one `crewdroid mcp` server kept running. `npx crewdroid` adds about 0.4 s to every call ([`cli-speed.json`](docs/measurements/cli-speed.json)), so install it once (`npm i -g crewdroid`) or use the MCP server. Per-phase numbers in [`single-vs-studio.md`](docs/measurements/single-vs-studio.md).

An AI agent driving one device (Field Notes demo app, "add a note and confirm it", 5 runs per path, API 34, s24ultra; raw in [`docs/measurements/agent-bench.json`](docs/measurements/agent-bench.json)): path A reads crewdroid's text outline and taps by text, path B reads a screenshot after every action and taps by x,y.

| Agent, per task | Screenshots + x,y taps | crewdroid `screen` + `tap --text` |
|---|---|---|
| Estimated model input tokens | 6183 | 1882 |
| Tool time (s) | 10.46 | 10.58 (a tie, not faster) |
| Same task on fold5-main and flip6-cover at font 1.3, no re-deriving | FAIL (s24ultra x,y outside the screen) | pass |

What crewdroid adds over mobile-mcp + the stock emulator: a lighter device (table above, [`single-vs-studio.json`](docs/measurements/single-vs-studio.json)), per-device network faults (`net`), layout checks across screens and fonts ([`layout.md`](docs/measurements/layout.md)) and judging the server's data ([`run-app.json`](docs/measurements/run-app.json)). What it does not add: tap / type speed, which is the same ([`agent-bench.json`](docs/measurements/agent-bench.json); mobile-mcp itself was not benchmarked, path B stands in for screenshot-driven agents).

Setup: Android 16 (API 36); the Studio side is a `pixel_9` AVD from `google_apis_playstore` with default 2 GB RAM and 4 cores, window on, `-gpu auto`, quickboot; the crewdroid side is `up` with no flags (headless, 2 cores, `google_atd` image); Ryzen 7 5700X, 64 GB, Windows 11, emulator 37.1.11.0. The CLI rows include starting node.

## What only crewdroid does

1. **Judges the server, not the screen.** After a run, `crewdroid judge` reads your API's data and checks rules: `unique` (no duplicates), `count` (nothing missing), `noLostUpdate` (no silent overwrite). A bug comes back as `VIOLATION` lines and exit code 1, not as a screenshot to interpret. No export endpoint? `crewdroid proxy start --target http://127.0.0.1:8080` records every request the emulators send (through the Android system proxy, no app or server change), and `crewdroid judge --rules judge/proxy.rules.json --log proxy.jsonl` checks `dupSuccess` (one write applied twice), `lostUpdate` (two edits on the same version both accepted), `lostWrite` (a failed write never retried) and `idle` from that log. Plain HTTP only for now ([ADR 0008](docs/adr/0008-proxy-judge.md)).
2. **Breaks one device at a time, mid-flow.** Network `airplane` / `nodata` / `slow` / `flaky` per device on its own schedule, fold / unfold during an upload, Doze, trim-memory, full storage, a low-end CPU / RAM spec. Every setter reads the state back.
3. **Runs a mixed fleet from one command.** Android 12 / 14 / 16 and S24 · Fold · Flip or any `WxH@dpi`, headless, all clones of one base image: 3 devices in 3.93 GB of host RAM and 6.99 GiB of disk (allocated).

Also in the box: crash / ANR triage, cold start and jank, APK inspection. Every command has `--json` and an exit code, and every command is an MCP tool.

```bash
npx crewdroid setup --yes        # Android SDK + emulator images, if you have none
npx crewdroid up --count 3       # S24 Ultra / API 34, Fold5 / API 34, Flip7 / API 36
npx crewdroid run --apk app.apk --flow flows/add-item.yaml --server http://127.0.0.1:8080   # your app: your Maestro flow on every device + network faults + judge, exit 1 on a bug
```

New to it? Try the bundled sample first (sample app + sample server with a race condition): `npx crewdroid run scenarios/photo-upload.json --seed 1`. Your own app step by step: [docs/guide-your-app.md](docs/guide-your-app.md).

## Why not just the Android Emulator?

The stock emulator is one phone with a window, driven by hand. crewdroid is a *fleet* driven by a program.

| | Android Emulator / AVD Manager | crewdroid |
|---|---|---|
| Multi-user bugs | not a feature | `run` repeats a flow on every device at different timings, then `judge` checks the server: `unique`, `count`, `noLostUpdate` |
| Network | one toggle in Extended Controls | per-device `airplane`, `nodata`, `slow`, `flaky` on a randomised schedule, mid-upload |
| Devices | one AVD = one window, one disk image each | N read-only clones of one base image, mixed screens (S/Fold/Flip/any `WxH@dpi`) and API levels, one command |
| Interaction | click in a window | `--json` output + exit code on every command |
| Device state | GUI panels | `env` (GPS, battery, rotation, dark mode, font, locale, GSM, SMS, calls) and `app` (permissions, deep links, Doze, trim, full storage) — each setter reads its state back |
| Fold / Flip | needs a foldable AVD | `fold` / `unfold` on any clone: the app gets a real configuration change |
| For an AI agent | nothing to call | MCP server, `AGENTS.md`, 7 skills triggered by symptoms ("app crashed", "deep link does not open", "sync duplicated a row") |

Resources for 3 devices (3 API levels each; stock = `avdmanager` defaults, headless, fresh):

| | stock `google_apis` | stock `google_atd` | crewdroid |
|---|---|---|---|
| Disk | 24.7 GiB (file length; not re-measured as allocated) | 11.8 GiB allocated (33.2 GiB file length) | 6.99 GiB allocated |
| Host RAM | 8.45 GB | 8.5-8.8 GB | 3.93 GB |
| Idle CPU (100 % = 1 core) | ~1000 % | ~248-352 % | ~600 % |

"Allocated" = bytes really on disk (sparse holes and NTFS compression excluded), the only disk number comparable to crewdroid's slimmed clones; the `google_apis` figure was taken as file length, so it overstates that column. Disk and RAM are lighter than both stock images, but idle CPU is not: crewdroid's ~600 % is higher than 3 stock `google_atd` AVDs (~248-352 % over 6 runs; one 60 s sample is noisy), so the CPU gap against `google_apis` comes from the image, not from crewdroid. Measured on one Windows 11 PC (Ryzen 7 5700X, 64 GB, WHPX), 3 devices. Raw JSON and method in [`docs/measurements/`](docs/measurements/) (`baseline.md`, `baseline-atd.md`).

No barrier, by design. Real concurrency bugs come from retries, offline queues and late edits overlapping — not from pressing a button at the exact same millisecond. crewdroid gives each device its own delays and network schedule and lets the overlap happen, then reads the truth from the server ([ADR 0002](docs/adr/0002-no-barrier.md)).

## 60-second tour

Boot a mixed fleet (headless, nothing appears on screen):

```bash
$ crewdroid up --count 3 --json
[
  { "serial": "emulator-5580", "profile": "s24ultra",   "api": 34, "screen": "1080x2340@450", "bootSeconds": 6.4, "readySeconds": 42.1 },
  { "serial": "emulator-5582", "profile": "fold5-main", "api": 34, "screen": "1812x2176@420", "bootSeconds": 6.7, "readySeconds": 41.8 },
  { "serial": "emulator-5584", "profile": "flip7-main", "api": 36, "screen": "1080x2520@480", "bootSeconds": 3.1, "readySeconds": 39.9 }
]
```

Cut one device's data mid-upload, let another go flaky:

```bash
$ crewdroid net emulator-5580 nodata
$ crewdroid net emulator-5582 flaky
```

Run your own app (a release APK is fine): `run --apk app.apk --flow flows/add-item.yaml --server http://127.0.0.1:8080` repeats your Maestro flow on every device under network faults, puts the recording proxy in front of your backend and judges the request log ([docs/guide-your-app.md](docs/guide-your-app.md); a scenario file adds intents / adb actions per iteration). Worked example on an app that is not ours: DAVx5 (F-Droid) + a local Radicale CardDAV server, `scenarios/davx5-contacts.json`, 3 devices with airplane / nodata / slow / flaky, then again with 30 % of the answers cut: 0 violations, 12 of 12 contacts stored, none twice, so no bug found in DAVx5 ([`docs/measurements/run-app.json`](docs/measurements/run-app.json)).

Or try the bundled sample: the multi-user scenario against a server with a race condition (`BUGGY=1` in the bundled sample server), and read the verdict:

```bash
$ crewdroid run scenarios/photo-upload.json --seed 1
...
VIOLATION uploads unique(key): duplicate key="u13-1" (2 rows)
VIOLATION uploads count(acks): missing 1 of 48 expected key values
VIOLATION writes noLostUpdate(id,baseVersion): lost update: 3 writes to id="r2" all based on baseVersion=4; all but one were overwritten
FAIL: 5 violations            # exit code 1
```

Same scenario, server fixed → `OK: 3 rules, 0 violations`, exit 0. The judge rules are a JSON file, so the same check runs against your own API's export.

Read the screen as text (what to tap, by name; one line per element, `--json` for the full tree):

```bash
$ crewdroid screen emulator-5580
dev.crewdroid.demo/dev.crewdroid.demo.MainActivity 1080x2340
[0] text "Field Notes" #app_title @391,141
[2] text "Synced ✓" #sync @908,169
[3] list #list @540,1306
  [5] text "Replace filter on intake line" #note_title @579,380
...
[35] btn "New note" #fab @819,2205
$ crewdroid tap emulator-5580 '[35]'      # or --text "New note"; prints the new screen once it settled
```

## Agent interface

What an agent gets is a contract, not speed claims: JSON in, JSON out, an exit code, and the state read back after every change.


- **Every command is machine-readable**: `--json`, non-zero exit on failure, read-back after every setter, clear error before any adb call on bad input.
- **MCP server**: `crewdroid mcp` exposes `devices`, `up`, `down`, `net`, `env`, `app`, `fold`, `triage`, `screen`, `perf`, `apk`, `judge`, `hammer`, `run` over stdio — the same functions the CLI calls, no second implementation.
- **Skills** in [`.agents/skills/`](.agents/skills/) (read by Claude Code, Cursor, Gemini CLI, Copilot, Codex): `crewdroid`, `android-triage`, `android-screen`, `android-permissions-intents`, `android-apk`, `android-perf`, `android-offline-concurrency`. Each is a short recipe of exact commands whose output the agent can act on.
- **`AGENTS.md`** with the rules an agent must keep (adb only against `emulator-<port>`, one run at a time, never a barrier) and **`CLAUDE.md`** for Claude Code.
- **Safe on a shared machine**: a USB phone plugged into the same PC is never touched; clones are read-only; `down` kills only `crew-*`.

```json
{ "mcpServers": { "crewdroid": { "command": "npx", "args": ["-y", "crewdroid", "mcp"] } } }
```

```bash
claude plugin marketplace add namyunsu/crewdroid && claude plugin install crewdroid@crewdroid
```

Cursor: [install the MCP server](cursor://anysphere.cursor-deeplink/mcp/install?name=crewdroid&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNyZXdkcm9pZCIsIm1jcCJdfQ==) · Codex / Gemini CLI / Copilot: the skills and `AGENTS.md` are picked up from the repo.

## What it finds

| Bug class | How crewdroid reproduces it | Rule that catches it |
|---|---|---|
| Duplicate upload after a retry (missing idempotency) | `flaky` network drops the response, the app's outbox retries with the same key | `unique(key)` |
| Dropped record (outbox lost on restart / airplane mode) | `airplane` during save, app restart offline, reconnect | `count(acks)` |
| Lost update (two users edit the same row, last write wins) | devices read the same version at different times and both PUT | `noLostUpdate(id,baseVersion)` |
| Fold during upload | `fold` / `unfold` while the outbox drains: the app must survive the configuration change with exactly one upload | `unique` + `count` |
| Crash / ANR only on one Android version or screen | mixed API 31/34/36 and S/Fold/Flip profiles in one run; `triage` reads the crash buffer, ANRs and exit reasons | — |

On your app: [docs/guide-your-app.md](docs/guide-your-app.md) (`run --apk --flow --server`, proxy log rules `dupSuccess` / `lostUpdate` / `lostWrite`). On DAVx5 with 30 % of the answers cut, each committed-but-unanswered `PUT` was resent with `If-None-Match: *`, got `412` and made no second copy: 0 violations, 12 of 12 contacts ([`docs/measurements/run-app.json`](docs/measurements/run-app.json)).

The bundled sample app (Kotlin, offline outbox, `probe-app/`) and sample server (`sample/server/`, `BUGGY=1` switch) make every row above reproducible on a laptop.

## Limits: when to use a real phone

crewdroid runs Google's `google_atd` images (chosen for lightness). Measured on fresh devices, API 31 / 34 / 36 ([`docs/measurements/atd-limits.md`](docs/measurements/atd-limits.md), re-check: `node scripts/check-atd-limits.mjs`):

| Missing on the image | What breaks because of it | Instead |
|---|---|---|
| A Google account and any screen to add one: 0 accounts, `ADD_ACCOUNT_SETTINGS` resolves to nothing; Play services itself is there (prebuilt GmsCore 22.50 / 23.18 / 25.08) ([measured](docs/measurements/atd-limits.md)) | "Sign in with Google" and anything that needs a signed-in Google account; FCM push was not tested here | a real phone |
| The Play Store: `com.android.vending` is only `/product/app/LicenseChecker` 1.8, `market://` resolves to nothing ([measured](docs/measurements/atd-limits.md)) | Play Billing, in-app updates, store links, installing from Play | a real phone |
| Chrome: `com.android.chrome` not installed; `VIEW https://` goes to a stub browser (`fakesystemapp`), on API 36 to a chooser with the WebView shell ([measured](docs/measurements/atd-limits.md)) | Custom Tabs and browser links, browser-based OAuth redirects back into the app | the app's own WebView: the system WebView (91 / 113 / 133) rendered a local page on all three APIs ([measured](docs/measurements/atd-limits.md)); else a real phone |
| A camera app on API 31 and 34: `IMAGE_CAPTURE` resolves to nothing (API 36 has `com.android.camera2`) ([measured](docs/measurements/atd-limits.md)) | camera-intent photo pickers ("take a photo" buttons) | `adb push` a picture, then the app's own picker; the system photo picker (`PICK_IMAGES`) resolves on API 34 and 36, not on 31 ([measured](docs/measurements/atd-limits.md)). A real camera: a real phone |
| A launcher: `MAIN/HOME` is an empty stub (`fakesystemapp` `EmptyHomeActivity`) on all three APIs ([measured](docs/measurements/atd-limits.md)) | home-screen widgets, shortcuts, launcher badges | a real phone |

## Requirements

- Android SDK with command-line tools and emulator >= 36.4 (`ANDROID_SDK_ROOT` or `ANDROID_HOME` must point at it, or `~/.crewdroid/android-sdk` must exist). No SDK yet: `npx crewdroid setup --yes` installs JDK 17 (for sdkmanager only), command-line tools, platform-tools, emulator and the `google_atd` image (`--images 34,31,36`, `--dry-run` lists sizes first); crewdroid downloads the `google_atd` images it needs for the host CPU (x86_64, or arm64-v8a on Apple Silicon / ARM Linux; API 31/34/36, ~0.9 GB each) and shrinks them with `slim`
- Node >= 22
- From a git checkout instead of npm: run `npm ci && npm run prepack` once. It builds the on-device helper APK (JDK 17) that the npm package already ships; without it `screen`/`tap` fall back to `uiautomator` and `type` takes ASCII only
- Windows 10/11 x64, macOS on Apple Silicon, or Linux x64/arm64
- Hardware acceleration: WHPX (Windows), Hypervisor.framework (macOS) or KVM (Linux, `/dev/kvm`); `setup` reports `emulator -accel-check`
- Image limits (`google_atd`, chosen for lightness): see [Limits](#limits-when-to-use-a-real-phone); also no Messages or Dialer (SMS and calls change telephony state only) and no GPU (frame numbers compare runs, not phones). Supported despite the image: any Unicode text input incl. Korean (on-device helper), and the API 31 black-screen-after-relaunch is detected and recovered (`blackRelaunch`)
- macOS/Linux: `slim` skips the NTFS sparse/compress steps (snapshot zero-fill and stale-overlay cleanup still run); RAM figures are process RSS (shared pages not split)

## Commands

Every command takes `--json` and exits non-zero on failure.

| Command | What it does |
|---|---|
| `crewdroid up --count N [--profiles a,b] [--screen WxH[@dpi],...] [--profiles-file f.json]` | boot N emulators with Galaxy profiles or your own screens (any size, e.g. `--screen 3840x2160@320`) |
| `crewdroid up [--cores 1\|2\|4\|6\|8] [--ram 896..8192]` | pick the guest CPU count and RAM like a real device spec (also `cores`/`ramMB` in a profile, e.g. `a16-lowend`); default 2 cores / 896 MB; a new spec builds its own base snapshot on first use (`docs/measurements/spec.md`) |
| `crewdroid up [--count N] --wifi` | each device can get its own Wi-Fi address; measured on Windows: 31 of 33 device boots got Wi-Fi from `net wifi`, the 2 misses were API 34 clones (wlan0 never associated), so `net wifi` asks for the access point again after 30 s (`docs/adr/0009-wifi.md`) (adds `-feature -WiFiPacketStream` to the clones, +9.4 % idle RAM; MCP `up` input `wifi: true`). Without it Wi-Fi gets an address on one device at a time. Each clone then sits on its own Wi-Fi network: clones cannot reach each other over Wi-Fi and wlan0 addresses can repeat. Untested on macOS and Linux (`docs/adr/0009-wifi.md`) |
| `crewdroid down` | kill every `crew-*` emulator |
| `crewdroid net <serial> airplane\|nodata\|slow\|flaky\|online` | set one device's network state |
| `crewdroid net <serial> wifi\|cellular\|both\|none` | which link is up: the emulator's "AndroidWifi" access point, mobile data, both, neither; `slow` and `flaky` then act on the chosen link. Every `net` call returns the transport apps see (`default: wifi\|cellular\|none`, `metered`). By default Wi-Fi gets an address on one device at a time; with `up --wifi` each device can (31 of 33 measured device boots), at +9.4 % idle RAM (`docs/adr/0009-wifi.md`) |
| `crewdroid net <serial> handover [--to wifi\|cellular] [--during <ms>]` | move the default network to the other link while the app keeps running; `--during` = ms with no link in between (default 0: new link first) |
| `crewdroid net <serial> metered on\|off` | mark the Wi-Fi network metered, so apps that sync only on unmetered networks hold back |
| `crewdroid fold <serial>` / `unfold <serial>` | cover <-> main screen on a Fold/Flip profile |
| `crewdroid run --apk <app.apk> --flow <flow.yaml> --server <url>` \| `run <scenario.json> [--seed N]` | run a multi-device scenario on any APK (Maestro flow / intent / adb actions, network faults), then judge the proxy log or the server data ([guide](docs/guide-your-app.md)) |
| `crewdroid judge --rules <file> --source <url\|file>` | check unique / count / noLostUpdate rules |
| `crewdroid hammer --url <base>` | server-side concurrency load without devices |
| `crewdroid slim` / `prepare` / `identity` | shrink disk, build base AVDs, make devices distinct |
| `crewdroid measure --up N` | measure disk, RAM, boot, idle CPU |
| `crewdroid triage` / `screen` / `perf` / `apk` | Android diagnostics, see below |
| `crewdroid env <serial> <what> [args]` | device environment: location, battery, rotation, dark, font, locale, mobile network, SMS, calls (see Environment) |
| `crewdroid app <serial> <pkg> <what> [args]` | app control: permissions, deep links / App Links, data clear, backup / restore, resource pressure (see App control) |
| `crewdroid shot` / `tap` / `type` / `swipe` / `key` | screenshot and input without mobile-mcp (see Screenshots and input) |
| `crewdroid mcp` | stdio MCP server exposing the above to an agent |

## Screenshots and input

| Command | What it does |
|---|---|
| `crewdroid shot <serial> [file.png]` | `exec-out screencap -p` to `file.png` (default `./crewdroid-<serial>-<yyyymmdd-HHMMSS>.png`); prints path, width x height and `blackRelaunch` (API 31 black screen recovered first, as in `screen`). The MCP tool returns the PNG as image content plus one text line. |
| `crewdroid tap <serial> <x> <y>` \| `'[n]'` \| `--text <T>` \| `--id <resource-id>` `[--index N]` | `input tap` at a point, at line `[n]` of the last `screen` outline (no new tree read while the same window has focus), or at the centre of the element whose text / content-desc or resource-id (full or the part after `:id/`) matches: exact first, then case-insensitive contains. No match, or several without `--index` (0-based), exits 1 with the candidates (text, id, bounds). |
| `crewdroid type <serial> <text> [--into <text\|id>]` | appends the text to the focused field through the on-device helper (any Unicode, e.g. Korean); `--into` taps the field first. Without the helper: `input text`, ASCII only, see below. |
| `crewdroid swipe <serial> up\|down\|left\|right [--times N]` \| `swipe <serial> x1 y1 x2 y2 [ms]` | finger direction over the middle 50 % of the current screen (`up` scrolls the content down). |
| `crewdroid key <serial> back\|home\|enter\|delete\|tab\|menu\|KEYCODE_*` | `input keyevent`; prints the focused window afterwards. |

`tap`, `type`, `swipe` and `key` then print the new screen outline (as `screen`), read once the tree is unchanged for 150 ms (1 s at most), so an agent needs no separate observe call; `--no-screen` (MCP `screen:false`) skips it, `--json` (MCP `format:"json"`) returns the result object with the outline as `screen`.

`screen`, `tap`, `type`, `swipe` and `key` go through a small on-device helper that `up` starts on every device (instrumentation APK `dev.crewdroid.agent`, reached over `adb forward` on 127.0.0.1; `docs/adr/0007-agent-helper.md`): a tree read takes tens of milliseconds instead of a `uiautomator dump`. Each result says `via: "helper"` or `via: "fallback"` (helper not answering: the old `uiautomator` / `input` path, then the helper is restarted). Points outside the screen exit 1 before anything is sent. Without the helper, non-ASCII text (e.g. Korean) is not typed: `type` exits 1 with the reason. `input text` only types characters in the device key map, ATD has no shell command that sets the clipboard for a paste (`cmd clipboard` has no implementation), and crewdroid does not install a keyboard app; pass such text through your app (intent extra, test hook) or install an IME such as ADBKeyboard yourself. The probe app has a form for these: `--es check form` (field id `name`, button `Send` -> `CrewProbe FORM <text>`, a 3-screen scroll whose bottom `END` logs `CrewProbe SCROLL END`). `node scripts/check-input.mjs` runs all of it on an API 34 and an API 36 device.

## Diagnostics

Read-only commands (nothing stays running on the device). Each takes `--json`; the same four are MCP tools.

| Command | Output |
|---|---|
| `crewdroid triage <serial> [--app <pkg>] [--heap out.hprof]` | `crashes` (logcat crash buffer: pkg, exception, top frame in the app, time), `anrs` (ActivityManager log + `dumpsys activity exit-info`), `anrTraces` (`/data/anr` headers, or `"unreadable"` without root), `exits` (exit reasons), `recentLog` (the app's last 200 lines), `summary`. `--heap` runs `am dumpheap` and pulls the hprof. |
| `crewdroid screen <serial> [--png file] [--bounds]` | focused window (`dumpsys window`) and screen size, then one line per visible element of the accessibility tree from the on-device helper (`uiautomator` as fallback): `[n] role "text" #id @x,y flags` (role btn / edit / text / img / list / check; a clickable card is one line with its texts; R8-obfuscated ids left out; `@x,y` = centre, `--bounds` adds `[l,t,r,b]`; flags `focused` / `checked` / `disabled`; `… N more below (swipe up)` for off-screen nodes). `--json` (MCP `format:"json"`) = the full tree `[{cls, text, desc, id, bounds, clickable, depth, editable?, scrollable?, checked?, focused?, disabled?}]`. Compose `testTag` shows as `id` only under `testTagsAsResourceId = true`. On API 31 a fully black screen left by an app relaunch (Android 12 emulator bug, any tool's `am start -S`) is recovered first (HOME + resume) and reported as `blackRelaunch`, so it is never mistaken for an app bug. |
| `crewdroid perf <serial> <pkg> [--activity .Main] [-- <am start extras>]` | cold start (`am force-stop`, 2 s, `am start -W`; TotalTime ms), frames / jank % / p50-p90-p99 from `dumpsys gfxinfo`, PSS total / Java / native KB from `dumpsys meminfo`. ATD images have no GPU: compare frame numbers between runs, not with a phone. |
| `crewdroid apk <file.apk>` | host only (`aapt2` from the newest `build-tools`): package, version, min/target SDK, permissions, exported activities, deep-link filters. |

The probe app has targets for these: `adb -s emulator-5580 shell am start -n dev.crewdroid.probe/.ProbeActivity --es check crash|anr|jank` (`anr`: tap the button, then tap again within 10 s). `node scripts/check-triage.mjs` runs all four on one API 34 device.

## Environment

`crewdroid env <serial> <what> [args] [--json]`. Every setter reads the state back and exits 1 with a message when it differs; bad values (`battery 150`, `rotate 9`, a serial that is not `emulator-<port>`) exit 1 before any adb call. Also an MCP tool (`env`).

| What | Meaning |
|---|---|
| `geo <lon> <lat> [alt]` | GPS fix (longitude first) and location switched on. Android only receives a fix while an app requests location, so the setter cannot fail on a mismatch: it only checks that location is on and reports the last fix Android saw (`androidLastFix`, `delivered`). The fix is confirmed only by the probe's `ENV loc=` line (`check=env`) |
| `battery <0-100> [ac|unplugged]` | level, and charger on or off |
| `rotate <0-3>` | auto-rotate off, fixed rotation |
| `sensor acceleration x:y:z` | accelerometer value |
| `dark on|off` / `font <scale>` | night mode / font scale (0.5 to 3) |
| `locale <pkg> <tags>` | per-app locale, e.g. `locale dev.crewdroid.probe ko-KR,en`; API 33+ only (no shell command for the device-wide locale) |
| `gsm data home|roaming|searching|denied|off|on` | mobile network registration |
| `gsm signal <0-31> [--hold <sec>]` | signal strength; the console keeps it 15 s, `--hold` re-sends every 10 s. No read-back exists (console ack only) |
| `sms <from> <text>` / `call <number> [accept|cancel]` | incoming SMS (read back from the guest's SMS handler) / incoming call, answer, hang up (read back from the telephony registry) |
| `show` | every state above, read back from the device |

`rotate` also runs `wm fixed-to-user-rotation enabled`: without it, on the API 36 image WindowManager restored the previous rotation (`revertOverride`) at the next app launch. `rotate` and `show` read the lock back from settings and WindowManager. `gsm signal` is confirmed only by the console's OK (no read-back exists). Negative numbers work (`env emulator-5580 geo -122.084 37.422`). ATD has no Messages or Dialer app: SMS and calls change telephony state and broadcasts only. The probe app logs what it sees: `am start -n dev.crewdroid.probe/.ProbeActivity --es check env` -> `CrewProbe ENV dark=<bool> font=<scale> rot=<n> battery=<pct> loc=<lat>,<lon>|none` (`loc` needs the location permission: `pm grant`). `node scripts/check-env.mjs` runs all of it on 2 devices.

## App control

`crewdroid app <serial> <pkg> <what> [args] [--json]`. Setters read the state back and exit 1 with a message when it differs; bad names, buckets or sizes exit 1 before any adb call. Also an MCP tool (`app`).

| What | Meaning |
|---|---|
| `perm grant|revoke <perm…>` / `perm show [perm…]` | `pm grant/revoke` (`CAMERA` or `android.permission.CAMERA`); `show` parses the runtime permissions of `dumpsys package` into `{name, granted}` |
| `open <uri> [--pkg]` | `am start -a VIEW -c BROWSABLE -d <uri>` (`--pkg`: only this package). Nothing can handle it -> exit 1 `No Activity found` (ATD has no Chrome). A running app only gets its task brought to the front and never sees the uri: the result says `delivered: false`; force-stop it first |
| `links show` / `links force <domain>` / `links reset` | App Links (API 31+): `pm get-app-links`; `set-app-links --package <pkg> 2 <domain>` (approved without internet); `... 0 all` |
| `clear` | `pm clear`; read back with `run-as` (debuggable apps), else only pm's `Success` |
| `backup` / `restore` | `bmgr` with `com.android.localtransport/.LocalTransport` (present on the API 34 and 36 images; absent -> exit 1 with that reason). `backup` of an app with no data is rejected by the transport. `restore` uses the newest set |
| `pressure doze` / `standby <active|working_set|frequent|rare|restricted>` / `bg-restrict` / `battery-saver` | `deviceidle force-idle` (unplugs the fake battery first); `am set-standby-bucket`; `appops RUN_ANY_IN_BACKGROUND ignore`; `settings put global low_power 1` |
| `pressure trim <level>` | `am send-trim-memory` (HIDDEN ... COMPLETE). No read-back on the device: only am's ack. A background level to a foreground process, or a process that is not running, is an error. The probe logs `CrewProbe TRIM <level>` |
| `pressure reset` | undoes doze, battery unplug, standby bucket (-> active), bg-restrict, battery-saver |
| `fill-storage <GB>` / `fill-storage free` | `fallocate` a file in `/data/local/tmp`, read back with `df -k /data`; `free` removes it. The image has about 5.8 GB free |

The probe app has the deep links `crewdroid://probe/*` and `https://probe.crewdroid.example/*` (autoVerify) and logs `CrewProbe LINK <uri>`. `node scripts/check-app.mjs` runs all of it on 2 devices.

## Used-phone load

`crewdroid load <serial> off|low|mid|high [--keep-apps] [--json]`, or `crewdroid up --load <level>` (applied after boot). Also an MCP tool (`load`, and a `load` input on `up`). Off by default: a plain `up` installs nothing of this.

A real user's phone has many apps installed, several alive in the background, little free RAM and some CPU work going on. Each level is a fixed recipe: installed filler apps (30 / 80 / 150 tiny APKs, generated once by `scripts/gen-filler-apks.mjs`; every 3rd wakes up and schedules a periodic job), background processes of the load app `dev.crewdroid.load` (5 / 15 / 30), memory ballast until MemAvailable is at 50 / 30 / 15 % of its value with load off, CPU workers at 10 / 25 / 50 % of every guest core, and AlarmManager / JobScheduler wakeups. `off` force-stops the load app (processes, ballast, alarms, jobs) and uninstalls the fillers and the load app unless `--keep-apps`. The result is the measured guest state: MemAvailable (MB, %), swap, load average, CPU busy %, running processes, installed packages.

The default 896 MB guest has only ~130 MB free at idle, so lmkd kills apps from `low` on; use `--ram 2048` or more to tell the levels apart. What each level costs (cold start, jank, low-memory kills of the app under test, host CPU/RAM) on API 34 and 36: `docs/measurements/load.md` (`node scripts/check-load.mjs`).

## Add a device profile

A profile is a screen (width x height, density) applied with `wm size` / `wm density` after boot, not a separate AVD. Add an entry to `profiles/galaxy.json`:

```json
{ "name": "s25", "model": "Galaxy S25", "width": 1080, "height": 2340, "density": 420, "minAndroid": "15", "minApi": 35 }
```

Then `crewdroid up --count 1 --profiles s25`. `minApi` picks which Android image the device lands on.

Any size without editing that file: `crewdroid up --count 2 --screen 1920x720@160,3840x2160@320` (density optional, derived for a ~360dp short side), or `--profiles-file my.json` (same schema; see `profiles/custom.example.json`). Sizes beyond the host monitor work — up to 7680x2160 tested; see `docs/measurements/size.md`.

## Safety rules

- Every adb call goes through a guard that only accepts `emulator-<port>` serials, so a USB phone on the same machine is never touched.
- Emulators run as read-only clones of one base AVD: nothing is saved back, and `down` removes only `crew-*` instances.
- One crewdroid run at a time per machine (`up`/`down` take a lock).
- The SDK path comes only from `ANDROID_SDK_ROOT` / `ANDROID_HOME`; nothing is hard-coded.

## How it stays light

Clones of one base AVD (`-read-only`), system images rewritten sparse + NTFS-compressed, quickboot RAM image zero-filled before the snapshot, `-lowram` with 896 MB guest RAM, host Vulkan off, no audio, no window. Every knob was measured one at a time: [`docs/measurements/slim.md`](docs/measurements/slim.md) (disk), [`ram.md`](docs/measurements/ram.md) (RAM), [`features.md`](docs/measurements/features.md) (each runtime feature's idle cost — none adds a daemon).

Korean docs: [README.ko.md](README.ko.md) · License: MIT

*Keywords: android emulator, headless, multi-device testing, concurrency testing, race condition, idempotency, lost update, offline-first sync, flaky network, Galaxy Fold Flip profiles, MCP server, AI agent, Claude Code plugin, agent skills, mobile QA automation.*
