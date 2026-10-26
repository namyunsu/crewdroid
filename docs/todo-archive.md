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

- [x] T30 [AUTO] AGENTS.md command table matches the CLI (FR-20 follow-up)
  origin: auto-plan (`node scripts/check-agent-files.mjs` FAIL 2026-10-26: "AGENTS.md does not name command `fold`/`unfold`"; AGENTS.md:22 still says `app` ... `planned` though T21 shipped it)
  area: AGENTS.md, scripts/check-agent-files.mjs
  model: haiku
  review: required
  accept: AGENTS.md "Commands" table has rows for `fold` and `unfold` (what they do, `implemented`) and `app` is `implemented`. `check-agent-files.mjs` additionally fails when a command it already reads from `cli.ts help` (the existing `cmds` list, no second call) has status `planned` in that table. No other AGENTS.md wording changes.
  verify: `node scripts/check-agent-files.mjs && npm test`

- [x] T31 [AUTO] `perf` cold start without `am start -S` (API 31 black screen, FR-18 / FR-25)
  origin: auto-plan (REPORT 2026-10-26 "src/perf.ts:24 `am start -S -W` is the API 31 black-screen candidate"; CLAUDE.md Gotchas + docs/adr/0005-api31-surfaceview.md: on API 31 ATD `am start -S` leaves the screen black, use force-stop, 2 s, start)
  area: src/perf.ts, scripts/check-surface.mjs, README.md (perf line only)
  model: sonnet
  review: required
  accept: `perf` does `am force-stop <pkg>`, waits 2 s, then `am start -W -n <comp> ...extras` (no `-S`); TotalTime is still reported (cold start: process was killed). MCP tool description and README.md:55 no longer say "-S". `check-surface.mjs` gains a step per device: run `crewdroid perf <serial> dev.crewdroid.probe -- --es check surface`, then screencap the probe's logged SURFACE bounds -> must not be one colour on any device including the API 31 one (PNG to `.ai-log/evidence/T31-perf-<serial>.png`). `check-triage.mjs` still passes (perf check=jank on API 34). The worker report pastes the cold TotalTime line and says whether the old `-S` path came out flat on the API 31 device (if not, the evidence only shows no regression). No launch flag / AVD config / KNOBS change. Kill emulators at the end.
  verify: `grep -q "perf" scripts/check-surface.mjs && node scripts/check-surface.mjs && node scripts/check-triage.mjs`

T30: fd972e0 · T31: c1f27a5 (shift 9)

- [x] T29 BLOCKED:샘플 앱 화면이 정지라 녹화에 움직임이 없음 — probe-app 에 주기 갱신 UI 추가(영역에 probe-app 포함)할지 결정 필요. 시도 1 코드는 git stash "T29-1 attempt" [KO] 공개용 데모 GIF: 샘플 앱 혼합 3대 + 판정 결과 (FR-23)
  area: scripts/demo-gif.mjs, src/record.ts (shared recorder from T16), docs/demo/demo.gif, scripts/check-demo-gif.mjs (`--max-mb --max-seconds`), docs/measurements/demo.json
  model: sonnet
  review: required
  accept: After T16 is DONE (recorder). `node scripts/demo-gif.mjs`: `up --count 3` with s24ultra@API34, fold5-main@API34, flip7-main@API36, start the sample server with `BUGGY=1` on a free port, record the 3 screens side by side while `crewdroid run scenarios/photo-upload.json --seed 1 --server-port <port>` runs (same recorder as mvp-private-app, timestamp overlay cropped), then append a 3 s tail that shows the judge summary text (ffmpeg drawtext, e.g. `VIOLATION duplicate: 2 rows`), write `docs/demo/demo.gif` (<= 3 MB, 480 px high, <= 20 s, 8 fps) and `docs/measurements/demo.json` (`gif.panels` like mvp.json + the judge result). Nothing from private-app appears. `check-demo-gif.mjs` keeps T13's rules (3 live panels with pairwise different ratios) and gains `--max-mb 3 --max-seconds 20`.
  verify: `node scripts/demo-gif.mjs && node scripts/check-demo-gif.mjs --mvp docs/measurements/demo.json --gif docs/demo/demo.gif --max-mb 3 --max-seconds 20`
  done: T29 (commit 5fe7909, merged on ai/work)

- [x] T32 [AUTO] Sample app shows live outbox state + public demo GIF (FR-23, unblocks T29)
  origin: auto-plan (T29 BLOCKED reason; FR-23)
  area: probe-app/app/src/main/kotlin/dev/crewdroid/probe/ProbeActivity.kt (default screen only), scripts/demo-gif.mjs, scripts/check-demo-gif.mjs, src/scenario.ts (only what stash@{0} needed), docs/demo/demo.gif, docs/measurements/demo.json
  model: sonnet
  review: required
  accept: Same accept as T29 above, plus: the default screen (ProbeActivity.kt:77) refreshes once a second with outbox pending / synced / conflict counts and the last sync result, so recorded panels change while the scenario runs. No new user-facing feature, no change to broadcasts, logcat lines (`CrewProbe ...`), `check` intents or the anr/jank/surface screens. Start from `git stash show -p stash@{0}` (T29-1 attempt); drop the stash when done. When done set T29 to `DONE (via T32)` in `.ai-log/status.md` and mark it `[x]` in this file.
  verify: `node scripts/demo-gif.mjs && node scripts/check-demo-gif.mjs --mvp docs/measurements/demo.json --gif docs/demo/demo.gif --max-mb 3 --max-seconds 20 && node scripts/check-offline.mjs && npm test`
  done: T32 (commit 5fe7909, merged on ai/work)

