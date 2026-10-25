# 0005 API 31 ATD 검은 화면 — SurfaceView 가 아니라 "강제 종료 직후 재실행"

- 날짜: 2026-10-26 · 상태: 실측 근거 있음 (T28), 원인의 안쪽(AOSP 12 코드 어디인지)은 [모름]
- 결정: 고치는 실행 옵션·속성은 없다. API 31 은 `profiles/galaxy.json` `relaunchBlackApis: [31]` 로 표시하고, `up`(그래서 `run` 도)이 그 API 에 배정된 기기마다 경고를 찍는다:
  `WARN emulator-<port> API 31: screen can stay black after am start -S / force-stop + immediate start; wait 2 s between stop and start (ADR 0005)`.
  `UpDevice.relaunchBlack` 이 같은 값을 `--json` 으로 준다. 테스트 쪽 해결: `am start -S` 대신 `am force-stop` → 2 초 쉼 → `am start`.
- 확인: `node scripts/check-surface.mjs` (s22@API31 + s24ultra@API34) [확인함 `.ai-log/evidence/T28-1.txt`]

## 무엇이 보였나
private-app 통화 화면(SurfaceView 2개)이 API 31 에서만 검었다 (T13-3: GPU 모드 5가지·콜드 부팅·카메라 끔 모두 검정). 그래서 "API 31 은 SurfaceView 를 못 그린다"로 적어 두었다 (`src/integrations/private-app.ts`).

## 재현 (private-app 없이)
프로브 앱 `check=surface`: 화면 가득 SurfaceView, 초록 바탕 + 움직이는 흰 네모. `--es mode gl` 은 GLSurfaceView(GLES2), `--ez pip true` 는 `setZOrderMediaOverlay` 작은 SurfaceView 를 하나 더 얹는다(통화 화면 배치). 앱이 `CrewProbe SURFACE l,t,r,b` 로 영역을 찍고, 스크립트가 screencap 을 그 영역으로 잘라 색 분포를 본다.

| 경우 | API 31 | API 34 |
|---|---|---|
| 처음 실행 / `force-stop` 후 2 초 쉬고 실행, canvas | 초록 96.2 % + 흰색 3.1 %, 22색 — 그려짐 | 96.1 % + 3.1 % — 그려짐 |
| 같은 방식, GL | 96.2 % + 3.1 % — 그려짐 | 그려짐 |
| 같은 방식, GL + pip | 그려짐 (4/4) | 그려짐 (초록 91.2 %, 파랑 4.6 %, 흰색 3.3 %) |
| 앱이 떠 있는 채로 `am start -S` (GL) | **검정 1색 100 %**, 6번 중 5~6번 | 6/6 그려짐 |
| `am force-stop` 직후 바로 `am start` | 검정 4/5 | — |
| SurfaceView 없는 샘플 화면(TextView)을 `-S` 로 | **검정 6/6** | 4/4 그려짐 |

[확인함 `T28-1.txt` 행렬, `check-surface.mjs` 출력]. SurfaceView 는 API 31 에서도 그려진다. 검어지는 조건은 "보이던 앱 프로세스를 죽이고 곧바로 다시 띄우기"이고, SurfaceView 가 없는 화면도 똑같이 검어진다. 검을 때는 SurfaceView 영역만이 아니라 화면 전체(상단 바 영역 포함)가 검다.

## 검을 때의 상태
- WindowManager: 새 Task `visible=true`, 창 `mDrawState=HAS_DRAWN`, `Surface: shown=true`, 포커스도 그 창 [확인함 `dumpsys window`, `dumpsys activity activities`].
- SurfaceFlinger: 같은 Task 의 레이어 `EffectLayer (Task=12)` 가 `flags=0x00000001`(숨김), 모든 레이어 `VisibleRegion count=0`, `Composition ... 0 Layers`; 앱 레이어에는 버퍼가 있다(`activeBuffer=[1080x2172 RGB_565]`). HWC 로그는 `RanchuHwc: presentDisplay display has no layers to compose` 반복 [확인함 `dumpsys SurfaceFlinger`, logcat].
- 즉 WM 은 Task 를 보이게 했다고 알고 있는데, 그 "보이기"가 SurfaceFlinger 에 반영되지 않았다. 앱은 계속 그리고 있다.
- 홈 키 → 같은 앱 `am start`(-S 없이) 를 하면 Task 레이어 숨김이 풀리고 다시 그려진다(198색) [확인함].
- 죽은 앱 쪽 로그: `ClientCache: failed to get buffer, invalid process token`, `BpTransactionCompletedListener: Failed to transact (-32)`. 이 줄은 정상으로 그려진 경우에도 나와서 원인 표지로 쓸 수 없다 [확인함]. Android 12 의 WM↔SF 트랜잭션 경합(죽은 프로세스의 버퍼/콜백이 엮인 트랜잭션과 새 Task 보이기)으로 보지만 코드로 확인하지 않았다 [추론: 13(API 34)에서 같은 절차가 늘 정상, 증상이 WM/SF 불일치].

