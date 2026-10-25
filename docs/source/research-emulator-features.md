# 에뮬레이터·adb CLI 기능 조사 (crewdroid 추가 후보)

조사일 2026-10-26. 기준: 로컬 emulator 37.1.11 (`emulator -help` 직접 확인), 설치 이미지 `google_atd` API 31/34/36 (`system-images/` 확인). 비용 = 경량(디스크/RAM/CPU)에 주는 영향 추정. `[unverified]` = 공식 문서로 확인 못 함.

공통 전제
- ATD 이미지에서 빠진 것(공식): Chrome·Maps·Messages·Play Store, **Settings 앱**, **SystemUI**, Dialer·Camera2·Gallery2·Launcher3·LatinIME 등. **Settings provider 는 남아 있음** → `settings put` 은 됨. 하드웨어 렌더링 비활성 [S4].
- `adb emu <cmd>` = 콘솔 명령 fire-and-forget, 여러 대면 `adb -s emulator-<port> emu …` [S1].
- `-read-only` 공식 help: "allow running multiple instances of emulators on the same AVD, but **cannot save snapshot**" [S2].

## a) 위치 — 비용 0
| 기능 | 명령 | ATD/headless 제약 | 출처 |
|---|---|---|---|
| 좌표 | `adb emu geo fix <경도> <위도> [고도m] [위성1-12] [속도knots]` (경도가 먼저) | mock GPS provider 로 들어옴. ATD 는 Settings 앱이 없으니 위치 스위치는 `adb shell cmd location set-location-enabled true` 로 켬 (API 30+ 쉘, [S9]) | [S1][S9] |
| NMEA | `adb emu geo nmea $GPGGA,…` (GPGGA/GPRMC만) | 동일 | [S1] |
| GPX/KML 경로 | **CLI 없음** — Extended Controls GUI 전용. 대체: 좌표 배열을 interval 로 `geo fix` 반복(속도 인자 포함) | headless 에서 GUI 불가 | [S1] |
| 테스트 provider | `cmd location providers add-test-provider gps` + `set-test-provider-location gps --location lat,lon` (`appops set <uid> android:mock_location allow` 필요) | geo fix 보다 무거움, 필요 없음 | [S9] |

## b) 센서·회전 — 비용 0
| 기능 | 명령 | 제약 | 출처 |
|---|---|---|---|
| 가속도/자이로 등 | `adb emu sensor status` / `sensor get acceleration` / `sensor set acceleration x:y:z` | 없음 | [S1] |
| 화면 회전 | `adb emu rotate` (90° 단위; 문서 본문은 45°라 적혀 자기모순) | 없음 | [S1] |
| 설정으로 고정 | `settings put system accelerometer_rotation 0` + `settings put system user_rotation 1` (0~3) | Settings.System 공개 상수. ATD OK | [S8] |

## c) 배터리 — 비용 0
`adb emu power capacity 15` · `power ac off` · `power status discharging` · `power health overheat` [S1]. 가드 쪽: `dumpsys battery unplug` / `dumpsys battery reset` (공식) [S10], `dumpsys battery set level 15` [unverified-공식문서엔 없음, BatteryService 쉘]. ATD 제약 없음.

## d) 통신 — 비용 0, ATD 는 UI 없이 상태만
| 기능 | 명령 | 제약 | 출처 |
|---|---|---|---|
| 통화 | `adb emu gsm call 010…` / `gsm accept` / `gsm cancel` / `gsm busy` / `gsm hold` / `gsm list` | "call audio 미지원". ATD 는 Dialer 없음 → InCall UI 없이 TelephonyManager 상태만 바뀜 [unverified] | [S1][S4] |
| SMS | `adb emu sms send 4085555555 "hi"` | ATD 에 Messages 없음 → `SMS_RECEIVED` 브로드캐스트는 오지만 보관 앱 없음 [unverified] | [S1][S4] |
| 신호 | `gsm signal <rssi 0-31> <ber 0-7>` (**다음 15초만 적용**), `gsm signal-profile 0-4` | 15초 제한 → 주기 재전송 필요 | [S1] |
| 망 상태 | `gsm data unregistered\|home\|roaming\|searching\|denied\|off\|on`, `gsm voice …`, `gsm status` | 지금 쓰는 `svc` 보다 가볍고 로밍/searching 까지 됨 | [S1] |
| SIM 없음 | 부팅 플래그 `-no-sim` | 부팅 시에만 | [S2] |

