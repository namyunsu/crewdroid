2026-10-23 | 빈 catch 반려 1회 | rule missing: 정리 코드의 catch 는 ESRCH 만 무시
2026-10-23 | 5599 포트를 T06 리뷰어가 띄운 샘플 서버가 점유(종료 명령 거부됨) → T09 기본 verify 가 EADDRINUSE | env broken / tool limit: 서브에이전트가 서버를 남김
2026-10-23 | 워커가 CLAUDE.md 를 시프트 중간에 수정(프롬프트 캐시 무효) | rule missing: 브리프에 CLAUDE.md 편집 금지 안 적음(T06)
2026-10-23 | 워커 중단으로 T10 검증 미완 → 마스터가 재실행(약 12분) | tool limit: 워커 핸드백 강제 신호
2026-10-23 | 서브에이전트가 임시 파일을 %TEMP% 에 남김(삭제 거부) | tool limit
2026-10-24 01:35 | 옛 shift(PID 28620)가 살아 있는데 watchdog 이 dead 로 판정해 새 shift 를 띄움 | env broken / tool limit
2026-10-24 | 옛 shift 가 오래 돌아 새 shift 가 연속으로 빈손 종료 | env broken: 두 shift 동시 실행 방지 장치 없음
2026-10-24 01:46 | 옛 세션이 안 끝난 채 shift 가 반복 시작됨 | env broken / tool limit
2026-10-24 | 옛 세션이 안 끝나 shift 가 빈 채로 반복됨 (shift 12,13) | env broken: 이전 claude 세션 PID 28620 이 autopilot 과 같은 파일을 계속 수정
2026-10-24 | 옛 세션 PID 28620 이 계속 T15 작업 중이라 shift 가 연속 3회 빈 채 종료 | env: 동시 세션 충돌
2026-10-24 | 옛 세션이 미커밋 T15 파일을 계속 수정해 shift 3회 연속 빈손 | env broken: 동시 세션 충돌
2026-10-24 | 옛 세션이 같은 Todo 를 손으로 계속 작업해 shift 5회 연속 대기 | env: 두 세션 동시 실행 방지 규칙 없음
2026-10-24 | 옛 세션 PID 28620 이 T15 를 계속 수정해 shift 6회 이상 연속 대기 | env: 동시 세션 충돌
2026-10-24 | 옛 대화형 세션이 T15 를 잡고 있어 autopilot shift 가 연속 빈손 종료 | env: 세션 중복
2026-10-24 | 옛 세션이 T15 변경·에뮬레이터를 쥐고 있어 shift 가 연속 빈 shift 됨 | env broken
2026-10-24 02:00 | 옛 세션 PID 28620 + 에뮬레이터 3대가 T15 점유 중이라 shift 가 빈 채로 끝남 | env: 동시 세션 충돌
2026-10-24 | 옛 세션이 T15 를 진행 중이라 shift 가 연속으로 빈 채 끝남(35, 36) | env broken: 동시 세션 감지 규칙 없음
2026-10-24 | 옛 세션이 T15 를 점유해 shift 가 연속으로 빈 채 끝남 | env broken
2026-10-24 | 옛 세션이 에뮬레이터를 잡고 있어 shift 2회 연속 빈 shift | env: 같은 PC 에서 수동 세션과 autopilot 동시 실행
2026-10-24 02:02 | 에뮬레이터 점유로 shift 연속 대기 | env broken: 옛 세션 PID 28620 이 CPU·포트를 계속 점유
2026-10-24 | 다른 세션이 T15 파일을 직접 수정 중이라 autopilot 이 shift 51~56 연속 빈손 | env broken: 사람 세션과 autopilot 동시 작업
- 2026-10-24 | 사용자 세션이 T15 파일을 직접 수정 중이라 shift 51~57 이 일 없이 끝남 | env: 동시 작업 충돌
- 2026-10-24 | 사용자 세션이 T15 파일을 계속 수정해 shift 51~63 이 일 없이 끝남 | env: 동시 작업 충돌
2026-10-24 | 다른 세션이 T15 를 수동 진행 중이라 shift 65 도 빈손 | env: 동시 세션 충돌
2026-10-24 | 다른 세션과 같은 Todo(T15)·에뮬레이터를 동시에 쓰려 해 shift 18회 빈손 | env: 사람 세션과 autopilot 동시 실행
2026-10-24 | 다른 세션이 에뮬레이터를 쓰는 중에 autopilot이 verify를 돌려 포트 충돌 | env: 에뮬레이터 동시 사용 잠금 없음
2026-10-24 | 다른 세션의 t15b/loop.mts가 5570 에뮬레이터를 점유해 shift 107·108 검증 불가 | env broken
2026-10-24 | 다른 세션의 loop.mts+에뮬레이터가 몇 shift째 점유해 autopilot이 빈 shift 반복 | env broken (세션 간 에뮬레이터 점유 조율 규칙 없음)
2026-10-24 | 다른 세션 loop.mts가 5570 에뮬레이터를 계속 점유해 shift가 빈 채 반복 | env broken
2026-10-24 | 다른 세션의 node loop2.mts 와 에뮬레이터 3대가 shift 108~113 내내 살아 있어 T15 검증 불가 | env broken
2026-10-24 02:56 | 117 | 보류 | loop2.mts(PID 31112) 생존, T15 대기
2026-10-24 02:57 | 119 | 다른 세션 loop2.mts(PID 31112)·에뮬레이터 3대 아직 실행 중, 이번에도 보류. 그 프로세스가 끝나면 T15부터 재개.
