# crewdroid · 2026-10-23 21:10
## 작업 내역 요약
완료 12 / BLOCKED 0 / 전체 12 · dev URL 없음(로컬 CLI)
## 이제 되는 것
- `npx tsx src/cli.ts run scenarios/photo-upload.json --seed 1`: 기종·안드로이드 버전이 섞인 3대를 띄워 반복 업로드·수정 + 네트워크 끊김을 섞은 뒤 서버 데이터를 판정하고 끈다.
- 버그 서버(`BUGGY=1`)에서는 3번 모두 위반을 찾고, 정상 서버에서는 3번 모두 통과한다.
- `node scripts/mvp-private-app.mjs --runs 3`: private-app 의 기사 3명 시험이 crewdroid 기기에서 3번 연속 통과한다.
- 에뮬레이터 콘솔 창이 화면에 뜨지 않는다.
## 알아둘 것
- 에뮬레이터 기동 방식 변경: 숨김 PowerShell 기동으로 바뀌어 PID 를 파일로 받는다. 기동이 멈추면 up 전체가 멈출 수 있다. 먼저 볼 곳 `src/emulator.ts:1` [확인함]
- 시나리오 실행기는 기기별 시드 지연·네트워크 스케줄을 쓴다. outbox 비움 타임아웃 경로는 한 번도 안 탔다. 먼저 볼 곳 `src/scenario.ts:1` [추론]
## 페인포인트
- BLOCKED 없음. 포트 5599 를 낡은 샘플 서버(PID 23568)가 계속 점유 중이라 검증은 5595 로 돌렸다.
- MVP 비교에서 crewdroid 디스크가 더 크다(38.6GB vs 24.7GB): 안드로이드 버전 3종 이미지를 각각 센 탓이다. RAM 은 비슷, 대기 CPU 는 1000% -> 126%.
- 구방식(avd-up.ps1) 수치는 -read-only 규칙 때문에 다시 재지 않고 기존 기록을 인용했다.
- QA: 로컬 e2e 대상이 없어 건너뜀(ENV_NO_E2E_TARGET).
## 앞으로 할 일
직접 확인할 것:
- `docs/demo/techs.gif` 를 열어 3대가 서로 다른 화면 비율로 보이고 통화가 이어지는지 확인. 왼쪽(s22) 화면이 검게 보임 [모름]
- 포트 5599 점유 프로세스(PID 23568) 종료
정해야 할 것:
- 디스크 비교를 공정하게 하려면 같은 이미지 복제본만 쓰는 구성으로 다시 잴지 선택
다음 후보:
- PUT 의 idempotency-key 무시 수정: 응답 유실 재시도가 가짜 충돌로 보임
- outbox 비움 타임아웃 경로 시험
- density 미확인 프로필 4개 실측
- 웹앱(Chrome) 시험 경로(google_apis 이미지)
- 오픈소스 공개 준비(영문 README)
