# crewdroid (한국어 요약)

**AI 에이전트가 Android Studio 에뮬레이터의 절반도 안 되는 RAM 으로 다루는 안드로이드 에뮬레이터. 기기마다 네트워크·배터리·위치·화면·글꼴·안드로이드 버전을 정해 준다.**

crewdroid 는 앱을 개발하는 동안 빌드하고 확인하는 루프에 쓰는 도구다. 푸시 알림·Play 서비스·Google 로그인·카메라 앱은 여전히 실제 폰에서 확인한다 ([한계](#한계-실제-폰이-필요할-때)).

[![15초 소개: S24·폴드5·플립7 에뮬레이터를 안드로이드 14·16 으로 띄우고, 한 폰만 네트워크를 끊어 메모가 오프라인으로 기다렸다 동기화되는 장면, 서버 데이터 판정(FAIL: 7 violations), 폴드 접기와 다크 모드](docs/demo/hero.gif)](docs/demo/hero.mp4)

- **가볍다.** 기기 1대에 호스트 RAM 1426 MB, 디스크 2.09 GiB. Android Studio 기본 AVD 는 3479 MB, 6.78 GiB. 콜드 부팅 23.7초(기본 AVD 39.3초).
- **에이전트용.** `screen` 은 화면을 글자 목록(`[3] btn "Send" #send @540,1210`)으로 돌려줘 스크린샷 토큰의 약 3분의 1(작업당 1882 대 6183), `tap --text Send` 는 화면 크기와 상관없이 이름으로 누른다. 모든 명령이 `--json` CLI 이자 MCP 도구.
- **환경을 마음대로.** 기기마다 `net airplane|nodata|slow|flaky`, `env` 배터리·위치·다크 모드·글꼴 크기·언어·회전, 갤럭시 S24·폴드·플립 화면과 접기/펴기, 안드로이드 12/14/16, 오래 쓴 폰 부하(`load`).

그 밖에: 여러 대로 돌린 뒤 서버 데이터에서 중복·누락·덮어쓰기 판정, 화면·글꼴 조합 레이아웃 점검, 크래시·ANR 분석.

## 1대 기준: Android Studio 기본 에뮬레이터와 비교

AI 에이전트가 기본 에뮬레이터에서 느리다고 찾아왔다면 여기부터 보면 된다. 1대, 3회 측정의 중앙값, 같은 PC (원본 측정값은 [`docs/measurements/single-vs-studio.json`](docs/measurements/single-vs-studio.json)):

| | Android Studio 기본 AVD | crewdroid `up` |
|---|---|---|
| 콜드 부팅 (`sys.boot_completed` 까지) | 39.3 s | 23.7 s |
| 스냅샷 시작 (`sys.boot_completed` 까지) | 5.4 s | 5.6 s (더 낫지 않음) |
| 스냅샷 시작 후 첫 화면 읽기까지 | 10 s | 14.4 s (더 낫지 않음: CLI 시작 시간 포함) |
| 준비 후 호스트 RAM | 3479 MB | 1426 MB |
| 유휴 CPU, 60 s (100 % = 코어 1개) | 215.1 % (회차별 48.4 ~ 362.2) | 170 % |
| 디스크 (AVD + 시스템 이미지) | 6.78 GiB | 2.09 GiB |
| 화면 읽기 (`adb uiautomator dump` 대 `crewdroid screen`) | 2137.5 ms | CLI 947.1 ms, MCP 서버 안 176.6 ms |
| 스크린샷 (`adb screencap` 대 `crewdroid shot`) | 814.1 ms | CLI 1041.4 ms (더 낫지 않음), MCP 서버 안 290.3 ms |

AI 에이전트가 기기 1대를 조작할 때 (Field Notes 데모 앱, "메모를 추가하고 목록에서 확인", 경로마다 5회, API 34, s24ultra; 원본 [`docs/measurements/agent-bench.json`](docs/measurements/agent-bench.json)): A 는 crewdroid 의 텍스트 화면 요약을 읽고 글자로 누르고, B 는 동작마다 스크린샷을 읽고 x,y 로 누른다.

| 에이전트, 작업 1건당 | 스크린샷 + x,y 탭 | crewdroid `screen` + `tap --text` |
|---|---|---|
| 모델 입력 토큰 추정 | 6183 | 1882 |
| 도구 시간 (s) | 10.46 | 10.58 (동률, 더 빠르지 않음) |
| 같은 작업을 fold5-main·flip6-cover, 글자 1.3 에서 다시 계산 없이 | 실패 (s24ultra 좌표가 화면 밖) | 통과 |

mobile-mcp + 기본 에뮬레이터에 비해 crewdroid 가 더하는 것: 더 가벼운 기기 (위 표, [`single-vs-studio.json`](docs/measurements/single-vs-studio.json)), 기기별 네트워크 장애 (`net`), 화면·글자 크기별 레이아웃 검사 ([`layout.md`](docs/measurements/layout.md)), 서버 데이터 판정 ([`run-app.json`](docs/measurements/run-app.json)). 더하지 않는 것: 탭·입력 속도는 같다 ([`agent-bench.json`](docs/measurements/agent-bench.json); mobile-mcp 자체는 재지 않았고, B 경로가 스크린샷으로 조작하는 에이전트를 대신한다).

조건: 안드로이드 16 (API 36). Studio 쪽은 `google_apis_playstore` 이미지의 `pixel_9` AVD, 기본값 RAM 2 GB·코어 4개, 창 켬, `-gpu auto`, 퀵부트. crewdroid 쪽은 플래그 없는 `up` (창 없음, 코어 2개, `google_atd` 이미지). Ryzen 7 5700X, 64 GB, Windows 11, 에뮬레이터 37.1.11.0. CLI 행에는 `npx tsx` 시작 시간이 들어 있다.

## crewdroid 만 하는 것

1. **화면이 아니라 서버를 판정한다.** 실행이 끝나면 `crewdroid judge` 가 내 API 의 데이터를 읽어 규칙을 검사한다: `unique`(중복 없음), `count`(누락 없음), `noLostUpdate`(몰래 덮어쓰기 없음). 버그는 스크린샷이 아니라 `VIOLATION` 줄과 종료 코드 1 로 돌아온다.
2. **흐름 도중에 기기 하나씩 망가뜨린다.** 기기마다 자기 일정으로 `airplane`·`nodata`·`slow`·`flaky`, 업로드 중 접기·펴기, Doze, 메모리 트림, 저장공간 가득, 저사양 CPU·RAM. 설정한 상태는 매번 되읽어 확인한다.
3. **명령 하나로 섞인 기기 묶음을 띄운다.** 안드로이드 12·14·16 과 S24·폴드·플립·임의 `WxH@dpi` 를 창 없이, 베이스 이미지 하나의 클론으로: 3대가 호스트 RAM 3.93 GB, 디스크 6.99 GiB(할당 크기).

그 밖에: 크래시·ANR 분석, 콜드 스타트·버벅임 측정, APK 검사. 모든 명령이 `--json` 과 종료 코드를 갖고, 모두 MCP 도구다.

```bash
npx crewdroid setup --yes        # 안드로이드 SDK·이미지가 없으면 설치
npx crewdroid up --count 3       # S24 Ultra / API 34, Fold5 / API 34, Flip7 / API 36
npx crewdroid run --apk app.apk --flow flows/add-item.yaml --server http://127.0.0.1:8080   # 내 앱: 기기마다 내 Maestro 흐름 + 네트워크 장애 + 판정, 버그가 있으면 exit 1
```

처음이면 동봉 샘플부터 (샘플 앱 + 경쟁 조건이 있는 샘플 서버): `npx crewdroid run scenarios/photo-upload.json --seed 1`. 내 앱 단계별 안내: [docs/guide-your-app.md](docs/guide-your-app.md) (영문). 우리 것이 아닌 앱 예: DAVx5(F-Droid) + 로컬 Radicale CardDAV 서버, `scenarios/davx5-contacts.json`, 3대에 airplane·nodata·slow·flaky, 응답 30 % 를 끊고 한 번 더: 위반 0, 연락처 12 개 중 12 개 저장, 중복 없음 — DAVx5 에서 버그를 찾지 못했다 ([`docs/measurements/run-app.json`](docs/measurements/run-app.json)).

## 구글 에뮬레이터와 뭐가 다른가

| | Android Emulator / AVD Manager | crewdroid |
|---|---|---|
| 다자 버그 | 기능 없음 | `run` 이 기기마다 다른 타이밍으로 흐름을 반복하고 `judge` 가 서버를 검사: `unique`·`count`·`noLostUpdate` |
| 네트워크 | Extended Controls 토글 1개 | 기기별 `airplane`·`nodata`·`slow`·`flaky` 를 무작위 일정으로, 업로드 도중에도 |
| 기기 | AVD 1개 = 창 1개, 디스크 이미지 각각 | 베이스 이미지 1개의 읽기 전용 클론 N대, 화면(S/Fold/Flip/임의 `WxH@dpi`)·API 혼합 |
| 조작 | 창에서 클릭 | 모든 명령 `--json` + 종료 코드 |
| 기기 상태 | GUI 패널 | `env`(GPS·배터리·회전·다크·글자·로케일·GSM·SMS·통화), `app`(권한·딥링크·Doze·트림·저장공간) — 설정 후 되읽어 확인 |
| 폴드/플립 | 폴더블 AVD 필요 | 아무 클론에서 `fold`/`unfold`: 앱이 실제 configuration change 를 받음 |
| AI 에이전트 | 부를 게 없음 | MCP 서버, `AGENTS.md`, 증상으로 트리거되는 스킬 7개 |

3대 기준 자원 (API 3종, 기본 AVD는 `avdmanager` 기본값·창 없음·첫 부팅):

| | 기본 `google_apis` | 기본 `google_atd` | crewdroid |
|---|---|---|---|
| 디스크 | 24.7 GiB (파일 길이, 할당 크기로 재지 않음) | 11.8 GiB 할당 (파일 길이 33.2 GiB) | 6.99 GiB 할당 |
| 호스트 RAM | 8.45 GB | 8.5-8.8 GB | 3.93 GB |
| 유휴 CPU (100 % = 코어 1개) | ~1000 % | ~248-352 % | ~600 % |

"할당" = 실제 디스크에 차지한 바이트(희소 구멍·NTFS 압축 제외). crewdroid 의 슬림 클론과 견줄 수 있는 유일한 디스크 수치다. `google_apis` 수치는 파일 길이라 그 열은 부풀려져 있다. 디스크·RAM 은 두 기본 이미지보다 가볍지만 유휴 CPU 는 아니다. crewdroid 의 ~600 % 는 기본 `google_atd` AVD 3개(6회 측정 ~248-352 %, 60초 1회 표본은 흔들린다)보다 높다. `google_apis` 대비 CPU 차이는 이미지 때문이지 crewdroid 때문이 아니다. Windows 11 PC 1대(Ryzen 7 5700X, 64 GB, WHPX)에서 측정했고 원본은 [`docs/measurements/`](docs/measurements/) (`baseline.md`, `baseline-atd.md`).

"동시에 누르기" 배리어는 일부러 없다. 현장의 동시성 버그는 재시도·오프라인 큐·늦은 수정이 겹쳐서 나지, 같은 밀리초에 눌러서 나지 않는다 ([ADR 0002](docs/adr/0002-no-barrier.md)).

## 한계: 실제 폰이 필요할 때

crewdroid 는 구글의 `google_atd` 이미지를 쓴다 (가벼움 때문에 선택). 새로 띄운 기기에서 API 31·34·36 을 측정했다 ([`docs/measurements/atd-limits.md`](docs/measurements/atd-limits.md), 다시 확인: `node scripts/check-atd-limits.mjs`):

| 이미지에 없는 것 | 그래서 안 되는 것 | 대신 |
|---|---|---|
| Google 계정과 계정을 추가할 화면: 계정 0 개, `ADD_ACCOUNT_SETTINGS` 가 아무것에도 연결되지 않음. Play 서비스 자체는 있음 (내장 GmsCore 22.50·23.18·25.08) ([측정](docs/measurements/atd-limits.md)) | "Google 로그인" 과 로그인된 Google 계정이 필요한 모든 것. FCM 푸시는 여기서 시험하지 않음 | 실제 폰 |
| Play 스토어: `com.android.vending` 은 `/product/app/LicenseChecker` 1.8 뿐, `market://` 는 아무것에도 연결되지 않음 ([측정](docs/measurements/atd-limits.md)) | Play 결제, 인앱 업데이트, 스토어 링크, Play 에서 설치 | 실제 폰 |
| 크롬: `com.android.chrome` 없음. `VIEW https://` 는 가짜 브라우저(`fakesystemapp`), API 36 은 WebView 셸과 고르는 창 ([측정](docs/measurements/atd-limits.md)) | Custom Tabs·브라우저 링크, 브라우저로 갔다 앱으로 돌아오는 OAuth | 앱 자체 WebView: 시스템 WebView (91·113·133) 가 세 API 모두 로컬 페이지를 그렸다 ([측정](docs/measurements/atd-limits.md)). 아니면 실제 폰 |
| API 31·34 의 카메라 앱: `IMAGE_CAPTURE` 가 아무것에도 연결되지 않음 (API 36 은 `com.android.camera2` 있음) ([측정](docs/measurements/atd-limits.md)) | 카메라 인텐트로 사진을 받는 화면 ("사진 찍기" 버튼) | `adb push` 로 사진을 넣고 앱 자체 선택기로. 시스템 사진 선택기(`PICK_IMAGES`)는 API 34·36 에 있고 31 에는 없다 ([측정](docs/measurements/atd-limits.md)). 진짜 카메라는 실제 폰 |
| 런처: `MAIN/HOME` 이 세 API 모두 빈 껍데기(`fakesystemapp` `EmptyHomeActivity`) ([측정](docs/measurements/atd-limits.md)) | 홈 화면 위젯·바로가기·런처 배지 | 실제 폰 |

## 요구 사항

- Node >= 22, 안드로이드 SDK + 에뮬레이터 >= 36.4 (없으면 `npx crewdroid setup --yes`)
- npm 대신 git 으로 받았으면 `npm ci && npm run prepack` 을 한 번 실행한다. npm 패키지에는 이미 들어 있는 기기 상주 도우미 APK(JDK 17)를 빌드한다. 없으면 `screen`·`tap` 이 `uiautomator` 로 돌고 `type` 은 ASCII 만 된다
- Windows 10/11 x64, Apple Silicon macOS, Linux x64/arm64. 이미지는 호스트 CPU 에 맞춰 x86_64 또는 arm64-v8a
- 하드웨어 가속: WHPX(Windows), Hypervisor.framework(macOS), KVM(Linux, `/dev/kvm`)
- 이미지 제약(`google_atd`, 가벼움 때문에 선택): [한계](#한계-실제-폰이-필요할-때) 참고. 그 밖에 문자·전화 앱 없음(SMS·통화는 통신 상태만 바뀜). GPU 없음(프레임 수치는 실행끼리 비교용). 그래도 되는 것: 한글 등 모든 문자 입력(기기 상주 도우미), API 31 재실행 후 검은 화면은 감지해 자동 복구(`blackRelaunch`)
- macOS/Linux 의 `slim` 은 NTFS 희소·압축 단계를 건너뛰고, RAM 수치는 프로세스 RSS(공유 페이지 나누지 않음)

명령 표·진단·환경·앱 제어·프로필 추가·안전 규칙은 영문 [README.md](README.md) 에 있다. 측정 원본은 [`docs/measurements/`](docs/measurements/).
