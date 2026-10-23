# 디스크 줄이기 (T15, FR-12)

- 날짜: 2026-10-24 · 같은 PC (Ryzen 7 5700X, Windows 11, NTFS), 에뮬레이터 37.1.11.0
- 잰 것: **실제 할당 크기** (`GetCompressedFileSizeW`, 희소 구멍·NTFS 압축 제외) — `src/slim.ts` `allocBytes()`. 파일 길이가 아니다.
- 범위: google_atd 이미지 3개 (API 31/34/36) + crew 기본 AVD 3개 + `%TEMP%\AndroidEmulator` (`-read-only` 클론의 임시 overlay).
- 원본: `slim.json` (T15 전 기준값 + 기본 AVD 3개를 다시 만든 `crewdroid slim --json`), `disk.json` (`check-disk.mjs`: 쉴 때 / 3대 실행 중).

## 결과

| | T15 전 | T15 후 (쉴 때) | T15 후 (3대 실행 중) |
|---|---|---|---|
| 이미지 3개 | 14.25 GiB | 2.90 GiB | 2.90 GiB |
| 기본 AVD 3개 | 14.34 GiB | 3.73 GiB | 3.73 GiB |
| 클론 임시 파일 | 0.11 GiB (지난 실행 찌꺼기) | 0 | 0.27 GiB |
| **합계** | **28.70 GiB** | **6.63 GiB (7.12 GB)** | **6.99 GiB (7.50 GB)** — 기준 8 GB 이하 |

[확인함 `slim.json`, `disk.json`, `.ai-log/evidence/T15-2.txt`]

부팅 (`sys.boot_completed`, 3대 혼합, 3초 간격): T04 평균 7.13 s → verify 실행 7.1 s, 따로 3회 6.70~6.80 s [확인함 `disk.json`, `check-disk.mjs` 3회]. 같은 verify 에서 `check-up`, `check-scenario` (BUGGY 3/3 잡음, 정상 3/3 통과), `mvp-private-app --runs 1` (private-app @techs 1/1) 모두 통과 [확인함 `T15-2.txt` 2·3라운드]. `slim` 이 기본 AVD 3개를 막 다시 만든 직후 첫 부팅은 8.6 s (API 31 12 s) 로 기준(+20 % = 8.56 s)을 0.04 s 넘었다 [확인함 `T15-1.txt` 1차 실행]. 다시 만들 일이 없는 `slim` (설정이 그대로면 아무것도 안 함) 뒤에는 해당 없다 [추론: 갓 쓴 압축 파일을 디스크에서 처음 읽는 비용으로 봄, 따로 재지 않음].

## 손잡이별 절약

