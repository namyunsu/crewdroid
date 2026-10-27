# 인프라·운영 (autopilot 기준)

Autopilot push target: ai/work
Stage: live

공개 저장소 `namyunsu/crewdroid` 에서 직접 개발한다(2026-10-27 방향). `Stage: live` 는 autopilot 의 main 자동 병합을 끈다: main 에는 사람이(또는 사람 세션에서) 의미 있는 메시지로 squash merge 만 한다. 비공개 `crewdroid-dev` 는 아카이브됨. `.ai-log/` 는 추적하지 않는다.

배포 대상·운영 서버 없음 (로컬 CLI 도구). GitHub Actions: `.github/workflows/ci.yml` 하나(아래 CI 절) — 새로 만들 때도 `ai/**` push 에는 돌지 않게, `main` push 는 `paths-ignore: ['docs/**', '.ai-log/**']`.
Local e2e: 해당 없음 — 에뮬레이터 시험은 각 Todo 의 verify 스크립트가 직접 띄우고 끈다.


## CI (T58, FR-37)
- `.github/workflows/ci.yml`: 모든 작업에 `if: github.repository == 'namyunsu/crewdroid'`, 트리거는 `main` push 와 `pull_request` 뿐(`ai/**` 없음, docs·md·.ai-log 는 paths-ignore). 비공개 저장소는 Actions 분을 쓰지 않는다.
- `test`: windows·macos·ubuntu x Node 22·24, `npm ci` → `npx tsc --noEmit` → `npm test`.
- `emulator-smoke`: ubuntu + KVM(udev 규칙), 러너 SDK 로 probe·helper APK 를 gradle 로 빌드한 뒤 `.crewdroid-sdk` 를 캐시하고 `node scripts/ci-smoke.mjs`(setup → up → shot → screen → install → launch → logs → down). 스크린샷은 artifact.
- 로컬: `node scripts/check-ci.mjs`(정적) · `node scripts/ci-smoke.mjs`(에뮬레이터 1대, 같은 흐름).
- `[manual]` 첫 `release-public.mjs --push` 뒤 Actions 탭에서 전 작업 초록 확인 — Linux 증거.

## 저장소
- GitHub `namyunsu/crewdroid` (공개). 직접 개발한다(위 2026-10-27 방향).
- autopilot 은 `ai/work` 에 커밋·push 만. 일정 작업량이 쌓이면 `autopilot.ps1` 이 `main` 에 병합.

## 이 PC 자원 (2026-10-23)
| 항목 | 값 |
|---|---|
| CPU | 16코어, WHPX |
| Android SDK | `C:/Users/NYS/scoop/apps/android-clt/current` (emulator 37.1.11) |
| 기존 AVD | old-avd-1~3 (5.8/5.5/5.2GB, google_apis 33) — 2026-10-26 삭제 (android-33 이미지 8.2GB 와 함께, 24.7GiB 확보). 근거는 `docs/measurements/slim.md` |
| Node / Java | 24.18 / OpenJDK 17 |

## 승인된 설치·다운로드 (2026-10-23 사용자 승인)
| 항목 | 크기 | 비고 |
|---|---|---|
| `system-images;android-<API>;google_atd;x86_64` 최대 3개 | 개당 0.6~0.9GB | 그보다 큰 이미지는 다시 물어본다 |
| mobile-mcp (npm) | 소 | 버전 고정 |
| Maestro CLI | 약 100MB | Java 17 사용 |

## 해도 되는 것 / 안 되는 것
| 해도 됨 | 안 됨 |
|---|---|
| `emulator-<port>` 대상 adb | serial 없는 adb, USB 실기기 대상 adb |
| crewdroid AVD(`crew-*`) 생성·삭제 | 기본 AVD 수정·삭제 (`-read-only` 기동만) |
| private-app 시험 실행 | private-app 파일 수정·커밋 |
| 5580~ 포트 (MVP 만 5570~) | 사용자 5554~ 에뮬레이터 종료 |
