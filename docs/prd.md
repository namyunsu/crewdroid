# crewdroid — PRD

## 1. 목적 / 사용자 / 핵심 시나리오

**목적:** 구글 안드로이드 에뮬레이터 위에 올리는 **가볍고 빠른 다자(多者) 안드로이드 현장 시험실**. 서로 다른 삼성 갤럭시를 쓰는 여러 사용자가 각자 다른 타이밍에 같은 흐름을 반복하고, 그사이 네트워크가 끊겼다 돌아오고, 끝나면 서버 데이터로 동시성 버그(중복·누락·덮어쓰기)를 판정한다. AI 에이전트(Claude Code)가 운영한다. MVP·데모가 생기면 GitHub 오픈소스로 공개한다(그 전까지 비공개).

**사용자:** 남윤수(혼자 여러 앱을 만들고 운영) → 공개 후 같은 문제를 가진 앱 개발자.

**지금 하는 방식과 막히는 곳 (2026-10-23 실측·조사):**
- private-app 는 `private-app-devicetest/scripts/avd-up.ps1` 로 AVD 3대(old-avd-1~3)를 띄워 다자 e2e 를 돌린다.
- AVD 대당 5.2~5.8GB + 시스템 이미지(google_apis 33) 별도, 화면 320x640/160dpi(갤럭시와 다름), 대당 4코어·2GB. 3대 = vCPU 12개. 오래 떠 있으면 대당 ~5코어를 먹어 시험이 흔들린다(private-app T21).
- 세 대가 모두 같은 기종·같은 안드로이드라서 "기사마다 다른 폰" 상황을 못 만든다.
- 앱마다 같은 다자 시험 틀을 새로 만든다.

**핵심 시나리오:**
1. `crewdroid up` 으로 서로 다른 기종 프로필·안드로이드 버전을 섞은 N대를 가볍게 띄운다.
2. 각 기기가 다른 타이밍으로 같은 흐름(예: 사진 촬영→업로드)을 여러 번 반복하고, 기기마다 네트워크 상태(비행기 모드·데이터 끊김·느림·들락날락)를 섞는다.
3. 끝나면 서버 데이터를 규칙으로 판정해 중복·누락·덮어쓰기를 찾는다.
4. 대량 동시 요청은 에뮬레이터 없이 API 스크립트로 한다.
5. Claude Code 는 mobile-mcp 로 탐색·디버깅하고, 재실행할 흐름은 Maestro YAML 로 남긴다.

**사용자 결정 (2026-10-23, 변경 금지):**
- 에뮬레이터(가상화)를 새로 만들지 않는다. 구글 에뮬레이터 위에 올린다.
- 기사 여러 명이 같은 폰이라고 가정하지 않는다. 시험마다 서로 다른 기종·버전을 섞는다.
- "동시에 누르기"(배리어) 장치는 쓰지 않는다. 현실의 겹침(다른 타이밍 반복 + 네트워크 섞기 + 사후 판정)으로 만든다.
- 경량화가 최우선이다. 전후 측정값(디스크·부팅·RAM·CPU)이 결과물이다.
- 구현: Node.js + TypeScript CLI. 판정·API 시험은 저장소 안의 샘플 서버(일부러 버그를 넣은)로 검증한다.
- MVP: private-app `tests/e2e/multi/techs.multi.ts`(기사 3명) 를 crewdroid 기동으로 같은 결과로 통과. private-app 저장소는 고치지 않는다.

## 2. 기능 요구사항