- [x] T34 [AUTO] features.md keeps one row per Todo (FR-16 deliverable table)
  origin: auto-plan (REPORT.md: features.md auto row label "T22" repeated)
  area: scripts/check-triage.mjs, scripts/check-env.mjs, docs/measurements/features.md
  model: haiku
  review: skip
  accept: check-triage.mjs and check-env.mjs replace their own row on rerun the way check-app.mjs:162-165 does (filter the label, then write) instead of appendFileSync; update their header comments (line 3) and say() texts ("row appended") to match. features.md keeps only the latest T22 row (2026-10-25, 3610 -> 2452) plus the T20 and T21 rows; header unchanged.
  verify: `node -e "const t=require('fs').readFileSync('docs/measurements/features.md','utf8').split(/\r?\n/).filter(l=>/^\| \d{4}-/.test(l)).map(l=>l.split('|')[2].trim().split(' ')[0]);const d=t.filter((x,i)=>t.indexOf(x)!==i);if(d.length)throw new Error('duplicate rows: '+d);console.log('one row per Todo')" && node -e "const fs=require('fs');for(const f of ['scripts/check-triage.mjs','scripts/check-env.mjs']){const s=fs.readFileSync(f,'utf8');if(/appendFileSync\(f/.test(s))throw new Error(f+' still appends')}console.log('rows replaced')"`
  done: T34 (commit 708d55e, merged on ai/work)

