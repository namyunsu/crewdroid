# crewdroid · 2026-10-26 07:30
## 작업 내역 요약
완료 27 / BLOCKED 2 / 전체 29 · dev URL 없음(로컬 CLI)
## 이제 되는 것
- `crewdroid env <serial> <geo|battery|rotate|dark|font|locale|sms|call>`: 에뮬레이터의 위치·배터리·회전·다크모드·글꼴·언어·문자·전화를 명령 한 줄로 바꾼다.
- `crewdroid app <serial> perm|open|links|clear|backup|pressure|fill-storage`: 앱 권한, 딥링크, 데이터 삭제, 백업, 메모리·저장공간 압박을 건다.
- 이전에 만든 `up`/`run`/`triage`/`screen`/`perf`/`apk`/`fold`/`mcp` 와 AI 에이전트용 스킬·플러그인 파일도 그대로 쓴다.
## 알아둘 것
- API 36 에뮬레이터 회전은 `wm fixed-to-user-rotation` 으로 고정해야 유지된다. 일부 이미지에서만 안 먹을 수 있다. 먼저 볼 곳 `src/env.ts` [확인함]
- 느린 망에서 2MB 업로드가 120초 안에 동기화되지 않는 경우가 있었다. 원인은 모른다. 먼저 볼 곳 `src/scenario.ts` [모름]
## 페인포인트
- BLOCKED: 옛 AVD 3대 + android-33 이미지 삭제 — 삭제 명령이 자동 권한 분류기에 거부됨(사용자 직접 허용 필요).
- BLOCKED: 공개용 데모 GIF — 샘플 앱 화면이 정지라 녹화에 움직임이 없음. probe-app 에 주기 갱신 UI 추가가 필요하다.
- QA: 로컬 e2e 대상이 없어 건너뜀(ENV_NO_E2E_TARGET).
- `scripts/check-agent-files.mjs` 가 AGENTS.md 에 fold 명령 행이 없다고 실패한다.
## 앞으로 할 일
직접 확인할 것:
- `node scripts/check-agent-files.mjs` 실패: AGENTS.md 명령 표에 `fold` 행을 추가하면 풀린다 [확인함]
- `src/perf.ts:24` 의 `am start -S -W` 가 API 31 화면 검정 현상의 후보 [추론]: API 31 기기에서 `perf` 실행 후 화면 확인
정해야 할 것:
- 옛 AVD(old-avd-1~3)와 android-33 google_apis 이미지를 직접 지울지(디스크 확보)
- 데모 GIF 를 위해 probe-app 에 주기 갱신 UI 를 추가해도 되는지
다음 후보:
- AGENTS.md 에 fold 행 추가: 검사 스크립트 실패 해소, 한 줄 수정
- 데모 GIF 재시도: 공개 README 노출에 필요
- 샘플 서버 PUT idempotency 수정: 응답 유실 재시도가 가짜 충돌로 보임
- 영문 README·공개 준비 점검(`check-public`)
## 결정 필요
- T17: 옛 AVD 3대 + android-33 이미지 삭제 — 사용자가 직접 삭제하거나 삭제 명령을 허용해야 함.
- T29: 데모 GIF 용으로 probe-app 에 주기 갱신 UI 를 추가해도 되는지(Todo 영역 확장).
- 느린 망 2MB 업로드 120초 미동기화(원인 모름): 재현 조건이 정해지면 Todo 로.
자동 계획: Todo 2건 추가(T30 AGENTS.md 명령 표, T31 perf API 31 검정 화면), 리뷰어 승인.