## e) 외관·로케일·시간 — 비용 0 (루트 항목 제외)
| 기능 | 명령 | 제약 | 출처 |
|---|---|---|---|
| 다크모드 | `cmd uimode night yes\|no\|auto` | API 29+. ATD OK | [S11] |
| 글자 크기 | `settings put system font_scale 1.3` (ui-sweep 가 이미 사용) | 없음 | [S8] |
| 밀도/크기 | `wm density 480`, `wm size 1080x2340` (이미 구현) | — | [S3] |
| 앱 단위 로케일 | `cmd locale set-app-locales <pkg> --locales ko-KR,en` / `get-app-locales` | API 33+. 기기 전체 로케일 쉘 명령은 **없음** | [S12] |
| 기기 전체 로케일 | `setprop persist.sys.locale ko-KR` + 재부팅 | root 필요(`adb root` 는 userdebug 이미지만) [unverified] | — |
| 타임존 | 부팅 플래그 `-timezone Asia/Seoul`(공식) ; 런타임 `setprop persist.sys.timezone` 는 root [unverified] | 클론은 부팅 시 플래그로 처리 | [S3] |
| 시계 | `settings put global auto_time 0` 후 `date -s`(root) [unverified]; 스냅샷 시간 보정 끄기 `-no-snapshot-update-time` | root | [S2] |

## f) 권한 — 비용 0
`pm grant <pkg> android.permission.CAMERA` / `pm revoke …` [S3], `appops set <pkg> <OP> allow\|ignore\|deny`, `appops get <pkg>` [S13], 상태 조회 `dumpsys package <pkg>` ("runtime permissions:" 블록, `granted=true`) [S3]. ATD 제약 없음.

## g) 인텐트·딥링크 — 비용 0
| 기능 | 명령 | 제약 | 출처 |
|---|---|---|---|
| 딥링크 | `am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://…" [<pkg>]` | **ATD 에 Chrome 없음** → 앱이 안 받으면 "No Activity found". 패키지 명시 권장 | [S3][S4][S7] |
| 브로드캐스트 | `am broadcast -a <action> -n <pkg>/<receiver>` | API 26+ 암시적 브로드캐스트 제한 → `-n` 필수 | [S3] |
| App Links 검증 | `pm set-app-links --package <pkg> 0 all`(초기화) → `pm verify-app-links --re-verify <pkg>`(인터넷 필요) → `pm get-app-links <pkg>` (`verified`/`legacy_failure`/`system_configured`/1024+) | API 31+. 오프라인이면 `pm set-app-links --package <pkg> 2 example.com` 으로 강제 approved | [S3][S7] |
| 구형 조회 | `dumpsys package domain-preferred-apps` | API ≤30 용 [unverified] | — |

## h) 앱 데이터 — 비용 0
`pm clear <pkg>` [S3]. 백업/복원: `bmgr enable true` → `bmgr transport com.android.localtransport/.LocalTransport` → `bmgr backupnow <pkg>` → `pm uninstall --user 0 <pkg>` + 재설치로 복원 [S14]. LocalTransport 가 google_atd 에 포함되는지 [unverified]. `run-as <pkg>` 는 debuggable 앱만 [S3].

