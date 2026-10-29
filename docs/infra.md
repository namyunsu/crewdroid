# 인프라·운영 (autopilot 기준)

Autopilot push target: ai/work
Stage: live

공개 저장소 `namyunsu/crewdroid` 에서 직접 개발한다(2026-10-27 방향). `Stage: live` 는 autopilot 의 main 자동 병합을 끈다: main 에는 사람이(또는 사람 세션에서) 의미 있는 메시지로 squash merge 만 한다. 비공개 `crewdroid-dev` 는 아카이브됨. `.ai-log/` 는 추적하지 않는다.

배포 대상·운영 서버 없음 (로컬 CLI 도구). GitHub Actions: `.github/workflows/ci.yml` 하나(아래 CI 절) — 새로 만들 때도 `ai/**` push 에는 돌지 않게, `main` push 는 `paths-ignore: ['docs/**', '.ai-log/**']`.
Local e2e: 해당 없음 — 에뮬레이터 시험은 각 Todo 의 verify 스크립트가 직접 띄우고 끈다.


## CI (T58, FR-37)
- `.github/workflows/ci.yml`: 모든 작업에 `if: github.repository == 'namyunsu/crewdroid'`, 트리거는 `main` push 와 `pull_request` 뿐(`ai/**` 없음, docs·md·.ai-log 는 paths-ignore). 공개 저장소라 포크에서는 돌지 않는다.
- `test`: windows·macos·ubuntu x Node 22·24, `npm ci` → `npx tsc --noEmit` → `npm test`.
- `emulator-smoke`: ubuntu + KVM(udev 규칙), 러너 SDK 로 probe·helper APK 를 gradle 로 빌드한 뒤 `.crewdroid-sdk` 를 캐시하고 `node scripts/ci-smoke.mjs`(setup → up → shot → screen → install → launch → logs → down). 스크린샷은 artifact.
- 로컬: `node scripts/check-ci.mjs`(정적) · `node scripts/ci-smoke.mjs`(에뮬레이터 1대, 같은 흐름).
- `[manual]` `main` 에 병합한 뒤 Actions 탭에서 전 작업 초록 확인 — Linux 증거.
- `test` 에 `node scripts/check-versions.mjs` 한 단계, 별도 `skills` 작업이 `check-agent-files.mjs`(스킬 front matter name·description 검사; `claude` CLI 가 없으면 plugin validate 만 건너뜀).

## 릴리스 (T68, FR-46)
- 버전은 `package.json` 한 곳이 기준. `.claude-plugin/plugin.json`, `server.json`(두 곳)이 같아야 하고 `node scripts/check-versions.mjs [--tag vX.Y.Z]` 가 아니면 exit 1. `crewdroid --version` 도 `package.json` 값을 찍는다.
- 올릴 때: 네 파일 버전을 함께 올리고 커밋 → push → `git tag vX.Y.Z && git push origin vX.Y.Z`. 태그 push 만 `.github/workflows/release.yml` 을 돌린다(schedule·수동 트리거 없음).
- release.yml 순서: check-versions `--tag` → `npm ci` → `tsc --noEmit` → `npm test` → `npm publish --provenance --access public` → `mcp-publisher login github-oidc` → `mcp-publisher publish`(버전 `MCP_PUBLISHER_VERSION` 고정). npm trusted publishing(OIDC, `id-token: write`)이라 토큰 secret 은 없다. `prepack` 이 helper APK 를 러너 SDK 로 빌드하므로 setup-java 17 을 쓴다.
- `[manual]` 최초 1회: npmjs.com 의 crewdroid 패키지 → Settings → Trusted publishing → GitHub, `namyunsu/crewdroid`, `release.yml`. 첫 태그를 push 하고 `npx crewdroid@latest --version` 이 같은지 확인.
- 검증한 에뮬레이터·이미지 버전은 `docs/compat.md`; 다르면 `setup`·`up` 이 WARN 한 줄(오류 아님).
- Release rhythm: at the end of every wave the human session squash-merges ai/work into main and tags; main must not lag ai/work by more than 3 days (FR-51)

## 저장소
- 저장소는 하나: `origin` = 공개 `namyunsu/crewdroid`. autopilot 은 `ai/work` 에 커밋·push 만 한다. `main` 에는 사람이 squash merge 하고 태그를 단다 (절차는 `docs/release.md` §8). `.ai-log/` 는 추적하지 않는다.
- `scripts/release-public.mjs` / `public-files.json` 은 내보내기 허용 목록 + `check-public.mjs` 스크럽 검사다. 별도 미러로 올리는 경로가 아니다. 에이전트는 이 스크립트가 찍는 `git push` 줄을 실행하지 않는다.
- GitHub Actions 는 `ci.yml` 의 `github.repository == 'namyunsu/crewdroid'` 조건으로 이 저장소에서만 돈다.

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
