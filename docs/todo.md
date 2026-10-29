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

Wave 2026-10-24 human /brief — user: "가로세로규격을 내가 임의로 넣을수도있어야해", screens bigger than the monitor for HMI work, fold/unfold for Fold/Flip ("나머지 기종은 결국 가로세로 길이만 다른거"). New FR-14, FR-15. Both after T16 (they touch `src/up.ts` / AVD config like T14-T16). Screens must render (T14) for the screenshot checks below.

Wave 2026-10-26 human /brief — user (`docs/source/requirements-2026-10-25.md`): every feature that fits the light AVD, maximum exposure to AI agents, Android-specialised skills, GitHub stars; "오토파일럿이 만들 투두를 세심하게 짜야해". Decisions (do not re-ask): wave order = AI exposure + release prep first; sample-server idempotency respected in normal mode only; API 31 SurfaceView gets an investigation Todo; LICENSE MIT; going public / `npm publish` / registry submissions are the user's own actions. Research with sources: `docs/source/research-ai-discoverability.md` (channels), `docs/source/research-emulator-features.md` (commands, ATD/headless caveats, cost). New FR-16..FR-25.
Rules for this wave (on top of the 2026-10-23 rules above):
- Lightness check for every runtime feature: no change to launch flags / AVD config / `KNOBS`; record 3-device idle RAM+CPU before/after in `docs/measurements/features.md` (append a row per Todo); anything over +5 % idle RAM becomes an opt-in flag.
- Emulator order (one per batch): T16 -> T17 -> T22 -> T26 -> T29 -> T18 -> T19 -> T20 -> T21 -> T28. Non-emulator Todos run beside them when areas do not overlap: batch 1 T16+T23+T24, batch 2 T17+T27, batch 3 T22+T25, then T26 (needs T22, T25 DONE).
- MCP pattern (T24 defines it): every feature module exports `mcpTools` and `src/mcp.ts` collects them; T20/T21/T22 add their tools that way when T24 is DONE, else leave a `// TODO mcpTools` line and T24's follow-up picks it up.
- Probe/sample app changes (Kotlin) are built with the Gradle wrapper the way T02/T09 did; the debug APK path stays `probe-app/app/build/outputs/apk/debug/app-debug.apk`.
- Another process holding the emulators (lock `%TEMP%\crewdroid-emulators.lock` owner alive and not yours) -> write `.ai-log/BUSY` and hand off (autopilot-step §1), never kill it.

Wave 2026-10-26 autopilot /brief auto (plan 2). Reviewer APPROVE 2/2 (`.ai-log/reviews/plan-2026-10-26.md`). Different files: may share a batch; T31 boots emulators.

Wave 2026-10-26 autopilot /brief auto (plan 3). Reviewer APPROVE 3/3 (`.ai-log/reviews/plan-2026-10-26-3.md`). T32 and T33 boot emulators and build the probe APK: T32 first, T33 in a later batch. T34 may share a batch with either.