| # | 손잡이 | 전 → 후 (실제 할당) | 절약 | 동작 |
|---|---|---|---|---|
| 1 | 시스템 이미지 `*.img` 를 NTFS 희소 파일로 다시 씀 (0인 64 KiB 단위는 구멍) | 이미지 3개 14.25 → 4.02 GiB (API 34 `system.img` 8.0 → 1.2 GiB) | **10.23 GiB** | 내용 동일: 복사본 sha256 = 원본 sha256 일 때만 교체, `<img>.sha256` 에 남김. API 34 `system.img` 8.6 GB 를 19 초에 처리 |
| 2 | 이미지에 NTFS 압축 (`compact /c`) 추가 | 4.02 → 2.90 GiB (31: 1.37→0.89, 34: 1.33→0.91, 36: 1.31→1.10) | 1.12 GiB | 압축 뒤 다시 해시해 같을 때만 완료 표시. 부팅 34: 6.7 s, 36: 6.7 s (그대로) |
| 3 | 파일 기반 게스트 RAM 끔 (`-feature -QuickbootFileBacked`, 기본·클론 모두) | AVD 마다 `snapshots/default_boot/ram.img` 2.5 GiB (API 34/36) 가 없어짐 | AVD 당 약 2.5 GiB | 이 파일은 지워도 클론이 부팅할 때마다 기본 AVD 폴더에 다시 만든다 (실제로 지운 뒤 클론 1대 → 2.5 GiB 재생성 확인). 끈 뒤 API 34 클론 부팅 8.6 → 6.6 s |
| 4 | 스냅샷 `ram.bin` 에 NTFS 압축 | API 34: 2.19 → 1.17 GiB | AVD 당 약 1 GiB | 부팅 6.5 s 그대로 (2회) |
| 5 | 스냅샷 저장 전 게스트 빈 RAM 을 0 으로 채움 (`drop_caches` 후 tmpfs 에 MemFree−512 MB 만큼 0 쓰고 삭제) | API 34 `ram.bin` 1.17 → 0.59 GiB (여유 256 MB 일 때), API 31 0.80 → 0.71 GiB (512 MB) | AVD 당 0.1~0.6 GiB | 커널이 해제할 때 0 으로 지우지 않아서 (`CONFIG_INIT_ON_FREE_DEFAULT_ON` 꺼짐) 페이지 캐시였던 페이지가 그대로 저장됐다. **여유 256 MB 로는 API 31 클론이 매번 `adb offline`** → 512 MB 로 정함 |
| 6 | 오래된 스냅샷·`ram.img` 삭제, `-wipe-data` 콜드 부팅으로 다시 만들기 | `userdata-qemu.img.qcow2` 31/34/36: 0.40/0.66/0.67 → 0.23/0.43/0.55 GiB (전 값은 `du -sh`) | 기본 AVD 3개 합 약 0.5 GiB | `prepare()` 가 `snapshots/` 를 통째로 지우고 시작 |
| 7 | 지난 실행이 남긴 클론 overlay (`%TEMP%\AndroidEmulator\TMP*`) 삭제 | 0.107 → 0 GiB | 0.11 GiB | 에뮬레이터가 하나도 안 돌 때만 |
| 8 | `hw.ramSize` 1536 | 효과 없음 | 0 | 에뮬레이터가 최소값으로 올린다: API 34/36 → 2560 MB (`Increasing RAM size to 2560MB`), API 31 → 2048 MB (스냅샷 `hardware.ini`) [확인함 로그·`hardware.ini`]. T16 이 다룬다 |
| 9 | `disk.dataPartition.size` 2G | 효과 없음 | 0 | 에뮬레이터가 부팅 때 `config.ini` 를 6442450944 (6G) 로 고쳐 쓴다 (3개 API 모두). qcow2 는 쓴 블록만 할당하므로 크기 상한이 할당량을 바꾸지도 않는다 [확인함 `config.ini`] |
| — | 에뮬레이터 자체 스냅샷 압축 (`ANDROID_SNAPSHOT_COMPRESS=1`) | `ram.bin` 2.35 → 1.25 GB (파일 길이) | 쓰지 않음 | 이 스냅샷으로 띄운 API 34 클론은 스냅샷 로드는 성공하지만 계속 `adb offline` (2회). 압축을 끄고 같은 절차로 다시 만들면 정상 → NTFS 압축 (#4) 으로 대체 |
| — | 이미지 간 같은 파일 하드링크 | 검토만 | — | 같은 파일은 `encryptionkey.img` (18 MB, 3개 동일 sha256) 정도인데 희소·압축 뒤 거의 0 이라 의미 없음 [확인함 sha256 일치, AVD 폴더 사본 할당 0.000 GiB] |

기본 AVD 하나의 남은 몫 (API 34, 쉴 때 1.26 GiB): `ram.bin` 약 0.7 GiB + `userdata-qemu.img.qcow2` 약 0.45 GiB + 나머지 [확인함 `allocBytes` 파일별, 1.26 은 `disk.json`].

## 동작

- `crewdroid slim [--json]`: 위 손잡이를 순서대로 적용하고 단계마다 합계를 낸다. 이미지는 `<img>.sha256` 가 있으면, 기본 AVD 는 `crewdroid-slim.json` 의 설정이 지금과 같으면 건너뛴다 (두 번째 실행은 수 초). 에뮬레이터가 하나라도 돌면 거부한다.
- `crewdroid prepare` (그리고 `up` 의 첫 사용): 이미지를 먼저 slim 하고, 기본 AVD 를 다시 만든 뒤 압축하고 표시 파일을 쓴다.
- 이미지 파일은 sdkmanager 가 다시 설치하면 원래 크기로 돌아온다. 그때는 `crewdroid slim` 을 다시 실행.
- 쓰는 쪽 영향: 클론은 기본 AVD 파일을 읽기만 하므로 압축 파일에 쓰는 일이 없다. 0 으로 채운 스냅샷이라 클론의 페이지 캐시가 비어서 시작한다 (첫 앱 실행 때 디스크 읽기가 늘 수 있다) [추론: 따로 재지 않음; 시나리오·private-app 통과 여부는 `T15-2.txt`].
