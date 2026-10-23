# Todo archive

Finished Todos, moved here by autopilot.
- [x] T01 [KO] 스캐폴드 + 지금 AVD 3대 기준 측정
  area: package.json, tsconfig.json, src/adb.ts, src/sdk.ts, src/measure.ts, src/cli.ts, test/, docs/measurements/
  model: sonnet
  review: required
  accept: Node+TS project (`npm test` = `node --test` via tsx). `src/adb.ts` exports the guarded adb runner (throws for any serial not `emulator-<port>`, unit-tested with `emulator-5580` ok, `R3CT...`/`192.168.0.2:5555`/empty rejected). `src/sdk.ts` resolves SDK from ANDROID_SDK_ROOT/ANDROID_HOME, falling back to `C:/Users/NYS/scoop/apps/android-clt/current`. `crewdroid measure --avd old-avd-1,old-avd-2,old-avd-3 --base-port 5580 --json` boots all three at once with the same flags avd-up.ps1 uses (`-no-window -no-audio -gpu host -camera-back emulated`) plus `-read-only`, and reports per device: disk (AVD dir bytes, plus system image dir bytes once), boot seconds to `sys.boot_completed=1`, host RAM of the emulator/qemu process (MB), average host CPU % of that process over 60 s idle after boot; then kills them. Results in `docs/measurements/baseline.json` + `baseline.md` (table, PC spec, emulator version, date).
  verify: `npm test && npx tsx src/cli.ts measure --avd old-avd-1,old-avd-2,old-avd-3 --base-port 5580 --json --out docs/measurements/baseline.json && node scripts/check-measure.mjs docs/measurements/baseline.json 3`
  commit: T01: 712e861

- [x] T02 [KO] ATD 이미지에서 카메라·사진 선택·업로드 실측 (프로브 앱 + 최소 업로드 서버)
  area: probe-app/, sample/server/, src/avd.ts, scripts/check-atd.mjs, docs/adr/0003-image.md
  model: sonnet
  review: required
  accept: Download `system-images;android-34;google_atd;x86_64` via sdkmanager. `src/avd.ts` creates crewdroid AVDs (`crew-<image>`, 1080x2340, `-cores 2 -memory 2048`) with avdmanager. `probe-app/` (Kotlin, minSdk 31, package `dev.crewdroid.probe`) is driven by adb broadcasts/intents and logs one result line per check to logcat tag `CrewProbe`: `CAMERA ok|fail <reason>` (Camera2 captures one JPEG from the emulated back camera), `PICKER ok|fail` (photo picker `ACTION_PICK_IMAGES` / `ACTION_GET_CONTENT` resolves; pick an image pushed to `/sdcard/Pictures` — automate the pick with `uiautomator` or document why not), `UPLOAD ok|fail <bytes>` (multipart POST to `http://10.0.2.2:<port>/upload`). `sample/server/` is a minimal `node:http` upload receiver (grows in T07). `scripts/check-atd.mjs` boots the ATD AVD, runs all three checks, prints a table and exits 0 only when every check produced a line. Outcome + chosen image strategy (ATD for native apps / google_apis kept for what fails) in `docs/adr/0003-image.md` with the raw lines.
  verify: `node scripts/check-atd.mjs --image android-34/google_atd --port 5580`
  commit: T02: c5ef704

- [x] T03 [KO] -read-only 복제 인스턴스 고유값 실측 + 다르게 만들기
  area: src/snapshot.ts, src/identity.ts, src/cli.ts, scripts/check-identity.mjs, docs/measurements/identity.md
  model: sonnet
  review: required
  accept: `crewdroid prepare --image android-34/google_atd` boots the base AVD once (not read-only), installs the probe app, saves a clean quickboot snapshot, shuts down. `crewdroid identity --image android-34/google_atd --count 3 --json` starts 3 `-read-only` clones from that snapshot and reports per serial: `settings get secure android_id`, probe-app's own `Settings.Secure.ANDROID_ID` (per-app value), `ro.serialno`, `ro.boot.serialno`, Wi-Fi MAC, `getprop net.hostname`. Record the raw "before" table in `docs/measurements/identity.md`. If any value collides, `up` gives each instance a distinct value (e.g. `-wifi-mac-address`, `adb root` + `settings put secure android_id`, or a documented equivalent) and the "after" table shows them all distinct; a value that cannot be changed is listed with the reason and what an app should do.
  verify: `npx tsx src/cli.ts identity --image android-34/google_atd --count 3 --json --out docs/measurements/identity.json && node scripts/check-identity.mjs docs/measurements/identity.json`
  commit: T03: 9c82f75

