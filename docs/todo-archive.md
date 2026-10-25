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

- [x] T15 [KO] 디스크 3대 ≤ 8GB (FR-12)
  area: src/avd.ts, src/snapshot.ts, src/slim.ts (new), src/cli.ts, scripts/check-disk.mjs, docs/measurements/slim.md
  model: opus
  review: required
  accept: `crewdroid slim` (also run by `prepare`) makes crewdroid's disk small without changing behaviour. Candidates, each measured before/after with real allocation (`fsutil file layout` / `GetCompressedFileSize` / `du`, not file length): (1) system images stored sparse — rewrite each `system-images/*/google_atd/x86_64/*.img` as an NTFS sparse file (zero ranges deallocated) or another lossless form the emulator still boots; keep a checksum so the content is provably identical; (2) quickboot snapshot slimmed — smaller `hw.ramSize` (from T16 if done, else 1536), one snapshot only (`default_boot`), delete stale ones, try emulator snapshot compression if available; (3) `disk.dataPartition.size` 2G for new AVDs; (4) anything else found (e.g. dedupe identical files across images by hard link). Report each knob's saving in `docs/measurements/slim.md`. Result: 3 images (API 31/34/36) + 3 base AVDs + 3 running clones' temp files <= 8 GB allocated, and boot time not worse than T04 by more than 20 %.
  verify: `npx tsx src/cli.ts slim --json && node scripts/check-disk.mjs --max-gb 8 && npx tsx src/cli.ts up --count 3 --json > docs/measurements/up.json && node scripts/check-up.mjs docs/measurements/up.json && npx tsx src/cli.ts down && node scripts/check-scenario.mjs && node scripts/mvp-private-app.mjs --runs 1`
  commit: 91db64f
- [x] T16 [KO] 호스트 RAM 3대 ≤ 4.2GB (FR-13)
  area: src/avd.ts, src/emulator.ts, src/measure.ts, src/up.ts, scripts/check-ram.mjs, docs/measurements/ram.md
  model: opus
  review: required
  accept: First fix the measure: report per emulator process Private Bytes / private working set and shared working set separately, and a 3-device total that counts shared pages once (clones of one snapshot share file-backed pages); keep the old working-set number for comparison with T01. Then sweep knobs one at a time on 3 mixed devices and record each in `docs/measurements/ram.md`: `hw.ramSize` 768/1024/1536, guest low-RAM props (`ro.config.low_ram=true`, smaller `dalvik.vm.heapsize`) if settable on ATD, `vm.heapSize`, audio off in config, unused sensors/front camera off, gpu mode (host vs swiftshader_indirect vs guest — keep whatever T14 needs for rendering), quickboot file-backed RAM on/off (`-feature -QuickbootFileBacked` or equivalent), cold boot vs snapshot. Adopt the smallest combination that still passes `check-scenario` and `mvp-private-app --runs 1` (WebRTC call). Result: 3-device host RAM total <= 4.2 GB by the corrected measure, and the old working-set number also reported. If 4.2 GB cannot be reached without breaking a test, stop BLOCKED with the best number, the knob that broke what, and the remaining options.
  attempt 2 (2026-10-26 /brief): start from attempt 1's work, committed as `89d8d55` "T16 WIP" on ai/work (`src/avd.ts src/measure.ts src/slim.ts src/snapshot.ts src/up.ts`, `docs/measurements/ram.* ram-sweep.json mvp.* scenario.*`, `docs/demo/techs.gif`, `scripts/check-ram.mjs`) — they reached 3930 MiB (`docs/measurements/ram.md`); keep them, do not redo the sweep. Attempt 1 was REJECTED only because `mvp-private-app` failed twice after the call passed: `adb pull /sdcard/crewdroid-rec.mp4` on emulator-5574 (API 36) failed, so no GIF (`.ai-log/evidence/T16-1-master.txt`, `T16-1-master-mvp2.txt`). Fix the recording path in `src/integrations/private-app.ts` (stop `screenrecord`, wait until the file is closed / `ls -l` size stable, then pull with retries; or record host-side with `adb -s <serial> emu screenrecord start/stop` — `docs/source/research-emulator-features.md` §p) and move that recorder into a shared `src/record.ts` (T29 reuses it). Do not weaken `check-demo-gif.mjs`.
  verify: `node scripts/check-ram.mjs --count 3 --max-mb 4300 && node scripts/check-scenario.mjs && node scripts/mvp-private-app.mjs --runs 1`
  commit: 4cead10

