---
name: crewdroid
description: Test an Android app on several emulated Galaxy devices at once with flaky or offline network, and find duplicate / lost / overwritten records on the server. Use when a bug appears only with multiple users, a sync or upload creates duplicates, an update is lost, or the app must be checked on different screen sizes and Android versions.
license: MIT
---
<!-- Format: https://code.claude.com/docs/en/skills ; .agents/skills is the cross-agent path (docs/source/research-ai-discoverability.md section 3). -->
# crewdroid

N headless emulators (mixed Galaxy screens and Android versions), per-device network states, then rules run on server data after the run.

## When to use
- "Two users upload at once and a row is duplicated / missing."
- "Offline sync lost an update."
- "Works on my phone, breaks on another screen size or API level."

Not for poking a single device's UI: use mobile-mcp or Maestro directly (always pass an `emulator-<port>` serial).

## First 5 commands
```bash
crewdroid up --count 3 --json                        # boot 3 mixed devices
crewdroid net emulator-5580 flaky --json             # airplane | nodata | slow | flaky | online
crewdroid run scenarios/photo-upload.json --seed 1 --server-port 5595 --json
crewdroid judge --rules <rules.json> --source <url|file> --json   # re-judge server data
crewdroid down --json                                # always, when finished
```
In a checkout without the package installed, replace `crewdroid` with `npx tsx src/cli.ts`.

## Rules
- adb only on `emulator-<port>`; one run at a time; never add a "press at the same moment" barrier.
- Read `AGENTS.md` for the full command table (some commands are marked planned).
- Measurements: `docs/measurements/`.

## More skills
- [android-triage](../android-triage/SKILL.md): crash, ANR, app killed.
- [android-screen](../android-screen/SKILL.md): blank / wrong screen, element not found.
- [android-permissions-intents](../android-permissions-intents/SKILL.md): permission denied, deep link does not open.
- [android-apk](../android-apk/SKILL.md): install fails, what is in / on the device.
- [android-perf](../android-perf/SKILL.md): slow start, jank, memory.
- [android-offline-concurrency](../android-offline-concurrency/SKILL.md): offline sync duplicates / lost updates.