- [x] T07 [KO] 서버 데이터 판정기 + 버그 모드 샘플 서버
  area: sample/server/, src/judge.ts, src/cli.ts, judge/sample.rules.json, test/judge.test.ts
  model: opus
  review: required
  accept: Sample server stores photos/records in a JSON file and exposes `POST /upload` (client id + idempotency key), `PUT /records/:id` (with version), `GET /export`. `BUGGY=1` reproduces real bugs: retry with the same idempotency key creates a duplicate; concurrent PUTs with stale versions silently overwrite (lost update); one race loses a write. Without `BUGGY` it dedupes by key and rejects stale versions (409). `crewdroid judge --rules <file> --source <url|file> [--json]` checks rules `unique(<field>)`, `count(<expected source>)` for missing items, `noLostUpdate(<id>,<version>)`; prints each violation with the offending rows; exit 1 on any violation. Unit tests cover each rule on fixed fixtures.
  verify: `npm test && node scripts/check-judge.mjs` (starts the server BUGGY -> seeds a known bad history -> judge exits 1 naming dup + lost update; then clean mode -> judge exits 0)
  commit: T07: 6054caf

- [x] T08 [KO] API 동시 요청 스크립트 (배리어 없음)
  area: src/hammer.ts, src/cli.ts, scripts/check-hammer.mjs
  model: sonnet
  review: required
  accept: `crewdroid hammer --url <base> --users N --repeat R [--jitter ms] [--retry-rate p] [--seed] [--rules file]` runs N virtual users in one Node process, each repeating the upload+edit flow R times with its own random delays (no shared start signal) and a configurable rate of client retries that reuse the idempotency key; prints throughput/errors, then runs `judge` with the rules and exits with judge's code. Against `BUGGY=1` with users=50 repeat=20 it finds duplicates/lost updates in >= 4 of 5 seeded runs; against the clean server 5 of 5 pass.
  verify: `node scripts/check-hammer.mjs`
  commit: T08: 594767e


- [x] T04 [KO] 기종·버전 혼합 N대 경량 기동 + 전후 수치 비교
  area: src/profiles.ts, profiles/galaxy.json, src/up.ts, src/cli.ts, scripts/check-up.mjs, docs/measurements/after.md
  model: opus
  review: required
  accept: `profiles/galaxy.json` holds the 10 profiles from `docs/source/research-samsung-screens.md` (name, width, height, density, min Android) with a `densitySource` field (`blisk`/`yesviz`/`chrome`/`unverified`) — values unconfirmed by a real device stay marked. Download up to 2 more `google_atd` images (e.g. API 31 and 36; ADR 0003 decides). `crewdroid up --count N [--profiles a,b,..] [--base-port] [--json]` starts N `-read-only` instances with `-no-window -no-audio -no-boot-anim -cores 2 -memory 2048`, never two with the same profile+API while N <= profile count, applies `wm size`/`wm density` after boot, waits for `sys.boot_completed`, prints serial/profile/API per device. `crewdroid down` kills only crewdroid instances (by port range / AVD name `crew-*`). `crewdroid measure --up 3` measures the same metrics as T01; `docs/measurements/after.md` puts T01 baseline and this side by side (disk total, boot s, RAM MB, CPU %) with the delta.
  verify: `npx tsx src/cli.ts up --count 3 --json > docs/measurements/up.json && node scripts/check-up.mjs docs/measurements/up.json && npx tsx src/cli.ts measure --up 3 --json --out docs/measurements/after.json && node scripts/check-measure.mjs docs/measurements/after.json 3 && npx tsx src/cli.ts down`
  commit: T04: 0018d89

- [x] T05 [KO] 네트워크 상태 전환 (비행기·데이터 끊김·느림·들락날락)
  area: src/net.ts, src/cli.ts, scripts/check-net.mjs, probe-app/ (download/upload timing broadcast only)
  model: sonnet
  review: required
  accept: `crewdroid net <serial> airplane|nodata|slow|flaky|online [--seed N]`: airplane = airplane mode on (radio + wifi off), nodata = mobile data and wifi off but airplane mode off, slow = emulator console `network speed`/`network delay` set to a very slow profile, flaky = on/off loop with per-device random durations from the seed (two devices never share a schedule) until `online`, online = everything restored. Each state is proven by the probe app: upload of a 1MB file to the sample server fails under airplane/nodata, takes >= 5x the online time under slow, and under flaky at least one upload fails and a later retry succeeds. An upload interrupted mid-transfer (`net nodata` while uploading) is reported as `UPLOAD fail` and the server keeps no partial file.
  verify: `node scripts/check-net.mjs --count 2`

  commit: T05: net state switching (ce38af5)

