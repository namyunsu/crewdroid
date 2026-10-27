# 0007 기기 상주 도우미 — 트리 읽기·입력을 adb 셸 명령 대신 계측 APK 한 개로

- 날짜: 2026-10-27 · 상태: 실측 근거 있음 (T52, API 31·34·36)
- 결정: `agent-helper/` 의 계측(instrumentation) APK `dev.crewdroid.agent` 를 `up` 이 기기마다 설치·시작한다. 도우미는 기기 안 `127.0.0.1:6790` 에서 작은 HTTP 를 받고, 호스트는 `adb forward tcp:0 tcp:6790` 으로 받은 빈 포트로 붙는다. `screen`·`tap`·`type`·`swipe`·`key` 는 도우미가 답하면 도우미로, 답하지 않으면 지금까지의 `uiautomator dump`·`input` 경로로 간다(결과의 `via`).
- 확인: `npm test && node scripts/check-helper.mjs` [확인함 `.ai-log/evidence/T52-1.txt`]

## 구조
| 부분 | 내용 |
|---|---|
| 기기 쪽 `Runner.kt` | `Instrumentation` 하나. `am instrument -w --no-hidden-api-checks -e port 6790 -e serial <serial> dev.crewdroid.agent/.Runner` 를 기기 셸에서 `setsid nohup ... &` 로 띄워 CLI 프로세스가 끝나도 남는다. UI·액티비티 없음. 의존성 없음(HTTP 는 `ServerSocket`, JSON 은 기본 `org.json`), R8 로 줄여 APK 약 43 KB |
| 경로 | `GET /health` (serial, api, versionCode) · `GET /tree` (활성 창 트리) · `GET /size` (현재 회전의 화면 크기, `wm size` 반영) · `POST /tap {x,y}` · `POST /swipe {x1,y1,x2,y2,ms}` · `POST /key {code}` · `POST /text {text}` |
| 트리 | `rootInActiveWindow` 를 돈다. 사용자에게 보이는 노드만, 텍스트·desc·id 가 없고 클릭·편집·스크롤도 안 되는 레이아웃 노드는 빼되 자식은 원래 깊이를 지킨다. 노드 = `{cls(짧은 이름), text, desc, id, bounds, clickable, depth, editable?, scrollable?, checked?}`. `uiautomator dump` 와 같은 뷰 집합을 보도록 `FLAG_INCLUDE_NOT_IMPORTANT_VIEWS`·`FLAG_REPORT_VIEW_IDS` 를 켠다. 읽기 전 `waitForIdle(100 ms, 최대 1 s)` |
| 입력 | 탭·스와이프·키 = `UiAutomation.injectInputEvent` (`input` 명령의 JVM 기동이 없다). 글자 = 입력 포커스가 있는 편집 노드에 `ACTION_SET_TEXT`(기존 글 + 새 글, 커서는 끝으로). 키 맵을 거치지 않아 한글·이모지도 그대로 들어간다 |
| 호스트 쪽 `src/helper.ts` | `startHelper`: APK 를 `/data/local/tmp` 로 push, 이전 도우미 force-stop, 그다음 기기 안에서 분리된 셸 하나가 versionCode 가 `HELPER_VERSION` 과 다를 때만 `pm install -r` 하고 `am instrument` 를 띄운다. 호스트는 forward 만 잡고 바로 돌아온다(adb 호출 3번). `call`: 포트는 `%TEMP%/crewdroid-helper-<serial>.json` 과 메모리(MCP 서버)에 둔다. 시작 뒤 45 초 안의 명령은 대체 경로로 가지 않고 `/health` 가 답할 때까지 기다린다. `orFallback`: 도우미가 답하지 않으면 옛 경로를 쓰고 **그 뒤에** 도우미를 다시 띄운다 |
| `up` | 기기별 identity 단계 뒤 `startHelper` 를 wm 단계와 나란히 돌린다. 결과 `devices[].helper` = `{ok, port, seconds}`, `phases.helper`. 설치·연결은 `up` 이 끝난 뒤 기기 안에서 이어진다 |
| 배포 | APK 는 npm 패키지에 넣는다: `files` 에 Gradle 산출물 경로, `prepack` 이 `probe-app` 의 Gradle wrapper 로 `agent-helper` 를 빌드한다. 사용자는 JDK·Gradle 없이 받는다. 저장소 체크아웃에서는 `probe-app/gradlew -p agent-helper assembleRelease` (check-helper 가 빌드한다). APK 가 없으면 `up` 의 `helper.ok=false` 와 이유, 명령은 옛 경로 |

