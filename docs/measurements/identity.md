# T03 -read-only 클론 고유값 실측 (2026-10-23)

`android-34/google_atd` 기본 AVD를 한 번 정상 부팅해 프로브 앱을 설치하고 quickboot 스냅샷(`default_boot`)을 저장한 뒤(`crewdroid prepare`), 같은 스냅샷에서 `-read-only` 클론 3대(포트 5580/5582/5584, 3초 간격)를 띄워 읽었다 (`crewdroid identity`, 원본: `identity.json`).
읽는 방법: android_id=`settings get secure android_id`, 앱별 값=프로브 앱 `Settings.Secure.ANDROID_ID`(logcat `CrewProbe: ID`), serialno=`getprop`, MAC=`/sys/class/net/wlan0/address`(adb root 필요: shell 권한은 Permission denied), hostname=`getprop net.hostname`.

## Before (클론 그대로)

| serial | androidId | appAndroidId | roSerialno | roBootSerialno | wifiMac | hostname |
|---|---|---|---|---|---|---|
| emulator-5580 | `b1a1a9be7213ba7c` | `3fdee6ed5e670463` | `EMULATOR37X1X11X0` | `EMULATOR37X1X11X0` | `02:15:cc:00:00:00` | `` |
| emulator-5582 | `b1a1a9be7213ba7c` | `3fdee6ed5e670463` | `EMULATOR37X1X11X0` | `EMULATOR37X1X11X0` | `02:15:cc:00:00:00` | `` |
| emulator-5584 | `b1a1a9be7213ba7c` | `3fdee6ed5e670463` | `EMULATOR37X1X11X0` | `EMULATOR37X1X11X0` | `02:15:cc:00:00:00` | `` |

결과: 6개 값 전부 3대가 같다 (충돌: androidId, appAndroidId, roSerialno, roBootSerialno, wifiMac, hostname). hostname은 빈 문자열 (설정 안 됨; 안드로이드가 DHCP에서 android_id로 만드는 이름은 android_id가 같으니 역시 같다).

## After (`makeDistinct`, 클론마다 다르게)

| serial | androidId | appAndroidId | roSerialno | roBootSerialno | wifiMac | hostname |
|---|---|---|---|---|---|---|
| emulator-5580 | `c0ffee0000000001` | `a0f1ee5e2b40d993` | `EMULATOR37X1X11X0` | `EMULATOR37X1X11X0` | `02:15:b2:00:00:01` | `crew-1` |
| emulator-5582 | `c0ffee0000000002` | `caec0ef41bba6928` | `EMULATOR37X1X11X0` | `EMULATOR37X1X11X0` | `02:15:b2:00:00:02` | `crew-2` |
| emulator-5584 | `c0ffee0000000003` | `7b63461dff7631bc` | `EMULATOR37X1X11X0` | `EMULATOR37X1X11X0` | `02:15:b2:00:00:03` | `crew-3` |

- android_id: `adb root` 후 `settings put secure android_id c0ffee00000000NN`.
- 앱별 ANDROID_ID: 앱 값은 `HMAC(userkey, 패키지+서명)`이고 `userkey`가 `/data/system/users/0/settings_ssaid.xml`(바이너리 XML)에 있어서, `settings put`만으로는 안 바뀐다. 파일을 pull해 64자 userkey를 같은 길이의 클론별 값으로 바꿔 push → `stop; start`(프레임워크 재시작, 에뮬레이터 재부팅 아님) → 프로브 앱 uninstall/install(캐시된 앱 항목 제거). 클론당 약 20~30초 추가.
- Wi-Fi MAC: root로 `ip link set wlan0 down; ... address 02:15:b2:00:00:NN; ... up`. (`-wifi-mac-address` 에뮬레이터 옵션은 쓰지 않았다: 스냅샷 복원 후에는 적용되지 않을 것으로 추정 [모름: 시험 안 함].)
- hostname: root로 `setprop net.hostname crew-N`.

## 바꿀 수 없는 값

| 값 | 이유 | 앱이 할 일 |
|---|---|---|
| `ro.serialno` / `ro.boot.serialno` (`EMULATOR37X1X11X0`, 에뮬레이터 버전 문자열) | 읽기 전용 속성이고 스냅샷에 구워져 있다. 에뮬레이터 `-android-serialno`는 이 PC(에뮬레이터 37.1.11)에서 단독 기동 2회 모두 GPU 초기화에서 멈춰 부팅이 안 됐다 (`-no-snapshot-load` 콜드 부팅 포함; 같은 조건에서 옵션만 빼면 7초에 부팅) | 하드웨어 시리얼로 사용자/기기를 구분하지 말 것. android_id나 앱이 설치 때 만든 UUID를 쓴다. 테스트에서 기기 구분은 adb 시리얼(`emulator-<port>`)로 한다 |

## 메모

- `prepare`는 `-no-snapshot-save`로 부팅해 `adb emu avd snapshot save default_boot`로 명시 저장한다 (약 42초, 부팅 24초).
- 클론은 스냅샷에서 복원되므로 부팅이 7~10초로 짧다. `makeDistinct`의 프레임워크 재시작 비용은 위에 적은 대로다.
- `up`(T04)에서는 `src/identity.ts`의 `makeDistinct(serial, index)`를 부팅 직후 호출하면 된다.
