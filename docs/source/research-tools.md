# 안드로이드 다자 동시 테스트 환경 조사 (2026-10-23 기준)

조사 방법: GitHub 저장소의 스타 수와 마지막 push 날짜는 `gh api`로 직접 받았고, README와 소스는 직접 열어 봤습니다. 시스템 이미지 크기는 Google 저장소 XML(`dl.google.com/.../sys-img2-4.xml`)에서 받았고, 이 PC의 `sdkmanager --list`와 `emulator -help`를 실행해 대조했습니다. Remote Test Lab 문서는 자바스크립트로 그려지는 페이지라 브라우저로 열어 읽었습니다.

이 PC의 현재 AVD 상태(`~/.android/avd/old-avd-1.avd/config.ini`):
- 용량은 대당 5.8GB입니다.
- 화면이 320x640, 160dpi라서 갤럭시 화면과 전혀 다릅니다.
- `hw.gpu.enabled=no`, 4코어, 2GB RAM, 데이터 파티션 10G입니다.
- 3대를 띄우면 vCPU 12개를 씁니다.
- 에뮬레이터 버전은 37.1.11이고 37.2.12가 나와 있습니다.

---

## 1. AI 에이전트가 기기를 조작하는 도구

| 저장소 | ★ | 마지막 push | 판정 |
|---|---|---|---|
| [mobile-next/mobile-mcp](https://github.com/mobile-next/mobile-mcp) | 9,900 | 2026-10-18 (v1.0.12) | **추천 1** |
| [mobile-dev-inc/Maestro](https://github.com/mobile-dev-inc/Maestro) (`maestro mcp`) | 16,180 | 2026-10-22 (cli-2.11.0) | **추천 2** |
| [appium/appium-mcp](https://github.com/appium/appium-mcp) | 504 | 2026-10-19 | 보조 후보 |
| [CursorTouch/Android-MCP](https://github.com/CursorTouch/Android-MCP) | 903 | 2026-10-21 | 단일 기기용 |
| [droidrun/mobilerun](https://github.com/droidrun/mobilerun) (droidrun에서 이름이 바뀜) | 9,740 | 2026-10-22 | 맞지 않음 |
| minhalvp/android-mcp-server | 811 | 2025-05 | 방치, 제외 |
| srmorete/adb-mcp | 55 | archived | 제외 |

**mobile-mcp (추천 1)**
- 왜:
  - README에 따르면 접근성 트리를 먼저 쓰고, 필요할 때만 스크린샷과 좌표로 넘어갑니다. 이미지 토큰이 적게 듭니다.
  - `src/server.ts`를 직접 확인했습니다. 도구 30여 개가 모두 호출마다 `device: z.string()` 인자를 받습니다. 그래서 MCP 서버 하나로 emulator-5554/5556/5558을 번갈아 조작할 수 있습니다.
  - README에 "Android Emulators on Linux/Windows/macOS"가 명시돼 있습니다.
  - `mobile_batch_commands`로 여러 동작을 한 번의 호출로 묶을 수 있습니다.
- 막힐 점:
  - 기기를 번갈아 순서대로 호출하는 방식이라 "정확히 같은 순간" 동작은 만들 수 없습니다. 동시성 버그 재현은 3번 항목의 스크립트로 해야 합니다.
  - `/mobile-mirror` 화면 미러링은 Ghostty나 kitty 터미널 전용이라 Windows에서는 쓸 수 없습니다.

**Maestro + `maestro mcp` (추천 2)**
- 왜:
  - 공식 문서([llms-full.txt](https://docs.maestro.dev/llms-full.txt))에 `claude mcp add maestro -- maestro mcp`가 나옵니다.
  - MCP 도구는 `list_devices`, `inspect_screen`(뷰 계층 JSON), `take_screenshot`, `run`(인라인 YAML 실행)입니다.
  - 에이전트가 화면을 탐색하다가 쓴 YAML이 그대로 재실행 가능한 테스트 자산으로 남습니다.
  - Windows 네이티브 설치를 지원하며, 문서는 WSL을 권장하지 않는다고 적고 있습니다.
- 막힐 점:
  - Java가 필요합니다.
  - MCP `run` 호출에서 기기 하나를 어떻게 고르는지는 문서에서 확인하지 못했습니다(확인 못 한 것에 적음).

**나머지**
- **mobilerun(구 droidrun)**: 그 자체가 LLM 에이전트입니다. `ANTHROPIC_API_KEY` 같은 별도 API 키와 기기에 Portal 앱 설치가 필요합니다. Claude Code가 직접 조작하는 구조와 겹치므로 제외했습니다.
- **Android-MCP**: `--device SERIAL`로 기기를 서버 시작 때 하나만 고정합니다. 여러 대를 쓰려면 서버를 여러 개 띄워야 합니다.
- **appium-mcp**: 다중 세션(`sessionId`)을 지원하지만 UiAutomator2 세션이 무겁습니다.

## 2. 에뮬레이터를 가볍고 빠르게, 여러 대 띄우기

**추천 1: ATD 이미지(`aosp_atd` / `google_atd`) + `-read-only` 다중 인스턴스**

이미지 크기 비교(Google 저장소 XML, x86_64 zip 기준):

| API | google_apis | aosp_atd | google_atd |
|---|---|---|---|
| 33 | 1,708MB | 582MB | 679MB |
| 34 | 1,564MB | 615MB | 700MB |
| 35 | 1,739MB | 690MB | 813MB |
| 36 | 1,895MB | 746MB | 860MB |

- ATD 이미지는 API 30부터 37까지 있습니다. [공식 문서](https://developer.android.com/studio/test/gradle-managed-devices)의 "API 30만 지원"은 낡은 내용이고, 실제 `sdkmanager --list`에는 33~35 ATD가 보입니다.
- Gradle 밖에서도 씁니다. [ReactiveCircus/android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner)(★1,307, 2026-08)가 `aosp_atd`, `google_atd`를 avdmanager와 emulator로 직접 띄웁니다.
- `-read-only`: 이 PC의 `emulator -help`에 "allow running multiple instances of emulators on the same AVD, but cannot save snapshot"이라고 나옵니다.
  - AVD 하나에 깨끗한 스냅샷(앱 설치 + 로그인 직전 상태)을 저장해 둡니다.
  - 그 AVD를 `-read-only -no-window -no-boot-anim -no-audio -port 5554/5556/5558`로 3개 띄웁니다.
  - 이렇게 하면 디스크 5.5GB x 3을 약 1벌로 줄이고, 스냅샷 로드로 몇 초 만에 부팅합니다.
- RAM과 코어: `-memory 2048 -cores 2`로 3대에 6코어 정도면 됩니다. 지금은 대당 4코어입니다.

**막힐 점 (중요)**
- ATD에는 Chrome, 카메라, 갤러리, 설정 앱, 런처가 없고 하드웨어 렌더링도 꺼져 있습니다.
  - Playwright로 **Android Chrome**을 띄워 웹앱을 테스트하고 있다면 ATD로는 안 됩니다. 그 경우는 google_apis를 유지하고 `-read-only` 공유만 적용하세요.
  - "사진 업로드"는 갤러리 앱 대신 시스템 사진 선택기나 `adb push`로 넣은 파일이 필요합니다. ATD에서 사진 선택기가 동작하는지는 확인하지 못했습니다.
- `-read-only` 인스턴스는 같은 스냅샷의 복제라서 기기 고유값(ANDROID_ID, Wi-Fi MAC 등)이 같을 수 있습니다(추정). 근거는 help에 `-wifi-mac-address`가 "read-only 모드에서 스냅샷 로드 시에만 적용"이라고 따로 있다는 점입니다. 서버가 기기 ID로 사용자를 구분하는 앱이면 주의해야 합니다.

**추천 2: Gradle Managed Devices** — 이번 경우에는 맞지 않습니다. 앱 소스 안의 instrumented 테스트(androidTest) 전용이라, 외부 Playwright·adb·Maestro 방식과 맞지 않습니다.

## 3. 다자 동시성 테스트 오케스트레이션

**추천 1: Maestro `--shard-all` + 배리어 서버**
- `maestro test --device "emulator-5554,emulator-5556,emulator-5558" --shard-all 3 flow.yaml`로 3대가 같은 흐름을 동시에 실행합니다. 근거는 공식 문서 "Run tests in parallel (Sharding)"입니다.
- 흐름 안에서 `${MAESTRO_SHARD_INDEX}`(0부터)로 사용자 계정을 나눕니다.
- `runScript` 안의 `http.get/post`로 작은 로컬 배리어 서버에 "준비됨"을 보내고, 모두 모이면 업로드 버튼을 동시에 누르게 할 수 있습니다.
- 막힐 점:
  - 기기들끼리 맞추는 동기화 기능은 기본으로 없어서 배리어를 직접 만들어야 합니다. 몇십 줄 수준입니다.
  - 에뮬레이터에서 호스트 서버는 `10.0.2.2`로 접근합니다.

**추천 2: 지금의 adb 병렬 스크립트에 배리어만 추가**
- 탭 직전까지 각 기기를 준비시킨 뒤 3대에 `adb -s X shell input tap …`을 동시에 보냅니다. PowerShell `Start-ThreadJob`이나 Node `Promise.all`로 할 수 있습니다.
- 가장 가볍고 이미 있는 자산을 재사용하는 방법입니다.

**맞지 않는 것**
- [Marathon](https://github.com/MarathonLabs/marathon)(★646, 2026-09)은 테스트를 나눠 빨리 끝내는 instrumentation 러너입니다. 동시 동작용이 아닙니다.
- [Flank](https://github.com/Flank/flank)(★701, 2026-06)는 Firebase Test Lab 전용이라 제외했습니다.

## 4. 삼성 화면 흉내내기

- 삼성 공식 [Galaxy Emulator Skin](https://developer.samsung.com/galaxy/emulator-skin/s)이 있습니다. [S26 시리즈는 2026-03에 추가](https://developer.samsung.com/galaxy-emulator-skin/news/en/2026/03/06/emulator-skins-for-galaxy-s26-series-are-now-available)됐습니다.
- 다만 스킨은 테두리 그림일 뿐입니다. headless(`-no-window`)에서는 의미가 없고, 기기 정의 XML도 들어 있지 않습니다.
- [사용 가이드](https://developer.samsung.com/galaxy-emulator-skin/guide.html)도 "하드웨어 프로필을 직접 만들어라"라고만 합니다.

**추천 방법: AVD `config.ini`에서 해상도를 직접 지정**

| 기기 | 해상도 | 물리 밀도(삼성 페이지) |
|---|---|---|
| S26 / S25 / S24 (기본형) | 1080x2340 | 411~422ppi |
| S26 Ultra | 1440x3120 | |

- 설정 예: `hw.lcd.width=1080`, `hw.lcd.height=2340`, `hw.lcd.density=???`
- 막힐 점: 위 숫자는 **물리 ppi**입니다. 안드로이드의 **논리 density** 값은 삼성이 공개하지 않았습니다.
  - Remote Test Lab 실기기에서 `adb shell wm size`와 `adb shell wm density`를 한 번 찍어서 그 값을 쓰는 것이 확실합니다.
  - 흔히 450이라고 알려져 있지만 확인하지 못했습니다.

## 5. 삼성 Remote Test Lab (공식 문서를 브라우저로 확인)

- **무료 한도** ([About RTL](https://developer.samsung.com/remotetestlab/doc/about-remote-test-lab)):
  - 매일 20크레딧, 1크레딧은 15분입니다. 즉 하루 무료 5시간입니다.
  - 최소 예약 30분(2크레딧), 최대 하루 10시간(40크레딧)입니다.
  - 주변기기는 지원하지 않습니다.
- **APK 설치** ([Tests on Devices](https://developer.samsung.com/remotetestlab/doc/tests-on-devices)): "Install App" 버튼이나 화면에 끌어다 놓기로 설치합니다. 기기 관리자 권한이 필요한 앱은 설치할 수 없습니다.
- **원격 adb**: Remote Debug Bridge를 지원합니다. ADB를 PATH에 넣고, RDB 앱을 실행하고, 웹 클라이언트에서 Connect를 누른 뒤 기기에서 USB 디버깅을 허용하면 로컬 포트로 adb가 연결됩니다. 2026-07 공지에서도 RDB와 16KB 페이지 환경을 언급합니다.
- **용도**: 동시성 테스트용이 아니라, 실제 One UI에서 마지막 확인(+ density 측정)용으로 적합합니다.

---

## 우리에게 추천 구성

- **에이전트**: Claude Code에는 `mobile-mcp`를 붙여 탐색과 디버깅을 합니다(호출마다 `device` 지정). 재현 가능한 흐름은 `maestro mcp`로 YAML로 굳힙니다.
- **이미지**: Playwright가 Android Chrome을 쓰지 않는다면 `system-images;android-34;google_atd;x86_64`(700MB)로 갑니다. Chrome이 필요하면 지금의 google_apis 33을 유지합니다.
- **AVD**: AVD는 1개만 둡니다. 1080x2340, density는 RTL 실측값, `hw.gpu.mode=swiftshader_indirect` 또는 host, `-memory 2048 -cores 2`로 설정합니다. 스냅샷을 1회 저장합니다.
- **기동**: 같은 AVD를 `-read-only -no-window -no-boot-anim -no-audio -port 5554/5556/5558`로 3개 띄웁니다. 디스크는 약 1/3로 줄어듭니다.
- **동시성 실행**: `maestro test --device "…5554,…5556,…5558" --shard-all 3`를 씁니다. 계정은 `MAESTRO_SHARD_INDEX`로 나누고, 배리어 서버(`10.0.2.2`)로 "동시에 누르기"를 맞춥니다.
- **최종 확인**: 주 1회 RTL 무료 5시간 안에서 실제 Galaxy에 APK를 올리고, RDB로 adb를 연결해 같은 Maestro 흐름을 1대에서 돌립니다.
- **유지보수**: 에뮬레이터를 37.2.12로 올립니다. 현재는 37.1.11입니다.

## 확인 못 한 것

- ATD 이미지에서 사진 선택기(PhotoPicker)나 `ACTION_GET_CONTENT`가 동작하는지, 그리고 이 PC에서 WHPX로 실제 부팅 시간과 RAM 절감이 얼마인지. 직접 설치해 측정하지 않았습니다.
- `-read-only` 복제 인스턴스들의 ANDROID_ID와 FID가 같은지. 추정만 했습니다.
- 갤럭시 기본 해상도(FHD+)에서의 논리 density 값.
- RDB 앱의 Windows 실행 요건(Java 필요 여부 등)과, RTL에서 한 계정으로 동시에 몇 대를 예약할 수 있는지.
- `maestro mcp`의 `run` 도구가 여러 기기 중 하나를 고르는 방법(인자 이름).
- 지금 Playwright가 Android Chrome에 붙는 방식인지 WebView 방식인지. 이에 따라 ATD를 쓸 수 있는지가 갈립니다.