## UiAutomation 은 시스템에 하나만 — 쉬면 놓는다
Android 는 UiAutomation 클라이언트를 한 번에 하나만 받는다. 도우미가 연결을 쥐고 있는 동안 `uiautomator dump` 는 `UiAutomationService ... already registered!` 로 죽는다 [확인함 API 34 logcat, `UiAutomationManager.registerUiTestAutomationServiceLocked`]. 그러면 crewdroid 의 대체 경로, mobile-mcp 의 요소 목록(`uiautomator dump`), Maestro 드라이버가 모두 막힌다. 그래서 도우미는 요청 없이 3 초가 지나면 연결을 놓고(`UiAutomation.destroy()`, 숨은 API 라 `--no-hidden-api-checks`) 다음 요청에서 다시 잡는다. `accept()` 의 timeout 을 그 타이머로 써 스레드를 늘리지 않았다.
- 놓은 뒤 `uiautomator dump` 는 성공한다 [확인함 check-helper parity 항목: dump 를 도우미가 쉬는 동안 돌린다].
- 다시 잡는 비용은 요청 한 번에 약 0.1 초다 (아래 표의 "쉰 뒤").
- 남는 한계: 도우미는 요청 없이 3 초가 지나야 UiAutomation 을 놓으므로 그 안에 mobile-mcp·Maestro 를 섞으면 나중 쪽이 실패할 수 있다. 도우미가 500 을 내면 `src/helper.ts`(64, 89행)는 대체 경로 없이 예외를 던진다(연결 거부·빈 응답·421 만 대체 경로). 측정(T61, `docs/measurements/coexist.md`): 세 번 실행에서 첫 실행만 a(`up` 1 초 뒤 mobile-mcp)와 f(Maestro 흐름 중 `screen`, 흐름도 실패)가 실패했고 나머지 두 번은 6 사례 모두 성공했다(단 f 의 Maestro 흐름은 세 번째에도 실패). 도우미 500 은 관찰되지 않았고 원인은 가리지 못했다. 이 충돌은 도우미 이전에도 dump 와 Maestro 사이에 있었다.

## 수치
| 항목 | API 31 | API 34 | API 36 | 목표 |
|---|---|---|---|---|
| `up` 에 더해진 시간 (wm 단계 뒤) | 0 s | 0 s | 0 s | ≤ 1 s |
| `up` 이 끝난 뒤 첫 `/health` 까지 | 97 ms | 59 ms | 5650 ms | — |
| 20 x `/tree` p50 / p90 (호스트 왕복 포함) | 22 / 36 ms | 23 / 47 ms | 63 / 111 ms | ≤ 300 / 600 ms |
| 쉰 뒤(UiAutomation 다시 잡기) `/tree` | 135~145 ms | 188~197 ms | 166~490 ms | ≤ 600 ms |
| CLI `tap --text "New note"` (node 기동 포함) | 377 ms | 410 ms | 483 ms | ≤ 1.5 s |
| MCP `tap` 도구 호출 | 73 ms | 117 ms | 57 ms | ≤ 0.5 s |
| 텍스트 parity (목록 / 에디터 시트) | 21/21, 8/8 | 22/22, 8/8 | 22/22, 8/8 | dump 텍스트 전부 |
| `type "안녕 pump"` | 그대로 | 그대로 | 그대로 | |
| 도우미 kill 뒤 `screen` (대체 경로) / 그다음 `screen` (재시작된 도우미) | 5084 / 1658 ms | 3154 / 706 ms | 4580 / 3517 ms | 둘 다 동작 |
| 도우미 PSS (기기 RAM 중) | 18 / 710 MB | 18 / 842 MB | 18 / 839 MB | |

