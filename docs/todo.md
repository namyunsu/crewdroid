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

- [ ] T15 [KO] 디스크 3대 ≤ 8GB (FR-12)
  area: src/avd.ts, src/snapshot.ts, src/slim.ts (new), src/cli.ts, scripts/check-disk.mjs, docs/measurements/slim.md
  model: opus
  review: required
  accept: `crewdroid slim` (also run by `prepare`) makes crewdroid's disk small without changing behaviour. Candidates, each measured before/after with real allocation (`fsutil file layout` / `GetCompressedFileSize` / `du`, not file length): (1) system images stored sparse — rewrite each `system-images/*/google_atd/x86_64/*.img` as an NTFS sparse file (zero ranges deallocated) or another lossless form the emulator still boots; keep a checksum so the content is provably identical; (2) quickboot snapshot slimmed — smaller `hw.ramSize` (from T16 if done, else 1536), one snapshot only (`default_boot`), delete stale ones, try emulator snapshot compression if available; (3) `disk.dataPartition.size` 2G for new AVDs; (4) anything else found (e.g. dedupe identical files across images by hard link). Report each knob's saving in `docs/measurements/slim.md`. Result: 3 images (API 31/34/36) + 3 base AVDs + 3 running clones' temp files <= 8 GB allocated, and boot time not worse than T04 by more than 20 %.
  verify: `npx tsx src/cli.ts slim --json && node scripts/check-disk.mjs --max-gb 8 && npx tsx src/cli.ts up --count 3 --json > docs/measurements/up.json && node scripts/check-up.mjs docs/measurements/up.json && npx tsx src/cli.ts down && node scripts/check-scenario.mjs && node scripts/mvp-private-app.mjs --runs 1`

- [ ] T16 [KO] 호스트 RAM 3대 ≤ 4.2GB (FR-13)
  area: src/avd.ts, src/emulator.ts, src/measure.ts, src/up.ts, scripts/check-ram.mjs, docs/measurements/ram.md
  model: opus
  review: required
  accept: First fix the measure: report per emulator process Private Bytes / private working set and shared working set separately, and a 3-device total that counts shared pages once (clones of one snapshot share file-backed pages); keep the old working-set number for comparison with T01. Then sweep knobs one at a time on 3 mixed devices and record each in `docs/measurements/ram.md`: `hw.ramSize` 768/1024/1536, guest low-RAM props (`ro.config.low_ram=true`, smaller `dalvik.vm.heapsize`) if settable on ATD, `vm.heapSize`, audio off in config, unused sensors/front camera off, gpu mode (host vs swiftshader_indirect vs guest — keep whatever T14 needs for rendering), quickboot file-backed RAM on/off (`-feature -QuickbootFileBacked` or equivalent), cold boot vs snapshot. Adopt the smallest combination that still passes `check-scenario` and `mvp-private-app --runs 1` (WebRTC call). Result: 3-device host RAM total <= 4.2 GB by the corrected measure, and the old working-set number also reported. If 4.2 GB cannot be reached without breaking a test, stop BLOCKED with the best number, the knob that broke what, and the remaining options.
  verify: `node scripts/check-ram.mjs --count 3 --max-mb 4300 && node scripts/check-scenario.mjs && node scripts/mvp-private-app.mjs --runs 1`

- [ ] T17 [KO] T16 통과 후 옛 AVD 3대 + android-33 google_apis 이미지 삭제
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
  area: src/fold.ts, src/cli.ts, src/avd.ts (foldable AVD config if needed), profiles/galaxy.json (fold pairs), scripts/check-fold.mjs, sample app (log configuration changes), docs/adr/0004-fold.md
  model: opus
  review: required
  accept: Fold/Flip profiles carry both screens (cover + main, from research-samsung-screens.md). `crewdroid fold <serial>` / `unfold <serial>` switches cover <-> main so the app gets a real configuration change (new screen size). Find what works on our ATD images and record it in ADR 0004 with evidence: emulator foldable support (`hw.sensor.hinge*` / foldable AVD config + `adb emu fold|unfold`), `cmd device_state state <id>`, or fallback `wm size/density` swap (honest about what the fallback does not emulate: hinge posture, half-open). The sample app logs `CrewProbe CONFIG <w>x<h>` on each configuration change and keeps its outbox/in-progress upload across fold/unfold (a fold during upload is a test case).
  verify: `node scripts/check-fold.mjs` (up a fold5 + flip6 profile; unfold/fold each; CONFIG lines show both sizes; screencap sizes change; an upload started before a fold completes exactly once on the server; down)
