# Handoff (2026-10-27 00:35 shift, DEV T51)
이번 shift: T51(Field Notes 레이아웃 점검 스크립트 check-layout.mjs + demo-app 수정) DONE, 커밋 4dbefd6. verify OK(30 captures), npm test 52 pass / fail 0, reviewer APPROVE.
BLOCKED: T50(영상)·T40(소개) — T49 측정이 전제와 반대. 사용자 결정: (a) screen/logs 압축+덤프 속도 개선 Todo 먼저 / (b) 메시지를 부팅·RAM·JSON·MCP 로 변경.
다음: 열린 dev Todo 없음 → QA(앞 shift 에서 scenario OK, T51 은 에뮬레이터 점검 통과) → WRAP-UP.
알려진 문제: src/triage.ts:31 tsc 오류(기존). scripts/demo-vibe.mjs:66 폰트 경로 Windows 하드코딩. 빈 catch(platform.ts:92,94, bench-agent.mjs:163). 목록 화면 하단 패딩 없어 FAB가 마지막 카드 가림.
MANUAL: T43 Mac/Linux 측정, T48 클립 5개 확인, T44 hero.gif(T50 이 대체). T51 로 툴바가 Material 툴바에서 LinearLayout 으로 바뀜 — docs/demo 클립은 재촬영 안 함.
