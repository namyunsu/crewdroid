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

Wave 2026-10-23 human /brief — lightness regressed (T04: disk +56 % with 3 versions, RAM +14 %); user: "RAM 이랑 디스크 확 줄여야지, 무조건". New FR-12 (disk <= 8 GB for 3 mixed devices) and FR-13 (host RAM <= 4.2 GB for 3). Measured 2026-10-23 by /brief (`du`): ATD system.img is stored fully allocated — API 34 8.1 GB, API 31 4.1 GB, API 36 1.8 GB, though the API 34 zip is ~0.7 GB (mostly zero blocks); each crew AVD's `snapshots/` is 3.5-4.7 GB (quickboot RAM image of `hw.ramSize=2048` + more); `disk.dataPartition.size=10G`; config still has `hw.audioInput/Output=yes`, most sensors on, `hw.gpu.enabled=no`. Order: T13 -> T14 -> T15 -> T16 (all touch AVD config/launch; T14 may change gpu/image settings T15/T16 then measure). Both T15 and T16 re-run `check-up`, `check-scenario` and `mvp-private-app --runs 1` so nothing that passed breaks. Never touch old-avd-1..3 or the android-33 google_apis image (deletion needs the user's yes).

- [ ] T17 BLOCKED:삭제 명령이 자동 권한 분류기에 거부됨(사용자가 직접 삭제 허용 또는 수행 필요) [KO] T16 통과 후 옛 AVD 3대 + android-33 google_apis 이미지 삭제
  origin: user approval in /brief 2026-10-23, verbatim: "T16 까지 통과하면 old-avd-1~3 과 android-33 google_apis 이미지 지워도 돼. 그 전엔 두고."
  area: docs/infra.md, CLAUDE.md (Gotchas), docs/measurements/slim.md
  model: haiku
  review: required
  accept: Run only when `.ai-log/status.md` shows T15 and T16 DONE (reviewer APPROVE); otherwise stay TODO. Delete exactly: AVDs `old-avd-1`, `old-avd-2`, `old-avd-3` (`avdmanager delete avd -n <name>`, plus their `.ini`) and `system-images;android-33;google_apis;x86_64` (`sdkmanager --uninstall`). Nothing else (no crew-* AVD, no other image). No emulator using them may be running. Record freed GB in `docs/measurements/slim.md`. Update infra.md and CLAUDE.md: the "never delete old-avd" rule is gone; private-app' `avd-up.ps1` would now try to recreate old-avd-N from the missing image, so private-app multi tests must run with `crewdroid up --count 3 --base-port 5570` first (as `scripts/mvp-private-app.mjs` does).
  verify: `node scripts/mvp-private-app.mjs --runs 1 && node -e "const fs=require('fs'),os=require('os'),p=require('path');const a=p.join(os.homedir(),'.android/avd');const bad=fs.readdirSync(a).filter(f=>/^old-avd-/.test(f));if(bad.length)throw new Error('left: '+bad);console.log('AVD gone')" && node -e "const fs=require('fs');const s=(process.env.ANDROID_SDK_ROOT||'C:/Users/NYS/scoop/apps/android-clt/current')+'/system-images/android-33/google_apis';if(fs.existsSync(s))throw new Error('image left');console.log('image gone')"`

Wave 2026-10-24 human /brief — user: "가로세로규격을 내가 임의로 넣을수도있어야해", screens bigger than the monitor for HMI work, fold/unfold for Fold/Flip ("나머지 기종은 결국 가로세로 길이만 다른거"). New FR-14, FR-15. Both after T16 (they touch `src/up.ts` / AVD config like T14-T16). Screens must render (T14) for the screenshot checks below.

- [ ] T18 [KO] 임의 화면 규격 + 모니터보다 큰 화면 (FR-14)
  area: src/up.ts, src/profiles.ts, profiles/galaxy.json (schema only), profiles/custom.example.json, src/cli.ts, scripts/check-size.mjs, docs/measurements/size.md, README.md (usage lines)
  model: sonnet
  review: required
  accept: `crewdroid up` takes ad-hoc screens next to named profiles: `--screen 1920x720@160` (WxH@density, density optional -> derived for ~360dp width) and repeatable/comma list, e.g. `--screen 1080x2340@450,3840x2160@320 --count 2`; a user profile file (`--profiles-file my.json`, same schema as galaxy.json, `profiles/custom.example.json` shows an HMI entry) also works. Invalid input (0, negative, non-number, missing x) -> clear error, exit 1, nothing launched. Measure and document in `docs/measurements/size.md` the largest size that boots and renders on API 34/36 ATD (try 3840x2160, 5120x1440, 7680x2160) with boot time and host RAM per size; sizes over the host monitor work headless and in `--window` mode (scaled window, full-resolution screenshot).
  verify: `node scripts/check-size.mjs` (up 2 devices with `--screen 1920x720@160,3840x2160@320`; `wm size`/`wm density` match; screencap PNG dimensions equal the requested sizes and are not uniform; bad `--screen 0x100` exits 1; down)