| ID | 요구 | 인수 기준 |
|---|---|---|
| FR-01 | 기준 측정 | 지금 AVD 3대(old-avd-1~3)의 디스크(AVD+시스템 이미지), 부팅 시간, 호스트 RAM, CPU 를 3대 동시 기동 기준으로 재서 `docs/measurements/baseline.md` 에 남긴다. 기존 AVD 는 `-read-only` 로만 띄워 바꾸지 않는다. |
| FR-02 | 경량 이미지 실측 | ATD 이미지(google_atd)에서 카메라 촬영·사진 선택·HTTP 업로드가 되는지 프로브 앱으로 실측하고, 쓸 이미지를 ADR 로 정한다. 안 되면 google_apis 유지 + `-read-only` 공유만 적용. |
| FR-03 | 복제 기기 고유값 | 같은 AVD 를 `-read-only` 로 여러 대 띄웠을 때 ANDROID_ID·Wi-Fi MAC·serial 등이 같은지 실측하고, 같으면 crewdroid 가 인스턴스마다 다르게 만든다(못 하면 이유를 문서화). |
| FR-04 | 혼합 N대 경량 기동 | `crewdroid up` 이 기종 프로필(해상도·density)과 안드로이드 버전(이미지 2~3개)을 섞어 N대를 headless 로 띄우고 `down` 으로 자기 인스턴스만 끈다. 기종은 AVD 를 따로 만들지 않고 `wm size/density` 로 바꾼다. 전후 수치 비교표를 남긴다. |
| FR-05 | 네트워크 상태 전환 | 기기별로 비행기 모드·데이터만 끊김·아주 느림·들락날락(기기마다 다른 타이밍)·정상 복귀를 명령 하나로 건다. 업로드 도중 끊김을 만들 수 있다. |
| FR-06 | AI 조작 연결 | mobile-mcp 와 Maestro(`maestro mcp`) 를 프로젝트 MCP 로 연결하고, crewdroid 기기를 serial 로 지정해 조작·흐름 실행이 된다. |
| FR-07 | 서버 데이터 판정 | 판정 규칙(고유 키 중복, 기대 개수 누락, 버전 덮어쓰기)을 파일로 주면 서버 데이터를 읽어 위반을 보고하고 종료 코드로 알린다. |
| FR-08 | API 동시 요청 | 에뮬레이터 없이 가상 사용자 N명이 서로 다른 지연으로 같은 API 흐름을 반복하고(배리어 없음), 끝나면 FR-07 판정을 돈다. |
| FR-09 | 오프라인 시나리오 | 샘플 앱이 오프라인 저장 → 재연결 동기화, 업로드 도중 끊김 재시도, 오프라인 중 다른 사용자가 같은 건 수정, 오프라인 상태로 앱 재시작을 지원한다. |
| FR-10 | 다자 현장 시나리오 | 혼합 N대가 샘플 앱 흐름을 다른 타이밍으로 반복하며 네트워크 상태를 섞고, 끝나면 판정한다. 버그 모드 서버에서는 위반을 찾고, 정상 모드에서는 통과한다. |
| FR-12 | 디스크 절반 이하 | 3대(안드로이드 버전 섞음) 기준 디스크 실제 할당량(이미지+AVD)이 T01 기준(24.6GB)의 1/3 이하(≤ 8GB). 버전을 섞어도 늘지 않는다. |
| FR-13 | RAM 절반 이하 | 3대 동시 기동 호스트 RAM(공유 페이지는 한 번만 셈)이 T01 기준(8.45GB)의 절반 이하(≤ 4.2GB). 시나리오·MVP 시험은 그대로 통과. |
| FR-14 | 임의 화면 규격 | 사용자가 가로·세로(px)와 density 를 직접 넣어 띄운다(명령 인자 또는 프로필 파일 한 줄). HMI 처럼 호스트 모니터보다 큰 화면(예: 3840x2160, 1920x720 같은 가로로 긴 화면)도 된다. 최대 크기는 실측해 문서화. |
| FR-15 | 폴드·플립 접기/펴기 | 접이식 프로필 기기에서 접기·펴기(커버↔메인 화면 전환)를 명령 하나로 일으켜, 앱이 화면 크기 변경을 받는다. |
| FR-16 | 기기 환경 조작 | `crewdroid env <serial> …` 한 명령으로 위치(geo fix)·배터리(잔량/충전)·센서/회전·다크모드·글자 크기·앱 로케일(API 33+)·통신망 상태(gsm data/signal)·SMS/통화 흉내를 걸고 되읽어 확인한다. 기동 플래그·AVD 설정은 바꾸지 않으며, 3대 기준 유휴 RAM·CPU 전후 수치를 `docs/measurements/features.md` 에 남긴다. |
| FR-17 | 앱 제어 | `crewdroid app <serial> <pkg> …` 로 런타임 권한 부여/회수/조회, 딥링크·App Links 검증 상태(강제 승인/초기화), 앱 데이터 초기화, 로컬 백업/복원, 자원 압박(Doze·Standby 버킷·메모리 트림·백그라운드 제한·절전·저장공간 채우기)을 걸고 되읽어 확인한다. |
| FR-18 | 안드로이드 진단 | `triage`(크래시·ANR·종료 사유·힙 덤프), `screen`(접근성 트리 요약 + 포커스 액티비티), `perf`(기동 시간·프레임 통계·메모리), `apk`(설치 없이 매니페스트·권한·minSdk) 가 `--json` 으로 나온다. 샘플 앱이 크래시·ANR·끊김을 일부러 낼 수 있다. |
| FR-19 | MCP 서버 | `crewdroid mcp` 가 stdio MCP 서버(공식 SDK)로 기기·네트워크·환경·앱·진단·판정·시나리오 도구를 노출한다. 도구는 CLI 와 같은 함수를 부르고(중복 구현 없음), adb 가드가 그대로 적용된다. |
| FR-20 | 에이전트용 저장소 파일 | AGENTS.md(전 에이전트 공통) + CLAUDE.md 첫 줄 `@AGENTS.md`, Claude Code 플러그인(`.claude-plugin/plugin.json` + 같은 저장소 `marketplace.json`), `.mcp.json` 에 crewdroid 서버, 스킬은 `.agents/skills/`(Cursor·Gemini·Copilot·Codex 공통 경로). `claude plugin validate --strict .` 통과. |
| FR-21 | 안드로이드 스킬 | 짧은 SKILL.md 6개(크래시/ANR 분류, 화면 이해, 권한·인텐트·딥링크, APK 읽기, 성능, 오프라인·동시성 재현 레시피). 각 스킬의 명령 블록은 crew 기기 1대에서 실제로 실행돼 통과한다. 설명은 증상("앱이 죽었다", "딥링크가 안 열린다")으로 트리거되게 쓴다. |
| FR-22 | 공개 준비 | LICENSE(MIT), 영문 README(한 줄 설치·데모 GIF·수치표·`mcpServers` 블록·Cursor 딥링크·플러그인 설치 한 줄), npm 패키지(`bin`, `mcpName`; `npm pack` 결과에서 `npx crewdroid --help` 동작), MCP Registry `server.json`, GitHub topics·awesome 목록 PR 문안, 개인 경로·계정·PC명 스크럽 검사. **공개 전환·npm publish·Registry 등록은 사람이 한다**(`docs/release.md` 체크리스트). |
| FR-23 | 공개용 데모 GIF | 샘플 앱으로 혼합 3대가 시나리오를 돌고 판정 결과가 보이는 GIF(≤ 3MB, ≤ 20초). private-app 화면은 쓰지 않는다. |
| FR-24 | 샘플 서버 멱등키 | 정상 모드 PUT 은 같은 `idempotency-key` 재시도에 처음 응답을 돌려주고 새 버전을 만들지 않는다(응답 유실 재시도가 가짜 충돌로 보이지 않게). BUGGY=1 은 그대로. |
| FR-25 | API 31 SurfaceView 원인 | API 31 ATD 가 SurfaceView 화면을 못 그리는 원인을 샘플 앱 SurfaceView 로 재현해 밝힌다. 고칠 수 있으면 `up` 에 반영, 아니면 ADR 에 근거를 남기고 프로필이 API 31 에 배정될 때 경고한다. |
| FR-11 | MVP: private-app 이전 | crewdroid 로 띄운 기기로 private-app `techs.multi.ts` 가 통과하고, 기존 `avd-up.ps1` 대비 디스크·부팅·RAM·CPU 비교표와 데모 GIF 를 남긴다. |