## 후보별 결과 (API 31 새 클론마다, GL `-S` 6회 / stop+2초 6회)
| 후보 | `-S` 6회 | stop+2초 6회 |
|---|---|---|
| 기준 (`-gpu host`, `-feature -Vulkan`, 창 없음, 스냅샷 부팅, makeDistinct 안 함 — 아래 줄도 모두) | 검정 5 | 정상 6 |
| `-gpu swiftshader_indirect` (소프트웨어 GPU, `CREWDROID_KNOBS`) | 검정 6 | 정상 6 |
| 호스트 Vulkan 켬 (`-feature Vulkan`, T16 이전 값) | 검정 6 | 정상 6 |
| 창 모드 (`--window` 와 같은 실행) | 검정 6 | 정상 6 |
| 콜드 부팅 (`-no-snapshot-load`) | 검정 6 | 정상 6 |
| `wm size/density` 덮어쓰기 안 함 | 검정 6 | 정상 6 |
| 프레임워크 재시작만 (`stop; start`, makeDistinct 와 같음) | 검정 5 | 정상 6 |
| `debug.sf.latch_unsignaled=1` + SF 재시작 | 검정 6 | 정상 6 |
| `service.sf.present_timestamp=0` (API 34 값) + SF 재시작 | 검정 5 | 정상 6 |
| `debug.sf.disable_backpressure=1` + SF 재시작 | 검정 6 | 정상 6 |
| `debug.hwui.drawing_enabled` 그대로 0 (T14 설정 안 함) | 검정 5 (GL 은 HWUI 를 안 거침) | — ; canvas SurfaceView 는 그려짐 (초록 96.9 %), 창 장식만 검정 |
| `up` 그대로 (makeDistinct 포함, `check-surface.mjs`) | 검정 1/1 | 정상 2/2 (canvas, gl) |

[확인함 `T28-1.txt`]. 어떤 GPU 모드·창·부팅 방식·SF 속성도 바꾸지 못했다. API 31 과 34 의 그래픽 속성 차이는 HWC 버전(`hwcomposer-2-3` vs `hwcomposer-3`), `service.sf.present_timestamp` (1 vs 0) 정도이고, 앞의 것은 이미지에 박혀 있어 바꿀 수 없다 [확인함 `getprop`].

## 왜 실행 옵션으로 고치지 않나
- 위 후보 모두 효과가 없었다. 원인이 이미지(Android 12 system_server/SurfaceFlinger) 안이라 `up` 의 옵션·속성으로 닿지 않는다 [추론: 위 표].
- 남은 길: API 31 을 아예 빼기(혼합 버전 요구 FR 와 충돌), 또는 테스트가 `-S` 대신 stop → 2 초 → start 를 쓰기. 후자를 경고 문구로 알린다. stop 후 2 초도 이번에 잰 약 70 회 중 1 회(drawing_enabled=0 클론, canvas 다음 첫 회) 검었으므로 "보장"이 아니라 "크게 줄임"이다 [확인함 `T28-1.txt`].

## private-app 와의 관계
private-app 의 다중 시험은 앱을 `am start -S -n ...LoginActivity` 로 띄운다 (`private-app-server/tests/e2e/multi/harness.ts`) [확인함 읽기만]. 그래서 T13-3 의 검은 통화 화면도 이 경합일 가능성이 크다 [추론]. T13-3 기록의 "로그인/방 목록은 그려지고 통화 화면만 검다"는 이 설명과 딱 맞지 않아, private-app 앱 자체로는 다시 재지 않았다 [모름]. `PRIVATE_APP_PROFILES` 에서 s22(API 31) 를 뺀 결정은 그대로 둔다.
