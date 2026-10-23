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
| FR-11 | MVP: private-app 이전 | crewdroid 로 띄운 기기로 private-app `techs.multi.ts` 가 통과하고, 기존 `avd-up.ps1` 대비 디스크·부팅·RAM·CPU 비교표와 데모 GIF 를 남긴다. |

## 3. 비기능 요구사항
- **가벼움:** 디스크는 이미지당 1벌(복제는 `-read-only`), 대당 `-cores 2 -memory 2048` 이하를 기본으로. 수치는 FR-01 기준 대비로 보고.
- **안전:** adb 는 `emulator-<port>` 만 대상. USB 실기기에 명령이 가지 않도록 모든 adb 호출은 한 함수(guard)를 지난다. 기존 old-avd-1~3 은 MVP 통과 전까지 지우거나 수정하지 않는다.
- **포트:** crewdroid 기본 포트는 5580부터(사용자 5554~, private-app 5570~ 와 안 겹치게). MVP 만 `--base-port 5570`.
- **환경:** Windows 11 (WHPX), 16코어, Android SDK `C:/Users/NYS/scoop/apps/android-clt/current`, emulator 37.1.11, Node 24, JDK 17. 오픈소스 공개를 위해 경로는 하드코딩하지 않고 `ANDROID_SDK_ROOT`/`ANDROID_HOME` 을 따른다.
- **AI 친화:** 모든 명령은 `--json` 출력이 있고, 실패 시 0 이 아닌 종료 코드.

## 4. 구현 범위 밖 (Out of scope)
- "동시에 누르기" 배리어 서버·동기화 장치 (사용자 거부)
- 새 가상화/에뮬레이터 개발
- iOS
- 웹앱(PWA)을 Android Chrome 으로 시험하는 경로 — ATD 에 Chrome 이 없다. 다음 웨이브 후보(google_apis 이미지 필요)
- Remote Test Lab 실기기 density 실측 — 사람이 하는 일(test-cases 의 manual). 이번 웨이브는 조사 표의 임시 density 사용
- 오픈소스 공개 전환·영문 README 정리·npm 배포 — MVP 이후
- 에뮬레이터 37.2.12 업그레이드 (기준 측정이 흔들림. 필요하면 별도 Todo)
- private-app 저장소 수정, old-avd-1~3 삭제
- GitHub Actions (지금은 없음)

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
- MVP 후 공개 전환(사람이 결정).

## 9. 변경 이력
| 날짜 | 출처 | 변경 |
|---|---|---|
| 2026-10-23 | docs/source/ 세 파일 + /brief 문답 | 최초 작성. MVP=techs.multi.ts, private-app 수정 안 함, Node+TS, 샘플 서버로 판정 검증 |
