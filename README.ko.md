# crewdroid (한국어 요약)

**Maestro 와 mobile-mcp 가 안드로이드 앱을 조작하면, crewdroid 는 조건을 만들고 결과를 판정한다.**

[![15초 소개: S24·폴드5·플립7 에뮬레이터를 안드로이드 14·16 으로 띄우고, 한 폰만 네트워크를 끊어 메모가 오프라인으로 기다렸다 동기화되는 장면, 서버 데이터 판정(FAIL: 7 violations), 폴드 접기와 다크 모드](docs/demo/hero.gif)](docs/demo/hero.mp4)

AI 에이전트는 이미 앱을 눌러 볼 수 있다. 하지만 화면 너머에서 일어난 일은 보지 못한다: 네트워크가 끊긴 사이 두 번 올라간 업로드, 비행기 모드에서 사라진 기록, 다른 사용자가 몰래 덮어쓴 수정. crewdroid 는 그런 버그가 나는 기기와 조건을 만들어 주고, 에이전트가 바로 쓸 수 있는 판정을 돌려준다.

## crewdroid 만 하는 것

1. **화면이 아니라 서버를 판정한다.** 실행이 끝나면 `crewdroid judge` 가 내 API 의 데이터를 읽어 규칙을 검사한다: `unique`(중복 없음), `count`(누락 없음), `noLostUpdate`(몰래 덮어쓰기 없음). 버그는 스크린샷이 아니라 `VIOLATION` 줄과 종료 코드 1 로 돌아온다.
2. **흐름 도중에 기기 하나씩 망가뜨린다.** 기기마다 자기 일정으로 `airplane`·`nodata`·`slow`·`flaky`, 업로드 중 접기·펴기, Doze, 메모리 트림, 저장공간 가득, 저사양 CPU·RAM. 설정한 상태는 매번 되읽어 확인한다.
3. **명령 하나로 섞인 기기 묶음을 띄운다.** 안드로이드 12·14·16 과 S24·폴드·플립·임의 `WxH@dpi` 를 창 없이, 베이스 이미지 하나의 클론으로: 3대가 호스트 RAM 3.93 GB, 디스크 6.99 GiB.

그 밖에: 크래시·ANR 분석, 콜드 스타트·버벅임 측정, APK 검사. 모든 명령이 `--json` 과 종료 코드를 갖고, 모두 MCP 도구다.

```bash
npx crewdroid setup --yes        # 안드로이드 SDK·이미지가 없으면 설치
npx crewdroid up --count 3       # S24 Ultra / API 34, Fold5 / API 34, Flip7 / API 36
npx crewdroid run scenarios/photo-upload.json --seed 1   # 다자 흐름 + 네트워크 장애 + 판정, 버그가 있으면 exit 1
```

## 구글 에뮬레이터와 뭐가 다른가

| | Android Emulator / AVD Manager | crewdroid |
|---|---|---|
| 다자 버그 | 기능 없음 | `run` 이 기기마다 다른 타이밍으로 흐름을 반복하고 `judge` 가 서버를 검사: `unique`·`count`·`noLostUpdate` |
| 네트워크 | Extended Controls 토글 1개 | 기기별 `airplane`·`nodata`·`slow`·`flaky` 를 무작위 일정으로, 업로드 도중에도 |
| 기기 | AVD 1개 = 창 1개, 디스크 이미지 각각 | 베이스 이미지 1개의 읽기 전용 클론 N대, 화면(S/Fold/Flip/임의 `WxH@dpi`)·API 혼합 |
| 디스크 / 호스트 RAM (3대) | 24.7 GiB / 8.45 GB | 6.99 GiB / 3.93 GB |
| 조작 | 창에서 클릭 | 모든 명령 `--json` + 종료 코드 |
| 기기 상태 | GUI 패널 | `env`(GPS·배터리·회전·다크·글자·로케일·GSM·SMS·통화), `app`(권한·딥링크·Doze·트림·저장공간) — 설정 후 되읽어 확인 |
| 폴드/플립 | 폴더블 AVD 필요 | 아무 클론에서 `fold`/`unfold`: 앱이 실제 configuration change 를 받음 |
| AI 에이전트 | 부를 게 없음 | MCP 서버, `AGENTS.md`, 증상으로 트리거되는 스킬 7개 |

수치는 Windows 11 PC 1대(Ryzen 7 5700X, 64 GB, WHPX)에서 3대 기준, 기본 `google_apis` AVD 3개와 비교해 측정했다.

"동시에 누르기" 배리어는 일부러 없다. 현장의 동시성 버그는 재시도·오프라인 큐·늦은 수정이 겹쳐서 나지, 같은 밀리초에 눌러서 나지 않는다 ([ADR 0002](docs/adr/0002-no-barrier.md)).

## 요구 사항

- Node >= 22, 안드로이드 SDK + 에뮬레이터 >= 36.4 (없으면 `npx crewdroid setup --yes`)
- Windows 10/11 x64, Apple Silicon macOS, Linux x64/arm64. 이미지는 호스트 CPU 에 맞춰 x86_64 또는 arm64-v8a
- 하드웨어 가속: WHPX(Windows), Hypervisor.framework(macOS), KVM(Linux, `/dev/kvm`)
- 이미지 제약(`google_atd`, 가벼움 때문에 선택): Play 스토어·Google Play 서비스가 없어 FCM 푸시·지도·Play 기반 로그인은 검증할 수 없다. 크롬·카메라 앱·갤러리·런처·문자·전화 앱 없음(SMS·통화는 통신 상태만 바뀜). GPU 없음(프레임 수치는 실행끼리 비교용). 그래도 되는 것: 한글 등 모든 문자 입력(기기 상주 도우미), API 31 재실행 후 검은 화면은 감지해 자동 복구(`blackRelaunch`)
- macOS/Linux 의 `slim` 은 NTFS 희소·압축 단계를 건너뛰고, RAM 수치는 프로세스 RSS(공유 페이지 나누지 않음)

명령 표·진단·환경·앱 제어·프로필 추가·안전 규칙은 영문 [README.md](README.md) 에 있다. 측정 원본은 [`docs/measurements/`](docs/measurements/), 요구사항은 [`docs/prd.md`](docs/prd.md).
