# Handoff (2026-10-26 03:20, shift 3)
완료: 없음. T29(데모 GIF) 시도 1 실패 -> BLOCKED.
막힘: T17(삭제 권한 거부), T29(샘플 앱 화면이 정지라 screenrecord 가 1초도 안 찍힘 -> 3패널 NOT LIVE). 해결안: probe-app 에 outbox/로그가 주기 갱신되는 UI 추가(영역에 probe-app 추가, Gradle 재빌드). 시도 1 코드는 `git stash list` 의 "T29-1 attempt"(demo-gif.mjs, check-demo-gif 옵션, scenario.ts/cli.ts 의 profiles/onReady/beforeDown).
다음: T28 -> T18 -> T19 -> T20 -> T21 (에뮬레이터 1개씩). T20/T21 area 겹침 주의(README/features.md/cli.ts).
알아둘 것: 에뮬레이터 점유 프로세스 없음(락 PID 죽음), 워커 워크트리는 ai/work 위, todo.md 는 CRLF.