- [x] T23 [KO] 샘플 서버: 정상 모드 PUT 이 멱등키 재시도에 같은 응답 (FR-24)
  area: sample/server/app.ts, test/server.test.ts, src/hammer.ts (PUT retry sends the same idempotency-key)
  model: sonnet
  review: required
  accept: Normal mode: a PUT `/records/:id` with an `idempotency-key` header already seen for that id returns the stored first response (same status, same version, no new version, no new `writes.jsonl` line); without the header behaviour is unchanged; `BUGGY=1` dedupes nothing (as today). Keys are kept per id in the JSON store. `src/hammer.ts` sends an idempotency-key on PUT and reuses it on its retry so a lost response no longer shows as a 409 conflict. `test/server.test.ts` (node:test, starts the server on a free port): normal PUT twice same key -> same version, one write line; different keys -> two versions; BUGGY twice same key -> two versions. `check-hammer.mjs` still passes (BUGGY >= 4/5 seeds fail, clean 5/5 pass).
  verify: `node --import tsx --test test/server.test.ts && node scripts/check-hammer.mjs`
  commit: 524ea73

- [x] T24 [KO] `crewdroid mcp` stdio MCP 서버 (FR-19)
  area: src/mcp.ts, src/cli.ts, package.json (`@modelcontextprotocol/sdk` + `zod`, pinned), scripts/check-mcp-server.mjs, docs/architecture.md (one paragraph), .mcp.json (add `crewdroid` server)
  model: opus
  review: required
  accept: `crewdroid mcp` starts a stdio MCP server with the official SDK (`McpServer` + `StdioServerTransport`; `docs/source/research-ai-discoverability.md` §1). Tools with zod input schemas, each a thin wrapper over the function the CLI already calls (no duplicated logic): `devices` (running crew emulators: serial, profile, api), `up` (count, profiles, basePort), `down`, `net` (serial, state), `judge` (rules, source), `hammer`, `run` (scenario file, seed), `apk` when `src/apk.ts` exists, and a registry: every module that exports `mcpTools: Tool[]` is picked up by `src/mcp.ts` (T20/T21/T22 add env/app/triage/screen/perf this way). Serial inputs go through the adb guard; errors return `isError: true` with the CLI message; long tools (`up`, `run`) take `timeoutSec` and report progress via logging notifications. `.mcp.json` gets `"crewdroid": { "command": "npx", "args": ["tsx", "src/cli.ts", "mcp"] }`. `scripts/check-mcp-server.mjs` (no emulator): spawns the server over stdio with the SDK client, `listTools` contains `devices`, `judge`, `net`, `up`; calls `judge` with `judge/sample.rules.json` against a BUGGY export fixture -> `isError` false and violations in the text; calls `net` with serial `R3CT1234` -> `isError` true with the guard message; calls `devices` -> JSON array (empty is fine).
  verify: `npm test && node scripts/check-mcp-server.mjs`
  commit: 733fb01



- [x] T22 [KO] 안드로이드 진단: triage(크래시/ANR/종료 사유/힙)·screen(접근성 트리)·perf(기동·프레임·메모리)·apk(매니페스트) (FR-18)
  area: src/triage.ts, src/screen.ts, src/perf.ts, src/apk.ts, src/cli.ts, src/sdk.ts (build-tools path for aapt2), probe-app/ (`check=crash|anr|jank`), scripts/check-triage.mjs, test/apk.test.ts, docs/measurements/features.md, README.md (diagnostics section)
  model: opus
  review: required
  accept: From `research-emulator-features.md` §l-o. `crewdroid triage <serial> [--app <pkg>] [--heap <out.hprof>] --json` -> `{crashes:[{pkg, exception, topFrame, time}] (logcat -b crash parsed), anrs:[…] (dumpsys activity exit-info <pkg> reasons, plus /data/anr/* when readable, else "unreadable"), recentLog:[last 200 lines for the app], summary:"N crashes, M ANRs, top: …"}`; `--heap` runs `am dumpheap` and pulls the hprof. `crewdroid screen <serial> [--png <file>] --json` -> focused activity (`dumpsys window` mCurrentFocus) + compact tree from `uiautomator dump`: `[{cls, text, desc, id, bounds, clickable, depth}]`, Compose testTags noted as resource-id only with `testTagsAsResourceId`. `crewdroid perf <serial> <pkg> [--activity <a>] --json` -> `am start -S -W` ThisTime/TotalTime, `dumpsys gfxinfo <pkg> framestats` -> frames, jank %, p50/p90/p99 ms, `dumpsys meminfo` PSS total/java/native. `crewdroid apk <file> --json` (host only, `aapt2` from `<sdk>/build-tools/<newest>`): package, versionName/Code, minSdk/targetSdk, permissions, exported activities, deep-link filters; missing file / no aapt2 -> exit 1 with the reason. Probe app: `check=crash` throws on the main thread, `check=anr` blocks the main thread 10 s while the script taps, `check=jank` busy-loops in draw. All four modules export `mcpTools`. `scripts/check-triage.mjs`: 1 device (API 34); trigger crash -> triage lists 1 crash with a `ProbeActivity` frame; trigger anr -> `anrs` >= 1 or exit-info REASON_ANR; `screen` lists the probe button with bounds inside `wm size`; `perf` JSON has TotalTime > 0 and frames > 0; `apk app-debug.apk` -> package `dev.crewdroid.probe`, minSdk 31, CAMERA permission; `apk missing.apk` exits 1; features.md row; down.
  verify: `npm test && node scripts/check-triage.mjs`
  commit: 06943a0

