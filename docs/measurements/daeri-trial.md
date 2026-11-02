# Daeri trial: one app built by an agent on both sides

2026-11-02, commit `9177b02`, one 16-thread Windows PC, never both sides at once. App, server, flows, spec and prompt: [`examples/daeri/`](../../examples/daeri/). The app and its seeded server bugs were written for this trial; it is not a production app. The server's `BUGGY=1` mode has a 0.8 s gap between the "is this call taken" check and the write, and ignores idempotency keys.

## Agent, empty project to finished test

Same empty project, spec, prompt and `BUGGY=1` server on both sides. Model `claude-opus-5-5`, effort medium, no human, no skills. The job: build the app, check each feature on screen and fix what breaks, test 3 drivers against the server, stop the emulators. **One run per side.**

| | Studio default AVD + adb + mobile-mcp | crewdroid MCP |
|---|---|---|
| Time | **40 min 30 s** | **13 min 42 s** |
| Turns | 45 | 135 |
| Bringing up 3 devices | 759 s in the 3 commands that hold the boot waits | 41 s (`up --count 3`) |
| Devices | 3 x API 36 Play image | API 31, 34, 36 ATD |
| Server bugs found | 4 | 4 |
| Scored afterwards | 0 violations, 0 of 30 actions failed | 0 violations, 0 of 30 actions failed |

Scoring: both APKs ran the same Maestro flows through `crewdroid run` against the fixed server, 3 devices x 5 rounds, with network faults and `--lose-acks 0.2`. The flows use only labels from the spec.

Limits:
- One run per side, so chance is in these numbers.
- The Studio figure includes first cold boots and AVD setup. Someone who keeps an emulator running does not pay those 759 s. Without them the Studio side is about 28 min.
- Each agent chose its own path. The crewdroid agent used 135 turns to the other's 45.

## `crewdroid run`, 3 devices

s24ultra, fold5-main, flip7-main, 5 rounds, network faults, 20 % of answers lost.

| Server | Runs | Verdict | Seconds |
|---|---|---|---|
| `BUGGY=1` | 2 | both caught: `dupSuccess`, `unique(tripKey)` | 305, 329 |
| fixed | 2 | both 0 violations | 309, 308 |

- These 2 buggy runs did not show the double dispatch. One earlier run did (`lostUpdate`, `unique(callId)`). At each device's own pace, two accepts seldom land in the same 0.8 s. Both agents reproduced it by tapping on several devices almost at once.
- With Maestro's `launchApp`, the API 36 clone went `device offline`: 3 of 5 runs stopped in setup and 1 lost 3 actions on that device (the limit in [`guide-your-app.md`](../guide-your-app.md)). Opening the app with an `intent` action instead: 0 failures in 6 runs.

## What the trial changed in crewdroid

- `judge --rules judge/proxy.rules.json` failed with `ENOENT` outside this repo. It now falls back to the bundled file.
- `type --into "<label>"` failed with `2 matches` on a Material field, whose label box has the same text as its input. It now prefers the editable node.

Still open: the agent drove `tap`, `net` and `proxy` by hand and did not find `run`.
