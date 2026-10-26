# Handoff (2026-10-26 shift 1, 3 batches)
이번 shift: T35(setup) · T36(단일 기기 up, devices) · T17(문서) · T37(install/launch/logs) · T38(shot/tap/type/swipe/key) 완료, ai/work 에 병합·push.
다음 batch: T39(MCP 종단 루프 + 스킬, opus) → T41(데모 GIF, 0.2.0) → T40(소개, T39·T41 뒤) ; T33(net slow 2MB 업로드)은 에뮬레이터 순서상 T41 뒤. 에뮬레이터 Todo는 한 번에 하나.
알려진 문제: src/triage.ts:31 tsc 오류 2건(기존). 한글 type 은 ATD 에서 불가(exit 1, README 명시). 워커 worktree 는 ai/work 보다 오래된 base 에서 시작할 수 있음 → 브리프에 "먼저 ai/work merge" 지시 필요. probe APK 는 gitignore 라 병합 후 main 에도 복사해야 check 가 맞음.
후속 후보: setup --images 값 숫자 검증, logs --seconds NaN 검증, %TEMP% 락의 PID 재사용 오판(msedgewebview2).
