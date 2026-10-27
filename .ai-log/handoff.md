# Handoff (2026-10-27 14:02 shift 5)
이번 shift: 새 T61(기기 사양)이 아카이브 T61 과 ID 충돌 → T64 로 개명. T64(up --cores/--ram, 프로필 cores/ramMB, 사양별 base AVD+스냅샷, f4040d0) DONE, reviewer APPROVE.
다음 batch: T62(load) → T63(wifi), 한 번에 하나. 이번엔 사람 세션이 같은 체크아웃에서 scripts/hero2 를 만지는 중이라 에뮬레이터·대량 수정 Todo 는 시작하지 않고 멈춤.
알려진 문제: 다른 사양 AVD 를 쓴 직후 기본 사양 첫 cold 로드가 40~90초 걸려 check-single 1회차가 20초 기준을 넘을 수 있음(단독 재실행은 통과). checkSpec 는 --count N 합계 RAM 이 아닌 기기별로 비교. a16-lowend 는 devices 에 "a16,a16-lowend" 로 표시. MCP up 의 cores/ram 은 실행 확인 못 함.
MANUAL: 공개 저장소 push 뒤 Actions 전 job 초록 확인. T43 Mac/Linux 측정, T48 클립 확인. 사람 세션 파일(scripts/hero2, hero2-judge.txt, research-oss-app.md)은 이 shift 가 커밋하지 않음.
