# crewdroid 공개 시험 대상 앱 조사 (2026-10-27)

조사 방법: 저장소 정보(라이선스, 별 수, 마지막 push)는 `gh api repos/<repo>` 로 2026-10-27에 직접 확인했다. 빌드 설정은 `gh api .../contents/<file>` 로 각 저장소의 `build.gradle(.kts)`, `gradle/libs.versions.toml`, `gradle-wrapper.properties` 원문을 읽어 확인했다. 직접 확인하지 못한 항목에는 [unverified]를 붙였다. 빌드 시간은 전부 추정치다 [unverified].

## 추천 1위 — Tasks.org + Radicale (`run`·`sweep` 둘 다)
- 저장소: https://github.com/tasks/tasks · GPL-3.0 · 별 5,695 · 마지막 push 2026-10-26
- UI: 혼합형. `res/layout` XML 36개에 Kotlin 파일 1,539개, `kmp/` 아래 Compose Multiplatform 화면이 있다. Compose `testTag` 를 쓰는 파일이 16개라 testTag 노출 여부 점검 대상으로도 쓸 수 있다.
- 빌드: AGP 9.4.1, Kotlin 2.4.10, Gradle 9.8.1, JDK 17(`jvmTarget JVM_17`), compileSdk 37 / minSdk 26 / targetSdk 36 (`gradle/libs.versions.toml`, `app/build.gradle.kts`).
  명령은 `./gradlew :app:assembleGenericDebug` 이다. CI도 `:app:assembleGenericRelease` 를 쓴다(`.github/workflows/android.yml`).
