# crewdroid

Lightweight multi-user Android field lab on top of Google's emulator. Boots N headless emulators with mixed Galaxy profiles and Android versions, sets per-device network states, then judges server data for concurrency bugs (duplicate / missing / overwritten records).

## Install and run
```bash
npm ci                                   # Node >= 22, Android SDK + emulator >= 36.4, WHPX/KVM
npx tsx src/cli.ts up --count 3 --json   # boot 3 mixed devices (emulator-5580, 5582, ...)
npx tsx src/cli.ts run scenarios/photo-upload.json --seed 1 --server-port 5595
npx tsx src/cli.ts down                  # always stop what you started
npm test                                 # success line: "# fail 0"
```
After publishing: `npx crewdroid <cmd>`. Every command takes `--json` and exits non-zero on failure.

## Commands
| Command | What it does | Status |
|---|---|---|
| `up` | boot N emulators (`--count`, mixed profiles from `profiles/galaxy.json`) | implemented |
| `down` | kill every `crew-*` emulator | implemented |
| `net` | per-device network state: airplane / nodata / slow / flaky / online | implemented |
| `env` | location, battery, rotation, dark mode, font, locale, network, SMS/call (`env <serial> <what> [args]`) | implemented |
| `app` | permissions, deep links, data clear, backup, resource pressure | implemented |
| `fold` | fold a fold/flip profile to its cover screen (`fold <serial>`) | implemented |
| `unfold` | unfold a fold/flip profile to its main screen (`unfold <serial>`) | implemented |
| `triage` | crashes, ANRs, exit reasons, heap dump | implemented |
| `screen` | focused activity + accessibility tree | implemented |
| `perf` | start time, frame jank, memory | implemented |
| `apk` | manifest summary of an APK (host only) | implemented |
| `judge` | rules on server data: unique / count / noLostUpdate (`--rules <file> --source <url\|file>`) | implemented |
| `hammer` | N virtual users against the API | implemented |
| `run` | scenario: up, install, per-device loops + network schedule, judge, down | implemented |
| `setup` | install SDK pieces (JDK 17, cmdline-tools, platform-tools, emulator, google_atd images); `--dry-run`, `--yes` | implemented |
| `mcp` | stdio MCP server wrapping the commands above | implemented |
| `prepare`, `identity`, `slim`, `measure` | base-image maintenance and measurement | implemented |
| `help` | usage text | implemented |

## Safety rules (every agent must keep)
- adb only against `emulator-<port>`. A USB phone may be plugged in; never use a bare `adb` or the phone serial. Go through `src/adb.ts`.
- One crewdroid run at a time. `down` kills every `crew-*` instance, so a second session on the same checkout breaks the first ("device offline"). `up`/`down`/`slim`/`prepare` take `%TEMP%\crewdroid-emulators.lock`; if another live process owns it, stop and report; never kill it.
- No barrier ("press at the same moment" sync). It was rejected; do not add one.
- Emulators are clones (`-read-only`) of one base AVD; never delete or modify base AVDs.
- Do not change launch flags, AVD config or `KNOBS` in a new feature. Kill emulators you started.
- No hard-coded SDK paths; use `src/sdk.ts`.

## Where things live
- `docs/measurements/` measurement JSON and tables (disk, RAM, CPU, boot time).
- `docs/architecture.md` components and which file each agent reads.
- `docs/prd.md` requirements (Korean). `docs/todo.md` task list.
- `.agents/skills/` agent skills (`crewdroid` umbrella skill first). `.mcp.json` MCP servers.
- Emulator host address seen from the device: `10.0.2.2`.