Wave 2026-10-26 human /brief — vibe-coding emulator. User, verbatim: "진짜 너무 무거운 안드로이드 스튜디오 에뮬레이터보다 AI가 다루어 훨씬쉽고, 서버자원을 많이 먹지 않으면서 빠르고 캡쳐도 잘떠지고 os, 사양크기도 변경이 되는 심플한 에뮬레이터 바이브 코딩용으로 딱이지" / "싹다해 오토파일럿으로 진행하자". New FR-26..FR-32 (`docs/prd.md`). Goal: an AI agent runs the whole loop with crewdroid alone (no mobile-mcp, no Android Studio): `setup` -> `up` -> `install` -> `launch` -> `shot` / `screen` -> `tap` / `type` -> `logs` -> `down`.
Rules for this wave (on top of the earlier rules):
- The repo is PUBLIC and on npm (`crewdroid@0.1.0`) and the MCP Registry. Never write a personal path, account, PC name or the private app's name into a tracked file; `node scripts/check-public.mjs` must still pass after every Todo.
- Every new command: `--json`, non-zero exit on failure, input validated before any adb call, serial through the `src/adb.ts` guard, and an MCP tool exported as `mcpTools` from its module (T24 pattern) with a description written for an agent. Add it to `COMMANDS`/help in `src/cli.ts` and to AGENTS.md's command table (`check-agent-files.mjs` enforces this).
- No change to launch flags / AVD config / `KNOBS`. Kill emulators you started.
- `npm publish` and `mcp-publisher publish` are the user's own steps (npm 2FA is a browser security key on the office PC). Prepare, never publish.
- Emulator order (one per batch): T36 -> T37 -> T38 -> T39 -> T41 -> T33. Batch 1: T36 + T35 + T17. T40 (pitch) runs last, after T39 and T41 are DONE (it links vibe.gif and quotes the loop time); it may share a batch with T33. Added later: T42 -> T43 -> T44 (hero motion graphic, boots 3 devices) -> T48 (demo app + real clips) -> T49 (agent benchmark) -> T50 (hero v2 from real clips + bench numbers) -> T40 (pitch, last).

Wave 2026-10-27 human /brief — make "AI drives it faster and cheaper" TRUE before the video says it. T49 measured the opposite (`docs/measurements/agent-bench.md`): tree way 9695 tokens / 23.9 s per task vs screenshots 6212 tokens / 10.3 s. Causes: `screen` JSON ~2800 tokens per call, `uiautomator dump` ~3.5 s per call and `tap --text` dumps again each time, `logs` ~3800 tokens per call. User: "그래 진행해" (optimise, re-measure, then video + README; do not change the message). Order: T52 -> T53 -> T54 -> T50 -> T40, one emulator Todo per batch. Update 2026-10-29: after T53 the tokens are 3x fewer but the time is a tie (11.1 s vs 10.3 s, spread +-3 s); the user settled the message as "cheaper and more robust, same time" — never "faster".
Rules for this wave:
- Never fake the comparison: path B (screenshots) stays exactly as T49 measured it (same task, same favourable assumptions). Only path A gets faster by making crewdroid itself faster/leaner. If a target is missed, report the real numbers (BLOCKED with them), do not tune the benchmark.
- Lightness rule still applies to anything that stays running on the device (idle RAM delta <= +5 % in `docs/measurements/features.md`).
- `check-public.mjs`, `check-agent-files.mjs`, `check-skills.mjs` keep passing; skills/README/AGENTS that show `screen` output are updated to the new format in the Todo that changes it.

Wave 2026-10-26 autopilot shift (found while verifying T33).

Wave 2026-10-27 autopilot /brief auto (plan 2 of this run). Design/layout gap (brief step 2b): the Field Notes demo app (T48, 2026-10-26) is the UI every intro clip shows, and no layout sweep exists for it. Boots 1 emulator.

Wave 2026-10-27 human /brief — external critique (`docs/source/critique-2026-10-27.md`, every point verified true on the repo). User decisions (do not re-ask): (1) private development repo + clean public mirror: this checkout's `origin` is now the PRIVATE `namyunsu/crewdroid-dev` (autopilot pushes here); the PUBLIC `namyunsu/crewdroid` (remote `public`, stars/npm/MCP Registry point at it) only receives clean release commits made by `scripts/release-public.mjs`, pushed by the user; (2) `run` generalised by UI steps (no test hooks needed in the app); (3) GitHub Actions CI, running only in the public repo; (4) repo version back to the released 0.1.0 until 0.2.0 ships at the end of this wave.
Rules for this wave:
- NEVER push to the `public` remote and never run `release-public.mjs --push`. Release is the user's step.
- Numbers in README/AGENTS are "ready" times (device usable), never boot-only; every platform claim names where it was measured.
- Order: emulator Todos one per batch after T54: T55 -> T56 -> T57 -> T50 -> T40 -> T60. T58 and T59 need no emulator: they may share batches with T52..T57.

