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


- [ ] T33 [AUTO] `net slow` lets a 2 MB upload finish (ADR 0006 open question, FR-05/FR-09)
  origin: auto-plan (docs/adr/0006-fold.md:32 [모름])
  area: src/net.ts (shape() only), probe-app/app/src/main/kotlin/dev/crewdroid/probe/Sample.kt (http() only), scripts/check-slow-upload.mjs, docs/adr/0006-fold.md
  model: sonnet
  review: required
  accept: Runs after T32. `node scripts/check-slow-upload.mjs` boots 1 device (`crewdroid up --count 1`), starts the clean sample server on a free port, sets `net slow`, sends a 2 MB upload through the probe app, and passes only if `CrewProbe SYNCED` appears within 120 s and the server has exactly 1 row for the key; repeats 3 times; prints measured seconds; always downs. Also runs the fold path once (fold mid-upload, stay on slow, as in ADR 0006). If every run passes before any code change, do not edit shape()/http(): write "not reproduced without/with fold" with the measured times in ADR 0006 instead. Otherwise find the cause first with evidence (tbf burst/latency drops, the 10 s watchdog, readTimeout 20 s), then fix it in shape() or http(); the slow profile stays "very slow" (1024 kbit, 300 ms) — do not raise those numbers. No launch flag / AVD config / KNOBS change. Replace the open-question line in ADR 0006 with the cause and the measured times. If shape() changed, `check-scenario.mjs` must pass too (add it to the run); if only http() changed, say why scenarios are unaffected.
  verify: `node scripts/check-slow-upload.mjs && node scripts/check-net.mjs && node scripts/check-offline.mjs`

Wave 2026-10-26 human /brief — vibe-coding emulator. User, verbatim: "진짜 너무 무거운 안드로이드 스튜디오 에뮬레이터보다 AI가 다루어 훨씬쉽고, 서버자원을 많이 먹지 않으면서 빠르고 캡쳐도 잘떠지고 os, 사양크기도 변경이 되는 심플한 에뮬레이터 바이브 코딩용으로 딱이지" / "싹다해 오토파일럿으로 진행하자". New FR-26..FR-32 (`docs/prd.md`). Goal: an AI agent runs the whole loop with crewdroid alone (no mobile-mcp, no Android Studio): `setup` -> `up` -> `install` -> `launch` -> `shot` / `screen` -> `tap` / `type` -> `logs` -> `down`.
Rules for this wave (on top of the earlier rules):
- The repo is PUBLIC and on npm (`crewdroid@0.1.0`) and the MCP Registry. Never write a personal path, account, PC name or the private app's name into a tracked file; `node scripts/check-public.mjs` must still pass after every Todo.
- Every new command: `--json`, non-zero exit on failure, input validated before any adb call, serial through the `src/adb.ts` guard, and an MCP tool exported as `mcpTools` from its module (T24 pattern) with a description written for an agent. Add it to `COMMANDS`/help in `src/cli.ts` and to AGENTS.md's command table (`check-agent-files.mjs` enforces this).
- No change to launch flags / AVD config / `KNOBS`. Kill emulators you started.
- `npm publish` and `mcp-publisher publish` are the user's own steps (npm 2FA is a browser security key on the office PC). Prepare, never publish.
- Emulator order (one per batch): T36 -> T37 -> T38 -> T39 -> T41 -> T33. Batch 1: T36 + T35 + T17. T40 (pitch) runs last, after T39 and T41 are DONE (it links vibe.gif and quotes the loop time); it may share a batch with T33. Added later: T42 -> T43 -> T44 (hero motion graphic, boots 3 devices) -> T40 (pitch, last).





