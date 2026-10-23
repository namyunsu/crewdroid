# Handoff (2026-10-23)
완료: T01 T02 T03 T04 T05 T07 T08 (todo-archive.md 참조). 에뮬레이터는 모두 꺼 둠.
다음 배치: T06 (에뮬 2개, Maestro 설치). T12(haiku)는 에뮬 사용이라 다른 에뮬 Todo 와 같은 배치 금지. 이후 T09 → T10 → T11.
알아둘 것:
- 샘플 서버는 server.ts → app.ts 로 합쳐짐 (/upload 포함). 프로브 앱은 x-client-id·idempotency-key 헤더를 보냄.
- up 은 스냅샷의 옛 프로브 앱을 띄움: 새 APK 는 매번 adb install -r 필요 (T06/T09/T10).
- 에뮬 37.1.11 콘솔 network speed/delay 는 실제로 안 느려짐: slow 는 게스트 tc netem(adb root) 사용.
- flaky 루프는 down 이 안 멈춤(후보: down 이 stopFlaky 호출). pid 재사용 시 엉뚱한 프로세스 kill 가능 [추론].
- 에뮬 37.1.11 은 -android-serialno 에서 멈춤. API 37 ATD 는 0.94GB 라 안 받음(fold8 은 API36).
- density 미확인 프로필 4개 (a16, flip6-cover, fold8-main, trifold-main). up 후 RAM 14% 증가 이유 [모름].
- CLAUDE.md 의 Commands/디렉터리 맵 미갱신 (up/down/prepare/identity/judge/hammer/net).
