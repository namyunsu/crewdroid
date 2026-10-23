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