- [x] T35 [KO] `crewdroid setup`: SDK·에뮬레이터·이미지·JDK 한 번에 설치 (FR-26)
  area: src/setup.ts, src/sdk.ts (sdkRoot default when no env: `<home>/.crewdroid/android-sdk` only if it exists or setup created it), src/cli.ts (setup), scripts/check-setup.mjs, test/setup.test.ts, README.md (Requirements section only)
  model: sonnet
  review: required
  accept: `crewdroid setup [--sdk <dir>] [--images 34[,31,36]] [--only cmdline-tools,platform-tools,emulator,images,jdk] [--dry-run] [--yes] --json`. SDK dir = `--sdk`, else ANDROID_SDK_ROOT / ANDROID_HOME, else `<home>/.crewdroid/android-sdk`. Steps, each skipped when already present (report `present`): (1) JDK >= 17 for sdkmanager — use `JAVA_HOME`/`java` on PATH if >= 17, else download Eclipse Temurin JRE 17 (Adoptium API `https://api.adoptium.net/v3/binary/latest/17/ga/<os>/<arch>/jre/hotspot/normal/eclipse`) into `<sdk>/jre` and pass it as JAVA_HOME to sdkmanager only (never change the user's environment); (2) command-line tools from Google's official zip (`https://dl.google.com/android/repository/commandlinetools-<win|linux|mac>-<build>_latest.zip`, current build number read from `https://dl.google.com/android/repository/repository2-3.xml` or pinned with a comment) into `<sdk>/cmdline-tools/latest`; (3) `sdkmanager platform-tools emulator`; (4) `system-images;android-<N>;google_atd;x86_64` per `--images` (default 34; arm64 hosts use `arm64-v8a`); (5) prints the env line to add (`ANDROID_SDK_ROOT=<dir>`) when the SDK is not already the env one. SDK licences: shown and accepted only with `--yes` or an interactive "y"; non-interactive without `--yes` -> exit 1 naming the flag. `--dry-run` lists every step with present/missing and the download size (from the repository XML / HTTP Content-Length), downloads nothing. Downloads go to a temp file and are renamed after the size matches; a failed step exits 1 naming the step and leaves earlier steps installed. Host checks reported, not fixed: hardware acceleration (`emulator -accel-check`), free disk. MCP tool `setup` (dry-run by default; `yes:true` to install). `scripts/check-setup.mjs`: (a) `setup --json` on this machine's SDK -> every step `present`, nothing downloaded, exit 0, < 30 s; (b) `setup --sdk <tmp> --dry-run --json` -> 5 steps all missing with sizes > 0, tmp still empty; (c) `setup --sdk <tmp> --only cmdline-tools,platform-tools --yes --json` -> `<tmp>/platform-tools/adb(.exe) version` runs; (d) non-interactive `setup --sdk <tmp2> --only platform-tools` without `--yes` exits 1 mentioning `--yes`; deletes the temp dirs. `test/setup.test.ts`: URL/arch/os mapping and step planning without network.
  verify: `npm test && node scripts/check-setup.mjs`
  manual: Linux and macOS: run `npx crewdroid setup --yes` on a clean machine, then `crewdroid up` (test-cases.md FR-26).

  done: `T35: summary` commit 5e5fa8e (merged 97c1821)

- [x] T36 [KO] 인자 없는 `up` = 1대, `--api`, `devices` 명령, 1대 기동 시간 (FR-27)
  area: src/up.ts (defaults only), src/cli.ts (up defaults, `--api`, `--profile` alias, `devices`), src/mcp.ts (`up` defaults, `devices` unchanged), scripts/check-single.mjs, docs/measurements/single.md, scripts/check-*.mjs and scenarios that relied on the old default count 3 (pass `--count 3` explicitly)
  model: sonnet
  review: required
  accept: `crewdroid up` with no flags boots ONE device: profile `s24ultra`, image = highest installed google_atd API <= 36. `--count N` keeps today's mixed behaviour (unchanged for N >= 2). `--api 31|34|36` pins the image (error listing installed APIs if missing; with `--count` > 1 all devices use it); `--profile <name>` = `--profiles <name>`. `crewdroid devices [--json]` lists running crew emulators (serial, api, profile, screen, booted) via the same function as the MCP `devices` tool. Grep every caller of the old default (`count` default "3" in cli.ts, scripts, scenario runner, MCP `up`) and pass `--count 3` where a 3-device run is meant, so `check-scenario.mjs`/`check-up.mjs` behave as before. `scripts/check-single.mjs`: `up --json` -> exactly 1 device, s24ultra, API 34 or 36; `devices --json` shows it booted; `up --api 31 --json` after `down` -> API 31; `--api 99` exits 1 listing the installed APIs; 3 cold runs of `up` (fresh, after `down`) timed to `sys.boot_completed` and to ready, written to `docs/measurements/single.md` (+ idle host RAM/CPU of the one device); `down`. README/AGENTS numbers are not changed here (T40 does).
  verify: `npm test && node scripts/check-single.mjs && node scripts/check-up.mjs`

  done: `T36: summary` commit 869d28e (merged 97c1821)

- [x] T17 [KO] T16 통과 후 옛 AVD 3대 + android-33 google_apis 이미지 삭제
  unblocked 2026-10-26 08:15 (human session, user approved): the deletion itself is DONE — `avdmanager delete avd` old-avd-1..3 (5.8+5.5+5.2 GiB) and `sdkmanager --uninstall system-images;android-33;google_apis;x86_64` (8.2 GiB), ~24.7 GiB freed; `~/.android/avd` has no old-avd-*, `<sdk>/system-images/android-33` is gone. Remaining for this Todo: the docs part of accept (slim.md freed GB row, infra.md, CLAUDE.md Gotchas) and the verify. Do not try to delete anything.
  origin: user approval in /brief 2026-10-23, verbatim: "T16 까지 통과하면 old-avd-1~3 과 android-33 google_apis 이미지 지워도 돼. 그 전엔 두고."
  area: docs/infra.md, CLAUDE.md (Gotchas), docs/measurements/slim.md
  model: haiku
  review: required
  accept: Run only when `.ai-log/status.md` shows T15 and T16 DONE (reviewer APPROVE); otherwise stay TODO. Delete exactly: AVDs `old-avd-1`, `old-avd-2`, `old-avd-3` (`avdmanager delete avd -n <name>`, plus their `.ini`) and `system-images;android-33;google_apis;x86_64` (`sdkmanager --uninstall`). Nothing else (no crew-* AVD, no other image). No emulator using them may be running. Record freed GB in `docs/measurements/slim.md`. Update infra.md and CLAUDE.md: the "never delete old-avd" rule is gone (the private-app integration was removed from this public repo on 2026-10-26; do not mention it).
  verify: `node -e "const fs=require('fs');const m=fs.readFileSync('docs/measurements/slim.md','utf8');if(!/old-avd/.test(m)||!/24\.7/.test(m))throw new Error('slim.md: no freed-space row for old-avd-1..3 + android-33 (24.7 GiB)');const i=fs.readFileSync('docs/infra.md','utf8');if(/삭제 금지|never delete/i.test(i))throw new Error('infra.md still forbids deleting old AVDs');console.log('docs ok')" && node scripts/check-public.mjs`
  done: `T17: summary` commit d6ca4c3 (merged 97c1821)

- [x] T37 [KO] `install` · `launch` · `logs` (FR-28)
  area: src/appctl.ts (new; do not grow src/app.ts), src/cli.ts, scripts/check-install.mjs, test/appctl.test.ts, probe-app/ (only if a log line is missing)
  model: sonnet
  review: required
  accept: `crewdroid install <serial|all> <apk> [--grant] [--json]`: `adb install -r [-g]`; `all` = every running crew device; result per device with package name (read with the T22 `apk` parser) and `Success`/the adb failure code (`INSTALL_FAILED_*` passed through verbatim, exit 1). `crewdroid launch <serial> <pkg> [--activity .Main] [--restart] [-- <am start extras>] [--json]`: activity resolved with `cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER <pkg>` when not given; `am start -W`; `--restart` = force-stop, wait 2 s, start (never `-S`, ADR 0005); returns component, TotalTime, and `crashed: true` + the crash summary (T22 triage) when the process is gone 2 s after start. `crewdroid logs <serial> <pkg> [--since 60s|<N>s|<N>m] [--level V|D|I|W|E] [--seconds N] [--json]`: only that app's lines (`logcat --pid` with `pidof`; if the app is not running, falls back to lines tagged with its last pid from `logcat -b all` and says so), `--seconds N` follows for N s then exits; output keeps logcat's time, level, tag, message (JSON: array of objects). MCP tools `install`, `launch`, `logs` (logs capped at 500 lines, newest last). `scripts/check-install.mjs`: 1 device; `install` probe APK -> Success + package `dev.crewdroid.probe`; `install` a non-APK file -> exit 1 with adb's failure text; `launch` without `--activity` -> resolves `.ProbeActivity`, TotalTime > 0; `launch --restart -- --es check crash` -> `crashed: true` with the exception name; `logs --since 2m --level I` contains a `CrewProbe` line and no line from another pid; `logs` for a package that is not installed exits 1; `down`.
  verify: `npm test && node scripts/check-install.mjs`

  done: `T37: install, launch and logs commands (FR-28)` commit 830a815

- [x] T38 [KO] `shot` · `tap` · `type` · `swipe` · `key` (FR-29)
  area: src/input.ts (new), src/shot.ts (new; reuses `unblack` from src/screen.ts), src/mcp.ts (tool results may be image content), src/cli.ts, probe-app/ (`check=form`: EditText id `name`, Button text `Send`, a 3-screen-tall ScrollView with a bottom TextView `END`; logs `CrewProbe FORM <text>` on Send and `CrewProbe SCROLL END` when END becomes visible), scripts/check-input.mjs, test/input.test.ts
  model: opus
  review: required
  accept: `crewdroid shot <serial> [file.png] [--json]`: runs `unblack` (API 31, ADR 0005), `exec-out screencap -p`, writes the PNG (default `./crewdroid-<serial>-<yyyymmdd-HHMMSS>.png`), prints the path, size and `blackRelaunch`. MCP `shot` returns MCP image content (`{type:"image", mimeType:"image/png", data:<base64>}`) plus one text line (path, w x h); extend the `Tool`/`serve()` contract in src/mcp.ts so a tool can return content items, without changing other tools' output. `crewdroid tap <serial> <x> <y>` | `--text <T>` | `--id <resource-id>` [--index N]: text/id matched against the `screen` tree (exact first, then case-insensitive contains); tap = centre of bounds via `input tap`; 0 matches or >1 without `--index` -> exit 1 listing candidates (text, id, bounds); returns what was tapped. `type <serial> <text> [--into <text|id>]` (taps the field first when `--into`): ASCII via `input text` with shell escaping (spaces, quotes, `&`, `%`); non-ASCII (e.g. Korean): find a way that works on ATD without installing a keyboard app (e.g. setting the clipboard then `input keyevent 279` PASTE) and verify it, else exit 1 with the reason and say so in README. `swipe <serial> up|down|left|right [--times N]` (screen-relative from `wm size`) or `swipe <serial> x1 y1 x2 y2 [ms]`. `key <serial> back|home|enter|delete|tab|menu|<KEYCODE_*>`. Coordinates outside `wm size` exit 1 before adb. MCP tools `shot`, `tap`, `type`, `swipe`, `key`. `scripts/check-input.mjs`: 1 device (API 34) + 1 device (API 36); probe `check=form`; `shot` -> PNG with the device's `wm size` dimensions and not one colour; MCP `shot` over the stdio SDK client returns an image item whose decoded PNG has the same size; `type --into name "hello world & 100%"` then `tap --text Send` -> `CrewProbe FORM hello world & 100%`; non-ASCII `type` -> either `FORM 안녕` or exit 1 with the documented reason (record which in the output); `tap --text Nothing` exits 1; `swipe up --times 6` -> `SCROLL END`; `key back` leaves the probe activity (focus changes); `tap 99999 1` exits 1; `down`.
  verify: `npm test && node scripts/check-input.mjs`

  done: `T38: shot, tap, type, swipe, key commands (FR-29)` commit afe1c75

- [x] T39 [KO] AI 바이브 코딩 루프 MCP 종단 검증 + `android-vibe-loop` 스킬 (FR-30)
  area: scripts/check-vibe-loop.mjs, .agents/skills/android-vibe-loop/SKILL.md, .agents/skills/crewdroid/SKILL.md (point to it first), src/mcp.ts (tool descriptions only), AGENTS.md (loop section)
  model: opus
  review: required
  accept: After T35-T38 are DONE. `scripts/check-vibe-loop.mjs` drives ONLY the MCP server over stdio with the official SDK client, like an agent would: `listTools` contains setup, up, devices, install, launch, shot, screen, tap, type, swipe, key, logs, down; `setup` (dry run) reports present; `up` {} -> 1 device; `install` probe APK; `launch` with `check=form` extras; `shot` -> image item; `screen` -> finds the `Send` button; `type` + `tap` -> `logs` (since 1m) contains `CrewProbe FORM`; `launch --restart` with `check=crash` -> `crashed:true`; `down`; prints each step's wall time and the total (target: whole loop < 3 min on this PC, record the number). Tool descriptions are tightened so an agent picks the right one (each says when to use it and what it returns; `screen` vs `shot`: tree vs pixels). `android-vibe-loop` SKILL.md (<= 120 lines, frontmatter rules as check-skills enforces, description triggered by "run/test my Android app", "see the app screen", "the app does not start", "build and check on a phone"): the loop with the exact MCP tool names and CLI equivalents, how to read `crashed`, `blackRelaunch`, multiple-match tap errors, and when to switch to the advanced skills. `crewdroid` umbrella skill points to it first. AGENTS.md gets a 10-line "Vibe-coding loop" section. `check-skills.mjs` and `check-agent-files.mjs` still pass.
  verify: `node scripts/check-vibe-loop.mjs && node scripts/check-skills.mjs && node scripts/check-agent-files.mjs`
  commit: 6ce0e3b T39: MCP end-to-end vibe loop check and android-vibe-loop skill (FR-30)

- [x] T42 [KO] 1대 `up` 이 왜 49초(ready 101초)인지 찾아 고치기 — 3대 혼합 때 API 36 은 3.1초였음 (FR-27, FR-04)
  origin: human /brief 2026-10-26 reading `docs/measurements/single.md` (T36): boot 48.9 s, ready 101.5 s for ONE device, while `docs/measurements/slim.md` / the 3-device runs showed snapshot boots of 3-9 s. The README pitch (T40) quotes "boots in seconds" — this must hold first.
  area: src/up.ts, src/snapshot.ts, src/identity.ts (makeDistinct timing only), scripts/check-single.mjs, docs/measurements/single.md
  model: opus
  review: required
  accept: Runs after T38 and before T40 (T40 depends on it). Find the cause with evidence before changing code: per phase timings of one `up` (launch -> adb device -> boot_completed -> hwui prop -> wm size/density -> makeDistinct/identity incl. framework restart -> ready), the emulator log (`%TEMP%\crewdroid-<avd>-<port>.log`: did it load the `default_boot` snapshot or cold boot? look for snapshot load / `-no-snapshot-load` / skin), whether the base snapshot was rebuilt (crewdroid-slim.json marker vs KNOBS), and compare the same profile in a 3-device run. Fix the cause (e.g. a snapshot that is not loaded, a needless re-prepare, a fixed sleep, makeDistinct's restart on a single device where no clone collides — a single device needs no distinct identity) without changing KNOBS / launch flags beyond what the cause requires. Target: 1 device ready <= 20 s on a prepared snapshot (API 34 and 36), boot <= 10 s; if not reachable, record why with the measured phases. `check-single.mjs` asserts ready <= 20 s (mean of 3) and writes the phase table to single.md; `check-up.mjs` (3 devices) still passes.
  verify: `node scripts/check-single.mjs && node scripts/check-up.mjs`
  commit: 03750ed

- [x] T43 [KO] macOS(Apple Silicon)·Linux 에서도 돌게: Windows 전용 코드 걷어내기 (FR-33)
  origin: human /brief 2026-10-26, user: "이거 mac에서도 돌아가야해". Today `up`/`down`/`devices`/`slim` call PowerShell (`src/emulator.ts` Start-Process, `Get-CimInstance Win32_Process` in up.ts/mcp.ts/measure.ts/snapshot.ts, NTFS `compact` + GetCompressedFileSizeW in slim.ts) and every image path hard-codes `x86_64` (avd.ts, profiles.ts, slim.ts, snapshot.ts), so nothing boots on a Mac.
  area: src/platform.ts (new: launchDetached, listProcesses, killTree, hostAbi), src/emulator.ts, src/up.ts (down/devices process listing only), src/mcp.ts (devices listing only), src/measure.ts, src/snapshot.ts, src/slim.ts, src/avd.ts, src/profiles.ts, src/setup.ts (reuse its imageAbi), test/platform.test.ts, README.md + README.ko.md (Requirements: macOS/Linux lines), AGENTS.md (one line)
  model: opus
  review: required
  accept: Runs after T42 and before T40 (T40 states supported platforms). One module `src/platform.ts` owns every OS difference; no other file calls `powershell`, `compact`, `Get-CimInstance` or checks `process.platform` for process work. Windows keeps exactly today's behaviour (same PowerShell commands, moved, not rewritten). macOS/Linux: emulator launched with `spawn(..., { detached: true, stdio: ["ignore", logFd, logFd] }).unref()` (headless, no window unless `--window`), processes listed with `ps -axo pid=,ppid=,rss=,%cpu=,command=`, killed with `process.kill` (TERM, then KILL after 5 s), RAM = RSS (shared pages not split; say so in the JSON `method` field). ABI from `os.arch()`: arm64 -> `arm64-v8a`, x64 -> `x86_64`, used by avd.ts/profiles.ts/slim.ts/snapshot.ts/setup.ts (single helper). `slim` on macOS/Linux: skip the NTFS sparse/compress steps with a `skipped: "NTFS only"` note, keep the snapshot zero-fill and stale-file cleanup; disk is measured with `du -k` (allocated blocks) there. Hardware acceleration check: macOS Hypervisor.framework / Linux `/dev/kvm` via `emulator -accel-check`, reported by `setup` (T35). Lock file and temp paths via `os.tmpdir()` (already). `test/platform.test.ts`: with platform/arch injected (no real OS needed) -> Windows uses the PowerShell commands, darwin/linux use spawn+ps, arm64 -> arm64-v8a image package `system-images;android-34;google_atd;arm64-v8a`; parsing of a captured `ps -axo` sample finds the crew-* qemu processes. On this Windows PC `check-single.mjs`, `check-up.mjs` and `check-input.mjs` still pass (no regression). Grep proves the rule: `rg -n "powershell|Get-CimInstance|compact\b" src` hits only src/platform.ts.
  verify: `npm test && node -e "const fs=require('fs');const bad=[];for(const f of fs.readdirSync('src').filter(f=>f.endsWith('.ts')&&f!=='platform.ts'))fs.readFileSync('src/'+f,'utf8').split('\n').forEach((l,i)=>{if(/powershell|Get-CimInstance|run\(.compact|x86_64/.test(l))bad.push(f+':'+(i+1))});if(bad.length)throw new Error('OS-specific code outside src/platform.ts: '+bad.join(' '));console.log('platform isolated')" && node scripts/check-single.mjs && node scripts/check-up.mjs`
  manual: on an Apple Silicon Mac: `npx crewdroid setup --yes` -> `npx crewdroid up` -> `npx crewdroid shot emulator-5580` -> `npx crewdroid down`; record times in docs/measurements/single.md (macOS row). Same on Linux with KVM (test-cases.md FR-33).
  commit: 4ab6e82

- [x] T41 [KO] 바이브 코딩 데모 GIF + 0.2.0 준비 (FR-32)
  area: scripts/demo-vibe.mjs, docs/demo/vibe.gif, docs/measurements/demo-vibe.json, scripts/check-demo-gif.mjs (1-panel mode), package.json + server.json (version 0.2.0), CHANGELOG.md, docs/release.md (0.2.0 steps)
  model: sonnet
  review: required
  accept: After T39 is DONE. `node scripts/demo-vibe.mjs`: 1 device (`up`), records its screen (src/record.ts) while running the loop through the CLI: install probe -> launch `check=form` -> type -> tap Send -> swipe -> `fold`-free; each step burned in as a caption (ffmpeg drawtext: `crewdroid install`, `crewdroid tap --text Send`, ...); a 2 s tail card with the measured loop time from T39; `docs/demo/vibe.gif` <= 3 MB, <= 25 s, 480 px high, 8 fps; `docs/measurements/demo-vibe.json` with `gif.panels` (1 panel) and step timings; down. `check-demo-gif.mjs` accepts 1..3 panels (`--panels 1`), still rejects a flat or static panel. Do not touch README (T40 puts the GIF in the hero). Version 0.2.0 in package.json and server.json (both packages[0].version and version); CHANGELOG.md (English, Keep a Changelog style) 0.2.0 = setup, single-device up/devices, install/launch/logs, shot/tap/type/swipe/key, vibe-loop skill, API 31 black-screen recovery, Node >= 22; 0.1.0 = first release. docs/release.md: the 0.2.0 steps the user runs (office PC: `git pull`, `npm publish --access public` + browser approval; any PC: `mcp-publisher login github` + `mcp-publisher publish`). Do not publish.
  verify: `node scripts/demo-vibe.mjs && node scripts/check-demo-gif.mjs --mvp docs/measurements/demo-vibe.json --gif docs/demo/vibe.gif --panels 1 --max-mb 3 --max-seconds 25 && node scripts/check-public.mjs`
  commit: faa7181 (+97a26d4 plugin.json)


- [x] T33 [AUTO] `net slow` lets a 2 MB upload finish (ADR 0006 open question, FR-05/FR-09)
  origin: auto-plan (docs/adr/0006-fold.md:32 [모름])
  area: src/net.ts (shape() only), probe-app/app/src/main/kotlin/dev/crewdroid/probe/Sample.kt (http() only), scripts/check-slow-upload.mjs, docs/adr/0006-fold.md
  model: sonnet
  review: required
  accept: Runs after T32. `node scripts/check-slow-upload.mjs` boots 1 device (`crewdroid up --count 1`), starts the clean sample server on a free port, sets `net slow`, sends a 2 MB upload through the probe app, and passes only if `CrewProbe SYNCED` appears within 120 s and the server has exactly 1 row for the key; repeats 3 times; prints measured seconds; always downs. Also runs the fold path once (fold mid-upload, stay on slow, as in ADR 0006). If every run passes before any code change, do not edit shape()/http(): write "not reproduced without/with fold" with the measured times in ADR 0006 instead. Otherwise find the cause first with evidence (tbf burst/latency drops, the 10 s watchdog, readTimeout 20 s), then fix it in shape() or http(); the slow profile stays "very slow" (1024 kbit, 300 ms) — do not raise those numbers. No launch flag / AVD config / KNOBS change. Replace the open-question line in ADR 0006 with the cause and the measured times. If shape() changed, `check-scenario.mjs` must pass too (add it to the run); if only http() changed, say why scenarios are unaffected.
  verify: `node scripts/check-slow-upload.mjs && node scripts/check-net.mjs && node scripts/check-offline.mjs`
  done: T33: commit 0058e84

- [x] T44 [KO] 15초 소개 모션 그래픽 `docs/demo/hero.gif` — 처음 보는 사람이 "뭐 하는 도구인지" 15초 안에 알게 (FR-34)
  origin: human /brief 2026-10-26, user: "꼭 소개를 멋지게 넣어줘 지금은 그냥 이 프로젝트가 도대체 뭐하는 프로젝트인지 잘 몰라 15초짜리 소개 모션그래픽을 넣어도 돼".
  area: scripts/hero/ (index.html + hero.css + storyboard.json + render.mjs), scripts/check-hero.mjs, docs/demo/hero.gif, docs/demo/hero-poster.png, docs/measurements/hero.json, package.json (devDependency `playwright` pinned; it is not shipped — `files` unchanged)
  model: opus
  review: required
  accept: Runs after T43 (uses the final numbers: 1-device ready 7.3 s from `docs/measurements/single.md`, loop 79 s from `docs/measurements/demo-vibe.json`, disk/RAM from slim.md/ram.md — read them from those files at render time, never type numbers by hand). Follow the `design-rules` skill (readable text: min 28 px at 960 px width, contrast >= 4.5:1, no thin grey text; nothing cut at the edges; one font family, at most 2 accent colours, dark background so GitHub dark and light themes both look right). Authored as an HTML/CSS animation (`scripts/hero/index.html`, CSS keyframes + a tiny JS clock, no network fonts — bundle or use a system font stack) and rendered deterministically: `scripts/hero/render.mjs` opens it in headless Chromium (Playwright), steps a virtual clock frame by frame (30 fps, 15 s = 450 frames, `page.clock` or a `?t=` parameter — no real-time capture), screenshots each frame at 960x540, then ffmpeg (palettegen/paletteuse, 15 fps in the GIF) -> `docs/demo/hero.gif` <= 5 MB, plus `hero-poster.png` (the final frame). Real footage, not mock phones: before rendering, `render.mjs` boots devices (`up --count 3` mixed: s24ultra, fold5-main, flip7-main) and captures `shot` PNGs of the probe app (and frames from `docs/demo/vibe.gif`) to embed; down afterwards. Storyboard (`storyboard.json`, scene start/end in s, the checker reads it): (1) 0-3 s the problem: "Android Studio emulator: heavy, one window, built for clicking" with a big heavy window icon fading out; (2) 3-6 s the answer: terminal types `npx crewdroid up` -> a real phone screenshot pops in, counter "ready in 7.3 s" (number from single.md); (3) 6-9 s "Any Android version, any screen": 3 real captures of different sizes/APIs slide in side by side with API labels; (4) 9-12.5 s "Your AI agent drives it": `install -> launch -> shot -> tap` steps light up one by one next to real vibe.gif frames, MCP / Claude Code / Cursor wordmarks as plain text; (5) 12.5-15 s logo text "crewdroid", tagline "Lightweight Android emulator for AI coding agents", and `npx crewdroid setup` in a code pill. `scripts/check-hero.mjs`: GIF exists, <= 5 MB, 14-16 s, width >= 900; storyboard has 5 scenes covering 0-15 s; the frame at the middle of every scene is not flat (top colour <= 90 %) and differs from the neighbouring scene's middle frame (> 10 % pixels changed); the numbers shown in scene 2 equal those in single.md (render.mjs writes what it used to `docs/measurements/hero.json`, the checker compares). The user judges the look (manual).
  verify: `node scripts/hero/render.mjs && node scripts/check-hero.mjs`
  manual: the user watches docs/demo/hero.gif on the GitHub page (light and dark theme) and says whether it explains the tool in 15 s (test-cases.md FR-34).
  done: T44: commit ee5c829

- [x] T45 [AUTO] `check-net` and `check-offline` fail on the current main with the original probe code (net state not applied / RETRY never seen) (FR-05, FR-09)
  origin: T33 verify (.ai-log/evidence/T33-master-net-orig.txt, T32-offline-1.txt)
  area: src/net.ts, scripts/check-net.mjs, scripts/check-offline.mjs (diagnosis first; touch only what the cause needs)
  model: opus
  review: required
  accept: Find the cause with evidence, then fix it in code (not by loosening the checks). Observed: check-net "online baseline" or "airplane: upload fails" and "interrupted mid-transfer" claims fail — upload succeeds under airplane, and `slow` then `nodata` after 3 s does not stop a 1 MB upload (finished in 3.4 s); check-offline "timeout 60s waiting for RETRY p3". Suspects to test, not assume: net state applied before the cellular network is up after boot (`Network is unreachable` window after `net slow` seen in T33); a regression from T42 (single-device `up` skips root waits) or T43 (`src/platform.ts`); `git bisect` between the last commit where `check-net` passed (see docs/measurements or .ai-log/evidence for older green runs) and HEAD. No launch flag / AVD config / KNOBS change.
  verify: `node scripts/check-net.mjs && node scripts/check-offline.mjs`
  commit: ba0a1ac T45: net waits for the state to settle and cuts the link before restoring

- [x] T48 [KO] 소개 영상용 진짜처럼 보이는 데모 앱 + 실제 동작 녹화 클립 (FR-34)
  origin: human 2026-10-26 on T44's hero.gif: "소개영상 솔직히 너무 구리잖아 실제 어플을 기동한다 뭐 이런걸 넣어야지 ㅠㅜ 왜 이렇게 대충 만드는거야". Cause (planner's fault): T44 was told to embed still screenshots of the test probe app (navy screen, 5 lines of small text). The hero must show a real-looking app MOVING on real emulators.
  area: demo-app/ (new Android module or a second flavor of probe-app, package `dev.crewdroid.demo`, never touching the probe's check= targets), scripts/hero/clips.mjs, docs/demo/clips/*.mp4 (git-ignored if > 2 MB each; keep the script reproducible), docs/measurements/hero-clips.json
  model: opus
  review: required
  accept: A small but polished "Field Notes" app (Material 3 / Material Components, light theme with one strong accent colour, real app bar, cards with bundled vector illustrations or generated colour thumbnails, FAB "New note", bottom sheet editor, list animations, a sync chip "Synced ✓" / "Offline · N pending", pull-to-refresh). It works against the sample server (`sample/server`, POST /records) through an outbox like the probe so going offline really shows pending items and reconnecting really syncs them. Looks like a Play Store app at first glance — follow the `design-rules` skill (contrast, sizes, nothing cut on s24ultra/fold5-main/flip7-main screens; verify with `shot` on all three). `scripts/hero/clips.mjs` records REAL footage with `settings put system show_touches 1` (touch dots visible) on API 34/36 devices (avoid API 31, ADR 0005) using src/record.ts, driven by crewdroid commands only (`launch`, `tap --text`, `type`, `swipe`, `net`, `fold`/`unfold`, `env dark on`), and saves trimmed clips: (a) `boot.mp4` 3 devices from `up` start to the app's first frame (real timing), (b) `agent.mp4` one device: tap FAB -> type "Fix pump #3" -> Save -> card animates into the list, (c) `offline.mp4` two devices: `net airplane` on one -> its chip turns "Offline · 1 pending" while the other stays synced -> `net online` -> both show the new card, (d) `fold.mp4` fold5 unfold/fold with the layout reflowing to 2 columns, (e) `dark.mp4` `env dark on` flip. `hero-clips.json` lists every clip with duration, device, and the crewdroid command sequence + timestamps (T50 overlays those commands in sync). Check: every clip exists, 2-8 s, frames change throughout (no frozen second), first and last frames differ, and the app's main screen PNG from `shot` on all 3 profiles has no text clipped at the edges (uiautomator bounds inside the screen) and passes a contrast check on its text colours.
  verify: `node scripts/hero/clips.mjs && node -e "const j=require('./docs/measurements/hero-clips.json');const need=['boot','agent','offline','fold','dark'];for(const n of need){const c=j.clips.find(x=>x.name===n);if(!c||c.seconds<2||c.seconds>8||!c.changesThroughout)throw new Error('clip '+n+' missing or static: '+JSON.stringify(c))}if(!j.layoutOk||!j.contrastOk)throw new Error('demo app layout/contrast check failed');console.log('clips ok')"`
  manual: the user looks at the 5 clips (test-cases.md FR-34).
  commit: bfc6b69 T48: Field Notes demo app + 5 real emulator clips

- [x] T49 [KO] "AI 가 더 잘, 더 빨리 다룬다"를 숫자로: 에이전트 조작 벤치마크 (FR-35)
  origin: human 2026-10-26: "AI가 이 에뮬을 더 잘 다루고 빠르게 다룬다는게 최고의 강점이야 너무 대충 만들지마". The pitch and the hero must prove this with measured numbers, not adjectives.
  area: scripts/bench-agent.mjs, docs/measurements/agent-bench.json, docs/measurements/agent-bench.md, src/screen.ts (only if a faster tree dump is found)
  model: opus
  review: required
  accept: After T48 (uses the Field Notes demo app). Same task, same device (s24ultra, API 34), 5 runs each, deterministic (no LLM): "open the app, add a note 'Fix pump #3', confirm it appears in the list". Path A = crewdroid way an agent uses it: `screen` (JSON tree) to observe, `tap --text` / `type` to act, `logs` to confirm. Path B = screenshot way (how pixel-based agents and computer-use drive an emulator window): `screencap -p` PNG to observe after every action, tap by coordinates found from that image (use the tree only to compute the coordinates the vision model would have to find — note this favours B). Measure per step and total: wall time, number of tool calls, observation payload bytes, and estimated model input tokens (text: chars/4; image: Anthropic's documented formula, tokens ≈ width*height/750 after scaling the long edge to <= 1568 px — cite the doc URL in the md), plus failure modes seen. Also measure "time to first usable device": crewdroid `up` (1 device) vs a stock AVD cold boot with a window (`emulator -avd <stock>` with Android Studio's default flags, then boot_completed) — reuse T01 numbers only if the same machine; otherwise measure now with a fresh google_atd AVD without crewdroid's slim/snapshot. Write `agent-bench.md` (table: A vs B, ratio column) and JSON. Honest wording: the numbers are observation cost and latency, not a model's success rate. The md ends with a 3-line "what this means for an agent" summary used by T50 and T40.
  verify: `node scripts/bench-agent.mjs && node -e "const j=require('./docs/measurements/agent-bench.json');for(const k of ['A','B'])if(!(j[k]&&j[k].runs===5&&j[k].tokensPerTask>0&&j[k].secondsPerTask>0))throw new Error('bench '+k+' incomplete');if(!(j.firstDevice&&j.firstDevice.crewdroidSeconds>0&&j.firstDevice.stockSeconds>0))throw new Error('first-device timing missing');console.log('bench ok A/B tokens',j.A.tokensPerTask,j.B.tokensPerTask)"`
  commit: 1274c6b T49: agent bench measured
