# crewdroid

Lightweight multi-user Android field lab on top of Google's emulator: N headless emulators with mixed Galaxy profiles and Android versions, per-device network states, then server-data judging for concurrency bugs (duplicate / missing / overwrite). Requirements: `docs/prd.md` (Korean). Todos: `docs/todo.md`.

## Stack
Node 24 + TypeScript CLI (run with `tsx`, tests with `node --test`). Sample server: `node:http`. Probe/sample app: Kotlin, JDK 17, Gradle. AI control: mobile-mcp, Maestro.

## Commands
(filled in by T01+; each with the line that means success)
- `npm test` -> `# fail 0`
- `npx tsx src/cli.ts <cmd> --json`
- `node scripts/check-mcp.mjs` (after `up --count 2`) -> `OK: mobile-mcp and maestro mcp reach the crewdroid emulators`
- `node scripts/check-offline.mjs [--server-port N]` (boots its own 2 emulators) -> `OK: offline outbox claims hold`
- `npx tsx src/cli.ts run scenarios/photo-upload.json [--seed N --server-port 5595]` / `node scripts/check-scenario.mjs` (boots 3 emulators x6 runs, ~12 min) -> `OK: scenario runs catch BUGGY and pass clean`
- `node scripts/mvp-private-app.mjs --runs 3` (private-app @techs on crewdroid devices, base-port 5570, ~10 min) -> `OK: private-app @techs passed 3/3 on crewdroid devices`
- `node scripts/check-hidden.mjs` -> `OK: ... all MainWindowHandle 0`
- Maestro (`scoop install maestro`, one device): `maestro test --device emulator-5580 flows/probe-upload.yaml`; two profiles at once: `--device "emulator-5580,emulator-5582" --shard-all 2` -> `Passed: 2/2`. The flow needs the sample server on :5599 and the current probe APK installed.
- mobile-mcp (`.mcp.json`, needs `MOBILEMCP_LEGACY_ROBOT=1`): every tool takes `device: "emulator-<port>"`. `maestro mcp`: `run`/`inspect_screen`/`take_screenshot` take `device_id: "emulator-<port>"` (required; no default device).

## Directory map
- `src/` CLI (`adb.ts` guarded adb, `sdk.ts` SDK paths, `emulator.ts` hidden launcher, `scenario.ts` runner, `integrations/private-app.ts`) · `scripts/check-*.mjs` Todo verifies · `docs/measurements/` measurement JSON + tables (deliverables)
- `probe-app/` Android probe/sample app · `sample/server/` sample server with `BUGGY=1` · `profiles/galaxy.json` device profiles · `flows/` Maestro YAML · `scenarios/` scenario files · `docs/demo/` demo GIF

## Domain glossary
- profile: a Galaxy screen (width x height, density) applied with `wm size/density` after boot; not a separate AVD
- clone: a `-read-only` instance of one base AVD (disk shared, no snapshot save)
- judge: rules run on server data after a run (unique / count / noLostUpdate)
- barrier: "press at the same moment" sync — rejected by the user, never add one

## Gotchas
- A USB phone is plugged in. Every adb call goes through `src/adb.ts` and must target `emulator-<port>`; mobile-mcp / Maestro device lists may show the phone — always pass an emulator serial.
- `old-avd-1..3` (private-app) must not change: launch only with `-read-only`, never delete. Do not edit `<private-app repo>`.
- Ports: crewdroid 5580+; user 5554+; private-app 5570+ (T11 only).
- ATD images have no Chrome/camera app/gallery/launcher; see `docs/adr/0003-image.md` once T02 writes it.
- Long-running emulators drift to ~5 host cores each (private-app T21): measure on fresh boots.
- Emulator host address from the device: `10.0.2.2`.
- One crewdroid run at a time: `down()` kills every `crew-*` instance, so two sessions on one checkout kill each other's clones ("device offline"). `up`/`down`/`slim`/`prepare` take `%TEMP%\crewdroid-emulators.lock` (owner PID); to hold it across a chain of commands, `export CREWDROID_OWNER=$(cat /proc/$$/winpid)` first.

## Conventions
- Every command supports `--json` and exits non-zero on failure. No hard-coded SDK paths (use `src/sdk.ts`).
- Kill emulators you started before a Todo ends.

## Deploy
None. Push `ai/work`; autopilot merges to `main`.