- [x] T25 [KO] 에이전트용 파일: AGENTS.md·CLAUDE.md import·Claude 플러그인·marketplace·.agents/skills (FR-20)
  area: AGENTS.md, CLAUDE.md (first line only: `@AGENTS.md`), .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .agents/skills/crewdroid/SKILL.md, scripts/check-agent-files.mjs, docs/architecture.md (where agents read what)
  model: sonnet
  review: required
  accept: Per `docs/source/research-ai-discoverability.md` §2-3 (cite the doc URLs in file comments where a format is non-obvious). `AGENTS.md` (English, <= 8 KiB): what crewdroid is, install/run in 5 lines, the command table (`up/down/net/env/app/triage/screen/perf/apk/judge/hammer/run/mcp` — mark the ones not yet implemented as "planned"), the safety rules every agent must keep (adb only `emulator-<port>`, one run at a time, no barrier), where measurements live. `CLAUDE.md` keeps its content and gets `@AGENTS.md` as its first line (Claude Code ignores AGENTS.md when CLAUDE.md exists). `.claude-plugin/plugin.json`: name `crewdroid` (no `claude-` prefix), description, version from package.json, author, `mcpServers` -> `${CLAUDE_PLUGIN_ROOT}` path to the mcp command, `skills` -> `./.agents/skills` if the plugin reference allows a custom skills path, else copy the skills under `skills/` and say which in architecture.md. `.claude-plugin/marketplace.json` with owner `namyunsu`, one plugin `source: "./"`, so `claude plugin marketplace add namyunsu/crewdroid` + `claude plugin install crewdroid@crewdroid` works once public. `.agents/skills/crewdroid/SKILL.md`: the umbrella skill (name `crewdroid`, description written for symptom triggering: "test an Android app on several emulated Galaxy devices at once, flaky network, duplicate/lost records"; body <= 120 lines: when to use, the 5 commands an agent needs first, pointers to the android-* skills T26 adds). `scripts/check-agent-files.mjs`: AGENTS.md exists <= 32 KiB and names every `cmd ===` branch of `src/cli.ts`; CLAUDE.md line 1 is `@AGENTS.md`; plugin.json name `crewdroid`, no banned prefix, every referenced path exists; marketplace.json plugins[0].source `./`; `.mcp.json` has `crewdroid`; every `SKILL.md` under `.agents/skills/` has frontmatter `name` == dir and `description` <= 1024 chars with no field outside name/description/license/compatibility/metadata/allowed-tools; then runs `claude plugin validate --strict .` and fails on a non-zero exit.
  verify: `node scripts/check-agent-files.mjs`
  commit: 1c97df8

