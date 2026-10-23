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

- [ ] T06 [KO] mobile-mcp · Maestro 연결
  area: .mcp.json, flows/, scripts/check-mcp.mjs, CLAUDE.md (Commands)
  model: sonnet
  review: required
  accept: Install Maestro CLI (approved) and add project `.mcp.json` with mobile-mcp (`npx -y @mobilenext/mobile-mcp@<pinned>`) and `maestro mcp`. `scripts/check-mcp.mjs` starts mobile-mcp over stdio as an MCP client, lists devices and confirms the crewdroid serials appear, then takes one accessibility snapshot of the probe app on a chosen emulator serial. `flows/probe-upload.yaml` (Maestro) opens the probe app, triggers an upload and asserts the success text; it runs with `maestro test --device "<s1>,<s2>" --shard-all 2` on two different profiles. Document in CLAUDE.md how to target one device in each tool and that a USB phone may appear in their device lists — always pass an `emulator-*` serial. Record how `maestro mcp`'s `run` picks a device.
  verify: `npx tsx src/cli.ts up --count 2 && node scripts/check-mcp.mjs && npx tsx src/cli.ts down`

- [ ] T09 [KO] 샘플 앱 오프라인 저장·동기화 시나리오
  area: probe-app/ (rename the user-facing part to "sample app" inside the same module), scripts/check-offline.mjs
  model: opus
  review: required
  accept: The app keeps an outbox (Room or files) of photos/edits: actions while offline are saved locally and sent when the network returns (idempotency key per action, retry with backoff); an upload cut mid-transfer is retried; the app restarted while offline (`am force-stop` + relaunch) keeps its outbox and syncs later; two devices edit the same record while one is offline and the server's response (409 in clean mode) is surfaced in logcat `CrewProbe CONFLICT <id>`. All triggers are adb broadcasts so scripts and Maestro can drive them.
  verify: `node scripts/check-offline.mjs` (2 mixed devices: offline save -> restart offline -> online -> server has exactly the expected rows; concurrent edit -> one CONFLICT line)

- [ ] T10 [KO] 다자 현장 시나리오 실행기 (혼합 N대 + 네트워크 섞기 + 판정)
  area: src/scenario.ts, scenarios/photo-upload.json, src/cli.ts, scripts/check-scenario.mjs, docs/measurements/scenario.md
  model: opus
  review: required
  accept: `crewdroid run scenarios/photo-upload.json [--seed]` = up N mixed devices (default 3) -> install sample app -> each device repeats the flow R times with its own random delays while the scenario applies network states per device (airplane, nodata, slow, flaky; schedules differ per device) -> wait for outboxes to drain (timeout) -> `judge` -> `down`. Writes a run report (devices with profile/API, network timeline per device, judge result, wall time, peak host CPU/RAM). Against `BUGGY=1` it reports at least one violation in >= 2 of 3 seeds; against the clean server 3 of 3 pass. Summary table in `docs/measurements/scenario.md`.
  verify: `node scripts/check-scenario.mjs`

- [ ] T11 [KO] MVP — private-app techs.multi.ts 를 crewdroid 기동으로 통과 + 전후 비교 + 데모 GIF
  area: src/integrations/private-app.ts, scripts/mvp-private-app.mjs, docs/measurements/mvp.md, docs/demo/
  model: opus
  review: required
  accept: Without editing private-app: `crewdroid up --count 3 --base-port 5570` (image per ADR 0003; private-app needs the emulated back camera and WebRTC — use `-gpu host -camera-back emulated` when the image allows; mix profiles, and Android versions the APK's minSdk allows) so `avd-up.ps1` sees emulator-5570/5572/5574 already booted and only installs the APK; then `npm run e2e:multi -- --grep @techs` in `<private-app repo>/private-app-server` passes 3 runs in a row. If private-app' global-setup forces its own AVDs or the spec needs something crewdroid cannot give without editing private-app, stop BLOCKED with the exact line. `docs/measurements/mvp.md`: old path (avd-up.ps1 + old-avd-1..3) vs crewdroid for the same spec — disk, boot, RAM, CPU, spec wall time, pass count. `docs/demo/techs.gif` (<= 10 MB, ffmpeg from `adb shell screenrecord` of the 3 devices side by side).
  verify: `node scripts/mvp-private-app.mjs --runs 3`
  manual: 데모 GIF 를 열어 3대 화면이 서로 다른 기종 비율로 보이고 통화가 이어지는지 눈으로 확인

- [ ] T12 [KO] 에뮬레이터 콘솔 창이 화면에 뜨지 않게
  area: src/emulator.ts (shared launcher), src/measure.ts
  model: haiku
  review: skip
  accept: T01 launches the emulator with Node `spawn(..., { detached: true, windowsHide: true })`; on Windows the grandchild `qemu-system-x86_64-headless.exe` still opens a visible console window (user saw it 2026-10-23). Move emulator launch into one shared function used by every command (measure/up/prepare/identity) that starts it hidden the way private-app avd-up.ps1 does (`powershell Start-Process -WindowStyle Hidden`, or an equivalent that hides grandchildren) and still returns/locates the PID for kill. No visible window while any crewdroid command runs.
  verify: `node scripts/check-hidden.mjs` (starts one crewdroid emulator, lists processes named emulator*/qemu* and asserts every one has MainWindowHandle 0 via `Get-Process`, then kills it)