## i) 자원 압박 — 비용 0~소
| 기능 | 명령 | 제약 | 출처 |
|---|---|---|---|
| 저장소 부족 | 부팅 `-partition-size <MB>`; 런타임 `fallocate -l 4G /data/local/tmp/fill` + `df /data` | fallocate 는 toybox [unverified]. `-read-only` 클론은 디스크 변경이 버려지므로 런타임 채움이 오히려 안전 | [S2][S3] |
| 메모리 트림 | `am send-trim-memory <pkg> RUNNING_CRITICAL\|COMPLETE…`, `am memory-factor set CRITICAL` / `show` / `reset` | AOSP main 기준; API 지원 범위 [unverified] | [S15] |
| Doze | `dumpsys deviceidle force-idle` / `unforce` / `dumpsys battery reset` | API 23+ | [S10] |
| Standby | `dumpsys battery unplug` → `am set-inactive <pkg> true`, `am set-standby-bucket <pkg> rare\|restricted`, `am get-standby-bucket` | restricted 는 API 31+ | [S10][S15][S16] |
| 백그라운드 제한 | `appops set <pkg> RUN_ANY_IN_BACKGROUND ignore\|allow`, `am make-uid-idle <pkg>`, `cmd deviceidle tempwhitelist -d <ms> <pkg>` | API 28+ | [S13] |
| 절전 | `settings put global low_power 1` (+ `dumpsys battery unplug`) | — | [S16] |
| 저사양 기기 | 부팅 `-lowram` | 부팅 시만 | [S2] |

## j) 스냅샷 — 클론에서 **저장 불가**
`adb emu avd snapshot list\|save <name>\|load <name>\|delete <name>` [S1]. `-read-only` 는 "cannot save snapshot" [S2]; 읽기전용 인스턴스는 auto-save 를 끄고 기존 Quickboot RAM 파일을 copy-on-write 로 공유 [S17]. 방침: `prepare`(베이스, 쓰기 가능)에서만 저장, 클론은 `-snapshot <name> -no-snapshot-save`. 클론에서 `avd snapshot load` 가 되는지 [unverified]. 스냅샷 로드/저장은 RAM 집약 작업 [S5].

## k) 폴더블 — 비용 중(별도 베이스 AVD)
`adb emu fold` / `unfold` / `posture`(목록) / `posture 2`(1 closed·2 half-opened·3 opened; Pixel Fold·Resizable 템플릿은 1~3만, 4·5 는 `KO: Failed to set posture`) [S18]. `resize-display <idx>` 는 **headless 미지원** [S1]. 힌지는 AVD `config.ini` 의 `hw.sensor.hinge*`(count/type/ranges/defaults/areas, posture_list) 로 정의 [S19] → 비폴더블 베이스에선 `fold` 가 KO [unverified]. 가드 쪽 `cmd device_state print-states` / `state <id>` / `state reset` (API 31+) [S20]. crewdroid 는 베이스 AVD 하나를 클론하므로 폴더블은 **두 번째 베이스 AVD** 가 필요 = 디스크·스냅샷 추가.

## l) 로그·ANR·크래시 — 비용 0 (bugreport 만 중)
`logcat -b crash -d` (버퍼 main/system/crash/events/radio/all) [S21]; `dumpsys activity exit-info <pkg>` (API 30 ApplicationExitInfo) [unverified-문서]; `am monitor` (crash/ANR 대기) [S3]; `am dumpheap [-n] <pkg> /data/local/tmp/h.hprof` → `adb pull` [S3][S15]; `/data/anr/`·`/data/tombstones` 직접 읽기는 쉘 권한에 따라 다름 [unverified] → `adb bugreport out.zip`(dumpsys+logcat+ANR 포함, 수십 초 CPU·수십 MB) [S22]. `bugreportz -p` 는 공식 문서에 없음 [unverified].

## m) 접근성·화면 이해 — 비용 0
`uiautomator dump /data/local/tmp/ui.xml` (mobile-mcp 가 이미 이 경로로 동작 → ATD·SystemUI 없음에도 OK), `dumpsys accessibility`, 포커스: `dumpsys window | grep mCurrentFocus` 또는 `dumpsys activity activities | grep topResumedActivity` [S3]. Compose: `Modifier.testTag` 는 `Modifier.semantics { testTagsAsResourceId = true }` 를 상위에 켜야 resource-id 로 노출(Compose 1.2.0-alpha08+), 아니면 text/contentDescription 만 [S23]. WebView 내용은 접근성 트리에 부분 노출, ATD 의 WebView provider 유무 [unverified].