- [x] T26 [KO] 안드로이드 스킬 6개 + 명령 블록 실기동 검증 (FR-21)
  area: .agents/skills/android-triage/SKILL.md, .agents/skills/android-screen/SKILL.md, .agents/skills/android-permissions-intents/SKILL.md, .agents/skills/android-apk/SKILL.md, .agents/skills/android-perf/SKILL.md, .agents/skills/android-offline-concurrency/SKILL.md, scripts/check-skills.mjs, .agents/skills/crewdroid/SKILL.md (links only)
  model: opus
  review: required
  accept: After T22 and T25 are DONE. Six skills, each <= 150 lines, frontmatter `name` (== dir) + `description` (symptom-triggered: "app crashed / ANR / blank screen / deep link does not open / jank, slow start / offline sync made duplicates or lost an update"), body = numbered recipe of exact commands (`crewdroid …`, `adb -s emulator-<port> …`, `maestro …`) with what each output line means and the next step, and a "what this cannot tell you" line. Command blocks the agent should run verbatim are fenced ```bash verify``` with `$SERIAL`/`$PKG` placeholders; every such block must run on a crew device. `android-permissions-intents` uses `crewdroid app` when T21 is DONE, else raw `pm`/`am` lines (and says T21 will replace them). `android-offline-concurrency` is the recipe behind FR-09/FR-10: outbox, flaky schedule, `crewdroid run` + `judge`, how to read a violation. `scripts/check-skills.mjs`: frontmatter rules as in T25's check, <= 150 lines, every `crewdroid <cmd>` mentioned exists in `cli.ts`; then boots 1 device (API 34), installs the probe APK, runs every ```bash verify``` block with placeholders substituted and fails on any non-zero exit; downs. T25's check-agent-files passes too.
  verify: `node scripts/check-skills.mjs && node scripts/check-agent-files.mjs`
  commit: acd96ba

