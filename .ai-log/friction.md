2026-10-23 | 빈 catch 반려 1회 | rule missing: 정리 코드의 catch 는 ESRCH 만 무시
2026-10-23 | 5599 포트를 T06 리뷰어가 띄운 샘플 서버가 점유(종료 명령 거부됨) → T09 기본 verify 가 EADDRINUSE | env broken / tool limit: 서브에이전트가 서버를 남김
2026-10-23 | 워커가 CLAUDE.md 를 시프트 중간에 수정(프롬프트 캐시 무효) | rule missing: 브리프에 CLAUDE.md 편집 금지 안 적음(T06)
2026-10-23 | 워커 중단으로 T10 검증 미완 → 마스터가 재실행(약 12분) | tool limit: 워커 핸드백 강제 신호
2026-10-23 | 서브에이전트가 임시 파일을 %TEMP% 에 남김(삭제 거부) | tool limit
2026-10-24 01:35 | 옛 shift(PID 28620)가 살아 있는데 watchdog 이 dead 로 판정해 새 shift 를 띄움 | env broken / tool limit [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 shift 가 오래 돌아 새 shift 가 연속으로 빈손 종료 | env broken: 두 shift 동시 실행 방지 장치 없음 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 01:46 | 옛 세션이 안 끝난 채 shift 가 반복 시작됨 | env broken / tool limit [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 세션이 안 끝나 shift 가 빈 채로 반복됨 (shift 12,13) | env broken: 이전 claude 세션 PID 28620 이 autopilot 과 같은 파일을 계속 수정 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 세션 PID 28620 이 계속 T15 작업 중이라 shift 가 연속 3회 빈 채 종료 | env: 동시 세션 충돌 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 세션이 미커밋 T15 파일을 계속 수정해 shift 3회 연속 빈손 | env broken: 동시 세션 충돌 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 세션이 같은 Todo 를 손으로 계속 작업해 shift 5회 연속 대기 | env: 두 세션 동시 실행 방지 규칙 없음 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 세션 PID 28620 이 T15 를 계속 수정해 shift 6회 이상 연속 대기 | env: 동시 세션 충돌 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 대화형 세션이 T15 를 잡고 있어 autopilot shift 가 연속 빈손 종료 | env: 세션 중복 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 세션이 T15 변경·에뮬레이터를 쥐고 있어 shift 가 연속 빈 shift 됨 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 02:00 | 옛 세션 PID 28620 + 에뮬레이터 3대가 T15 점유 중이라 shift 가 빈 채로 끝남 | env: 동시 세션 충돌 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 세션이 T15 를 진행 중이라 shift 가 연속으로 빈 채 끝남(35, 36) | env broken: 동시 세션 감지 규칙 없음 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 세션이 T15 를 점유해 shift 가 연속으로 빈 채 끝남 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 옛 세션이 에뮬레이터를 잡고 있어 shift 2회 연속 빈 shift | env: 같은 PC 에서 수동 세션과 autopilot 동시 실행 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 02:02 | 에뮬레이터 점유로 shift 연속 대기 | env broken: 옛 세션 PID 28620 이 CPU·포트를 계속 점유 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션이 T15 파일을 직접 수정 중이라 autopilot 이 shift 51~56 연속 빈손 | env broken: 사람 세션과 autopilot 동시 작업 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
- 2026-10-24 | 사용자 세션이 T15 파일을 직접 수정 중이라 shift 51~57 이 일 없이 끝남 | env: 동시 작업 충돌 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
- 2026-10-24 | 사용자 세션이 T15 파일을 계속 수정해 shift 51~63 이 일 없이 끝남 | env: 동시 작업 충돌 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션이 T15 를 수동 진행 중이라 shift 65 도 빈손 | env: 동시 세션 충돌 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션과 같은 Todo(T15)·에뮬레이터를 동시에 쓰려 해 shift 18회 빈손 | env: 사람 세션과 autopilot 동시 실행 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션이 에뮬레이터를 쓰는 중에 autopilot이 verify를 돌려 포트 충돌 | env: 에뮬레이터 동시 사용 잠금 없음 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션의 t15b/loop.mts가 5570 에뮬레이터를 점유해 shift 107·108 검증 불가 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션의 loop.mts+에뮬레이터가 몇 shift째 점유해 autopilot이 빈 shift 반복 | env broken (세션 간 에뮬레이터 점유 조율 규칙 없음) [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션 loop.mts가 5570 에뮬레이터를 계속 점유해 shift가 빈 채 반복 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션의 node loop2.mts 와 에뮬레이터 3대가 shift 108~113 내내 살아 있어 T15 검증 불가 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 02:56 | 117 | 보류 | loop2.mts(PID 31112) 생존, T15 대기
2026-10-24 02:57 | 119 | 다른 세션 loop2.mts(PID 31112)·에뮬레이터 3대 아직 실행 중, 이번에도 보류. 그 프로세스가 끝나면 T15부터 재개.
2026-10-24 | 다른 세션이 5570~5574 에뮬레이터를 점유해 shift 반복 공회전 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션의 에뮬레이터/loop 프로세스가 반복 점유해 shift 빈손 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션이 에뮬레이터/포트 5570을 점유해 shift가 빈손으로 끝남 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션의 node loop/에뮬레이터가 shift 108~132 동안 점유해 빈 shift 반복 | env broken (세션 간 포트·에뮬레이터 충돌) [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션의 loop.mts·에뮬레이터가 포트를 계속 점유해 shift가 비어 돎 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 03:42 | 에뮬레이터 점유로 shift 빈손 | env broken (다른 세션 check-scenario 실행 중) [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 03:42 | 다른 세션이 에뮬레이터를 계속 점유해 shift 낭비 | env broken: 동시 세션 충돌 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 03:43 | 다른 세션의 check-scenario가 에뮬레이터를 계속 점유해 shift가 비어 있음 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션 check-scenario가 에뮬레이터를 계속 점유해 shift가 빈 채로 끝남 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션이 에뮬레이터·check-scenario 점유해 shift 공회전 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 03:48 | 에뮬레이터 점유 반복 | env broken: 다른 세션이 check-scenario로 에뮬레이터 장기 점유 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 03:50 | 에뮬레이터를 다른 세션이 계속 점유해 shift가 비어 있음 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 03:56 | 다른 세션이 에뮬레이터를 계속 점유해 shift가 비어 끝남 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 다른 세션이 에뮬레이터를 장시간 점유해 shift가 비어 있음 | env broken / tool limit (세션 간 락 없음) [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 04:03 | 에뮬레이터를 다른 세션이 계속 점유해 shift가 비어 돌아감 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 04:07 | 다른 세션이 에뮬레이터·check-scenario를 장시간 점유해 shift가 빈손 반복 | env: 한 번에 하나의 crewdroid 실행 제한 [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | 같은 checkout 에서 autopilot 셸 2개 동시 실행 → down() 이 에뮬 죽여 verify 실패 | env broken (tool limit) [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-24 | T13 가 T14(렌더) 선행 필요한데 todo 순서 반대 | Todo unclear
2026-10-24 | 같은 checkout 에서 autopilot 셸이 동시에 돌아 T15 verify 를 두 번 실행 | env broken [처리됨 2026-10-26: autopilot.ps1 단일 실행 가드 + BUSY 대기, 프로젝트 잠금 %TEMP%\crewdroid-emulators.lock]
2026-10-26 | mvp-private-app 가 -lowram 설정에서 3번 중 1번 채팅 15초 초과로 실패(불안정) | env flaky / RAM 노브 부작용 의심
2026-10-26 | 워크트리가 옛 main 에서 시작해 ai/work 로 옮겨야 했음, 절대경로 private-app 가정 | tool limit
2026-10-26 | 워커가 .ai-log/evidence 를 격리 때문에 공유 경로에 못 씀 | tool limit
2026-10-26 | 워커 haiku 의 avdmanager delete 가 자동 권한 분류기에 거부돼 T17 막힘 | env broken / rule missing (삭제 Todo 는 사전 허용 필요)
2026-10-26 | todo.md 가 CRLF 라 정규식 이동 스크립트가 실패 | tool limit
2026-10-26 | T22 가 lightness 행을 1대로 재서 반려 (todo accept 와 wave rule 충돌) | Todo unclear
2026-10-26 | T25 accept 의 validate --strict 통과 조건이 CLAUDE.md-at-root 경고 때문에 불가능 | Todo unclear
2026-10-26 | T29 verify 실패: 샘플 앱 정지 화면 때문에 live 패널 0, 10분 낭비 | Todo unclear (area 에 probe-app 없음)
2026-10-26 | API31 SurfaceView 가설이 틀려 todo 문구(surfaceView:false)와 실측이 어긋남 | Todo unclear
2026-10-26 | 리뷰어가 반려한 API36 검사 건너뛰기: 워커가 원인 모름인 채 skip 으로 통과시킴 | brief 규칙 부족(이후 brief 에 'API 별 skip 금지' 명시)
2026-10-26 | todo.md CRLF/LF 혼재로 sed/python 이동 중 임시파일 경로 오류 | env/tool limit
2026-10-26 | perf 스킬 문서에 -S 잔존(스킬 수정 승인 필요) | rule missing; features.md 자동 행 라벨 오기 | tool limit
2026-10-26 | QA 대상(Local e2e/Dev URL) 없어 QA 건너뜀 | env broken
2026-10-26 | 이전 shift 타임아웃 후 worker 의 check-slow-upload 가 계속 돌며 에뮬레이터 점유 | env: shift 타임아웃 시 하위 프로세스가 남음
2026-10-26 | 워커 worktree base 가 ai/work 보다 낡아 병합 충돌(cli.ts COMMANDS) 반복 | rule missing: 브리프에 base 갱신 지시
2026-10-26 | 락 파일이 재사용된 PID 를 살아있는 소유자로 오판 | env broken
2026-10-26 | check-public 스크러브가 테스트 가짜 시리얼 문자열에 걸림 | tool limit
2026-10-26 | T41 이 package.json 만 0.2.0 으로 올리고 plugin.json 누락 → T43 워커의 check-agent-files 실패 | Todo unclear (버전 올릴 파일 목록 없음)
2026-10-26 | 리뷰어가 verify 를 다시 돌려 single.md(추적 파일)가 바뀜 → 되돌림 | tool limit
2026-10-26 | check-net/offline 이 원본에서도 실패해 T33 verify 체인이 막힘, A/B 확인에 약 30분 | env broken (기존 결함)
2026-10-26 | T40 을 보낸 뒤 /brief 가 todo.md 선행 조건을 바꿔 작업 폐기 | Todo changed mid-shift (사람 편집과 shift 겹침)
2026-10-26 | 워커가 %TEMP% 임시 폴더 삭제를 권한에서 거부당함 | tool limit
2026-10-26 | 이전 shift 시간초과 뒤에도 bench-agent.mjs(PID 22632)와 bench-stock-34 에뮬레이터가 살아 락을 쥠 | env broken / tool limit
2026-10-26 | 이전 shift 의 bench-agent(22632)가 shift 사이에도 계속 돌아 에뮬레이터 점유 | env: 오래 걸리는 벤치가 shift 종료 후 살아남음
