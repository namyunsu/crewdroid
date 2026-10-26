# crewdroid (한국어 요약)

**AI 에이전트가 쓰는 헤드리스 안드로이드 기기 시험실.** 명령 하나로 서로 다른 갤럭시 화면·안드로이드 버전을 섞은 에뮬레이터 N대를 띄우고, 기기마다 다른 타이밍으로 네트워크를 끊었다 붙이며 같은 흐름을 반복시킨 뒤, 서버 데이터로 동시성 버그(중복·누락·덮어쓰기)를 판정한다. 창도 클릭도 없다: 모든 단계가 `--json` 과 종료 코드를 가진 CLI 명령이고, 같은 명령이 MCP 도구와 에이전트 스킬로도 노출된다.

```bash
npx crewdroid up --count 3
npx crewdroid run scenarios/photo-upload.json --seed 1   # 버그가 있으면 exit 1
```

## 구글 에뮬레이터와 뭐가 다른가

| | Android Emulator / AVD Manager | crewdroid |
|---|---|---|
| 기기 | AVD 1개 = 창 1개, 디스크 이미지 각각 | 베이스 이미지 1개의 읽기 전용 클론 N대, 화면(S/Fold/Flip/임의 `WxH@dpi`)·API 혼합 |
| 조작 | 창에서 클릭, 스크린샷 보기 | 모든 명령 `--json` + 종료 코드, `screen` 은 픽셀 대신 접근성 트리 |
| 부팅(3대) | 31.6 s 콜드 | 6.7 s (슬림 스냅샷) |
| 디스크 / 호스트 RAM (3대) | 24.7 GiB / 8.45 GB | 6.99 GiB / 3.93 GB |
| 네트워크 | Extended Controls 토글 1개 | 기기별 `airplane`·`nodata`·`slow`·`flaky` 를 무작위 일정으로, 업로드 도중에도 |
| 다자 버그 | 기능 없음 | `run` 이 기기마다 다른 타이밍으로 흐름을 반복하고 `judge` 가 서버를 검사: `unique`·`count`·`noLostUpdate` |
| 기기 상태 | GUI 패널 | `env`(GPS·배터리·회전·다크·글자·로케일·GSM·SMS·통화), `app`(권한·딥링크·Doze·트림·저장공간) — 설정 후 되읽어 확인 |
| 폴드/플립 | 폴더블 AVD 필요 | 아무 클론에서 `fold`/`unfold`: 앱이 실제 configuration change 를 받음 |
| AI 에이전트 | 부를 게 없음 | MCP 서버, `AGENTS.md`, 증상으로 트리거되는 스킬 7개 |

"동시에 누르기" 배리어는 일부러 없다. 현장의 동시성 버그는 재시도·오프라인 큐·늦은 수정이 겹쳐서 나지, 같은 밀리초에 눌러서 나지 않는다 ([ADR 0002](docs/adr/0002-no-barrier.md)).

## 요구 사항

- Node >= 22, 안드로이드 SDK + 에뮬레이터 >= 36.4 (없으면 `npx crewdroid setup --yes`)
- Windows 10/11 x64, Apple Silicon macOS, Linux x64/arm64. 이미지는 호스트 CPU 에 맞춰 x86_64 또는 arm64-v8a
- 하드웨어 가속: WHPX(Windows), Hypervisor.framework(macOS), KVM(Linux, `/dev/kvm`)
- macOS/Linux 의 `slim` 은 NTFS 희소·압축 단계를 건너뛰고, RAM 수치는 프로세스 RSS(공유 페이지 나누지 않음)

명령 표·진단·환경·앱 제어·프로필 추가·안전 규칙은 영문 [README.md](README.md) 에 있다. 측정 원본은 [`docs/measurements/`](docs/measurements/), 요구사항은 [`docs/prd.md`](docs/prd.md).
