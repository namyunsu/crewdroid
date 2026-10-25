# Handoff (2026-10-26 04:17, shift 4)
완료: T28 (API31 검은 화면 원인은 SurfaceView 아님: am start -S 직후 재실행 경합. ADR 0005, up 이 WARN, relaunchBlackApis 표시). 커밋 65f9e86.
막힘: T17(삭제 권한 거부), T29(probe-app 에 주기 갱신 UI 필요, stash "T29-1 attempt").
다음: T18 -> T19 -> T20 -> T21 (에뮬레이터 1개씩; T20/T21 area 겹침 주의).
알아둘 것: src/perf.ts:24 의 am start -S -W 가 API31 에서 같은 경합에 걸릴 수 있음(후보). 에뮬레이터 점유 프로세스 없음. todo.md 는 CRLF.
