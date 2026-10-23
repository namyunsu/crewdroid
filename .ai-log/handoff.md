# Handoff (2026-10-24, shift 6)
완료: T13(GIF 3대 라이브, s22→s24ultra), T14(렌더 수정), T15(디스크 6.99 GiB ≤ 8, 부팅 6.73s).
다음: T16(RAM) → T17(옛 AVD 삭제, T16 승인 후) → T18 → T19. 에뮬 Todo 는 배치당 1개.
알아둘 것:
- 에뮬 쓰는 명령은 잠금(%TEMP%\crewdroid-emulators.lock) 으로 보호. 긴 체인은 `export CREWDROID_OWNER=$(cat /proc/$$/winpid)` 먼저(CLAUDE.md Gotchas).
- autopilot 셸이 같은 checkout 에서 여러 개 동시에 돌았음(PID 28620, 12512). 한 개만 에뮬 사용.
- API 31 ATD 는 private-app 통화 화면(SurfaceView)을 못 그림 [원인 모름]. 데모는 API 34/34/36. 결정 필요.
- adb `error: closed` 재시도가 비멱등 명령에 안전한지 [모름]. flip7 패널 live 103/204 경계.
- 포트 5599 점유 → 검증은 --server-port 5595.