- [ ] T56 [KO] 3대 ready 34초 → 20초 이하: 기기 고유값 맞추기를 병렬·경량화 (FR-04, FR-27)
  origin: critique "부팅 ~7초는 과장, readySeconds 가 약 40초". 1 device is 7.3 s ready (T42); 3 devices still 34-36 s because makeDistinct restarts the framework and reinstalls the probe per clone (~27 s).
  area: src/up.ts, src/identity.ts, src/snapshot.ts (only if a per-clone identity can be prepared once), scripts/check-up.mjs (ready assertion), docs/measurements/up.md (new, English: per-phase table 1 vs 3 devices)
  model: opus
  review: required
  accept: After T55. Measure per-phase timings for 3 mixed devices first (record before). Then cut the clone identity cost without dropping distinctness (T03 rule: ANDROID_ID, MAC, serial differ): e.g. run the three devices' phases in parallel instead of serially, change ANDROID_ID through `settings`/SSAID without a full framework restart where the API allows it, skip the probe reinstall when no probe is used, or bake distinct identities per port into prepared snapshots — evidence for each tried option in up.md. Targets (mean of 3 cold runs, prepared snapshots): 3 devices ready <= 20 s, 1 device stays <= 10 s. `check-identity.mjs` still shows all ids distinct; `check-up.mjs` asserts the 3-device ready target, prints the phase table and writes `docs/measurements/up-ready.json` {threeDevices:{meanReadySeconds, runs}, oneDevice:{meanReadySeconds, runs}} (oneDevice from check-single's runs); `check-scenario.mjs` passes. If the target is not reachable, BLOCKED with the measured phases.
  verify: `node scripts/check-up.mjs && node scripts/check-identity.mjs docs/measurements/identity.json && node scripts/check-single.mjs && node -e "const j=require('./docs/measurements/up-ready.json');if(!(j.threeDevices.meanReadySeconds<=20&&j.oneDevice.meanReadySeconds<=10))throw new Error('ready targets missed: '+JSON.stringify(j));console.log('ready ok',j.threeDevices.meanReadySeconds,j.oneDevice.meanReadySeconds)"`

- [ ] T57 [KO] 대기 CPU 줄이기: 1대 220% → ≤100%, 3대 ~600% → ≤300% (FR-13 lightness)
  origin: critique "무겁다 — 3대 유휴 CPU 약 600%". RAM/disk were cut, CPU never was.
  area: src/avd.ts (KNOBS — this Todo may change them), src/snapshot.ts, src/up.ts (post-boot settings only), scripts/check-cpu.mjs (new), docs/measurements/cpu.md + cpu.json (English), docs/measurements/ram.md (re-check row)
  model: opus
  review: required
  accept: After T56. Same method as T16's RAM sweep: one knob at a time, 1 device and 3 devices, 60 s idle after ready, host CPU % of all emulator/qemu processes. Candidates (measure each; cite what the emulator docs say): `-cores 1` vs 2, `-gpu` modes still allowed (host vs software — keep rendering working, T14/T28), `-feature -Vulkan` (already), disable animations (`settings put global window_animation_scale/transition_animation_scale/animator_duration_scale 0`), stop always-on guest services ATD still runs (list `top -n 1` in the guest first: which processes burn CPU), `-no-audio` (already), `-qemu -icount`/timer options if the emulator supports them, snapshot saved after the guest has settled, `dumpsys deviceidle force-idle` while waiting, `-delay-adb`. Adopt the smallest set that keeps `check-scenario.mjs`, `check-input.mjs`, `check-helper.mjs` and `check-render.mjs` passing. Targets: 1 device idle <= 100 %, 3 devices <= 300 % (100 % = one host core). RAM must not regress past FR-13 (re-run `check-ram.mjs`). If a target is missed, BLOCKED with the table and the remaining biggest consumer.
  verify: `node scripts/check-cpu.mjs && node scripts/check-ram.mjs --count 3 --max-mb 4300 && node scripts/check-scenario.mjs && node scripts/check-input.mjs`


