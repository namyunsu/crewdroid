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
- Emulator order (one per batch): T36 -> T37 -> T38 -> T39 -> T41 -> T33. Batch 1: T36 + T35 + T17. T40 (pitch) runs last, after T39 and T41 are DONE (it links vibe.gif and quotes the loop time); it may share a batch with T33.





- [ ] T39 [KO] AI 바이브 코딩 루프 MCP 종단 검증 + `android-vibe-loop` 스킬 (FR-30)
  area: scripts/check-vibe-loop.mjs, .agents/skills/android-vibe-loop/SKILL.md, .agents/skills/crewdroid/SKILL.md (point to it first), src/mcp.ts (tool descriptions only), AGENTS.md (loop section)
  model: opus
  review: required
  accept: After T35-T38 are DONE. `scripts/check-vibe-loop.mjs` drives ONLY the MCP server over stdio with the official SDK client, like an agent would: `listTools` contains setup, up, devices, install, launch, shot, screen, tap, type, swipe, key, logs, down; `setup` (dry run) reports present; `up` {} -> 1 device; `install` probe APK; `launch` with `check=form` extras; `shot` -> image item; `screen` -> finds the `Send` button; `type` + `tap` -> `logs` (since 1m) contains `CrewProbe FORM`; `launch --restart` with `check=crash` -> `crashed:true`; `down`; prints each step's wall time and the total (target: whole loop < 3 min on this PC, record the number). Tool descriptions are tightened so an agent picks the right one (each says when to use it and what it returns; `screen` vs `shot`: tree vs pixels). `android-vibe-loop` SKILL.md (<= 120 lines, frontmatter rules as check-skills enforces, description triggered by "run/test my Android app", "see the app screen", "the app does not start", "build and check on a phone"): the loop with the exact MCP tool names and CLI equivalents, how to read `crashed`, `blackRelaunch`, multiple-match tap errors, and when to switch to the advanced skills. `crewdroid` umbrella skill points to it first. AGENTS.md gets a 10-line "Vibe-coding loop" section. `check-skills.mjs` and `check-agent-files.mjs` still pass.
  verify: `node scripts/check-vibe-loop.mjs && node scripts/check-skills.mjs && node scripts/check-agent-files.mjs`