## 3. 비기능 요구사항
- **가벼움:** 디스크는 이미지당 1벌(복제는 `-read-only`), 대당 `-cores 2 -memory 2048` 이하를 기본으로. 수치는 FR-01 기준 대비로 보고.
- **안전:** adb 는 `emulator-<port>` 만 대상. USB 실기기에 명령이 가지 않도록 모든 adb 호출은 한 함수(guard)를 지난다. 기존 old-avd-1~3 은 MVP 통과 전까지 지우거나 수정하지 않는다.
- **포트:** crewdroid 기본 포트는 5580부터(사용자 5554~, private-app 5570~ 와 안 겹치게). MVP 만 `--base-port 5570`.
- **환경:** Windows 11 (WHPX), 16코어, Android SDK `C:/Users/NYS/scoop/apps/android-clt/current`, emulator 37.1.11, Node 24, JDK 17. 오픈소스 공개를 위해 경로는 하드코딩하지 않고 `ANDROID_SDK_ROOT`/`ANDROID_HOME` 을 따른다.
- **AI 친화:** 모든 명령은 `--json` 출력이 있고, 실패 시 0 이 아닌 종료 코드. 같은 함수가 CLI 와 MCP 도구 양쪽에 쓰인다.
- **새 기능의 경량 조건:** 기동 플래그·AVD 설정을 바꾸지 않는 런타임 명령(adb emu/shell)만 기본 기능. 3대 유휴 RAM·CPU 전후 수치를 `docs/measurements/features.md` 에 남기고, 유휴 RAM +5 % 를 넘는 기능은 옵션(기본 꺼짐)으로 둔다.
- **에뮬레이터 호환 메모 (조사 2026-10-26):** `-gpu swiftshader_indirect/angle_indirect/guest` 는 36.4.9 부터 deprecated(대체 `-gpu software`; 우리 기본은 `host`). API 37 이미지는 VM 최소 RAM 4GB 라 FR-13 혼합에 넣지 않는다.

