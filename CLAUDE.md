@AGENTS.md

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
- `node scripts/check-triage.mjs` (3 mixed devices idle row + 1 device checks) -> `OK: triage, screen, perf and apk claims hold`
- `node scripts/check-skills.mjs` (1 device, runs every ```bash verify``` block) -> `OK: 7 skills hold, ...`; `node scripts/check-agent-files.mjs` -> `OK: agent files hold ...`; `node scripts/check-public.mjs` -> `OK: public-release checks passed`
- `node scripts/check-hidden.mjs` -> `OK: ... all MainWindowHandle 0`
- Maestro (`scoop install maestro`, one device): `maestro test --device emulator-5580 flows/probe-upload.yaml`; two profiles at once: `--device "emulator-5580,emulator-5582" --shard-all 2` -> `Passed: 2/2`. The flow needs the sample server on :5599 and the current probe APK installed.
- mobile-mcp (`.mcp.json`, needs `MOBILEMCP_LEGACY_ROBOT=1`): every tool takes `device: "emulator-<port>"`. `maestro mcp`: `run`/`inspect_screen`/`take_screenshot` take `device_id: "emulator-<port>"` (required; no default device).

## Directory map
- `src/` CLI (`adb.ts` guarded adb, `sdk.ts` SDK paths, `emulator.ts` hidden launcher, `scenario.ts` runner, `record.ts` side-by-side recorder, `proxy.ts` recording proxy + log rules for `judge --log`; `scripts/release-public.mjs` + `public-files.json` export the public mirror) · `scripts/check-*.mjs` Todo verifies · `docs/measurements/` measurement JSON + tables (deliverables)
- `probe-app/` Android probe/sample app · `sample/server/` sample server with `BUGGY=1` · `profiles/galaxy.json` device profiles · `flows/` Maestro YAML · `scenarios/` scenario files · `docs/demo/` demo GIF

## Domain glossary
- profile: a Galaxy screen (width x height, density) applied with `wm size/density` after boot; not a separate AVD
- clone: a `-read-only` instance of one base AVD (disk shared, no snapshot save)
- judge: rules run on server data after a run (unique / count / noLostUpdate)
- barrier: "press at the same moment" sync — rejected by the user, never add one

## Gotchas
- A USB phone is plugged in. Every adb call goes through `src/adb.ts` and must target `emulator-<port>`; mobile-mcp / Maestro device lists may show the phone — always pass an emulator serial.
- Ports: crewdroid 5580+; user 5554+; 5570+ reserved for other suites.
- ATD images have no Chrome/gallery/launcher, and no camera app on API 31 and 34 (API 36 has `com.android.camera2`, `docs/measurements/atd-limits.md`); see `docs/adr/0003-image.md` once T02 writes it.
- API 31 ATD: `am start -S` (or force-stop then start at once) usually leaves the whole screen black (SF keeps the new Task hidden); SurfaceView itself renders. Use force-stop, 2 s, start. No flag fixes it; `up` prints a WARN (`docs/adr/0005-api31-surfaceview.md`).
- Long-running emulators drift to ~5 host cores each: measure on fresh boots.
- Emulator host address from the device: `10.0.2.2`.
- One crewdroid run at a time: `down()` kills every `crew-*` instance, so two sessions on one checkout kill each other's clones ("device offline"). `up`/`down`/`slim`/`prepare` take `%TEMP%\crewdroid-emulators.lock` (owner PID); to hold it across a chain of commands, `export CREWDROID_OWNER=$(cat /proc/$$/winpid)` first.
- Emulators held by another process (lock owner alive, not you): write `.ai-log/BUSY` (one line: pid, what) and stop; autopilot waits 20 min. Never kill the other run.
- Never push to the `public` remote (the public mirror); only the user runs the `git push` line that `scripts/release-public.mjs` prints. A new doc/ADR linked from README must be in `public-files.json` and free of `.ai-log` paths.
- Proxy default port 5590+ sits next to emulator ports (5580+): `up --count` of 6+ could collide.
- New runtime features must not change launch flags / AVD config / `KNOBS`; log 3-device idle RAM+CPU before/after in `docs/measurements/features.md`.

## Conventions
- Every command supports `--json` and exits non-zero on failure. No hard-coded SDK paths (use `src/sdk.ts`).
- Kill emulators you started before a Todo ends.

## Deploy
None. Push `ai/work`; autopilot merges to `main`.