- Google 서비스: Firebase·Play 의존성은 `googleplayImplementation` 에만 묶여 있고, `generic` flavor 에는 들어가지 않는다. 다만 `com.google.gms.google-services` 플러그인은 모든 flavor 에 적용되는데, 저장소에 들어 있는 `app/google-services.json` 으로 키 없이 빌드된다 [빌드 성공 여부 unverified]. NDK 는 쓰지 않는다(`.cpp` 0개). 서명은 debug 빌드라 필요 없다.
- 백엔드: CalDAV 서버. 앱의 "함께 쓰는 서버" 목록(`WorksWithCatalog.kt`)에 Radicale·Nextcloud·DAVx5·EteSync 가 들어 있다. 로컬 실행 명령은 다음과 같다(https://radicale.org/v3.html, 기본 포트 5232, localhost 에만 바인딩하므로 에뮬레이터에서 `10.0.2.2:5232` 로 접속).
  `python -m pip install radicale && python -m radicale --storage-filesystem-folder=./col --auth-type none`
- 시험: androidTest 75개(`CaldavSynchronizerTest`, `ICalendarMergeTest` 등). Maestro flow 는 없다.
- 단점: 저장소가 KMP(desktop/iOS/wear 포함) 구성이라 파일이 3,605개로 크다. 첫 빌드는 10분을 넘길 수 있다 [unverified].
- 심을 버그: 서버 데이터가 VTODO `.ics` 파일이라 판정이 쉽다.
  - 오프라인 재시도 뒤 중복 생성: 같은 할 일이 UID 다른 파일로 2개 생긴다.
  - ETag 무시 덮어쓰기: 마지막 저장만 남는 lost update.
  - 폴드 시 편집 화면 상태 유실.
  - 알림 권한 거부 시 멈춤.
  - 글자 2.0배에서 날짜 칩 잘림.

## 추천 2위 — wallabag Android + wallabag 서버 (`run` 전용으로 가장 단순)
- 저장소: https://github.com/wallabag/android-app · GPL-3.0 · 별 591 · 마지막 push 2026-10-12
- UI: Java Views 만 쓴다(Java 165개, Kotlin 0개, layout 21개). Compose testTag 점검에는 쓸 수 없다.
- 빌드: AGP 9.3.0, Gradle 9.6.1, Java toolchain 21, compileSdk 37 / minSdk 23 (`build.gradle`, `app/build.gradle`). Kotlin·Firebase·GMS·flavor·NDK 가 모두 없고 release 서명도 필요 없다. 명령은 `./gradlew assembleDebug` 이다. 파일이 589개로 작아서 수 분 안에 빌드될 것으로 본다 [unverified].
- 백엔드: `docker run -p 80:80 -e "SYMFONY__ENV__DOMAIN_NAME=http://localhost" wallabag/wallabag`. 기본 계정은 wallabag/wallabag, DB 는 기본값 SQLite 다(https://hub.docker.com/r/wallabag/wallabag).
- 오프라인: 앱 안에 오프라인 작업 큐가 이미 있다(`QueueHelper.java`, `QueueItemDao`, `OfflineChangesSynchronizer.java`). 우리가 원하는 "오프라인 뒤 재시도 → 중복 업로드" 버그를 큐 처리에 그대로 심을 수 있다.
- 단점: 시험 코드가 0개다. 기사 본문을 WebView 로 띄우는데 ATD 이미지에 WebView 가 있는지 확인하지 못했다 [unverified]. 목록·폼은 Views 라 문제없다.
- 심을 버그: 같은 URL 기사 중복 저장(서버 DB 판정), 읽음·별표 동시 토글 덮어쓰기, 특정 API 레벨에서만 나는 크래시.

## 추천 3위 — Fossify Notes (`sweep` 전용, 백엔드 없음)
- 저장소: https://github.com/FossifyOrg/Notes · GPL-3.0 · 별 507 · 마지막 push 2026-10-27
- UI: Views 중심(viewBinding, layout 30개, Kotlin 54개). detekt 에 Compose 규칙이 들어 있어 일부 화면은 Compose 로 보인다 [unverified].
- 빌드: AGP 9.4.1, Kotlin 2.4.20, Gradle 9.8.2, JDK 17, SDK 26–36. flavor 는 `foss`/`gplay` 두 개이고 명령은 `./gradlew assembleFossDebug` 다. 키·서명 없이 빌드된다(`keystore.properties_sample` 은 release 용). F-Droid 에 올라 있다(https://f-droid.org/packages/org.fossify.notes/ [unverified]). 작아서 빌드가 빠르다.
- 단점: 서버가 없어서 `run` 시연에는 쓸 수 없다.
- 심을 버그: 플립 커버(720x748)에서 툴바 버튼이 화면 밖으로 밀림, 글자 2.0배에서 탭 제목 잘림, 폴드·회전 시 작성 중 메모 유실, 저장소 권한 거부 시 멈춤.

## 나머지 후보 요약
라이선스·별·마지막 push 는 `gh api` 로 2026-10-27에 확인했다.

| 앱 | 라이선스 | 별 | 마지막 push | UI | 백엔드 | 탈락 이유 |
|---|---|---|---|---|---|---|
| Nextcloud Notes (nextcloud/notes-android) | GPL-3.0 | 1,110 | 10-26 | Views(Java+Kotlin) | Nextcloud docker | 로그인에 Nextcloud Files 앱 설치가 필요하다("the user needs to install the Nextcloud Files app", Android-SingleSignOn README). 앱 2개와 무거운 서버가 필요하다. Java 21, AGP 9.4.1 |
| Habitica (HabitRPG/habitica-android) | GPL-3.0 | 1,836 | 10-26 | Views+Compose | 서버 공개(docker-compose.yml) | README 가 Firebase 프로젝트를 만들어 `google-services.json` 을 받으라고 요구해 키 없는 빌드 조건에 어긋난다 |
| Feeder | GPL-3.0 | 3,095 | 10-26 | 순수 Compose(testTag 9개 파일) | RSS + feeder-sync(AGPL) | 순수 Compose 대조군으로 좋은 후보. 데이터 쓰기가 적어 중복·덮어쓰기 판정에 약하다 |
| Now in Android | Apache-2.0 | 21,968 | 10-26 | Compose | 없음(`demo` flavor 는 로컬 데이터) | prod 백엔드가 공개되지 않았다(README). 유명하지만 sweep 데모용에 그친다 |
| Sunflower | Apache-2.0 | 17,741 | 2024-08 | Compose | 없음 | 저장소가 archived 상태 |
| AntennaPod | GPL-3.0 | 8,247 | 10-25 | Views | gpodder 계열 동기화 | 크다. 핵심이 미디어 재생이라 업로드형이 아니다 |
| Mihon | Apache-2.0 | 24,753 | 10-26 | Compose | 확장 소스 | 콘텐츠 저작권 문제, 백엔드 없음 |
| Thunderbird | Apache-2.0 | 14,142 | 10-27 | Compose 전환 중 | IMAP(GreenMail 등) | 빌드가 크고 판정이 복잡하다 |
| Element X / SchildiChat Next | AGPL-3.0 | 2,464 / 323 | 10-27 / 10-26 | Compose | Synapse docker | Rust SDK 를 써서 무겁다 [unverified] |
| Etar | GPL-3.0 | 2,629 | 10-26 | Views | CalendarProvider | 서버 동기화를 별도 앱(DAVx5)에 맡긴다 |
| Joplin | AGPL-3.0 [unverified] | 56,890 | 10-27 | React Native | Joplin Server docker | Node/yarn 모노레포다. 접근성 트리가 RN `testID` 를 거쳐서 나와 Android 네이티브 레이아웃 사례로 쓰기 어렵다 |
| Organic Maps / Kiwix | 비표준 / GPL-3.0 | 15,785 / 1,513 | 10-27 / 10-26 | — | 없음 | NDK·C++ 이나 네이티브 라이브러리가 무겁다 |
| NewPipe / Jitsi / Signal | — | — | — | — | — | YouTube 스크래핑 / RN·WebRTC / 제외 지시 |

## 최종 순위와 이유
1. **Tasks.org + Radicale**: 기준을 거의 다 채우는 유일한 후보다. 실사용 앱이고, Views 와 Compose 가 섞여 있고, 오프라인 우선 CalDAV 동기화를 한다. 서버는 `pip` 명령 하나로 뜨고, 데이터가 `.ics` 파일이라 `unique`/`count`/`noLostUpdate` 판정을 그대로 붙일 수 있다. 위험은 빌드 크기 하나뿐이다. 먼저 `assembleGenericDebug` 가 키 없이 몇 분 걸리는지 실측해야 한다.
2. **wallabag**: `run` 시연을 가장 짧게 만드는 경로다. docker 한 줄로 서버가 뜨고, 이미 있는 오프라인 큐에 중복 업로드 버그를 넣으면 된다. Tasks 빌드가 10분을 넘거나 깨지면 `run` 의 주 대상을 wallabag 으로 바꾼다.
3. **Fossify Notes**: 작고 빌드가 빨라서 sweep(API × 화면 × 글자 크기) 데모와 레이아웃 버그 심기에 가장 싸다. 순수 Compose 의 testTag 노출을 보여 줘야 하면 Feeder 를 보조로 둔다.

세 앱 모두 GPL-3.0 이라 수정 빌드를 공개할 때 소스 공개와 같은 라이선스 유지가 필요하다. 세 저장소 모두 Maestro flow 가 없으므로 flow 는 우리가 새로 작성해야 한다.

## 출처
- gh API 메타데이터: https://api.github.com/repos/tasks/tasks , /wallabag/android-app , /FossifyOrg/Notes 외 위 표의 저장소들
- Tasks 빌드: https://github.com/tasks/tasks/blob/main/app/build.gradle.kts , https://github.com/tasks/tasks/blob/main/gradle/libs.versions.toml , https://github.com/tasks/tasks/blob/main/.github/workflows/android.yml , https://github.com/tasks/tasks/blob/main/kmp/src/commonMain/kotlin/org/tasks/compose/settings/WorksWithCatalog.kt
- Radicale: https://radicale.org/v3.html
- wallabag: https://github.com/wallabag/android-app/blob/master/app/build.gradle , https://hub.docker.com/r/wallabag/wallabag
- Fossify Notes: https://github.com/FossifyOrg/Notes/blob/main/app/build.gradle.kts , https://github.com/FossifyOrg/Notes/blob/main/gradle/libs.versions.toml
- Nextcloud SSO: https://github.com/nextcloud/Android-SingleSignOn , https://github.com/nextcloud/notes-android/blob/main/FAQ.md
- Habitica: https://github.com/HabitRPG/habitica-android/blob/main/README.md
- Now in Android: https://github.com/android/nowinandroid/blob/main/README.md
- CalDAV 서버 목록: https://devguide.calconnect.org/caldav/server-implementations/