- [ ] T19 [KO] 폴드·플립 접기/펴기 (FR-15)
  area: src/fold.ts, src/cli.ts, src/avd.ts (foldable AVD config if needed), profiles/galaxy.json (fold pairs), scripts/check-fold.mjs, sample app (log configuration changes), docs/adr/0006-fold.md
  model: opus
  review: required
  accept: Fold/Flip profiles carry both screens (cover + main, from research-samsung-screens.md). `crewdroid fold <serial>` / `unfold <serial>` switches cover <-> main so the app gets a real configuration change (new screen size). Read `docs/source/research-emulator-features.md` §k first (fold/posture need `hw.sensor.hinge*` in the AVD config, so a foldable needs a second base AVD + snapshot — count its disk in the ADR; `resize-display` is not supported headless). Find what works on our ATD images and record it in ADR 0006 with evidence: emulator foldable support (`hw.sensor.hinge*` / foldable AVD config + `adb emu fold|unfold`), `cmd device_state state <id>`, or fallback `wm size/density` swap (honest about what the fallback does not emulate: hinge posture, half-open). The sample app logs `CrewProbe CONFIG <w>x<h>` on each configuration change and keeps its outbox/in-progress upload across fold/unfold (a fold during upload is a test case).
  verify: `node scripts/check-fold.mjs` (up a fold5 + flip6 profile; unfold/fold each; CONFIG lines show both sizes; screencap sizes change; an upload started before a fold completes exactly once on the server; down)

Wave 2026-10-26 human /brief — user (`docs/source/requirements-2026-10-25.md`): every feature that fits the light AVD, maximum exposure to AI agents, Android-specialised skills, GitHub stars; "오토파일럿이 만들 투두를 세심하게 짜야해". Decisions (do not re-ask): wave order = AI exposure + release prep first; sample-server idempotency respected in normal mode only; API 31 SurfaceView gets an investigation Todo; LICENSE MIT; going public / `npm publish` / registry submissions are the user's own actions. Research with sources: `docs/source/research-ai-discoverability.md` (channels), `docs/source/research-emulator-features.md` (commands, ATD/headless caveats, cost). New FR-16..FR-25.
Rules for this wave (on top of the 2026-10-23 rules above):
- Lightness check for every runtime feature: no change to launch flags / AVD config / `KNOBS`; record 3-device idle RAM+CPU before/after in `docs/measurements/features.md` (append a row per Todo); anything over +5 % idle RAM becomes an opt-in flag.
- Emulator order (one per batch): T16 -> T17 -> T22 -> T26 -> T29 -> T18 -> T19 -> T20 -> T21 -> T28. Non-emulator Todos run beside them when areas do not overlap: batch 1 T16+T23+T24, batch 2 T17+T27, batch 3 T22+T25, then T26 (needs T22, T25 DONE).
- MCP pattern (T24 defines it): every feature module exports `mcpTools` and `src/mcp.ts` collects them; T20/T21/T22 add their tools that way when T24 is DONE, else leave a `// TODO mcpTools` line and T24's follow-up picks it up.
- Probe/sample app changes (Kotlin) are built with the Gradle wrapper the way T02/T09 did; the debug APK path stays `probe-app/app/build/outputs/apk/debug/app-debug.apk`.
- Another process holding the emulators (lock `%TEMP%\crewdroid-emulators.lock` owner alive and not yours) -> write `.ai-log/BUSY` and hand off (autopilot-step §1), never kill it.

- [ ] T20 [KO] `crewdroid env` 기기 환경 조작: 위치·배터리·센서/회전·다크·글자·앱 로케일·통신망·SMS/통화 (FR-16)
  area: src/env.ts, src/cli.ts, probe-app/ (`check=env` logs the state it sees), scripts/check-env.mjs, test/env.test.ts, docs/measurements/features.md, README.md (env section)
  model: sonnet
  review: required
  accept: `crewdroid env <serial> <what> [args] [--json]`, every call through `src/adb.ts` (`adb -s <serial> emu …` / `shell …`), commands from `docs/source/research-emulator-features.md` §a-e: `geo <lon> <lat> [alt]` (then `cmd location set-location-enabled true`), `battery <0-100> [ac|unplugged]`, `rotate <0-3>` (`accelerometer_rotation 0` + `user_rotation`), `sensor acceleration x:y:z`, `dark on|off`, `font <scale>`, `locale <pkg> <tags>` (API 33+, `cmd locale set-app-locales`), `gsm data home|roaming|searching|denied|off|on`, `gsm signal <0-31> [--hold <sec>]` (the console value lasts 15 s; `--hold` re-sends every 10 s), `sms <from> <text>`, `call <number> [accept|cancel]`, and `show` (reads every state back: `settings get`, `dumpsys battery`, `dumpsys location`, `cmd uimode night`, `getprop`). Every setter reads its state back and exits 1 with a message when it differs; invalid values (`battery 150`, `rotate 9`, bad serial) exit 1 before any adb call. The probe app's `check=env` logs `CrewProbe ENV dark=<bool> font=<scale> rot=<n> battery=<pct> loc=<lat>,<lon>|none`. `scripts/check-env.mjs` boots 2 mixed devices, applies each command, checks read-back + the ENV log line, then appends the idle RAM/CPU before/after row to `features.md` and downs. `src/env.ts` exports `mcpTools` (wave rule).
  verify: `npm test && node scripts/check-env.mjs`