3대 유휴 RAM(에뮬레이터+qemu working set, 30 초): 도우미 켬 2490·2162 MB, 끔 2314 MB → 켬 평균 기준 +0.5 % (≤ +5 %), `docs/measurements/features.md` T52 행 [확인함 `.ai-log/evidence/T52-1.txt`]. 켬→끔→켬 순서로 재 장시간 기동 에뮬레이터의 꾸준한 감소를 상쇄했다.

## 대체 경로와 재시작
- 도우미가 연결 거부·빈 응답·serial 불일치(421)면 "답하지 않음"으로 보고 옛 경로를 쓴다. 프로세스당 한 번 `helper not answering on <serial> (<이유>); using uiautomator/input` 를 stderr 로 남긴다.
- 옛 경로가 끝난 뒤 `/health` 를 한 번 더 보고 그래도 없으면 `startHelper` 로 다시 띄운다. 순서가 반대면 새 도우미가 UiAutomation 을 쥐어 바로 앞의 dump 가 실패한다.
- 처음에는 호스트가 `adb install` 하고 `/health` 를 기다린 뒤 `up` 을 끝냈다. 막 부팅한 기기(첫 부팅 dexopt, identity 의 프레임워크 재시작)에서는 설치 약 6 초 + `am instrument` 시작 약 3 초라 `up` 이 API 34 에서 5.7 초, API 31·36 에서 15 초 넘게 늘었고 두 대는 15 초 안에 답하지 않았다 [확인함 첫 check-helper 실행, API 31 logcat 타임라인]. 그래서 설치·시작을 기기 안으로 넘기고 기다림을 첫 명령으로 옮겼다.
- 시작 뒤 45 초 안에 답이 없으면, 또는 시작 자체가 실패하면 상태 파일에 `failedAt` 을 적고 5 분 동안은 시작을 다시 시도하지 않는다(명령마다 몇 초씩 잃지 않게). `up` 은 이와 상관없이 늘 시작한다.
- 시간 초과로 끝난 POST(탭 등)는 기기에서 이미 실행됐을 수 있어 대체 경로로 다시 보내지 않고 오류로 낸다(두 번 탭 방지).
- `type`: 도우미가 409(접근성 트리에 입력 포커스 편집 노드 없음, 예: WebView 안 입력칸)를 내면 ASCII 는 `input text` 로 보낸다. 비ASCII 는 그 이유로 실패.

## 보안
- 기기 쪽 소켓은 `127.0.0.1` 에만 묶인다. 같은 에뮬레이터 안의 다른 앱은 이 포트에 붙어 탭·입력을 보낼 수 있다 [추론 루프백은 앱 사이에 열려 있다]. 테스트용 에뮬레이터라 받아들인다. 실기기에는 설치하지 않는다(모든 adb 호출은 `emulator-<port>` 만).
- 호스트 쪽 `adb forward tcp:<port>` 는 adb 서버가 `127.0.0.1` 에만 연다 [추론 adb 기본값, 별도 확인 안 함]. 다른 PC 에서는 붙을 수 없다.
- 호스트 포트가 에뮬레이터가 꺼진 뒤 다른 에뮬레이터의 forward 로 재사용될 수 있어, 모든 요청에 `X-Serial` 을 붙이고 도우미는 자기 serial 이 아니면 421 로 거절한다 [확인함 수동 curl: `this helper serves emulator-5580, not emulator-5581`].

## 하지 않은 것
- 접근성 서비스(AccessibilityService) 방식: 여러 개가 함께 돌 수 있어 충돌은 없지만 임의 `KEYCODE_*` 주입이 안 되고(전역 동작만) 설정 변경이 필요하다. 브리프가 계측 방식을 정했다.
- 베이스 AVD 스냅샷에 미리 설치: `prepare` 와 스냅샷을 바꿔야 해 하지 않았다. 클론은 `-read-only` 라 `up` 마다 기기 안에서 설치한다(43 KB). 기기 쪽 로그는 `/data/local/tmp/crewdroid-agent.log`.
