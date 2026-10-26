# 인프라·운영 (autopilot 기준)

Autopilot push target: ai/work

배포 대상·운영 서버 없음 (로컬 CLI 도구). GitHub Actions 워크플로 없음 — 새로 만들 때도 `ai/**` push 에는 돌지 않게, `main` push 는 `paths-ignore: ['docs/**', '.ai-log/**']`.
Local e2e: 해당 없음 — 에뮬레이터 시험은 각 Todo 의 verify 스크립트가 직접 띄우고 끈다.

## 저장소
- GitHub `namyunsu/crewdroid` (비공개). MVP·데모 후 사람이 공개 전환.
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