- [ ] T44 [KO] 15초 소개 모션 그래픽 `docs/demo/hero.gif` — 처음 보는 사람이 "뭐 하는 도구인지" 15초 안에 알게 (FR-34)
  origin: human /brief 2026-10-26, user: "꼭 소개를 멋지게 넣어줘 지금은 그냥 이 프로젝트가 도대체 뭐하는 프로젝트인지 잘 몰라 15초짜리 소개 모션그래픽을 넣어도 돼".
  area: scripts/hero/ (index.html + hero.css + storyboard.json + render.mjs), scripts/check-hero.mjs, docs/demo/hero.gif, docs/demo/hero-poster.png, docs/measurements/hero.json, package.json (devDependency `playwright` pinned; it is not shipped — `files` unchanged)
  model: opus
  review: required
  accept: Runs after T43 (uses the final numbers: 1-device ready 7.3 s from `docs/measurements/single.md`, loop 79 s from `docs/measurements/demo-vibe.json`, disk/RAM from slim.md/ram.md — read them from those files at render time, never type numbers by hand). Follow the `design-rules` skill (readable text: min 28 px at 960 px width, contrast >= 4.5:1, no thin grey text; nothing cut at the edges; one font family, at most 2 accent colours, dark background so GitHub dark and light themes both look right). Authored as an HTML/CSS animation (`scripts/hero/index.html`, CSS keyframes + a tiny JS clock, no network fonts — bundle or use a system font stack) and rendered deterministically: `scripts/hero/render.mjs` opens it in headless Chromium (Playwright), steps a virtual clock frame by frame (30 fps, 15 s = 450 frames, `page.clock` or a `?t=` parameter — no real-time capture), screenshots each frame at 960x540, then ffmpeg (palettegen/paletteuse, 15 fps in the GIF) -> `docs/demo/hero.gif` <= 5 MB, plus `hero-poster.png` (the final frame). Real footage, not mock phones: before rendering, `render.mjs` boots devices (`up --count 3` mixed: s24ultra, fold5-main, flip7-main) and captures `shot` PNGs of the probe app (and frames from `docs/demo/vibe.gif`) to embed; down afterwards. Storyboard (`storyboard.json`, scene start/end in s, the checker reads it): (1) 0-3 s the problem: "Android Studio emulator: heavy, one window, built for clicking" with a big heavy window icon fading out; (2) 3-6 s the answer: terminal types `npx crewdroid up` -> a real phone screenshot pops in, counter "ready in 7.3 s" (number from single.md); (3) 6-9 s "Any Android version, any screen": 3 real captures of different sizes/APIs slide in side by side with API labels; (4) 9-12.5 s "Your AI agent drives it": `install -> launch -> shot -> tap` steps light up one by one next to real vibe.gif frames, MCP / Claude Code / Cursor wordmarks as plain text; (5) 12.5-15 s logo text "crewdroid", tagline "Lightweight Android emulator for AI coding agents", and `npx crewdroid setup` in a code pill. `scripts/check-hero.mjs`: GIF exists, <= 5 MB, 14-16 s, width >= 900; storyboard has 5 scenes covering 0-15 s; the frame at the middle of every scene is not flat (top colour <= 90 %) and differs from the neighbouring scene's middle frame (> 10 % pixels changed); the numbers shown in scene 2 equal those in single.md (render.mjs writes what it used to `docs/measurements/hero.json`, the checker compares). The user judges the look (manual).
  verify: `node scripts/hero/render.mjs && node scripts/check-hero.mjs`
  manual: the user watches docs/demo/hero.gif on the GitHub page (light and dark theme) and says whether it explains the tool in 15 s (test-cases.md FR-34).

- [ ] T40 [KO] 소개 바꾸기: 바이브 코딩용 가벼운 에뮬레이터를 앞세움 (FR-31)
  area: README.md, README.ko.md, AGENTS.md (intro lines only), package.json (`description`, `keywords`), server.json (`description`), scripts/check-public.mjs (pitch checks), docs/release.md (GitHub description command)
  model: sonnet
  review: required
  accept: After T39, T41, T42, T43 and T44 are DONE (the README shows commands that exist, the loop time T39 measured, T44's `docs/demo/hero.gif` and T41's `docs/demo/vibe.gif`). The user's complaint to fix: "지금은 이 프로젝트가 도대체 뭐하는 프로젝트인지 잘 몰라" — a stranger must get it from the first screen. Order of the first screen: `hero.gif` (T44) on top; then a 3-bullet "What is it?" block in plain words (1. a lightweight Android emulator you start with one command, no Android Studio; 2. your AI coding agent drives it through CLI/MCP — install, launch, screenshot, tap, logs; 3. switch Android version and screen size with a flag); then the quick start. README first screen (before the first `##` after the hero): one-sentence pitch "Lightweight headless Android emulator for AI coding agents" (vibe coding named), badges kept, the 4-line quick start (`npx crewdroid setup --yes`, `npx crewdroid up`, `npx crewdroid install emulator-5580 app.apk`, `npx crewdroid shot emulator-5580`), `docs/demo/vibe.gif` under the quick start (the 3-device `demo.gif` moves to the Advanced section), then a "vs Android Studio emulator" table from measured numbers only (`docs/measurements/single.md` 1-device boot/RAM, `slim.md`, `ram.md`; cite files) covering: install size, boot, host RAM/CPU, window (none), AI interface (JSON/MCP/accessibility tree vs clicking), OS/screen switch (`--api`, `--profile`, `--screen`, `fold`), capture (`shot`/`screen`, API 31 black-screen recovery). Then "Use it from your AI agent" (MCP block, Claude plugin, Cursor link, skills), then the per-command reference, and the multi-device concurrency testing (current "Why/60-second tour/What it finds" content, kept) under one `## Advanced: multi-device concurrency testing` section. Keywords line updated (vibe coding, android emulator for ai, headless android, mcp). README.ko.md mirrors the pitch, quick start and table in Korean. package.json/server.json descriptions = the same pitch (<= 100 chars for server.json). docs/release.md gains the exact `gh repo edit --description` line with the same pitch (the user runs it, or the next /brief does). `check-public.mjs` adds: README hero (first 40 lines) contains "AI coding agents", "vibe", every quick-start command, and the GIF; every `crewdroid <cmd>` in the README exists in `src/cli.ts` COMMANDS; package.json and server.json descriptions equal; no number in the comparison table without a `docs/measurements/` link in the same section.
  verify: `node -e "const h=require('fs').readFileSync('README.md','utf8').split('\n').slice(0,40).join('\n');for(const k of ['hero.gif','What is it','AI coding agents','vibe','npx crewdroid setup','npx crewdroid shot','vibe.gif'])if(!h.includes(k))throw new Error('README hero lacks: '+k);console.log('hero ok')" && node scripts/check-public.mjs && node scripts/check-agent-files.mjs`

