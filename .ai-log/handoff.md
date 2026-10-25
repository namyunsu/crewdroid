# Handoff (2026-10-26 05:20, shift 5)
완료: T18(임의 화면 --screen/--profiles-file, 초과 크기는 -skin 으로 콜드부팅), T19(fold/unfold 는 wm size 교체 방식; 진짜 폴더블 AVD 는 ATD 에서 앱 화면이 안 바뀜, ADR 0006).
막힘: T17(삭제 권한 거부), T29(probe-app 주기 갱신 UI 필요).
다음: T20 -> T21 (에뮬레이터 1개씩; cli.ts 영역 겹침이라 한 배치에 하나).
알아둘 것: 느린 망에서 2 MB 업로드가 120초 안에 SYNCED 안 됨(원인 모름, 후속 Todo 후보). features.md 에 T18/T19 idle 행 없음. src/perf.ts:24 am start -S -W 가 API31 경합 후보. todo.md 는 LF/CRLF 혼재 주의. tsc 오류 src/triage.ts:31 기존.
