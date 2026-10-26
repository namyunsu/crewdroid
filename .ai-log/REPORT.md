# crewdroid · 2026-10-26 23:55
## 작업 내역 요약
완료 46 / BLOCKED 2 / 전체 48 · dev URL 없음(로컬 CLI)
## 이제 되는 것
- `crewdroid net <serial> airplane|online|...` 로 네트워크 상태를 바꿀 때, 먼저 끊고 안정될 때까지 기다린다. 부팅 직후 API 31 기기에서 네트워크가 잠깐 비던 문제가 없어졌다.
- `demo-app/` 의 Field Notes 앱과 실제 에뮬레이터 녹화 클립 5개(부팅·에이전트 조작·오프라인·폴드·다크)가 생겼다.
- `node scripts/bench-agent.mjs` 로 에이전트가 화면을 읽는 비용(토큰·초)을 트리 방식과 스크린샷 방식으로 비교할 수 있다.
## 알아둘 것
- `src/net.ts`: 네트워크 상태 전환이 이제 3~15초 동안 멈춰서 기다린다. 시나리오처럼 전환을 많이 하는 곳이 느려질 수 있다. 먼저 볼 곳 `src/net.ts`. [확인함]  (check-scenario 3대 x 6회: BUGGY 3/3 잡고 clean 3/3 통과, `.ai-log/evidence/qa/check-scenario.txt`)
## 페인포인트
- BLOCKED 영상(T50)·소개문(T40): 에이전트 비교 측정이 "더 빠르고 싸다"는 전제와 반대로 나왔다. 트리 방식 9695토큰·23.9초, 스크린샷 방식 6212토큰·10.3초. 원인은 screen JSON 이 크고(회당 2778토큰), uiautomator 덤프가 회당 3.5초, logs 가 회당 3527토큰이기 때문이다.
- 로컬 e2e 대상이 없어 브라우저 QA는 해당 없음. 대신 npm test(52개 통과, 실패 0)와 check-scenario 로 확인했다.
- `%TEMP%` 의 crewbench-*/t45/t48/t49/hero-* 폴더가 권한 거부로 안 지워진다.
## 앞으로 할 일
직접 확인할 것:
- Field Notes 클립 5개(`docs/demo/` 또는 hero-clips.json 경로)를 직접 보고 쓸 만한지 판단
- 기존 hero.gif 는 이미 구리다고 하셨으니 T50 이 대체할 때까지 그대로 둔다
- Mac/Linux 에서 측정 한 번 돌려 보기(T43)
정해야 할 것:
- 영상·소개 메시지: (a) screen/logs 출력을 줄이고 덤프를 빠르게 하는 작업을 먼저 하고 숫자를 뒤집은 뒤 영상, (b) "빠르다/싸다" 대신 부팅 시간·RAM·JSON 구조·MCP 를 내세우는 쪽으로 메시지 변경 — 둘 중 고르기
다음 후보:
- screen/logs 출력 압축: 에이전트 비용이 실제로 줄어든다
- uiautomator 덤프 속도 개선: 회당 3.5초가 가장 큰 지연이다
- 소개 영상 다시 만들기: 메시지가 정해지면 바로 가능
- README 첫 화면 정리: 뭐 하는 프로젝트인지 바로 보이게

## 자동 계획 2026-10-27
- 새 Todo 1건: T51 Field Notes 데모 앱 화면 깨짐 점검(기종 5개 x 글자 크기 1.0/1.3/2.0). 리뷰어 승인.
- 만들지 않은 것: screen/logs 출력 압축·덤프 속도 개선은 위 "정해야 할 것"(a)/(b) 결정에 걸려 있어 Todo 로 만들지 않았다.
## 결정 필요
- T50 영상·T40 소개 메시지: (a) 에이전트 비용 줄이기 먼저 / (b) 메시지를 부팅·RAM·JSON·MCP 로 변경.
- 참고(요구사항 위반 아님): `src/triage.ts:31` tsc 타입 오류 2건(실행은 정상), `scripts/demo-vibe.mjs:66` Windows 폰트 경로. 고칠지 /brief 에서 정해 주세요.
