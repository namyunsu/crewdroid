# crewdroid

A lightweight multi-user Android field lab: N headless emulators with mixed Galaxy profiles and Android versions, per-device network states, and server-data judging for concurrency bugs (duplicate / missing / overwrite), driven by an AI agent.

```bash
npx crewdroid up --count 3
```

![3 emulators running side by side](docs/demo/demo.gif)

Measured on one Windows 11 PC (Ryzen 7 5700X, 64 GB) with 3 mixed devices (API 31 / 34 / 36), against 3 stock `google_apis` AVDs:

| | stock AVDs | crewdroid |
|---|---|---|
| Disk | 24.7 GiB | 6.99 GiB |
| Host RAM | 8.45 GB | 3.93 GB |
| Boot | 31.6 s | 6.7 s |
| Idle CPU (100 % = 1 core) | 1000 % | ~600 % |

Raw numbers and method: `docs/measurements/`.

## Requirements

- Android SDK with command-line tools and emulator >= 36.4 (`ANDROID_SDK_ROOT` or `ANDROID_HOME` must point at it)
- Node >= 24
- Hardware acceleration: WHPX (Windows) or KVM (Linux)

## Commands

Every command takes `--json` and exits non-zero on failure.

| Command | What it does |
|---|---|
| `crewdroid up --count N [--profiles a,b] [--screen WxH[@dpi],...] [--profiles-file f.json]` | boot N emulators with Galaxy profiles or your own screens (any size, e.g. `--screen 3840x2160@320`) |
| `crewdroid down` | kill every `crew-*` emulator |
| `crewdroid net <serial> airplane\|nodata\|slow\|flaky\|online` | set one device's network state |
| `crewdroid run <scenario.json> [--seed N]` | run a multi-device scenario, then judge the server data |
| `crewdroid judge --rules <file> --source <url\|file>` | check unique / count / noLostUpdate rules |
| `crewdroid hammer --url <base>` | server-side concurrency load without devices |
| `crewdroid slim` / `prepare` / `identity` | shrink disk, build base AVDs, make devices distinct |
| `crewdroid measure --up N` | measure disk, RAM, boot, idle CPU |
| `crewdroid triage` / `screen` / `perf` / `apk` | Android diagnostics, see below |
| `crewdroid env <serial> <what> [args]` | device environment: location, battery, rotation, dark, font, locale, mobile network, SMS, calls (see Environment) |
| `crewdroid mcp` | stdio MCP server exposing the above to an agent |

## Diagnostics

Read-only commands (nothing stays running on the device). Each takes `--json`; the same four are MCP tools.