- [x] T06 [KO] mobile-mcp · Maestro 연결
  area: .mcp.json, flows/, scripts/check-mcp.mjs, CLAUDE.md (Commands)
  model: sonnet
  review: required
  accept: Install Maestro CLI (approved) and add project `.mcp.json` with mobile-mcp (`npx -y @mobilenext/mobile-mcp@<pinned>`) and `maestro mcp`. `scripts/check-mcp.mjs` starts mobile-mcp over stdio as an MCP client, lists devices and confirms the crewdroid serials appear, then takes one accessibility snapshot of the probe app on a chosen emulator serial. `flows/probe-upload.yaml` (Maestro) opens the probe app, triggers an upload and asserts the success text; it runs with `maestro test --device "<s1>,<s2>" --shard-all 2` on two different profiles. Document in CLAUDE.md how to target one device in each tool and that a USB phone may appear in their device lists — always pass an `emulator-*` serial. Record how `maestro mcp`'s `run` picks a device.
  verify: `npx tsx src/cli.ts up --count 2 && node scripts/check-mcp.mjs && npx tsx src/cli.ts down`

  commit: T06: mobile-mcp + maestro wiring, probe-upload flow, check-mcp (4015b96)

- [x] T09 [KO] 샘플 앱 오프라인 저장·동기화 시나리오
  area: probe-app/ (rename the user-facing part to "sample app" inside the same module), scripts/check-offline.mjs
  model: opus
  review: required
  accept: The app keeps an outbox (Room or files) of photos/edits: actions while offline are saved locally and sent when the network returns (idempotency key per action, retry with backoff); an upload cut mid-transfer is retried; the app restarted while offline (`am force-stop` + relaunch) keeps its outbox and syncs later; two devices edit the same record while one is offline and the server's response (409 in clean mode) is surfaced in logcat `CrewProbe CONFLICT <id>`. All triggers are adb broadcasts so scripts and Maestro can drive them.
  verify: `node scripts/check-offline.mjs` (2 mixed devices: offline save -> restart offline -> online -> server has exactly the expected rows; concurrent edit -> one CONFLICT line)

  commit: T09: sample app outbox, offline sync, conflict logging (b2b75f1)

- [x] T10 [KO] 다자 현장 시나리오 실행기 (혼합 N대 + 네트워크 섞기 + 판정)
  area: src/scenario.ts, scenarios/photo-upload.json, src/cli.ts, scripts/check-scenario.mjs, docs/measurements/scenario.md
  model: opus
  review: required
  accept: `crewdroid run scenarios/photo-upload.json [--seed]` = up N mixed devices (default 3) -> install sample app -> each device repeats the flow R times with its own random delays while the scenario applies network states per device (airplane, nodata, slow, flaky; schedules differ per device) -> wait for outboxes to drain (timeout) -> `judge` -> `down`. Writes a run report (devices with profile/API, network timeline per device, judge result, wall time, peak host CPU/RAM). Against `BUGGY=1` it reports at least one violation in >= 2 of 3 seeds; against the clean server 3 of 3 pass. Summary table in `docs/measurements/scenario.md`.
  verify: `node scripts/check-scenario.mjs`
  commit: T10: 8121d59