- [x] T27 [KO] 공개 준비: LICENSE·영문 README·npm 패키지·server.json·스크럽 검사·release 체크리스트 (FR-22)
  area: LICENSE, README.md (English; current Korean text -> README.ko.md), package.json, server.json, scripts/check-public.mjs, docs/release.md, src/sdk.ts (no `C:/Users/NYS` fallback: clear error naming ANDROID_SDK_ROOT/ANDROID_HOME), .gitignore
  model: sonnet
  review: required
  accept: LICENSE = MIT, copyright 2026 Yunsu Nam. README.md first screen: one sentence, one-line install (`npx crewdroid up --count 3`), `docs/demo/demo.gif` (T29 writes it; keep the link), a numbers table from `docs/measurements` (disk 24.7 -> 6.99 GiB, host RAM 8.45 -> 3.93 GB, boot 31.6 -> 6.7 s, idle CPU 1000 -> ~600 %, 3 mixed devices), then: requirements (Android SDK + emulator >= 36.4, Node >= 24, WHPX/KVM), the command table, an `mcpServers` JSON block (`npx -y crewdroid mcp`), Claude Code plugin install (2 lines), a Cursor install deeplink (`cursor://anysphere.cursor-deeplink/mcp/install?name=crewdroid&config=<base64>`), how to add profiles, safety rules, link to AGENTS.md. `package.json`: `private` removed, name `crewdroid` (free on npm 2026-10-26), `bin: { crewdroid }` pointing at a built entry (`tsc` to `dist/` on `prepack`, or a tiny loader with `tsx` as a dependency — pick the one that makes `npx crewdroid` work from a tarball), `files`, `keywords` (android, emulator, mcp, mcp-server, claude-code, agent-skills, mobile-testing, concurrency), `repository`, `license`, `mcpName: "io.github.namyunsu/crewdroid"`. `server.json` per the MCP Registry quickstart (npm package, stdio transport, same name/version). `scripts/check-public.mjs`: (1) scrub — `git ls-files` minus `docs/**`, `.ai-log/**` must not contain `NYS`, `jjkng`, `C:/Users/`, `C:\Users\`, `D:/workspace`, `D:\workspace`, or a USB serial pattern `R3CT\w+`; (2) LICENSE MIT present; (3) README has the install line, the `mcpServers` block, the numbers table and the GIF link; (4) `npm pack` into a temp dir, `npm i <tarball>` there, `npx crewdroid --help` prints `up` and `mcp`; (5) `server.json` name == `mcpName`, version == package.json version, packages[0].identifier == package name. `docs/release.md` (Korean): the human-only steps in order with the exact commands — make the repo public, `npm publish --access public`, `mcp-publisher init/login github/publish`, GitHub topics list (7), PR texts for punkpeye/awesome-mcp-servers and travisvn/awesome-claude-skills, claude-community submission, Cursor deeplink generation, and what in `docs/` and `.ai-log/` mentions private-app or the PC name so the user can decide to keep or purge.
  verify: `node scripts/check-public.mjs`
  commit: 7555c43

- [x] T28 [KO] API 31 ATD SurfaceView 미표시 원인 조사 (FR-25)
  area: probe-app/ (`check=surface`: SurfaceView with a solid colour + a moving square), scripts/check-surface.mjs, docs/adr/0005-api31-surfaceview.md, src/up.ts / src/avd.ts (only if a flag or prop fixes it), profiles/galaxy.json + src/profiles.ts (`surfaceView: false` marker + warning in `up` when a profile lands on API 31), CLAUDE.md (Gotchas line)
  model: opus
  review: required
  accept: Reproduce without private-app: API 31 vs API 34 ATD, probe `check=surface`, screencap of the SurfaceView area. Test the candidates one at a time and record each result with the screencap stats in the ADR: `debug.hwui.drawing_enabled` (T14 fix) vs the SurfaceView path, SurfaceFlinger layer state (`dumpsys SurfaceFlinger` activeBuffer / composition), `-gpu host` vs `-gpu software`, `-feature -Vulkan` (T16), `-no-window` vs `--window`, `setprop debug.sf.*` knobs, API 31 image build props. If a launch flag/prop fixes it: apply it in `up` (API 31 only), and the SurfaceView screencap is non-uniform on API 31 too. If not: ADR 0005 says why with evidence, API 31 profiles get `surfaceView: false`, and `up`/`run` print `WARN emulator-<port> API 31: SurfaceView content does not render (ADR 0005)` when a profile lands there. `scripts/check-surface.mjs`: up API 31 + API 34, run `check=surface`, crop the SurfaceView bounds (probe logs `CrewProbe SURFACE <l>,<t>,<r>,<b>`), fail when a device's crop is uniform unless that device is flagged `surfaceView:false` AND the WARN line was printed; down.
  verify: `node scripts/check-surface.mjs`

T28: API 31 SurfaceView investigation — 65f9e86

- [x] T18 [KO] 임의 화면 규격 + 모니터보다 큰 화면 (FR-14)
  area: src/up.ts, src/profiles.ts, profiles/galaxy.json (schema only), profiles/custom.example.json, src/cli.ts, scripts/check-size.mjs, docs/measurements/size.md, README.md (usage lines)
  model: sonnet
  review: required
  accept: `crewdroid up` takes ad-hoc screens next to named profiles: `--screen 1920x720@160` (WxH@density, density optional -> derived for ~360dp width) and repeatable/comma list, e.g. `--screen 1080x2340@450,3840x2160@320 --count 2`; a user profile file (`--profiles-file my.json`, same schema as galaxy.json, `profiles/custom.example.json` shows an HMI entry) also works. Invalid input (0, negative, non-number, missing x) -> clear error, exit 1, nothing launched. Measure and document in `docs/measurements/size.md` the largest size that boots and renders on API 34/36 ATD (try 3840x2160, 5120x1440, 7680x2160) with boot time and host RAM per size; sizes over the host monitor work headless and in `--window` mode (scaled window, full-resolution screenshot).
  verify: `node scripts/check-size.mjs` (up 2 devices with `--screen 1920x720@160,3840x2160@320`; `wm size`/`wm density` match; screencap PNG dimensions equal the requested sizes and are not uniform; bad `--screen 0x100` exits 1; down)

T18: custom screen sizes — a497f0d

- [x] T19 [KO] 폴드·플립 접기/펴기 (FR-15)
  area: src/fold.ts, src/cli.ts, src/avd.ts (foldable AVD config if needed), profiles/galaxy.json (fold pairs), scripts/check-fold.mjs, sample app (log configuration changes), docs/adr/0006-fold.md
  model: opus
  review: required
  accept: Fold/Flip profiles carry both screens (cover + main, from research-samsung-screens.md). `crewdroid fold <serial>` / `unfold <serial>` switches cover <-> main so the app gets a real configuration change (new screen size). Read `docs/source/research-emulator-features.md` §k first (fold/posture need `hw.sensor.hinge*` in the AVD config, so a foldable needs a second base AVD + snapshot — count its disk in the ADR; `resize-display` is not supported headless). Find what works on our ATD images and record it in ADR 0006 with evidence: emulator foldable support (`hw.sensor.hinge*` / foldable AVD config + `adb emu fold|unfold`), `cmd device_state state <id>`, or fallback `wm size/density` swap (honest about what the fallback does not emulate: hinge posture, half-open). The sample app logs `CrewProbe CONFIG <w>x<h>` on each configuration change and keeps its outbox/in-progress upload across fold/unfold (a fold during upload is a test case).
  verify: `node scripts/check-fold.mjs` (up a fold5 + flip6 profile; unfold/fold each; CONFIG lines show both sizes; screencap sizes change; an upload started before a fold completes exactly once on the server; down)

T19: fold/unfold — ea4dd35


- [x] T20 [KO] `crewdroid env` 기기 환경 조작: 위치·배터리·센서/회전·다크·글자·앱 로케일·통신망·SMS/통화 (FR-16)
  area: src/env.ts, src/cli.ts, probe-app/ (`check=env` logs the state it sees), scripts/check-env.mjs, test/env.test.ts, docs/measurements/features.md, README.md (env section)
  model: sonnet
  review: required
  accept: `crewdroid env <serial> <what> [args] [--json]`, every call through `src/adb.ts` (`adb -s <serial> emu …` / `shell …`), commands from `docs/source/research-emulator-features.md` §a-e: `geo <lon> <lat> [alt]` (then `cmd location set-location-enabled true`), `battery <0-100> [ac|unplugged]`, `rotate <0-3>` (`accelerometer_rotation 0` + `user_rotation`), `sensor acceleration x:y:z`, `dark on|off`, `font <scale>`, `locale <pkg> <tags>` (API 33+, `cmd locale set-app-locales`), `gsm data home|roaming|searching|denied|off|on`, `gsm signal <0-31> [--hold <sec>]` (the console value lasts 15 s; `--hold` re-sends every 10 s), `sms <from> <text>`, `call <number> [accept|cancel]`, and `show` (reads every state back: `settings get`, `dumpsys battery`, `dumpsys location`, `cmd uimode night`, `getprop`). Every setter reads its state back and exits 1 with a message when it differs; invalid values (`battery 150`, `rotate 9`, bad serial) exit 1 before any adb call. The probe app's `check=env` logs `CrewProbe ENV dark=<bool> font=<scale> rot=<n> battery=<pct> loc=<lat>,<lon>|none`. `scripts/check-env.mjs` boots 2 mixed devices, applies each command, checks read-back + the ENV log line, then appends the idle RAM/CPU before/after row to `features.md` and downs. `src/env.ts` exports `mcpTools` (wave rule).
  verify: `npm test && node scripts/check-env.mjs`
  commits: 4f0d731 b16e9f3 7b8c4ee


- [x] T21 [KO] `crewdroid app` 앱 제어: 권한·딥링크/App Links·데이터 초기화·백업/복원·자원 압박 (FR-17)
  area: src/app.ts, src/cli.ts, probe-app/ (deep-link intent filters `crewdroid://probe/*` and `https://probe.crewdroid.example/*` with autoVerify; logs `CrewProbe LINK <uri>`), scripts/check-app.mjs, test/app.test.ts, docs/measurements/features.md, README.md (app section)
  model: sonnet
  review: required
  accept: `crewdroid app <serial> <pkg> <what> [args] [--json]` from `research-emulator-features.md` §f-i: `perm grant|revoke|show <permission…>` (`pm grant/revoke`; `show` parses `dumpsys package` runtime permissions into `{name, granted}`), `open <uri> [--pkg]` (`am start -a VIEW -c BROWSABLE -d`; "No Activity found" -> exit 1 with that message — ATD has no Chrome), `links show|force <domain>|reset` (`pm get-app-links` / `set-app-links --package <pkg> 2 <domain>` / `set-app-links --package <pkg> 0 all`, API 31+), `clear` (`pm clear`), `backup|restore` (`bmgr` local transport; if `LocalTransport` is absent on ATD exit 1 with that reason and record it in `features.md`), `pressure doze|standby <bucket>|trim <level>|bg-restrict|battery-saver|reset` (`dumpsys deviceidle force-idle`, `am set-standby-bucket`, `am send-trim-memory`, `appops set RUN_ANY_IN_BACKGROUND ignore`, `settings put global low_power 1`; `reset` undoes all), `fill-storage <GB>|free` (`fallocate` in `/data/local/tmp`, read back with `df /data`). Each setter reads back; bad permission name / unknown bucket exit 1 before adb. `scripts/check-app.mjs`: 2 mixed devices; grant -> show granted=true -> revoke -> false; `open crewdroid://probe/x` -> LINK line; `links force probe.crewdroid.example` then `open https://probe.crewdroid.example/y` -> LINK line and `links show` says approved; `clear` empties the outbox dir; doze -> `dumpsys deviceidle` shows IDLE; standby rare -> `am get-standby-bucket` 40; `fill-storage 2` -> `df` drops >= 2 GB then `free` restores; features.md row; down. `src/app.ts` exports `mcpTools`.
  verify: `npm test && node scripts/check-app.mjs`
  commits: 24c37f3 ad02388 
