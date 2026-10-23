## 삼성 갤럭시 화면 사양 (2026-10 기준)

**한 줄 요약:** 화면 크기·해상도·ppi·출시 OS는 공식 출처로 모두 확인했습니다. 다만 **dp 폭의 근거인 "삼성 기본 dpi"를 공식 문서로 확인한 모델은 하나도 없습니다.** 표의 dp 값은 제3자 뷰포트 DB에서 가져왔고, 출처끼리 서로 다른 값이 여럿 있습니다. 표는 실기기 `adb shell wm size` / `wm density`로 확인하기 전까지 임시 값으로 쓰세요.

**출처 약어**
- **[G]** GSMArena 모델별 스펙 페이지. 행마다 링크를 붙였습니다.
- **[SD]** 삼성 개발자 에뮬레이터 스킨 페이지(공식): [S](https://developer.samsung.com/galaxy-emulator-skin/galaxy-s.html) · [Z](https://developer.samsung.com/galaxy-emulator-skin/galaxy-z.html) · [A](https://developer.samsung.com/galaxy-emulator-skin/galaxy-a.html)
- **[B]** [Blisk 기기 목록](https://blisk.io/devices). 뷰포트·DPR을 실었습니다.
- **[Y]** [yesviz](https://yesviz.com/viewport.php). 계산값으로 보입니다. 다른 표에서 A36 해상도를 2408로 잘못 적은 사례가 있어 신뢰도가 낮습니다.
- **[C]** [Chrome DevTools 기기 목록](https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/emulation/EmulatedDevices.ts)
- **[T]** [Tom's Guide](https://tomsguide.com/phones/samsung-phones/how-to-change-screen-resolution-on-samsung-galaxy-s24): S24+·S24 Ultra가 FHD+로 출고된다는 근거

**기본 표시 해상도:** QHD+ 패널 모델은 FHD+(1080×2340)로 출고됩니다. 이 근거([T])는 S24+·Ultra 세대뿐이고, S22U·S23U·S25+ 이후는 같은 관행으로 **추정**했습니다.

**dp는 해상도를 바꿔도 거의 그대로입니다.** 삼성은 해상도를 바꾸면 density도 함께 조정합니다. 예를 들어 S22 Ultra는 Blisk 기준 QHD에서 DPR 3.75로 384dp이고, FHD에서는 450dpi(2.8125)로 계산해도 같은 384dp입니다. 단, "화면 크게/작게(Screen zoom)" 설정을 바꾸면 dp 폭도 달라집니다.

### 1. 바형 (S 시리즈 · A 시리즈)

| 모델 | 출시 | 인치 | 해상도 | 기본 표시 | ppi | dp 폭 (기본 dpi) | 출시 OS | 최신 OS | 비율 | 출처 |
|---|---|---|---|---|---|---|---|---|---|---|
| S22 | 2022-02 | 6.1 | 1080×2340 | 네이티브 | 425 | **360** (480, DPR 3) [B] | Android 12 | Android 16 / One UI 8 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s22_5g-11253.php) [SD] |
| S22+ | 2022-02 | 6.6 | 1080×2340 | 네이티브 | 393 | **384** (450, DPR 2.8125) [B] | Android 12 | Android 16 (업데이트 4회 정책으로 추정, GSMArena 표기 미갱신) | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s22+_5g-11252.php) |
| S22 Ultra | 2022-02 | 6.8 | 1440×3088 | FHD+ (추정) | 500 | **384** [B] | Android 12 | Android 16 / One UI 8 | 19.3:9 | [G](https://www.gsmarena.com/samsung_galaxy_s22_ultra_5g-11251.php) |
| S23 | 2023-02 | 6.1 | 1080×2340 | 네이티브 | 425 | **360** (480) [B] | Android 13 | One UI 8.5 표기 (Android 17 대상) | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s23-12082.php) |
| S23+ | 2023-02 | 6.6 | 1080×2340 | 네이티브 | 393 | **384** (450) [B] | Android 13 | Android 17 / One UI 9 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s23+-12083.php) |
| S23 Ultra | 2023-02 | 6.8 | 1440×3088 | FHD+ (추정) | 500 | **384** [B] | Android 13 | Android 17 / One UI 9 | 19.3:9 | [G](https://www.gsmarena.com/samsung_galaxy_s23_ultra-12024.php) |
| S24 | 2024-01 | 6.2 (삼성 6.1) | 1080×2340 | 네이티브 | 416 (삼성 422) | **360** (480) [B] | Android 14 | Android 17 / One UI 9 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s24-12773.php) [SD] |
| S24+ | 2024-01 | 6.7 | 1440×3120 | FHD+ [T] | 513 | **384** [B] | Android 14 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s24+-12772.php) |
| S24 Ultra | 2024-01 | 6.8 | 1440×3120 | FHD+ [T] | 505 | **384** [B] | Android 14 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s24_ultra-12771.php) |
| S25 | 2025-01 | 6.2 | 1080×2340 | 네이티브 | 416 | 360 (DPR 3) [Y] | Android 15 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s25-13610.php) |
| S25+ | 2025-01 | 6.7 | 1440×3120 | FHD+ (추정) | 513 | 412 [Y] ⚠ | Android 15 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s25+-13609.php) |
| S25 Ultra | 2025-01 | 6.9 | 1440×3120 | FHD+ (추정) | 498 | 412 [Y] ⚠ | Android 15 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s25_ultra-13322.php) |
| S25 Edge | 2025-05 | 6.7 | 1440×3120 | FHD+ (추정) | 513 | 412 [Y] ⚠ | Android 15 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s25_edge-13506.php) |
| S26 | 2026-02 | 6.3 | 1080×2340 | 네이티브 | 411 | 360 [Y] | Android 16 | Android 17 / One UI 9 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s26_5g-14456.php) |
| S26+ | 2026-02 | 6.7 | 1440×3120 | FHD+ (추정) | 516 | 412 [Y] ⚠ | Android 16 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s26+_5g-14457.php) |
| S26 Ultra | 2026-02 | 6.9 | 1440×3120 | FHD+ (추정) | 500 | 412 [Y] ⚠ | Android 16 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_s26_ultra_5g-14320.php) |
| A15 5G | 2023-12 | 6.5 | 1080×2340 | 네이티브 | 396 | 미확인 | Android 14 | Android 16 / One UI 8.5 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a15_5g-12638.php) [SD] |
| A16 5G | 2024-10 | 6.7 | 1080×2340 | 네이티브 | 385 | 미확인 | Android 14 | One UI 8.5 (Android 16) | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a16_5g-13346.php) |
| A17 5G | 2025-08 | 6.7 | 1080×2340 | 네이티브 | 385 | 미확인 | Android 15 | One UI 8.5 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a17_5g-14041.php) |
| A25 | 2023-12 | 6.5 | 1080×2340 | 네이티브 | 396 | 미확인 | Android 14 | One UI 8.5 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a25-12555.php) |
| A26 | 2025-03 | 6.7 | 1080×2340 | 네이티브 | 385 | 미확인 | Android 15 | One UI 8.5 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a26-13679.php) |
| A27 | 2026-06 | 6.7 | 1080×2340 | 네이티브 | 385 | 미확인 | Android 16 | Android 17 / One UI 9 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a27_5g-14606.php) |
| A35 | 2024-03 | 6.6 | 1080×2340 | 네이티브 | 390 | 412 [Y] (DPR 2.625) | Android 14 | 미확인 (페이지는 One UI 7 표기) | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a35-12705.php) |
| A36 | 2025-03 | 6.7 | 1080×2340 | 네이티브 | 385 | 미확인 ([Y] 값은 해상도 오기) | Android 15 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a36-13497.php) |
| A37 | 2026-03 | 6.7 | 1080×2340 | 네이티브 | 385 | 미확인 | Android 16 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a37_5g-14378.php) |
| A55 | 2024-03 | 6.6 | 1080×2340 | 네이티브 | 390 | ⚠ 충돌: 412 [Y] / 360 [C] | Android 14 | One UI 8.5 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a55-12824.php) |
| A56 | 2025-03 | 6.7 | 1080×2340 | 네이티브 | 385 | 미확인 | Android 15 | Android 17 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a56-13603.php) |
| A57 | 2026-03 | 6.7 | 1080×2340 | 네이티브 | 385 | 미확인 | Android 16 / One UI 8.5 | 미확인 | 19.5:9 | [G](https://www.gsmarena.com/samsung_galaxy_a57_5g-14379.php) |

⚠ 표시 항목 설명:
- **S25+ 이후 412dp는 yesviz 값뿐**이고 근거가 약합니다. S24 세대까지는 384dp였고, 412dp가 맞다면 FHD 기준 420dpi라는 뜻이 됩니다. 실기기로 확인해야 합니다.
- **A55**는 Chrome DevTools의 "360×800 DSF 2.25" 값이 실제 해상도(1080×2340)와 곱이 맞지 않습니다.
- **A 시리즈 dp**는 기본 dpi가 420이면 411~412dp, 480이면 360dp입니다. 아직 확정하지 못했습니다.

**비고:** 펀치홀 위치와 노치 모양(예: A15·A25 물방울 노치)은 GSMArena·삼성 스펙 페이지에 나와 있지 않아 **미확인**입니다. 일반적으로는 중앙 펀치홀로 알려져 있지만 출처로 확인하지는 않았습니다.

### 2. 폴더블 (커버·메인 화면을 각각 한 행으로)

| 모델 / 화면 | 출시 | 인치 | 해상도 | ppi | dp 폭 | 출시 OS | 최신 OS | 비율 | 비고 · 출처 |
|---|---|---|---|---|---|---|---|---|---|
| Flip4 커버 | 2022-08 | 1.9 | 260×512 | 약 302 (계산) | 미확인 | Android 12 | Android 16 / One UI 8 | 약 1:2 | 작은 직사각형 · [G](https://www.gsmarena.com/samsung_galaxy_z_flip4-11538.php) |
| Flip4 메인 | | 6.7 | 1080×2640 | 426 | 미확인 (480dpi면 360) | | | 22:9 (계산) | [SD] |
| Flip5 커버 | 2023-08 | 3.4 | 720×748 | 306 | 미확인 | Android 13 | Android 17 / One UI 9 | 약 1:1.04 | 아래쪽 카메라 컷아웃 있는 폴더 모양([삼성 비교 페이지](https://www.samsung.com/us/smartphones/galaxy-z-flip7-fe/compare/)) · [G](https://www.gsmarena.com/samsung_galaxy_z_flip5-12252.php) |
| Flip5 메인 | | 6.7 | 1080×2640 | 425 | 미확인 | | | 22:9 | |
| Flip6 커버 / 메인 | 2024-07 | 3.4 / 6.7 | 720×748 / 1080×2640 | 306 / 426 | 미확인 | Android 14 | Android 17 | 1:1.04 / 22:9 | [G](https://www.gsmarena.com/samsung_galaxy_z_flip6-13192.php) |
| Flip7 커버 | 2025-07 | 4.1 | 948×1048 | 약 345 (계산) | 미확인 | Android 16 | Android 17 / One UI 9 | 약 1:1.1 | [G](https://www.gsmarena.com/samsung_galaxy_z_flip7-13712.php) |
| Flip7 메인 | | 6.9 | 1080×2520 | 397 | **360** (DPR 3) [Y] | | | 21:9 | |
| Flip7 FE 커버 / 메인 | 2025-07 | 3.4 / 6.7 | 720×748 / 1080×2640 | 306 / 426 | 미확인 | Android 16 / One UI 8 | 미확인 | 1:1.04 / 22:9 | [G](https://www.gsmarena.com/samsung_galaxy_z_flip7_fe_5g-13844.php) |
| Flip8 커버 / 메인 | 2026-07 | 4.1 / 6.9 | 948×1048 / 1080×2520 | 342 / 400 | 미확인 (메인은 Flip7과 같은 해상도) | Android 17 / One UI 9 | 같음 | 1:1.1 / 21:9 | 커버 해상도는 출처마다 다름(1048×984 표기도 있음) · [G](https://www.gsmarena.com/samsung_galaxy_z_flip8_5g-14803.php) |
| Fold4 커버 | 2022-08 | 6.2 | 904×2316 | 약 401 (계산) | 미확인 (Fold5와 같은 해상도) | Android 12L | Android 16 (업데이트 4회 정책으로 추정) | 23.1:9 | [G](https://www.gsmarena.com/samsung_galaxy_z_fold4-11737.php) |
| Fold4 메인 | | 7.6 | 1812×2176 | 373 | 미확인 | | | 약 1:1.2 | [SD] |
| Fold5 커버 | 2023-08 | 6.2 | 904×2316 | 미기재 | **344** (420dpi, DSF 2.625) [C] | Android 13 | Android 17 / One UI 9 | 23.1:9 | [G](https://www.gsmarena.com/samsung_galaxy_z_fold5-12418.php) |
| Fold5 메인 | | 7.6 | 1812×2176 | 373 | **690** [C] | | | 약 1:1.2 | |
| Fold6 커버 / 메인 | 2024-07 | 6.3 / 7.6 | 968×2376 / 1856×2160 | 410 / 374 | 미확인 ([C] 값 412·744는 해상도와 곱이 맞지 않음) | Android 14 | Android 17 | 약 22:9 / 1:1.16 | [G](https://www.gsmarena.com/samsung_galaxy_z_fold6-13147.php) |
| Fold7 커버 | 2025-07 | 6.5 | 1080×2520 | 422 | 미확인 | Android 16 | Android 17 | 21:9 | [G](https://www.gsmarena.com/samsung_galaxy_z_fold7-13826.php) |
| Fold7 메인 | | 8.0 | 1968×2184 | 368 | 984 (DPR 2) [Y] ⚠ | | | 약 1:1.11 | 커뮤니티 글에는 "안쪽 기본 최소 폭 437"이라는 상충 주장이 있음 |
| Fold8 커버 | 2026-07 | 5.5 | 1248×1972 | 428 | 미확인 | Android 17 / One UI 9 | 같음 | 약 10:16 | 넓은 커버 · [G](https://www.gsmarena.com/samsung_galaxy_z_fold_wide_5g-14673.php) |
| Fold8 메인 | | 7.6 | 삼성 1828×2448 / GSMArena 2448×1848 (값 충돌) | 약 403 | 미확인 | | | 4:3 (가로로 긴 화면) | [SD] |
| Fold8 Ultra 커버 / 메인 | 2026-07 | 6.5 / 8.0 | 1080×2520 / 2256×2504 | 422 / 422 | 미확인 | Android 17 / One UI 9 | 같음 | 21:9 / 약 1:1.11 | [G](https://www.gsmarena.com/samsung_galaxy_z_fold8_ultra_5g-14802.php) [SD] |
| TriFold 보조(커버) | 2025-12 | 6.5 | 1080×2520 | 422 | 미확인 | Android 16 / One UI 8.5 | 미확인 | 약 21:9 | GSMArena는 "보조 화면"으로만 표기 · [G](https://www.gsmarena.com/samsung_galaxy_z_trifold_5g-14292.php) |
| TriFold 메인 | | 10.0 | 1584×2160 | 269 | 미확인 | | | 4:3 | [SD] |

Flip 시리즈는 메인 화면과 커버 화면에 모두 같은 출시 OS가 적용됩니다(행 병합). 출시 OS의 One UI 버전은 GSMArena에 적혀 있는 경우만 넣었고, 나머지는 미확인입니다.

### 에뮬레이터 프로필 추천 (10개)

| # | 프로필 | 해상도 / dpi → dp | Android | 고른 이유 |
|---|---|---|---|---|
| 1 | S22 | 1080×2340 / 480 → 360 | 12 (API 31) | 가장 오래된 OS이면서 가장 흔한 360dp 폭 |
| 2 | S24 Ultra (FHD 기본) | 1080×2340 / 450 → 384 | 14 | 플러스·울트라 계열의 384dp 폭 |
| 3 | S26 Ultra | 1080×2340 / 420 → 412 (⚠ 실측 필요) | 16 | 최신 플래그십이고, 412dp 폭이 맞는지 확인하는 용도 |
| 4 | A16 5G | 1080×2340 / dpi 미확인 (360·412 둘 다 테스트) | 14 | 판매량이 많은 보급형, 90Hz |
| 5 | Fold5 커버 | 904×2316 / 420 → 344 | 13 | **가장 좁은 폭**이고 23.1:9로 가장 길쭉함 |
| 6 | Fold5 메인 | 1812×2176 / 420 → 690 | 13 | 정사각형에 가까운 태블릿형 화면 |
| 7 | Flip6 커버 | 720×748 / dpi 미확인 | 14 | 정사각형 소형 화면 + 컷아웃 |
| 8 | Flip7 메인 | 1080×2520 / 480 → 360 | 16 | 21:9 세로로 긴 화면 |
| 9 | Fold8 메인 + 커버 | 1828×2448 · 1248×1972 / dpi 미확인 | 17 (API 37) | 최신 OS, 4:3 가로형 메인, 넓은 커버 |
| 10 | TriFold 메인 | 1584×2160 / dpi 미확인 | 16 | 가장 큰 10인치 4:3 화면 |

### 남은 문제와 다음 할 일

- **기본 dpi가 미확인인 모델**(A 시리즈, Flip·Fold 커버, Fold6·7·8, TriFold)은 실기기에서 `adb shell wm size`, `wm density`, `dumpsys display` 결과를 받아 채우는 것이 유일하게 확실한 방법입니다.
- 삼성 개발자 사이트에 모델별 에뮬레이터 스킨 zip이 있어서, 그 안에 density 설정이 들어 있을 가능성이 있습니다. 다만 파일을 내려받는 일이라 실행하지 않았습니다. 받아도 될지 알려 주세요.
- AVD의 `hw.lcd.density`에 450 같은 비표준 값을 넣을 수 있는지는 확인하지 않았습니다. 안 되면 실행 중인 에뮬레이터에서 `adb shell wm density 450`으로 맞추면 됩니다.