## n) 성능 — 비용 0~소
`dumpsys gfxinfo <pkg> framestats` / `… reset`, `dumpsys meminfo <pkg>` [S24]; `am start -S -W <pkg>/.Main` → `ThisTime/TotalTime/WaitTime`, logcat `Displayed …`/`Fully drawn …` [S25]. **ATD 는 하드웨어 렌더링 비활성** → 프레임 수치는 상대 비교용 [S4]. `simpleperf` 는 Android ≥ Q 기기 내장, profileable/debuggable 앱 [S26]; `perfetto -o /data/misc/perfetto-traces/t.pftrace -t 10s sched gfx view am wm` 는 P 이상 내장 [S27], 9/10 은 `setprop persist.traced.enable 1` [unverified]. 추적 중 CPU 증가 → 시간 제한.

## o) APK 정적 정보 — 비용 0 (호스트)
`aapt2 dump badging|permissions|xmltree app.apk` — build-tools ≥26.0.2 [S28]. `apkanalyzer apk summary|manifest min-sdk|target-sdk|permissions|dex packages app.apk` — `cmdline-tools/<ver>/bin/apkanalyzer(.bat)` [S29].

## p) 화면 녹화 — 비용 중(CPU)
| 방식 | 명령 | 제약 | 출처 |
|---|---|---|---|
| 가드 | `screenrecord --time-limit 180 --size 720x1280 --bit-rate 4000000 /data/local/tmp/r.mp4` → `adb pull` | 최대 180초, 오디오 없음, 녹화 중 회전 불가. 게스트 소프트웨어 인코딩 = 클론 CPU | [S3] |
| 호스트 | `adb emu screenrecord start [--time-limit 10] out.webm` / `stop` ; 부팅 플래그 `-record-session <file>,<delay>[,<duration>]` | `.webm` 만, 파일은 `~/.android/avd/<avd>.avd/console_out/` (클론 경로 [unverified]). `-no-window` 동작 여부 문서 없음 [unverified]; 인코딩은 호스트 CPU | [S1][S2][S30] |
pull 안정성: 녹화 프로세스 종료(파일 close) 후 pull; API 34/36 차이 문서 없음.

## q) 멀티디스플레이 — 비용 중(RAM·렌더)
부팅 `-multidisplay 1,1200,800,240,0` (index 1~3) [S2]; 런타임 `adb emu multidisplay add <index> <w> <h> <dpi> <flag>` / `del` (fold 프로필 미지원) [S1]; 가드 `am start --display 1 …`, `dumpsys display`. ATD 는 런처 없어 보조 화면이 빈 화면. headless 동작 [unverified]. 프레임버퍼 w×h×4 만큼 게스트 RAM 추가.

## r) 경량 플래그 (공식 수치 없음 — 실측은 `docs/measurements/ram*.json`)
| 플래그 | 효과 | 출처 |
|---|---|---|
| `-no-window` | 그래픽 창 비활성(서버용). 29.0.6: headless 빌드가 이를 대체 예정 | [S2][S30] |
| `-no-audio` `-no-boot-anim` `-no-metrics` `-no-passive-gps` | 오디오/부팅 애니/메트릭/패시브 GPS 끔 | [S2] |
| `-accel on` | 하이퍼바이저 강제(없으면 실패) | [S2] |
| `-gpu software` | 36.4.9+: 최적 소프트웨어 백엔드(기본 lavapipe). `swiftshader_indirect`·`angle_indirect`·`guest` 는 **deprecated(36.4.9)** → 교체 필요. ATD 는 어차피 HW 렌더 끔 | [S6][S30] |
| `-feature -Vulkan` | 35.3.11 "Really disable Vulkan API calls" | [S30] |
| `-memory <MB>` | 1536~8192; **API 37 부터 최소 4 GB**; config.ini `hw.ramSize` 는 37.1.11 부터 `6G` 단위 허용 | [S2][S30] |
| `-cores N` | 가상 코어 수, 기본은 AVD 값(보통 2) | [S2] |
| `-feature QuickbootFileBacked` | 게스트 RAM 을 파일 매핑 → `-read-only` 클론이 Quickboot RAM 을 copy-on-write 공유 (끄려면 `advancedFeatures.ini` 에 `QuickbootFileBacked = off`) | [S17] |
| `-lowram` `-no-snapshot-save` `-delay-adb` `-restart-when-stalled` `-quit-after-boot <s>` `-partition-size` | 저사양 플래그/상태 폐기/adb 지연/스톨 재시작/타임아웃/파티션 | [S2] |