| Command | Output |
|---|---|
| `crewdroid triage <serial> [--app <pkg>] [--heap out.hprof]` | `crashes` (logcat crash buffer: pkg, exception, top frame in the app, time), `anrs` (ActivityManager log + `dumpsys activity exit-info`), `anrTraces` (`/data/anr` headers, or `"unreadable"` without root), `exits` (exit reasons), `recentLog` (the app's last 200 lines), `summary`. `--heap` runs `am dumpheap` and pulls the hprof. |
| `crewdroid screen <serial> [--png file]` | focused window (`dumpsys window`) and a compact `uiautomator` tree `[{cls, text, desc, id, bounds, clickable, depth}]`. Compose `testTag` shows as `id` only under `testTagsAsResourceId = true`. |
| `crewdroid perf <serial> <pkg> [--activity .Main] [-- <am start extras>]` | cold start `am start -S -W` (TotalTime ms), frames / jank % / p50-p90-p99 from `dumpsys gfxinfo`, PSS total / Java / native KB from `dumpsys meminfo`. ATD images have no GPU: compare frame numbers between runs, not with a phone. |
| `crewdroid apk <file.apk>` | host only (`aapt2` from the newest `build-tools`): package, version, min/target SDK, permissions, exported activities, deep-link filters. |

The probe app has targets for these: `adb -s emulator-5580 shell am start -n dev.crewdroid.probe/.ProbeActivity --es check crash|anr|jank` (`anr`: tap the button, then tap again within 10 s). `node scripts/check-triage.mjs` runs all four on one API 34 device.

## Environment

`crewdroid env <serial> <what> [args] [--json]`. Every setter reads the state back and exits 1 with a message when it differs; bad values (`battery 150`, `rotate 9`, a serial that is not `emulator-<port>`) exit 1 before any adb call. Also an MCP tool (`env`).

| What | Meaning |
|---|---|
| `geo <lon> <lat> [alt]` | GPS fix (longitude first) and location switched on. Android only receives a fix while an app requests location, so the read-back shows the last fix Android saw (`androidLastFix`, `delivered`), not an error |
| `battery <0-100> [ac|unplugged]` | level, and charger on or off |
| `rotate <0-3>` | auto-rotate off, fixed rotation |
| `sensor acceleration x:y:z` | accelerometer value |
| `dark on|off` / `font <scale>` | night mode / font scale (0.5 to 3) |
| `locale <pkg> <tags>` | per-app locale, e.g. `locale dev.crewdroid.probe ko-KR,en`; API 33+ only (no shell command for the device-wide locale) |
| `gsm data home|roaming|searching|denied|off|on` | mobile network registration |
| `gsm signal <0-31> [--hold <sec>]` | signal strength; the console keeps it 15 s, `--hold` re-sends every 10 s. No read-back exists (console ack only) |
| `sms <from> <text>` / `call <number> [accept|cancel]` | incoming SMS (read back from the guest's SMS handler) / incoming call, answer, hang up (read back from the telephony registry) |
| `show` | every state above, read back from the device |

On the API 36 image launching an app writes `user_rotation=1` again whatever the lock says (measured, cause unknown); `rotate` and `show` report the lock itself (settings and WindowManager). Negative numbers work (`env emulator-5580 geo -122.084 37.422`). ATD has no Messages or Dialer app: SMS and calls change telephony state and broadcasts only. The probe app logs what it sees: `am start -n dev.crewdroid.probe/.ProbeActivity --es check env` -> `CrewProbe ENV dark=<bool> font=<scale> rot=<n> battery=<pct> loc=<lat>,<lon>|none` (`loc` needs the location permission: `pm grant`). `node scripts/check-env.mjs` runs all of it on 2 devices.

## Use it from an AI agent

MCP (any client):

```json
{
  "mcpServers": {
    "crewdroid": { "command": "npx", "args": ["-y", "crewdroid", "mcp"] }
  }
}
```

Claude Code plugin:

```bash
claude plugin marketplace add namyunsu/crewdroid
claude plugin install crewdroid@crewdroid
```

Cursor: [install the MCP server](cursor://anysphere.cursor-deeplink/mcp/install?name=crewdroid&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNyZXdkcm9pZCIsIm1jcCJdfQ==)

Agents: see [AGENTS.md](AGENTS.md).

## Add a device profile

A profile is a screen (width x height, density) applied with `wm size` / `wm density` after boot, not a separate AVD. Add an entry to `profiles/galaxy.json`:

```json
{ "name": "s25", "model": "Galaxy S25", "width": 1080, "height": 2340, "density": 420, "minAndroid": "15", "minApi": 35 }
```

Then `crewdroid up --count 1 --profiles s25`. `minApi` picks which Android image the device lands on.

Any size without editing that file: `crewdroid up --count 2 --screen 1920x720@160,3840x2160@320` (density optional, derived for a ~360dp short side), or `--profiles-file my.json` (same schema; see `profiles/custom.example.json`). Sizes beyond the host monitor work; see `docs/measurements/size.md` for the largest tested.

## Safety rules

- Every adb call goes through a guard that only accepts `emulator-<port>` serials, so a USB phone on the same machine is never touched.
- Emulators run as read-only clones of one base AVD: nothing is saved back, and `down` removes only `crew-*` instances.
- One crewdroid run at a time per machine (`up`/`down` take a lock).
- The SDK path comes only from `ANDROID_SDK_ROOT` / `ANDROID_HOME`; nothing is hard-coded.

Korean docs: [README.ko.md](README.ko.md) · License: MIT