- [x] T11 [KO] MVP — private-app techs.multi.ts 를 crewdroid 기동으로 통과 + 전후 비교 + 데모 GIF
  area: src/integrations/private-app.ts, scripts/mvp-private-app.mjs, docs/measurements/mvp.md, docs/demo/
  model: opus
  review: required
  accept: Without editing private-app: `crewdroid up --count 3 --base-port 5570` (image per ADR 0003; private-app needs the emulated back camera and WebRTC — use `-gpu host -camera-back emulated` when the image allows; mix profiles, and Android versions the APK's minSdk allows) so `avd-up.ps1` sees emulator-5570/5572/5574 already booted and only installs the APK; then `npm run e2e:multi -- --grep @techs` in `<private-app repo>/private-app-server` passes 3 runs in a row. If private-app' global-setup forces its own AVDs or the spec needs something crewdroid cannot give without editing private-app, stop BLOCKED with the exact line. `docs/measurements/mvp.md`: old path (avd-up.ps1 + old-avd-1..3) vs crewdroid for the same spec — disk, boot, RAM, CPU, spec wall time, pass count. `docs/demo/techs.gif` (<= 10 MB, ffmpeg from `adb shell screenrecord` of the 3 devices side by side).
  verify: `node scripts/mvp-private-app.mjs --runs 3`
  manual: 데모 GIF 를 열어 3대 화면이 서로 다른 기종 비율로 보이고 통화가 이어지는지 눈으로 확인
  commit: T11: d582510

- [x] T12 [KO] 에뮬레이터 콘솔 창이 화면에 뜨지 않게
  area: src/emulator.ts (shared launcher), src/measure.ts
  model: haiku
  review: skip
  accept: T01 launches the emulator with Node `spawn(..., { detached: true, windowsHide: true })`; on Windows the grandchild `qemu-system-x86_64-headless.exe` still opens a visible console window (user saw it 2026-10-23). Move emulator launch into one shared function used by every command (measure/up/prepare/identity) that starts it hidden the way private-app avd-up.ps1 does (`powershell Start-Process -WindowStyle Hidden`, or an equivalent that hides grandchildren) and still returns/locates the PID for kill. No visible window while any crewdroid command runs.
  verify: `node scripts/check-hidden.mjs` (starts one crewdroid emulator, lists processes named emulator*/qemu* and asserts every one has MainWindowHandle 0 via `Get-Process`, then kills it)
  commit: T12: f6c3da0

- [x] T13 [AUTO] Demo GIF shows all 3 devices live (FR-11 follow-up to T11)
  origin: auto-plan (docs/demo/techs.gif frames checked 2026-10-23: left panel API 32 is black for the whole run, right panel API 36 stays frozen on the `screenrecord --bugreport` intro text; only the middle panel shows the app)
  area: src/integrations/private-app.ts (recording), scripts/mvp-private-app.mjs (GIF build), scripts/check-demo-gif.mjs (new), docs/demo/techs.gif, docs/measurements/mvp.*
  model: sonnet
  review: required
  accept: Find why 2 of 3 `screenrecord` captures show no app frames (e.g. recording starts before the app is foreground, screenrecord emits frames only on change, `wm size` vs recorder size, per-API screenrecord behaviour) and fix the capture so every panel shows the private-app app during the call. `mvp-private-app.mjs` writes each panel's x-range and the source serial/profile/API into `mvp.json` `gif.panels`. New `scripts/check-demo-gif.mjs` reads `mvp.json` + `docs/demo/techs.gif` with ffmpeg and fails unless, for every panel, frames in the second half of the GIF are (a) not flat (luma range > 40) and (b) different from the panel's first frame; and the 3 panels' width/height ratios are pairwise different. It must exit 1 on the current GIF (left black, right frozen). Same rules as T11: private-app untouched, old-avd-1..3 not launched, `--base-port 5570` only here, all emulators killed at the end. GIF <= 10 MB.
  verify: `node scripts/mvp-private-app.mjs --runs 3 && node scripts/check-demo-gif.mjs` (runs 3 keeps the T11 pass count and table in mvp.md) -> `OK: demo GIF has 3 live panels`
  manual: GIF 를 열어 3대 모두 앱 화면과 통화 진행이 보이는지 눈으로 확인
  commit: 1a8d7bb

- [x] T14 [KO] ATD 화면이 그려지지 않음 (창은 부팅 로고에서 멈춤, screencap 전부 검정)
  origin: human /brief 2026-10-23 22:00. User opened crew-android-36 (5590) and crew-android-34 (5592) with a window: the window stayed on the "android" boot logo while `sys.boot_completed=1`, the private-app LoginActivity was top-resumed and `uiautomator dump` listed its texts. `adb exec-out screencap -p` was all black on both, also with `-gpu swiftshader_indirect`, after KEYCODE_WAKEUP, and after `adb root; stop; start`. T11's GIF showed one live panel out of three, so some path does render.
  area: src/emulator.ts, src/up.ts, src/avd.ts (AVD config / launch flags), scripts/check-render.mjs, docs/adr/0003-image.md
  model: opus
  review: required
  accept: Find the root cause (ATD build property, AVD config.ini `hw.*`, launch flag, snapshot from a no-window boot, or other) and record it with evidence in ADR 0003. After the fix, every `crewdroid up` device on all three images (API 31/34/36) renders: screencap of a launched app is not uniform black, and a window opened with `--window` (new flag on `up`, shows the emulator window for a human) shows the app, not the boot logo. If ATD cannot render at all, say so in the ADR and propose the lightest image that does (with its size) — BLOCKED for the user's approval before downloading anything over ~0.9GB.
  verify: `node scripts/check-render.mjs` (up 3 mixed devices, start the probe/sample app on each, screencap, fail if any image is >99% one colour; down)

  commit: 9bdd4ae
