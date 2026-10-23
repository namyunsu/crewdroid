# Autopilot Todo

Finished Todos move to `docs/todo-archive.md`. Pushing `ai/work` deploys nothing (no workflows).

Wave 2026-10-23 human /brief KICKOFF — lightness first (user decision). Sources: `docs/source/*`, decisions in `docs/prd.md` §1 (do not re-ask).
Rules for every Todo:
- adb only through `src/adb.ts` guard: serial must match `^emulator-\d+$` (a USB phone is plugged in). Pass `-s <serial>` always; never a bare `adb shell`.
- Never modify or delete `old-avd-1..3` AVDs: launch them only with `-read-only`. Never edit `<private-app repo>` (read and run only).
- crewdroid default ports start at 5580 (user 5554~, private-app 5570~). Only T11 uses `--base-port 5570`.
- No "press at the same moment" barrier anywhere (user rejected). Overlap comes from per-device random delays + repeats + network states.
- Do not assume one phone model: any multi-device run mixes profiles and Android versions.
- Measurements are deliverables: raw JSON in `docs/measurements/*.json`, table in the matching `.md`. Kill every emulator you started before the Todo ends (`crewdroid down`).
- System image downloads approved: `google_atd` x86_64 for at most 3 API levels (each <= ~0.9GB). Anything bigger (google_apis ~1.6-1.9GB) -> BLOCKED with the reason, ask the user.
Ordering: emulator Todos run one per batch (CPU): T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T09 -> T10 -> T11. T07 -> T08 need no emulator and may share a batch with one emulator Todo.