Wave 2026-10-27 human /brief — DIRECTION CHANGE (`docs/source/direction-2026-10-27.md` + user in chat). This overrides the earlier 2026-10-27 critique wave where they conflict.
- Message: "the AI sees past the screen" — why it crashed (`triage`), whether the device is really in that state (`net`/`env`/`fold` read-back), what the server really kept (`judge`), and above all: ONE existing test run by the AI across Android version x screen x font scale, judging layout breakage (off-screen buttons, overlapping elements, text clipped at large fonts) from exact accessibility-tree coordinates. Compare against mobile-mcp / Appium / screenshot computer use, not against the Android emulator. Never pitch "we give an accessibility tree" or "tree beats screenshots on tokens".
- Repo: develop in the PUBLIC `namyunsu/crewdroid` (origin). `crewdroid-dev` is archived. `.ai-log/` is local only (untracked). `main` only gets squash merges with meaningful messages (no autopilot auto-ship: infra.md `Stage: live`).
- Autopilot only for measurement / repetitive work; core steps (Phase 1 Maestro-based `run` and `sweep`) are built in a human-reviewed session. T53-T60 except T58 are BLOCKED (held, dropped or moved to the session) — see status.md reasons.
- Positioning (direction 1-1): a COMPLEMENT to Maestro / mobile-mcp — "they drive the app, crewdroid makes the conditions and judges the result". New features should plug into their flows (Maestro YAML in, mobile-mcp used alongside), not re-implement driving.
- Phase 2 benchmark: "mobile-mcp alone" vs "mobile-mcp + crewdroid", same model and prompt; start with 5 seeded bugs x 3 runs per condition (user), on Tasks.org (generic flavor, fork) + a local Radicale CalDAV server — user's choice 2026-10-27 (`docs/source/research-oss-app.md`); fallback Fossify Notes (sweep) + wallabag (run) if Tasks.org does not build without keys or takes too long.
- Remaining autopilot work now: T52 (in progress), T58 (CI).

Wave 2026-10-27 autopilot /brief auto (plan 1 after the direction change). Measurement only (direction 2026-10-27: autopilot does measurement and repeat work). Boots emulators: runs alone.

Wave 2026-10-27 human /brief — device conditions (user: "에뮬레이터의 cpu와 ram을 선택할 수 있게, 진짜 에뮬레이터처럼" / "부하를 줄 수도 있어야 해, 사용자 폰은 깔린 앱과 백그라운드 앱이 많기 때문에, low-high 구조로" / "와이파이를 잡고 테스트할 수 있는 것도"). These are CONDITIONS (positioning: crewdroid makes the conditions and judges). All off by default — the default `up` stays as light as today. Autopilot order after T58: T64 -> T62 -> T63, one per batch.

