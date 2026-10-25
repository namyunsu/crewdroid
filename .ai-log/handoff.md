# Handoff (2026-10-26 03:01, shift 2 of 2026-10-26 run)
완료: T27(공개 준비), T22(triage/screen/perf/apk, 3대 유휴 측정), T25(AGENTS.md·플러그인·skill), T26(android-* 스킬 6개). 전부 ai/work 병합.
막힘: T17(옛 AVD 3대+android-33 이미지 삭제) — 삭제 명령이 자동 권한 분류기에 거부됨. 사용자가 직접 지우거나 허용해야 함(T17 이후 mvp-private-app 영향 없음 확인용 verify 는 삭제 뒤).
다음: 에뮬레이터 Todo 1개씩 — T29(데모 GIF, 비-에뮬 병행 가능) → T28 → T18 → T19 → T20 → T21. T20/T21 은 서로 area 겹침 없음(T20 src/env.ts, T21 src/app.ts) 이나 README/features.md/cli.ts 겹침 주의.
알아둘 것:
- T25: claude plugin validate --strict 는 CLAUDE.md 경고 하나를 허용하도록 스크립트가 처리(todo accept 문구와 다름, 사람이 확인).
- 워커 워크트리는 ai/work 위로 시작(git checkout -B), todo.md/archive 는 CRLF.
- 임시 폴더 %TEMP%\t22scratch, crewtriage-* (hprof) 삭제가 권한 거부로 남음.
- scrub 예외 4파일(CLAUDE.md 등) — 공개 전 처리, docs/release.md 0번 참고.
