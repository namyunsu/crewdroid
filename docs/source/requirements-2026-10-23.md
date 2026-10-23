# crewdroid — 요구사항 메모 (2026-10-23, 남윤수와의 대화에서)

## 한 줄
AI 에이전트가 운영하는 **가볍고 빠른 다자(多者) 안드로이드 현장 시험실**. 서로 다른 삼성폰을 쓰는 여러 사용자가 각자 다른 일을 동시에 하고, 그사이 네트워크가 끊겼다 돌아오고, 끝나면 서버 데이터로 동시성 버그(중복·누락·덮어쓰기)를 판정한다. GitHub 오픈소스로 공개해 스타를 받는 것이 목표 (MVP 와 데모가 생기면 공개 전환, 그 전까지 비공개).

## 우선순위 (사용자 결정)
1. **경량화가 최우선.** 지금 이 PC 의 AVD 3대(old-avd-1~3, Android 13 google_apis, 각 5.2~5.8GB + 시스템 이미지 8.2GB, 화면 320x640/160dpi, 대당 4코어)는 무겁고 느리다. 디스크·부팅 시간·RAM·CPU 를 숫자로 재서 줄인다. 전후 측정값이 결과물이다.
2. 다자 동시 시험이 원활할 것 — 앞으로 어떤 앱을 만들든 기본 시험이다.
3. AI(Claude Code)가 잘 다룰 것.

## 사용자 결정·의견 (그대로)
- 에뮬레이터 자체(가상화)를 새로 만들지 않는다. 구글 에뮬레이터 위에 올리는 시험실을 만든다.
- 대상은 **삼성 갤럭시 폰**. 기종 바리에이션은 넓게 (S·A·Flip·Fold·TriFold, 안드로이드 12~17). 기종 화면 값은 `research-samsung-screens.md`. 기본 density 는 공식 값이 없어 Remote Test Lab 실기기 `adb shell wm size/density` 로 실측해 채운다.
- **기사 여러 명이 같은 폰이라고 가정하지 않는다.** 시험마다 서로 다른 기종·버전을 섞는다.
- **"동시에 누르기"(배리어) 장치는 쓰지 않는다.** 현실의 겹침을 만든다: 각자 다른 타이밍으로 같은 흐름을 여러 번 반복, 네트워크 상태 섞기, 끝난 뒤 서버 데이터로 판정. 대량 동시 요청은 에뮬레이터 없이 API 스크립트로.
- **비행기 모드처럼 데이터가 안 터지는 환경**을 꼭 넣는다: 비행기 모드, 데이터만 끊김, 아주 느림, 들락날락. 업로드 도중 끊김, 오프라인 저장 후 재연결 동기화, 오프라인 중 다른 사용자가 같은 건 수정, 오프라인 상태로 앱 재시작.
- 실물 최종 확인은 삼성 Remote Test Lab(하루 무료 5시간, 원격 adb) — 동시성 시험용이 아니라 마지막 확인과 density 실측용.

## 조사로 정한 방향 (근거: research-tools.md)
- 이미지: 경량 ATD(`google_atd`/`aosp_atd`, API 34 약 700MB) 우선. 단 카메라 앱·갤러리·Chrome 이 없다 → 카메라·사진 선택·업로드가 되는지 **먼저 실측**, 안 되면 google_apis 유지.
- 같은 AVD 를 `-read-only` 로 여러 개 띄워 디스크를 1벌로. 복제 인스턴스의 ANDROID_ID 등 기기 고유값이 같은지 **실측** (서버가 기기로 사용자를 구분하면 문제).
- 기종은 기종마다 AVD 를 만들지 않고 실행 후 `wm size/density` 로 바꾼다. 안드로이드 버전 차이만 이미지를 따로 둔다 (2~3개).
- AI 조작: mobile-mcp (명령마다 device 지정, 접근성 트리). 재실행 가능한 흐름: Maestro (`--shard-all`).
- 기존 자산: `<private-app repo>\private-app-devicetest\scripts\avd-up.ps1`(N대 headless 기동·APK 설치·권한, emulator-<port> 만 adb 대상), `private-app-server/tests/e2e/multi/harness.ts`. `~/.claude/skills/ui-sweep/app-sweep.py`(fold/flip 화면 프로필을 wm 으로 바꾸고 reset).

## MVP (제안, 사용자 확인 전)
private-app 의 3인 동시 접속 시험을 crewdroid 로 옮겨, 기존보다 가볍고 빠르게 같은 결과로 통과. 전후 디스크·부팅·RAM 수치와 데모 GIF.

## 안전
- adb 는 emulator-<port> 만 대상으로 (USB 실기기 보호, private-app 규칙과 같음).
- 기존 old-avd-1~3 은 새 방식이 private-app 시험을 통과하기 전까지 지우지 않는다.
