# crewdroid — PRD

## 1. 목적 / 사용자 / 핵심 시나리오

**목적:** 구글 안드로이드 에뮬레이터 위에 올리는 **가볍고 빠른 다자(多者) 안드로이드 현장 시험실**. 서로 다른 삼성 갤럭시를 쓰는 여러 사용자가 각자 다른 타이밍에 같은 흐름을 반복하고, 그사이 네트워크가 끊겼다 돌아오고, 끝나면 서버 데이터로 동시성 버그(중복·누락·덮어쓰기)를 판정한다. AI 에이전트(Claude Code)가 운영한다. MVP·데모가 생기면 GitHub 오픈소스로 공개한다(그 전까지 비공개).

**사용자:** 남윤수(혼자 여러 앱을 만들고 운영) → 공개 후 같은 문제를 가진 앱 개발자.

**포지셔닝 (2026-10-27):** "Maestro 와 mobile-mcp 가 앱을 조작하면, crewdroid 는 조건을 만들고 결과를 판정한다." 대체재가 아니라 보완재. 아무도 안 하는 자리 세 가지: ① 여러 기기를 동시에 띄우고 기기마다 다른 네트워크 장애 주입 ② 버전 × 화면 × 글꼴 매트릭스를 로컬에서 무료로 일괄 판정 ③ 앱 화면이 아니라 서버 데이터로 정합성 판정. 경쟁 분석: `docs/source/direction-2026-10-27.md` 1-1.

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
| FR-26 | 한 번에 설치 (`setup`) | `crewdroid setup` 이 Android SDK 커맨드라인 도구·platform-tools·emulator·기본 ATD 이미지(API 34, 선택으로 31/36)와 필요하면 JDK 17 을 받아 설치하고, 이미 있으면 아무것도 받지 않는다. `--dry-run` 은 받을 것과 크기만 보여준다. SDK 라이선스는 `--yes` 또는 대화형 동의가 있어야 받는다. Windows 는 실측, Linux/mac 은 같은 코드 경로(수동 확인). |
| FR-27 | 1대 바로 띄우기 | 인자 없는 `crewdroid up` 은 기본 1대(s24ultra 프로필, 설치된 가장 높은 API ≤ 36)를 띄운다. `--api N`, `--profile`, `--screen` 으로 바꾼다. `crewdroid devices` 가 떠 있는 기기를 보여준다. 1대 기동 시간을 측정해 남긴다. |
| FR-28 | 앱 설치·실행·로그 | `install <serial\|all> <apk> [--grant]`, `launch <serial> <pkg> [--activity] [--restart]`(재시작은 종료→2초→실행, ADR 0005), `logs <serial> <pkg> [--since] [--level] [--seconds]`(그 앱 pid 의 로그만). 모두 MCP 도구. |
| FR-29 | 캡처·입력 | `shot <serial> [file]` 은 PNG 한 장을 저장하고 경로를 출력(MCP 는 이미지로 돌려줌, API 31 검은 화면 복구 포함). `tap <serial> (x y \| --text T \| --id ID)`, `type <serial> <text>`, `swipe <serial> up\|down\|left\|right`, `key <serial> back\|home\|enter`. 글자/id 로 누를 때 후보가 여럿이면 목록과 함께 실패. 영문이 아닌 글자 입력은 되는 방법을 찾거나 이유와 함께 실패. mobile-mcp 없이 crewdroid 하나로 앱을 조작한다. |
| FR-30 | 바이브 코딩 루프 | AI 가 MCP 만으로 up → install → launch → shot → tap/type → logs → down 을 끝까지 돈다. 이 루프를 실제 기기 1대에서 자동 검증하고, `android-vibe-loop` 스킬로 짧게 안내한다. |
| FR-31 | 소개 바꾸기 | README 첫 화면·AGENTS.md·npm/MCP 설명·GitHub 설명이 "AI 코딩 에이전트용 가벼운 헤드리스 안드로이드 에뮬레이터(바이브 코딩)"를 앞세운다. 첫 화면은 4줄 시작(`setup` → `up` → `install` → `shot`)과 안드로이드 스튜디오 에뮬레이터 대비 표. 다자 동시성 시험은 "고급 기능" 절로. |
| FR-32 | 0.2.0 준비 | 바이브 코딩 루프 데모 GIF(1대, 단계 자막), 버전 0.2.0(package.json·server.json), CHANGELOG. npm publish·Registry 재등록은 사람이 `docs/release.md` 순서대로(사무실 PC, 브라우저 승인). |
| FR-33 | macOS·Linux 지원 | Apple Silicon Mac(arm64-v8a 이미지, Hypervisor.framework)과 Linux(KVM)에서 `setup`·`up`·`shot`·`down` 이 돈다. OS 차이는 한 모듈에만 둔다. Windows 동작은 그대로. Mac 실측은 사람이(manual). |
| FR-34 | 15초 소개 모션 그래픽 | README 맨 위 15초 GIF: 문제(무거운 스튜디오 에뮬레이터) → 명령 하나로 7초 기동 → 버전·화면 바꾸기 → AI 가 조작 → 이름·한 줄 소개·설치 명령. 실제 기기 캡처를 쓰고 숫자는 측정 파일에서 읽는다. HTML/CSS 애니메이션을 헤드리스 브라우저로 프레임 단위 렌더. 보기 좋은지는 사람이 판단. |
| FR-35 | AI 조작 효율 증명 | 같은 작업을 crewdroid 방식(접근성 트리 + 글자로 탭)과 스크린샷 방식(이미지 보고 좌표 탭)으로 각 5회 돌려 작업당 시간·도구 호출 수·관찰 데이터 크기·예상 토큰을 잰다. 첫 기기 준비 시간도 일반 에뮬레이터와 비교. 이 숫자가 README·소개 영상의 핵심 메시지. |
| FR-36 | `run` 일반화 | **Maestro flow YAML 을 그대로 받아**(새 DSL 금지, 방향 2026-10-27) N대에서 서로 다른 타이밍·네트워크 일정으로 돈다. 샘플 앱 하드코딩 제거, 앱 상태 확인은 로그 패턴·화면 글자 대기. 앱에 테스트 훅이 필요 없다. 공개 오픈소스 앱으로 검증. 끝 판정은 사용자 백엔드의 export 에 `judge` 규칙. 샘플 앱 전용 훅은 `preset: probe` 로 분리. |
| FR-37 | CI | 공개 저장소에서만 도는 GitHub Actions: Windows·macOS·Linux 단위 테스트·타입검사, Linux 실제 에뮬레이터 스모크(setup→up→shot→screen→install→launch→logs→down). |
| FR-38 | 공개 저장소 정리 | (방향 2026-10-27 로 변경) 공개 `namyunsu/crewdroid` 에서 직접 개발. `.ai-log/` 는 추적하지 않음, README 에 과장·작업 로그·PC명 없음, main 은 의미 있는 메시지의 squash merge 만, npm 버전 = package.json 버전. |
| FR-39 | 조합 레이아웃 판정 (`sweep`) | 기존 테스트 하나(Maestro flow)를 안드로이드 버전 × 화면(프로필·임의 크기·폴드) × 글꼴 크기 조합 전체에 자동으로 돌리고, 각 화면의 접근성 트리 좌표로 화면 밖 버튼·겹친 요소·잘린 글자(글자별 위치 정보)·작은 터치 영역을 판정한다. 깨진 곳 목록 + 표시된 캡처 + 종료 코드. |
| FR-40 | 판정 정확도 벤치 | 공개 오픈소스 앱(포크)에 버그를 심고(처음엔 5개 × 3회), 같은 모델·프롬프트로 **mobile-mcp 단독 vs mobile-mcp + crewdroid** 를 비교: 찾은·고친 비율(주 지표)·오탐·시간·토큰. 레이아웃 버그(sweep)와 네트워크·다기기·서버 정합성 버그를 섞는다. 지더라도 결과와 원시 로그를 공개. 이기지 못하면 출시 단계로 가지 않는다. |
| FR-41 | 기기 사양 선택 | 실제 기기 사양처럼 CPU 코어 수·RAM 을 고른다(`up --cores --ram`, 프로필에도). 스냅샷이 사양에 묶이면 사양별 기본 스냅샷을 처음 쓸 때 만든다. 기본값은 지금 그대로(가벼움). |
| FR-42 | 사용자 폰 부하 | `load off/low/mid/high`: 깔린 앱(수십~백여 개)·백그라운드 프로세스·메모리 점유·CPU 작업·주기적 깨우기를 정해진 단계로 걸고, 기기 상태(남은 메모리·CPU·패키지 수)와 시험 앱의 기동 시간·버벅임·강제 종료를 측정해 보여준다. `off` 로 원상복구. |
| FR-43 | Wi-Fi 시험 | Wi-Fi / 모바일 데이터 / 둘 다 / 없음 전환, 전송 중 Wi-Fi↔모바일 이동(핸드오버), 데이터 요금제(metered) Wi-Fi. 앱이 보는 네트워크 종류를 되읽어 확인. ATD 이미지에 Wi-Fi 가 없으면 근거와 대안을 남기고 멈춤(큰 이미지 다운로드는 사용자 승인). |
| FR-44 | 공개 저장소 꾸미기 | 기여 안내·행동 강령·보안 안내·이슈 양식(버그/기능/"내 앱에 써 봤다")·PR 양식, 바로 돌려 볼 수 있는 예제 3개(내 API 판정, Maestro + 네트워크 장애, 크래시 분석), 소셜 미리보기 이미지. 없는 기능은 쓰지 않는다. |
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
| 2026-10-26 | autopilot /brief auto, reviewer 승인 2건 | T30 AGENTS.md 명령 표(fold/unfold/app) 보완(FR-20), T31 perf 의 `am start -S` 제거(FR-18/FR-25). 요구사항 변경 없음 |
| 2026-10-26 | autopilot /brief auto, reviewer 승인 3건 | T32 샘플 앱 실시간 상태 화면 + 데모 GIF(FR-23, T29 해소), T33 느린 망 2MB 업로드 미완료 원인(ADR 0006 열린 질문), T34 features.md 행 중복 정리. 요구사항 변경 없음 |
| 2026-10-26 | 사용자 "진짜 너무 무거운 안드로이드 스튜디오 에뮬레이터보다 AI가 다루기 훨씬 쉽고, 서버 자원 많이 안 먹고 빠르고 캡처도 잘 되고 OS·사양·크기도 바뀌는 심플한 에뮬레이터, 바이브 코딩용" / "싹 다 해 오토파일럿으로" | FR-26~FR-32 추가: 바이브 코딩 루프(setup·1대 up·install·launch·logs·shot·tap/type·MCP 루프·스킬)와 소개 바꾸기, 0.2.0 준비. 동시성 시험은 고급 기능으로 |
| 2026-10-26 | 사용자 "이거 mac에서도 돌아가야해" | FR-33 추가 (T43): OS 전용 코드를 한 모듈로 모으고 macOS·Linux 경로 추가 |
| 2026-10-26 | 사용자 "꼭 소개를 멋지게… 뭐하는 프로젝트인지 잘 몰라, 15초짜리 소개 모션그래픽" | FR-34 추가 (T44), T40 첫 화면 순서: hero.gif → "What is it?" 3줄 → 빠른 시작 |
| 2026-10-26 | 사용자 "소개영상 너무 구리다, 실제 앱 기동을 넣어야지" / "AI가 더 잘·빠르게 다루는 게 최고의 강점, 대충 만들지 마" | T48 데모 앱+실제 녹화, T50 소개 영상 v2(실제 녹화 11초 이상, AI 조작 효율 수치), FR-35·T49 에이전트 조작 벤치마크 추가 |
| 2026-10-27 | autopilot /brief auto, reviewer 승인 1건 | T51 Field Notes 데모 앱 화면 깨짐 점검(기종 5개 x 글자 크기 3단계, design-rules). 요구사항 변경 없음 |
| 2026-10-27 | T49 측정이 주장과 반대(트리 9695토큰·23.9초 vs 스크린샷 6212토큰·10.3초), 사용자 "그래 진행해" | 메시지 유지, 실제로 빠르게: T52 상주 도우미(트리 ≤0.3초), T53 짧은 출력·행동 후 화면 반환, T54 재측정(둘 다 이겨야 함) 뒤 T50 영상·T40 README |
| 2026-10-27 | 외부 비평 `docs/source/critique-2026-10-27.md` + /brief 문답 | 지적 전부 사실 확인. FR-36 run 일반화(UI 단계), FR-37 CI(공개 저장소만), FR-38 비공개 개발 + 공개 미러, 3대 ready ≤20초·대기 CPU 절반(T56·T57), 버전은 웨이브 끝 0.2.0 배포. 이 PC 의 origin 을 비공개 crewdroid-dev 로 전환 |
| 2026-10-27 | `docs/source/direction-2026-10-27.md` + 사용자 "진짜 장점은 기존 테스트 하나로 버전 × 화면 × 글꼴 조합을 AI 가 돌리고 깨진 곳을 판정" + /brief 문답 | 핵심 메시지 변경(화면 너머 원인 + 조합 레이아웃 판정), FR-39 sweep·FR-40 판정 정확도 벤치 추가, FR-36 을 Maestro flow 입력으로, FR-38 을 공개 저장소 직접 개발로. 비공개 dev 저장소 아카이브. T53·T54·T55·T56·T57·T50·T59·T60·T40 보류·폐기·세션 이관, autopilot 은 측정·반복 작업만 |
| 2026-10-27 | 사용자 경쟁 분석·포지셔닝 (direction 1-1) | 포지셔닝을 보완재로 명시(§1), FR-40 벤치 조건을 mobile-mcp 단독 vs mobile-mcp + crewdroid 로 변경 |
| 2026-10-27 | autopilot /brief auto, reviewer 승인 1건 | T61 도우미(T52)와 mobile-mcp·Maestro 동시 사용 측정(FR-06), ADR 0007 문구 정정. 요구사항 변경 없음 |
| 2026-10-27 | 공개 앱 조사 `docs/source/research-oss-app.md` + 사용자 선택 | Phase 1·2 대상 앱 = Tasks.org(GPL-3.0, generic flavor) + Radicale(로컬 CalDAV). 먼저 키 없는 빌드·시간 실측, 깨지거나 너무 느리면 Fossify Notes(sweep) + wallabag(run) 으로 전환 |
| 2026-10-27 | 사용자 "cpu와 ram을 선택할 수 있게", "부하 low-high", "와이파이 잡고 테스트" | FR-41 사양 선택, FR-42 사용자 폰 부하, FR-43 Wi-Fi 시험 추가(T64·T62·T63, autopilot, 기본 꺼짐) |
| 2026-10-27 | 사용자 "git도 꾸며줘야 해, 유입 들어오게" | FR-44 추가(T65). GitHub 설명·홈페이지·토픽 16개는 세션에서 바로 변경 |
| 2026-10-27 | T61(자동) 공존 측정 실패 + 보완재 포지셔닝 | T66: Maestro·mobile-mcp 와 같은 기기에서 같이 써도 깨지지 않게(6개 사례 각 10/10) |