- [ ] T21 [KO] `crewdroid app` 앱 제어: 권한·딥링크/App Links·데이터 초기화·백업/복원·자원 압박 (FR-17)
  area: src/app.ts, src/cli.ts, probe-app/ (deep-link intent filters `crewdroid://probe/*` and `https://probe.crewdroid.example/*` with autoVerify; logs `CrewProbe LINK <uri>`), scripts/check-app.mjs, test/app.test.ts, docs/measurements/features.md, README.md (app section)
  model: sonnet
  review: required
  accept: `crewdroid app <serial> <pkg> <what> [args] [--json]` from `research-emulator-features.md` §f-i: `perm grant|revoke|show <permission…>` (`pm grant/revoke`; `show` parses `dumpsys package` runtime permissions into `{name, granted}`), `open <uri> [--pkg]` (`am start -a VIEW -c BROWSABLE -d`; "No Activity found" -> exit 1 with that message — ATD has no Chrome), `links show|force <domain>|reset` (`pm get-app-links` / `set-app-links --package <pkg> 2 <domain>` / `set-app-links --package <pkg> 0 all`, API 31+), `clear` (`pm clear`), `backup|restore` (`bmgr` local transport; if `LocalTransport` is absent on ATD exit 1 with that reason and record it in `features.md`), `pressure doze|standby <bucket>|trim <level>|bg-restrict|battery-saver|reset` (`dumpsys deviceidle force-idle`, `am set-standby-bucket`, `am send-trim-memory`, `appops set RUN_ANY_IN_BACKGROUND ignore`, `settings put global low_power 1`; `reset` undoes all), `fill-storage <GB>|free` (`fallocate` in `/data/local/tmp`, read back with `df /data`). Each setter reads back; bad permission name / unknown bucket exit 1 before adb. `scripts/check-app.mjs`: 2 mixed devices; grant -> show granted=true -> revoke -> false; `open crewdroid://probe/x` -> LINK line; `links force probe.crewdroid.example` then `open https://probe.crewdroid.example/y` -> LINK line and `links show` says approved; `clear` empties the outbox dir; doze -> `dumpsys deviceidle` shows IDLE; standby rare -> `am get-standby-bucket` 40; `fill-storage 2` -> `df` drops >= 2 GB then `free` restores; features.md row; down. `src/app.ts` exports `mcpTools`.
  verify: `npm test && node scripts/check-app.mjs`



- [ ] T29 BLOCKED:샘플 앱 화면이 정지라 녹화에 움직임이 없음 — probe-app 에 주기 갱신 UI 추가(영역에 probe-app 포함)할지 결정 필요. 시도 1 코드는 git stash "T29-1 attempt" [KO] 공개용 데모 GIF: 샘플 앱 혼합 3대 + 판정 결과 (FR-23)
  area: scripts/demo-gif.mjs, src/record.ts (shared recorder from T16), docs/demo/demo.gif, scripts/check-demo-gif.mjs (`--max-mb --max-seconds`), docs/measurements/demo.json
  model: sonnet
  review: required
  accept: After T16 is DONE (recorder). `node scripts/demo-gif.mjs`: `up --count 3` with s24ultra@API34, fold5-main@API34, flip7-main@API36, start the sample server with `BUGGY=1` on a free port, record the 3 screens side by side while `crewdroid run scenarios/photo-upload.json --seed 1 --server-port <port>` runs (same recorder as mvp-private-app, timestamp overlay cropped), then append a 3 s tail that shows the judge summary text (ffmpeg drawtext, e.g. `VIOLATION duplicate: 2 rows`), write `docs/demo/demo.gif` (<= 3 MB, 480 px high, <= 20 s, 8 fps) and `docs/measurements/demo.json` (`gif.panels` like mvp.json + the judge result). Nothing from private-app appears. `check-demo-gif.mjs` keeps T13's rules (3 live panels with pairwise different ratios) and gains `--max-mb 3 --max-seconds 20`.
  verify: `node scripts/demo-gif.mjs && node scripts/check-demo-gif.mjs --mvp docs/measurements/demo.json --gif docs/demo/demo.gif --max-mb 3 --max-seconds 20`
