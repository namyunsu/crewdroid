# T04 전후 비교: 기존 AVD 3대(T01) vs `crewdroid up` 3대

- 날짜: 2026-10-23 · 같은 PC(Ryzen 7 5700X 16스레드, 64 GB, Windows 11), 에뮬레이터 37.1.11.0
- 전(T01): `baseline.json` — old-avd-1..3 (android-33 google_apis), `-read-only` 콜드 부팅, 3초 간격
- 후(T04): `after.json` — `crewdroid measure --up 3`. 프로필 s22@API31, s24ultra@API34, s26ultra@API36 (google_atd 3종), `-read-only` + quickboot 스냅샷, `-cores 2 -memory 2048 -no-boot-anim`, 3초 간격, 부팅 뒤 `makeDistinct` + `wm size/density` 적용
- 참고(같은 이미지): `after-same-image.json` — `measure --up 3 --profiles s24ultra,a16,flip6-cover` (3대 모두 API 34 한 AVD의 클론)
- 측정 방법은 T01과 같다: 부팅 완료 뒤 60초 idle 동안 호스트 CPU(100 % = 코어 1개), 끝 시점 작업 집합 RAM, 디스크는 AVD 폴더 + 시스템 이미지(같은 폴더는 한 번만) 파일 크기 합.

## 합계 비교

| 항목 | 전 (T01) | 후 (T04, API 31/34/36 혼합) | 차이 | 참고: 후, API 34 하나 ×3 | 차이 |
|---|---|---|---|---|---|
| 디스크 합계 (파일 크기) | 24.73 GiB | 38.63 GiB | **+13.90 GiB (+56 %)** | 13.01 GiB | −11.72 GiB (−47 %) |
| 디스크 합계 (실제 할당, `du -sk`) | 24.56 GiB | 28.59 GiB | +4.03 GiB (+16 %) | 12.95 GiB | −11.61 GiB (−47 %) |
| 부팅 (평균, `sys.boot_completed`) | 27.4 s | 7.2 s | **−20.2 s (−74 %)** | 6.8 s | −20.6 s (−75 %) |
| 사용 준비까지 (부팅 + makeDistinct + wm) | — | 33.0 s | — | 32.9 s | — |
| 호스트 RAM 합계 | 8453 MB | 9596 MB | **+1143 MB (+14 %)** | 9781 MB | +1328 MB (+16 %) |
| 호스트 CPU 합계 (60 s idle 평균) | 999.5 % | 117.8 % | **−881.7 %p (−88 %)** | 75.9 % | −923.6 %p (−92 %) |

## 기기별

| 구분 | 기기 | 이미지 | 디스크 (파일 크기, 중복 제외) | 부팅 | 준비 | RAM | CPU |
|---|---|---|---|---|---|---|---|
| 전 | old-avd-1 | android-33 google_apis | 13.99 GiB (이미지 포함) | 31.6 s | — | 2843 MB | 347.1 % |
| 전 | old-avd-2 | 〃 | 5.50 GiB | 27.4 s | — | 2813 MB | 334.9 % |
| 전 | old-avd-3 | 〃 | 5.25 GiB | 23.3 s | — | 2797 MB | 317.5 % |
| 후 | emulator-5580 s22 | android-31 google_atd | 18.20 GiB (AVD 14.04 + 이미지 4.17) | 9.1 s | 33.8 s | 2946 MB | 21.8 % |
| 후 | emulator-5582 s24ultra | android-34 google_atd | 13.01 GiB (AVD 4.85 + 이미지 8.16) | 6.1 s | 31.9 s | 3295 MB | 21.6 % |
| 후 | emulator-5584 s26ultra | android-36 google_atd | 7.42 GiB (AVD 5.50 + 이미지 1.92) | 6.3 s | 33.3 s | 3355 MB | 74.4 % |

## 읽는 법

- **CPU와 부팅은 크게 줄었다.** 스냅샷에서 복원해 6~9초에 부팅되고, idle CPU는 3대 합계가 코어 약 10개 → 약 1.2개로 줄었다 [확인함 `after.json`, `baseline.json`]. 이유는 콜드 부팅 직후의 백그라운드 작업이 없고 ATD에 GMS가 없어서로 본다 [추론: 프로세스별로 나눠 재지는 않음].
- **디스크는 "이미지를 몇 종류 섞느냐"가 좌우한다.** 같은 이미지 클론 3대는 47 % 줄었지만, 안드로이드 버전 3종을 섞으면 시스템 이미지 3개와 기본 AVD 3개를 따로 들고 있어서 오히려 늘었다 [확인함 `after.json`, `after-same-image.json`]. 파일 크기 합(T01과 같은 방식)은 희소 파일인 `userdata-qemu.img`(API 31은 10 GiB로 잡힘)를 그대로 더해서 실제 할당량(`du -sk`, +16 %)보다 크게 나온다 [확인함 `du -sk ~/.android/avd/crew-*.avd`]. 실제 할당 수치의 "전" 값은 old-avd AVD를 오늘 `du -sk`로 다시 잰 값이다(T01 시점 값 아님).
- **ATD 이미지 크기는 버전마다 다르다.** 디스크 할당 기준 API 31 4.2 GB, API 34 8.2 GB(google_apis 33과 거의 같음), API 36 1.9 GB [확인함 `du -sk system-images/*/*`]. API 34 ATD는 디스크 면에서 이득이 없다.
- **RAM은 오히려 1대당 약 0.4 GB 늘었다.** `-memory 2048`은 게스트 RAM 상한이라 호스트 작업 집합을 줄이지 못했다. 스냅샷 복원 시 게스트 메모리 전체를 매핑하는 영향인지는 [모름: 따로 재지 않음].
- 클론마다 `makeDistinct`(앱별 ANDROID_ID 키 교체 + 프레임워크 재시작 + 앱 재설치)가 약 25초 걸려서, 쓸 수 있을 때까지는 약 33초다.
- 남은 `-read-only` 클론의 쓰기분(임시 파일)은 디스크 합계에 넣지 않았다 [추론: 에뮬레이터가 종료 때 지우므로 상시 점유가 아님, 위치·크기는 재지 않음].