## 결론 — 추가 우선순위
1. **비용 0, 바로**: a 위치, b 센서·회전, c 배터리, d `gsm data/signal`·SMS·통화 상태, e 다크·font_scale·앱 로케일, f 권한, g 딥링크·App Links 강제 상태, h pm clear·bmgr, i Doze/Standby/트림/절전/저장소 채움, l logcat crash·exit-info·dumpheap, m uiautomator dump, n gfxinfo·meminfo·am start -W, o aapt2.
2. **비용 중, 선택**: p 녹화(호스트 쪽 `adb emu screenrecord` 우선, headless 검증 필요), n perfetto/simpleperf, q 멀티디스플레이.
3. **맞지 않음**: j 클론 스냅샷 저장, GPX 재생, `resize-display`(headless 불가), k 폴더블(베이스 AVD 추가 필요).

## 출처
- [S1] 콘솔 명령 https://developer.android.com/studio/run/emulator-console
- [S2] 로컬 `emulator -help` / `-help-read-only` / `-help-cores` / `-help-multidisplay` (37.1.11) ; 플래그 문서 https://developer.android.com/studio/run/emulator-commandline
- [S3] adb/am/pm/screenrecord https://developer.android.com/tools/adb
- [S4] ATD https://developer.android.com/studio/test/gradle-managed-devices
- [S5] 스냅샷 https://developer.android.com/studio/run/emulator-snapshots
- [S6] GPU 모드 https://developer.android.com/studio/run/emulator-acceleration
- [S7] App Links 검증 https://developer.android.com/training/app-links/verify-android-applinks
- [S8] Settings.System 상수 https://developer.android.com/reference/android/provider/Settings.System ; ui-sweep 스킬 `app-sweep.py`
- [S9] LocationShellCommand https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/location/LocationShellCommand.java
- [S10] Doze/Standby https://developer.android.com/training/monitoring-device-state/doze-standby
- [S11] UiModeManagerService 쉘 https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/UiModeManagerService.java
- [S12] LocaleManagerShellCommand https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/locales/LocaleManagerShellCommand.java
- [S13] 앱 전원 관리(appops/make-uid-idle/tempwhitelist) https://source.android.com/docs/core/power/app_mgmt
- [S14] 백업 테스트 https://developer.android.com/identity/data/testingbackup
- [S15] ActivityManagerShellCommand(dumpHelp) https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/main/services/core/java/com/android/server/am/ActivityManagerShellCommand.java
- [S16] Pie 전원(standby bucket, low_power) https://developer.android.com/about/versions/pie/power
- [S17] Emulator 28.0.16 노트(-read-only, QuickbootFileBacked) https://androidstudio.googleblog.com/2018/11/emulator-28016-stable.html
- [S18] fold/posture/resize-display https://developer.android.com/blog/posts/emulator-control-for-adaptive-app-development
- [S19] 힌지 config.ini https://androidstudio.googleblog.com/2020/06/emulator-30017-canary.html , https://androidstudio.googleblog.com/2020/08/emulator-30025-canary.html
- [S20] DeviceStateManagerShellCommand https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/devicestate/DeviceStateManagerShellCommand.java
- [S21] logcat https://developer.android.com/tools/logcat
- [S22] bugreport https://developer.android.com/studio/debug/bug-report
- [S23] Compose×UiAutomator https://developer.android.com/develop/ui/compose/testing/interoperability
- [S24] dumpsys https://developer.android.com/tools/dumpsys
- [S25] 앱 시작 시간 https://developer.android.com/topic/performance/vitals/launch-time
- [S26] simpleperf README https://android.googlesource.com/platform/system/extras/+/master/simpleperf/doc/README.md
- [S27] Perfetto Android 버전 노트 https://perfetto.dev/docs/reference/android-version-notes
- [S28] aapt2 https://developer.android.com/tools/aapt2
- [S29] apkanalyzer https://developer.android.com/tools/apkanalyzer
- [S30] 에뮬레이터 릴리스 노트(37.2.12 까지) https://developer.android.com/studio/releases/emulator ; 녹화 https://developer.android.com/studio/run/emulator-record-screen