- [ ] T42 [KO] 1대 `up` 이 왜 49초(ready 101초)인지 찾아 고치기 — 3대 혼합 때 API 36 은 3.1초였음 (FR-27, FR-04)
  origin: human /brief 2026-10-26 reading `docs/measurements/single.md` (T36): boot 48.9 s, ready 101.5 s for ONE device, while `docs/measurements/slim.md` / the 3-device runs showed snapshot boots of 3-9 s. The README pitch (T40) quotes "boots in seconds" — this must hold first.
  area: src/up.ts, src/snapshot.ts, src/identity.ts (makeDistinct timing only), scripts/check-single.mjs, docs/measurements/single.md
  model: opus
  review: required
  accept: Runs after T38 and before T40 (T40 depends on it). Find the cause with evidence before changing code: per phase timings of one `up` (launch -> adb device -> boot_completed -> hwui prop -> wm size/density -> makeDistinct/identity incl. framework restart -> ready), the emulator log (`%TEMP%\crewdroid-<avd>-<port>.log`: did it load the `default_boot` snapshot or cold boot? look for snapshot load / `-no-snapshot-load` / skin), whether the base snapshot was rebuilt (crewdroid-slim.json marker vs KNOBS), and compare the same profile in a 3-device run. Fix the cause (e.g. a snapshot that is not loaded, a needless re-prepare, a fixed sleep, makeDistinct's restart on a single device where no clone collides — a single device needs no distinct identity) without changing KNOBS / launch flags beyond what the cause requires. Target: 1 device ready <= 20 s on a prepared snapshot (API 34 and 36), boot <= 10 s; if not reachable, record why with the measured phases. `check-single.mjs` asserts ready <= 20 s (mean of 3) and writes the phase table to single.md; `check-up.mjs` (3 devices) still passes.
  verify: `node scripts/check-single.mjs && node scripts/check-up.mjs`

- [ ] T43 [KO] macOS(Apple Silicon)·Linux 에서도 돌게: Windows 전용 코드 걷어내기 (FR-33)
  origin: human /brief 2026-10-26, user: "이거 mac에서도 돌아가야해". Today `up`/`down`/`devices`/`slim` call PowerShell (`src/emulator.ts` Start-Process, `Get-CimInstance Win32_Process` in up.ts/mcp.ts/measure.ts/snapshot.ts, NTFS `compact` + GetCompressedFileSizeW in slim.ts) and every image path hard-codes `x86_64` (avd.ts, profiles.ts, slim.ts, snapshot.ts), so nothing boots on a Mac.
  area: src/platform.ts (new: launchDetached, listProcesses, killTree, hostAbi), src/emulator.ts, src/up.ts (down/devices process listing only), src/mcp.ts (devices listing only), src/measure.ts, src/snapshot.ts, src/slim.ts, src/avd.ts, src/profiles.ts, src/setup.ts (reuse its imageAbi), test/platform.test.ts, README.md + README.ko.md (Requirements: macOS/Linux lines), AGENTS.md (one line)
  model: opus
  review: required
  accept: Runs after T42 and before T40 (T40 states supported platforms). One module `src/platform.ts` owns every OS difference; no other file calls `powershell`, `compact`, `Get-CimInstance` or checks `process.platform` for process work. Windows keeps exactly today's behaviour (same PowerShell commands, moved, not rewritten). macOS/Linux: emulator launched with `spawn(..., { detached: true, stdio: ["ignore", logFd, logFd] }).unref()` (headless, no window unless `--window`), processes listed with `ps -axo pid=,ppid=,rss=,%cpu=,command=`, killed with `process.kill` (TERM, then KILL after 5 s), RAM = RSS (shared pages not split; say so in the JSON `method` field). ABI from `os.arch()`: arm64 -> `arm64-v8a`, x64 -> `x86_64`, used by avd.ts/profiles.ts/slim.ts/snapshot.ts/setup.ts (single helper). `slim` on macOS/Linux: skip the NTFS sparse/compress steps with a `skipped: "NTFS only"` note, keep the snapshot zero-fill and stale-file cleanup; disk is measured with `du -k` (allocated blocks) there. Hardware acceleration check: macOS Hypervisor.framework / Linux `/dev/kvm` via `emulator -accel-check`, reported by `setup` (T35). Lock file and temp paths via `os.tmpdir()` (already). `test/platform.test.ts`: with platform/arch injected (no real OS needed) -> Windows uses the PowerShell commands, darwin/linux use spawn+ps, arm64 -> arm64-v8a image package `system-images;android-34;google_atd;arm64-v8a`; parsing of a captured `ps -axo` sample finds the crew-* qemu processes. On this Windows PC `check-single.mjs`, `check-up.mjs` and `check-input.mjs` still pass (no regression). Grep proves the rule: `rg -n "powershell|Get-CimInstance|compact\b" src` hits only src/platform.ts.
  verify: `npm test && node -e "const fs=require('fs');const bad=[];for(const f of fs.readdirSync('src').filter(f=>f.endsWith('.ts')&&f!=='platform.ts'))fs.readFileSync('src/'+f,'utf8').split('\n').forEach((l,i)=>{if(/powershell|Get-CimInstance|run\(.compact|x86_64/.test(l))bad.push(f+':'+(i+1))});if(bad.length)throw new Error('OS-specific code outside src/platform.ts: '+bad.join(' '));console.log('platform isolated')" && node scripts/check-single.mjs && node scripts/check-up.mjs`
  manual: on an Apple Silicon Mac: `npx crewdroid setup --yes` -> `npx crewdroid up` -> `npx crewdroid shot emulator-5580` -> `npx crewdroid down`; record times in docs/measurements/single.md (macOS row). Same on Linux with KVM (test-cases.md FR-33).

- [ ] T40 [KO] 소개 바꾸기: 바이브 코딩용 가벼운 에뮬레이터를 앞세움 (FR-31)
  area: README.md, README.ko.md, AGENTS.md (intro lines only), package.json (`description`, `keywords`), server.json (`description`), scripts/check-public.mjs (pitch checks), docs/release.md (GitHub description command)
  model: sonnet
  review: required
  accept: After T39, T41, T42 and T43 are DONE (the README shows commands that exist, the loop time T39 measured, and T41's `docs/demo/vibe.gif`). README first screen (before the first `##` after the hero): one-sentence pitch "Lightweight headless Android emulator for AI coding agents" (vibe coding named), badges kept, the 4-line quick start (`npx crewdroid setup --yes`, `npx crewdroid up`, `npx crewdroid install emulator-5580 app.apk`, `npx crewdroid shot emulator-5580`), `docs/demo/vibe.gif` as the hero image (the 3-device `demo.gif` moves to the Advanced section), then a "vs Android Studio emulator" table from measured numbers only (`docs/measurements/single.md` 1-device boot/RAM, `slim.md`, `ram.md`; cite files) covering: install size, boot, host RAM/CPU, window (none), AI interface (JSON/MCP/accessibility tree vs clicking), OS/screen switch (`--api`, `--profile`, `--screen`, `fold`), capture (`shot`/`screen`, API 31 black-screen recovery). Then "Use it from your AI agent" (MCP block, Claude plugin, Cursor link, skills), then the per-command reference, and the multi-device concurrency testing (current "Why/60-second tour/What it finds" content, kept) under one `## Advanced: multi-device concurrency testing` section. Keywords line updated (vibe coding, android emulator for ai, headless android, mcp). README.ko.md mirrors the pitch, quick start and table in Korean. package.json/server.json descriptions = the same pitch (<= 100 chars for server.json). docs/release.md gains the exact `gh repo edit --description` line with the same pitch (the user runs it, or the next /brief does). `check-public.mjs` adds: README hero (first 40 lines) contains "AI coding agents", "vibe", every quick-start command, and the GIF; every `crewdroid <cmd>` in the README exists in `src/cli.ts` COMMANDS; package.json and server.json descriptions equal; no number in the comparison table without a `docs/measurements/` link in the same section.
  verify: `node -e "const h=require('fs').readFileSync('README.md','utf8').split('\n').slice(0,40).join('\n');for(const k of ['AI coding agents','vibe','npx crewdroid setup','npx crewdroid shot','vibe.gif'])if(!h.includes(k))throw new Error('README hero lacks: '+k);console.log('hero ok')" && node scripts/check-public.mjs && node scripts/check-agent-files.mjs`

- [ ] T41 [KO] 바이브 코딩 데모 GIF + 0.2.0 준비 (FR-32)
  area: scripts/demo-vibe.mjs, docs/demo/vibe.gif, docs/measurements/demo-vibe.json, scripts/check-demo-gif.mjs (1-panel mode), package.json + server.json (version 0.2.0), CHANGELOG.md, docs/release.md (0.2.0 steps)
  model: sonnet
  review: required
  accept: After T39 is DONE. `node scripts/demo-vibe.mjs`: 1 device (`up`), records its screen (src/record.ts) while running the loop through the CLI: install probe -> launch `check=form` -> type -> tap Send -> swipe -> `fold`-free; each step burned in as a caption (ffmpeg drawtext: `crewdroid install`, `crewdroid tap --text Send`, ...); a 2 s tail card with the measured loop time from T39; `docs/demo/vibe.gif` <= 3 MB, <= 25 s, 480 px high, 8 fps; `docs/measurements/demo-vibe.json` with `gif.panels` (1 panel) and step timings; down. `check-demo-gif.mjs` accepts 1..3 panels (`--panels 1`), still rejects a flat or static panel. Do not touch README (T40 puts the GIF in the hero). Version 0.2.0 in package.json and server.json (both packages[0].version and version); CHANGELOG.md (English, Keep a Changelog style) 0.2.0 = setup, single-device up/devices, install/launch/logs, shot/tap/type/swipe/key, vibe-loop skill, API 31 black-screen recovery, Node >= 22; 0.1.0 = first release. docs/release.md: the 0.2.0 steps the user runs (office PC: `git pull`, `npm publish --access public` + browser approval; any PC: `mcp-publisher login github` + `mcp-publisher publish`). Do not publish.
  verify: `node scripts/demo-vibe.mjs && node scripts/check-demo-gif.mjs --mvp docs/measurements/demo-vibe.json --gif docs/demo/vibe.gif --panels 1 --max-mb 3 --max-seconds 25 && node scripts/check-public.mjs`
