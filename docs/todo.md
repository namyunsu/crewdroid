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

Wave 2026-10-23 autopilot /brief auto (plan 1).

- [ ] T13 [AUTO] Demo GIF shows all 3 devices live (FR-11 follow-up to T11)
  origin: auto-plan (docs/demo/techs.gif frames checked 2026-10-23: left panel API 32 is black for the whole run, right panel API 36 stays frozen on the `screenrecord --bugreport` intro text; only the middle panel shows the app)
  area: src/integrations/private-app.ts (recording), scripts/mvp-private-app.mjs (GIF build), scripts/check-demo-gif.mjs (new), docs/demo/techs.gif, docs/measurements/mvp.*
  model: sonnet
  review: required
  accept: Find why 2 of 3 `screenrecord` captures show no app frames (e.g. recording starts before the app is foreground, screenrecord emits frames only on change, `wm size` vs recorder size, per-API screenrecord behaviour) and fix the capture so every panel shows the private-app app during the call. `mvp-private-app.mjs` writes each panel's x-range and the source serial/profile/API into `mvp.json` `gif.panels`. New `scripts/check-demo-gif.mjs` reads `mvp.json` + `docs/demo/techs.gif` with ffmpeg and fails unless, for every panel, frames in the second half of the GIF are (a) not flat (luma range > 40) and (b) different from the panel's first frame; and the 3 panels' width/height ratios are pairwise different. It must exit 1 on the current GIF (left black, right frozen). Same rules as T11: private-app untouched, old-avd-1..3 not launched, `--base-port 5570` only here, all emulators killed at the end. GIF <= 10 MB.
  verify: `node scripts/mvp-private-app.mjs --runs 3 && node scripts/check-demo-gif.mjs` (runs 3 keeps the T11 pass count and table in mvp.md) -> `OK: demo GIF has 3 live panels`
  manual: GIF 를 열어 3대 모두 앱 화면과 통화 진행이 보이는지 눈으로 확인
