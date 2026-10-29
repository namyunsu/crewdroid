# Contributing to crewdroid

crewdroid boots several headless Android emulators with different Galaxy screens and Android versions, sets a network state per device, and judges the server's data for duplicate, missing and overwritten records.
It works with Maestro and mobile-mcp: they drive the app, crewdroid makes the conditions and judges the result.

## Set up

You need Node >= 22 and a machine with hardware acceleration (WHPX on Windows, Hypervisor.framework on macOS, KVM on Linux).

```bash
git clone https://github.com/namyunsu/crewdroid.git
cd crewdroid
npm ci
npx crewdroid setup --yes        # Android SDK, emulator and system images, if you have none (--dry-run lists sizes first)
npm test                         # success line: "# fail 0"
```

Run the CLI from source with `npx tsx src/cli.ts <command>`.

## Checks

`npm test` runs the unit tests. It needs no emulator and runs in seconds.

The `scripts/check-*.mjs` files are end-to-end checks. Each prints one `OK:` line on success.
- No emulator: `check-public.mjs`, `check-repo-polish.mjs`, `check-ci.mjs`, `check-agent-files.mjs`, `check-judge.mjs`.
- Boot emulators (minutes, several GB of RAM): `check-up.mjs`, `check-net.mjs`, `check-env.mjs`, `check-triage.mjs`, `check-scenario.mjs`, `check-vibe-loop.mjs` and most of the others.

Say in your pull request which ones you ran. If you cannot run the emulator checks, say so; a maintainer will run them.

## Rules

These keep the tool safe to run on a machine that has a real phone plugged in.
- Use `adb` only against `emulator-<port>`, and only through `src/adb.ts`. Never a bare `adb`, never a phone serial.
- One crewdroid run at a time. `down` kills every `crew-*` emulator, so a second run on the same checkout breaks the first.
- No barrier ("press at the same moment" sync). It was considered and rejected.
- Emulators are read-only clones of one base AVD. Do not modify or delete base AVDs.
- A new feature must not change launch flags, AVD config or `KNOBS`.
- No hard-coded SDK paths; use `src/sdk.ts`.
- Measure before you claim. A number in the README or docs comes from a run you can repeat (see `docs/measurements/`).
- Every command takes `--json` and exits non-zero on failure.

## Commits and pull requests

- One logical change per commit. Subject in the imperative, under about 70 characters: "Fix up on GPU-less Linux", not "Fixed" or "Fixes".
- Say what changed and why in the body. The diff already shows how.
- Pull request: fill in the template (what, why, which checks ran).

## Good first issues

- Docs: a clearer error message, a typo, a missing example.
- New `judge` rules or new cases for the existing ones (`src/judge.ts`, `test/`).
- More Galaxy profiles in `profiles/galaxy.json`.
- Anything in the "works with my app" reports: try crewdroid on your app and tell us what was missing.

Questions and ideas: open an issue.
