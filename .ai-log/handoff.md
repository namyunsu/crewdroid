# Handoff (2026-10-23)
완료: T01 T02 T03 T04 T07 T08 (todo-archive.md 참조). 에뮬레이터는 모두 꺼 둠.
다음 배치: T05 (에뮬 1개). T12(haiku, 창 숨김)는 에뮬을 쓰므로 다른 에뮬 Todo 와 같은 배치 금지. 이후 T06 → T09 → T10 → T11.
알아둘 것:
- sample/server/server.ts(T02 업로드)와 app.ts(T07 판정용)가 둘 다 기본 포트 5599 인 별개 서버. T05/T09/T10 전에 하나로 합칠 것 (app.ts 에 /upload 있음, 프로브 앱이 x-client-id·idempotency-key 헤더를 보내야 함).
- 에뮬 37.1.11 은 -android-serialno 에서 멈춤: ro.serialno 는 못 바꿈.
- API 37 ATD 는 0.94GB 라 안 받음: fold8 은 API36 (belowMinApi).
- density 미확인 프로필 4개 (a16, flip6-cover, fold8-main, trifold-main).
- up 후 RAM 이 14% 늘어난 이유 [모름].
- 동시에 다른 autopilot 셸이 돌았을 수 있음 (T02 워커가 check-atd 중복 실행 관찰): 포트 충돌 주의.
- CLAUDE.md 의 Commands/디렉터리 맵은 아직 갱신 안 됨 (up/down/prepare/identity/judge/hammer, src/avd·snapshot·identity·up·judge·hammer).
