# 호스트 RAM 줄이기 (T16, FR-13)

- 날짜: 2026-10-24 · 같은 PC (Ryzen 7 5700X, 64 GB, Windows 11 10.0.26300, WHPX), 에뮬레이터 37.1.11.0
- 잰 것: `node scripts/check-ram.mjs` — `up --count 3` (s22@API31, s24ultra@API34, s26ultra@API36, 스냅샷 부팅 + makeDistinct + wm) → 60초 쉼 → 에뮬레이터 프로세스(`emulator`, `qemu-system-*`)마다 `src/measure.ts` `memStats()`.
- 원본: `ram.json` (채택값 verify 실행), `ram-sweep.json` (손잡이별 실행 전부 + 메모). 단위 MiB.

## 측정 보정

| 값 | 뜻 |
|---|---|
| private WS | 작업 집합 중 이 프로세스만 쓰는 페이지 (`QueryWorkingSet`, Shared 비트 0) |
| shared WS | 작업 집합 중 공유 가능한 페이지 (DLL, 파일 매핑) |
| shared PSS | 공유 페이지를 공유 프로세스 수로 나눈 몫. 3대 합에서 같은 페이지가 한 번만 세어진다 |
| **합계** | **Σ private WS + Σ shared PSS** — FR-13 판정값 |
| Private Bytes | 커밋된 전용 메모리 (`PrivateMemorySize64`). 페이지 파일 몫까지 포함해 작업 집합보다 크다 |
| old WS | T01 과 같은 `WorkingSet64` 합 (비교용) |

공유 페이지는 대당 약 64 MiB 뿐이고 그 몫(PSS)은 9~10 MiB 다. 버전이 다른 3대는 시스템 이미지·스냅샷이 서로 달라 공유할 게 없고, 에뮬레이터 메모리의 대부분(게스트 RAM 블록)은 전용 메모리다 [확인함 `ram.json` `sharedWsMB`, `VirtualQueryEx` 블록 분석: API 34, 1024 MB 에서 게스트 RAM 블록 1024 MB 중 948 MB 상주]. 그래서 보정 합계는 old WS 보다 약 160 MiB 작을 뿐이다.

## 결과

| | T01 (old-avd ×3) | T16 전 (T15 설정) | **T16 채택** |
|---|---|---|---|
| 합계 (private WS + shared PSS) | — | 8364 MiB | **3930 MiB (4.12 GB)** — 기준 4300 MiB (4.2 GiB) 이하 |
| old WS 합 | 8453 MB | 8538 MiB | 4093 MiB |
| Private Bytes 합 | — | 10971 MiB | 6180 MiB |

[확인함 `ram.json`, `ram-sweep.json` `k0-base`, `baseline.md`]

채택값 (`src/avd.ts` `KNOBS`): `-lowram`, 게스트 RAM 896 MB (API 31 만 768 MB), 호스트 Vulkan 끔 (`-feature -Vulkan`), 나머지는 그대로 (`-gpu host`, 파일 기반 RAM 끔, 스냅샷 부팅). 같은 verify 에서 `check-scenario` (BUGGY 3/3 잡음, 정상 3/3 통과) 통과 [확인함 `T16-1.txt`]. 추가로 `check-up`, `check-render` (3대 모두 그려짐), `check-disk` (5.92 GiB, 부팅 평균 6.37 s) 통과 [확인함 `T16-1.txt` 끝부분].

같은 896 MB 설정을 모든 API 에 쓴 두 번은 4283 / 4313 MiB 로 기준에 붙어 있었다 (실행마다 ±50~100 MiB 흔들림). API 31 은 통화 시험에 쓰지 않으므로 768 MB 로 내려 여유를 만들었다 [확인함 `ram-sweep.json` `k-896-novk`, `k-896-novk-2`].

## 손잡이별 (한 번에 하나, 3대 합계)

