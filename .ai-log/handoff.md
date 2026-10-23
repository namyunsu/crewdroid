# Handoff (2026-10-24, shift 6)
완료: T13(GIF 3대 라이브, s22→s24ultra 교체), T14(화면 렌더 수정: debug.hwui.drawing_enabled=1).
다음: T15(디스크) → T16(RAM) → T17(옛 AVD 삭제, T15·T16 승인 후) → T18 → T19. 에뮬 Todo 는 배치당 1개.
알아둘 것:
- API 31 ATD 는 private-app 통화 화면(SurfaceView)을 못 그림(원인 [모름]). 데모는 API 34/34/36. 사용자 결정 필요.
- up 을 거치지 않는 에뮬 기동 경로(measure.ts, identity.ts, prepare)에는 setprop 없음.
- 포트 5599 점유 → 검증은 --server-port 5595. PUT 은 idempotency-key 무시 [추론].
- flip7 패널 live 103/204 로 check-demo-gif 경계.