## 4. 구현 범위 밖 (Out of scope)
- "동시에 누르기" 배리어 서버·동기화 장치 (사용자 거부)
- 새 가상화/에뮬레이터 개발
- iOS
- 웹앱(PWA)을 Android Chrome 으로 시험하는 경로 — ATD 에 Chrome 이 없다. 다음 웨이브 후보(google_apis 이미지 필요)
- Remote Test Lab 실기기 density 실측 — 사람이 하는 일(test-cases 의 manual). 이번 웨이브는 조사 표의 임시 density 사용
- 공개 전환·npm publish·MCP Registry 등록·awesome 목록 PR 제출 자체 — 사람이 한다 (준비물만 FR-22)
- 에뮬레이터 37.2.12 업그레이드 (기준 측정이 흔들림. 필요하면 별도 Todo)
- private-app 저장소 수정 (old-avd-1~3 삭제는 T17 로 승인됨)
- GitHub Actions (지금은 없음)
- 조사에서 뺀 채널: Smithery(HTTP/MCPB 만), PulseMCP(제출 중단), mcp.so 유료, llms.txt·GEMINI.md 전용 투자 (근거 부족·전환 중) — `docs/source/research-ai-discoverability.md`
- 다음 웨이브 후보 (경량 비용 중 이상): 클론 런타임 스냅샷 저장(`-read-only` 는 불가), GPX/KML 경로 재생(GUI 전용 → geo fix 반복으로 대체), 멀티디스플레이, perfetto/simpleperf 추적, 호스트 쪽 `adb emu screenrecord` — `docs/source/research-emulator-features.md`
- 기기 전체 로케일·시계 조작 (root 필요, ATD 는 시스템 읽기 전용) — 앱 단위 로케일·`-timezone` 부팅 플래그로 대체

## 5. 스택
- CLI: Node.js 24 + TypeScript (`tsx` 로 실행, `node:test` 로 단위 시험). 패키지 이름 `crewdroid`.
- 샘플 서버: Node(`node:http`) + 파일/SQLite 없이 JSON 파일 저장 — 버그 모드 스위치 포함.
- 프로브/샘플 앱: Android Kotlin (JDK 17, Gradle), 최소 화면.
- AI 조작: mobile-mcp, Maestro CLI.

## 6. 외부 연동
- Android SDK (emulator, adb, avdmanager, sdkmanager) — 시스템 이미지 google_atd 2~3개 다운로드는 사용자 승인됨(개당 0.6~0.9GB).
- mobile-mcp(npm), Maestro CLI — 설치 승인됨.
- private-app 저장소(`<private-app repo>`) — 읽기·실행만.

## 7. 디자인 방향
UI 없음(CLI). 샘플 앱은 시험용 최소 화면이라 디자인 단계 생략.

## 8. 배포 / 운영
- 비공개 GitHub `namyunsu/crewdroid`. autopilot 은 `ai/work` 에 push. 배포 대상 없음.
- 공개 전환은 FR-22 준비가 끝난 뒤 사람이 결정. npm 패키지 이름 `crewdroid` (2026-10-26 npm 에 없음 확인), MCP Registry 이름 `io.github.namyunsu/crewdroid`.

## 9. 변경 이력
| 날짜 | 출처 | 변경 |
|---|---|---|
| 2026-10-23 | docs/source/ 세 파일 + /brief 문답 | 최초 작성. MVP=techs.multi.ts, private-app 수정 안 함, Node+TS, 샘플 서버로 판정 검증 |
| 2026-10-23 | autopilot /brief auto, reviewer 승인 1건 | T13: 데모 GIF 3대 모두 앱 화면이 보이게(FR-11 보완). 요구사항 변경 없음 |
| 2026-10-23 | 사용자 "RAM 이랑 디스크 확 줄여야지" | FR-12 디스크 ≤ 8GB, FR-13 RAM ≤ 4.2GB (3대 기준) 추가. T04 결과 디스크 +56%·RAM +14% 로 늘어난 것을 되돌림 |
| 2026-10-24 | 사용자 "가로세로규격을 내가 임의로 넣을수도있어야해", HMI 큰 화면, 폴드·플립 접는 모션 | FR-14 임의 규격·큰 화면, FR-15 접기/펴기 추가 |
| 2026-10-26 | docs/source/requirements-2026-10-25.md + 조사 2건 + /brief 문답 | FR-16~FR-25 추가 (기기 환경·앱 제어·진단·MCP 서버·에이전트 파일·스킬·공개 준비·데모 GIF·멱등키·API 31). 결정: 웨이브는 AI 노출·공개 준비 먼저, 멱등키는 정상 모드만 존중, API 31 은 원인 조사, LICENSE MIT, 공개 전환은 사람 |
