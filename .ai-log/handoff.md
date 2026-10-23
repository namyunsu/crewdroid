# Handoff (2026-10-23, shift 3)
완료: T01~T09 (todo-archive.md 참조). 에뮬레이터는 모두 꺼 둠.
다음 배치: T10 (opus, 에뮬 N대). T12(haiku)는 에뮬 사용이라 T10 과 같은 배치 금지. 이후 T11.
알아둘 것:
- [환경] 포트 5599 를 PID 23568(샘플 서버, T06 리뷰어가 남김)이 점유 중. 종료는 권한 거부됨 → 사람이 끄면 기본 verify 가 돈다. 그 전엔 check-*.mjs 에 --server-port 5595.
- 샘플 앱: 브로드캐스트 dev.crewdroid.sample.PHOTO|EDIT|READ|SYNC, outbox 는 filesDir/outbox, 로그 태그 CrewProbe (SAVED/RETRY/CONFLICT/DROPPED/OUTBOX).
- PUT 은 idempotency-key 를 무시 → 응답 유실 재시도가 가짜 CONFLICT 로 보일 수 있음 [추론] (후보 Todo).
- mobile-mcp 는 MOBILEMCP_LEGACY_ROBOT=1 일 때만 emulator-<port> id 로 지정 가능 (기본은 AVD 이름). maestro mcp run 은 device_id 필수.
- up 은 옛 프로브 앱을 띄움: 새 APK 는 매번 adb install -r. up 후 check-net/check-mcp 재확인 통과.
- 이전: slow 는 게스트 tc netem, flaky 루프는 down 이 안 멈춤(pid 재사용 위험 [추론]), 에뮬 37.1.11 은 -android-serialno 에서 멈춤.
- density 미확인 프로필 4개 (a16, flip6-cover, fold8-main, trifold-main).