| # | 손잡이 | 합계 | 결과 |
|---|---|---|---|
| 0 | T15 설정: `hw.ramSize` 1536 (에뮬레이터가 2048/2560 으로 올림) | 8364 | 기준 |
| 1 | `-lowram` + 1024 MB | 5072 | **−3292**. `-lowram` 이 RAM 하한을 없앤다 (`Removing any lower bound of RAM size`, 로그에 `Increasing RAM size` 없음). 통화 통과 |
| 2 | `hw.ramSize` 768 (+lowram) | 4340 | 통화 **실패** (T1 90초 안에 연결 안 됨, 에뮬 CPU 681 %). API 36 은 prepare 중 `settings_ssaid.xml` 이 안 생겨 makeDistinct 가 깨졌다 → prepare 가 프로브 앱으로 ANDROID_ID 를 한 번 읽게 고쳐 해결 |
| 3 | `hw.ramSize` 832 (+lowram, Vulkan 끔) | — | `up` **실패**: API 36 makeDistinct 의 프레임워크 재시작이 30초 안에 안 끝남 |
| 4 | `hw.ramSize` 896 (+lowram, Vulkan 끔) | 4283 / 4313 | 통화 통과. 기준선 근처 |
| 5 | 호스트 Vulkan 끔 (`-feature -Vulkan`), 1024 | 4740 (1번 대비 −332) | **채택**. 렌더·통화 통과. 콜드 부팅 맨 클론 비교에서도 4661 → 4159 |
| 6 | 게스트 low-RAM 속성 (`ro.config.low_ram=true`) | — | **설정 불가**: `-lowram` 도 `-prop ro.config.low_ram=true` 도 게스트 속성을 바꾸지 못했다 (`getprop` 빈 값, 부팅 속성 목록에 없음). ATD 는 시스템 파티션이 읽기 전용 |
| 7 | `vm.heapSize` 192M (`dalvik.vm.heapsize`) | 5166 | 효과 없음 (흔들림 범위) |
| 8 | 오디오 끔 (`hw.audioInput/Output=no`) | 5175 | 효과 없음. `-no-audio` 는 이미 켜져 있었다 |
| 9 | 안 쓰는 센서 끔 (자이로·자기·기압·근접·조도 등 12개) | 5173 | 효과 없음. 전면 카메라는 이미 `none` |
| 10 | `-gpu swiftshader_indirect` (1024) | 5418 | 더 큼 (+346) |
| 11 | `-gpu guest` (768) | 4305 (2번 대비 −35) | 흔들림 범위. T14 렌더 확인을 다시 해야 해서 안 씀 |
| 12 | 파일 기반 quickboot RAM 켬 (`-feature QuickbootFileBacked`) | 5379 | 더 큼, API 36 부팅 11.5 s. 끈 채로 둠 (T15 디스크 이유도 있음) |
| 13 | 콜드 부팅 (스냅샷 안 씀, 1024) | 5032 | 1번과 같은 수준, 부팅 21~28 s. 스냅샷 유지 |
| — | `-feature -HardwareDecoder,-VirtualScene,-AndroidVirtualizationFramework,-VirtioGpuNext`, `-GLDMA,-GLDMA2,-HasSharedSlotsHostMemoryAllocator`, `-cores 1` | 맨 클론 콜드 비교 | 효과 없음 (흔들림 범위) |

## 읽는 법

- 대당 호스트 RAM ≈ 게스트 RAM 거의 전부 + 약 450~600 MiB (프로세스 힙 ~180 MiB, 128 MiB 블록 1개, 작은 할당 수백 개) [확인함 `VirtualQueryEx` 블록 분석]. 게스트가 한 번 건드린 페이지는 게스트가 해제해도 호스트에서 내려가지 않는다 (풍선·free page reporting 없음) [추론: makeDistinct 의 프레임워크 재시작이 맨 클론 대비 대당 약 120 MiB 를 더한 것으로 봄].
- 그래서 남은 큰 손잡이는 게스트 RAM 크기뿐이고, 896 MB 아래로는 API 36 의 makeDistinct·통화가 깨진다.
- prepare 를 여러 번 하는 동안 저장된 스냅샷 몇 개 (약 12번 중 3번, API 34·36) 가 모든 클론에서 `adb offline` 으로 남았다. `adb reconnect` 로도 안 풀렸고 다시 prepare 하면 정상이었다 [확인함]. 원인 [모름]. `prepare()` 가 이제 클론 하나를 띄워 확인하고 안 되면 다시 만든다 (최대 3번).
- 설정을 바꾸면 (`KNOBS`, 또는 스윕용 환경변수 `CREWDROID_KNOBS`) 표시 파일 `crewdroid-slim.json` 이 달라져 다음 `up` 이 기본 AVD 3개를 다시 prepare 한다 (3대 약 6분) [추론: 이번 실행들의 prepare 로그 시간으로 어림].