- [x] T66 (accepted at 56/60 by the user 2026-10-29: a,b,c,e 10/10, d,f 8/10 = API 31 guest memory, outside T66; attempt-2 code shipped) [KO] Maestro·mobile-mcp 와 같이 써도 안 깨지게: 공존 실패 원인 찾고 고치기 (포지셔닝 필수 조건)
  origin: human /brief 2026-10-27. The positioning is "Maestro and mobile-mcp drive the app, crewdroid makes the conditions and judges" — so crewdroid must never break them. T61 (auto) found intermittent failures (`docs/measurements/coexist.md`): case a (mobile-mcp right after `up`: "Cannot read properties of undefined (reading 'node')") and case f (`crewdroid screen` during a Maestro flow: "unexpected screencap size", Maestro lost the device; in the last of 3 runs the Maestro flow still failed). Android allows one UiAutomation connection at a time; the helper (T52) holds one and releases it after 3 s idle.
  area: agent-helper/, src/helper.ts, src/screen.ts, src/shot.ts, scripts/check-coexist.mjs (from T61, extended), docs/measurements/coexist.md (English rewrite of the table + cause), docs/adr/0007-agent-helper.md (coexistence section)
  model: opus
  review: required
  accept: Find the cause of each failure with evidence first (who holds UiAutomation when, logcat of the helper / Maestro driver / mobile-mcp's devicekit or uiautomator, the screencap size error path). Then make coexistence reliable, for example: the helper takes UiAutomation only for the duration of one request and never while another automation client is connected (detect Maestro's / mobile-mcp's instrumentation or uiautomator process and fall back to read-only paths that do not need UiAutomation), `shot` uses `exec-out screencap -p` only (no raw-size parsing that breaks when another tool resizes), `up` starts the helper lazily on the first crewdroid request instead of at boot. No feature of T52 is silently dropped: if a mode must fall back (slower tree, no non-ASCII input while Maestro runs), the output says so. Target: every case a-f passes 10/10 in a row (60 runs), including a full Maestro flow that passes while crewdroid `screen`, `shot`, `net`, `env` run against the same device, and mobile-mcp `mobile_list_elements_on_screen` right after `up`. Record the 60 results and timings in coexist.md. If 10/10 is not reachable for a case, BLOCKED with the cause and the measured pass rate.
  verify: `node scripts/check-coexist.mjs --repeat 10 && node scripts/check-helper.mjs`

Wave 2026-10-27 human /brief — improvement request `docs/source/request-2026-10-27.md` (goal: an AI-agent Android developer uses crewdroid instead of the Android Studio emulator). User decisions: everything goes to autopilot (reviewer required); order = T62 (in progress) -> T66 -> T53 -> T54 -> T67 -> T69 -> T55, with T68 and T70 in parallel when areas allow; T63 and T65 last. The request's task 1 numbers (uiautomator dump 3+ s per call) predate T52: re-measure, do not trust them. Task 1 = T53 + T54 (reopened), task 2 = T67, task 3 = T68 (+ the human session ships ai/work to main so T58's CI finally runs), task 4 = T55 (rewritten), task 5 = T69, measurable cleanup = T70. README wording, ATD limits, `.ai-log` untracking are done by the human session.

- [ ] T74 [KO] 여러 대에서 Wi-Fi 주소가 한 대만 잡히는 문제: 클론마다 `-wifi-mac-address` 시험 (사용자 결정 필요)
  origin: T63 ADR 0009. Fix needs a launch flag, which the "no launch flag changes" rule forbids without a decision.
  BLOCKED: 사용자 결정 — 기동 플래그 `-wifi-mac-address` 추가 허용 여부
  area: src/emulator.ts, src/net.ts, docs/adr/0009-wifi.md
  model: opus
  review: required
  accept: Only after the user allows the launch flag: give each clone a distinct Wi-Fi MAC, prove with 3 devices that `net wifi` gets an address on all, re-log idle RAM+CPU in features.md. Otherwise leave documented.
  verify: `node scripts/check-wifi.mjs --count 3 && node scripts/check-net.mjs`

Wave 2026-10-29 human /brief — outside review `docs/source/feedback-2026-10-29.md` (read on a Mac from the public repo). Its main complaints ("run only works on the bundled sample app", "T53/T54 not started", "benchmark contradicts the claim") were already fixed on ai/work (T55, T53, T54) but never shipped: GitHub `main` stopped at 61e5f17 (2026-10-27) and npm at 0.1.0 (2026-10-26). The 10-27 critique made the same complaint. User decisions (do not re-ask): (1) no Play image, no FCM push (T71 dropped, FR-47 out of scope) — crewdroid is a tool for the develop-and-check loop; push, Play services and Google sign-in are checked on a real phone, and the README says so; (2) the README leads with the user's own app, the bundled sample is "try it first"; (3) ship at the end of this wave (T60, then the human session merges to main and tags). Order: T77 -> T76 -> T60. T76 and T77 boot emulators: separate batches.
