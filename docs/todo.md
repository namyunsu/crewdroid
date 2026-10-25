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


Wave 2026-10-26 human /brief — user (`docs/source/requirements-2026-10-25.md`): every feature that fits the light AVD, maximum exposure to AI agents, Android-specialised skills, GitHub stars; "오토파일럿이 만들 투두를 세심하게 짜야해". Decisions (do not re-ask): wave order = AI exposure + release prep first; sample-server idempotency respected in normal mode only; API 31 SurfaceView gets an investigation Todo; LICENSE MIT; going public / `npm publish` / registry submissions are the user's own actions. Research with sources: `docs/source/research-ai-discoverability.md` (channels), `docs/source/research-emulator-features.md` (commands, ATD/headless caveats, cost). New FR-16..FR-25.
Rules for this wave (on top of the 2026-10-23 rules above):
- Lightness check for every runtime feature: no change to launch flags / AVD config / `KNOBS`; record 3-device idle RAM+CPU before/after in `docs/measurements/features.md` (append a row per Todo); anything over +5 % idle RAM becomes an opt-in flag.
- Emulator order (one per batch): T16 -> T17 -> T22 -> T26 -> T29 -> T18 -> T19 -> T20 -> T21 -> T28. Non-emulator Todos run beside them when areas do not overlap: batch 1 T16+T23+T24, batch 2 T17+T27, batch 3 T22+T25, then T26 (needs T22, T25 DONE).
- MCP pattern (T24 defines it): every feature module exports `mcpTools` and `src/mcp.ts` collects them; T20/T21/T22 add their tools that way when T24 is DONE, else leave a `// TODO mcpTools` line and T24's follow-up picks it up.
- Probe/sample app changes (Kotlin) are built with the Gradle wrapper the way T02/T09 did; the debug APK path stays `probe-app/app/build/outputs/apk/debug/app-debug.apk`.
- Another process holding the emulators (lock `%TEMP%\crewdroid-emulators.lock` owner alive and not yours) -> write `.ai-log/BUSY` and hand off (autopilot-step §1), never kill it.





- [ ] T29 BLOCKED:샘플 앱 화면이 정지라 녹화에 움직임이 없음 — probe-app 에 주기 갱신 UI 추가(영역에 probe-app 포함)할지 결정 필요. 시도 1 코드는 git stash "T29-1 attempt" [KO] 공개용 데모 GIF: 샘플 앱 혼합 3대 + 판정 결과 (FR-23)
  area: scripts/demo-gif.mjs, src/record.ts (shared recorder from T16), docs/demo/demo.gif, scripts/check-demo-gif.mjs (`--max-mb --max-seconds`), docs/measurements/demo.json
  model: sonnet
  review: required
  accept: After T16 is DONE (recorder). `node scripts/demo-gif.mjs`: `up --count 3` with s24ultra@API34, fold5-main@API34, flip7-main@API36, start the sample server with `BUGGY=1` on a free port, record the 3 screens side by side while `crewdroid run scenarios/photo-upload.json --seed 1 --server-port <port>` runs (same recorder as mvp-private-app, timestamp overlay cropped), then append a 3 s tail that shows the judge summary text (ffmpeg drawtext, e.g. `VIOLATION duplicate: 2 rows`), write `docs/demo/demo.gif` (<= 3 MB, 480 px high, <= 20 s, 8 fps) and `docs/measurements/demo.json` (`gif.panels` like mvp.json + the judge result). Nothing from private-app appears. `check-demo-gif.mjs` keeps T13's rules (3 live panels with pairwise different ratios) and gains `--max-mb 3 --max-seconds 20`.
  verify: `node scripts/demo-gif.mjs && node scripts/check-demo-gif.mjs --mvp docs/measurements/demo.json --gif docs/demo/demo.gif --max-mb 3 --max-seconds 20`
