# Handoff (2026-10-26 23:35 shift 5, 3 batches)
이번 shift: T45(net 상태 전환이 online 을 거치고 부팅 직후 API31 네트워크 공백 → src/net.ts 에서 먼저 끊고 settle 대기, ba0a1ac APPROVE), T48(Field Notes 데모 앱 + 클립 5개, bfc6b69 APPROVE), T49(에이전트 벤치, 1274c6b APPROVE).
핵심 문제: T49 결과가 전제와 반대. 트리 방식 9695토큰·23.9초 vs 스크린샷 6212토큰·10.3초 (crewdroid up 8.5초 vs stock 콜드 24.2초, 단 stock quick boot 5.8초). 원인: screen JSON 들여쓰기·필드 과다(2778토큰/회), uiautomator dump 3.5초/회, logs 3527토큰/회.
BLOCKED: T50(영상)·T40(소개) — 사용자가 메시지를 정해야 함. 선택지: (a) screen/logs 출력 압축 + 덤프 속도 개선 Todo 를 먼저 만들어 숫자를 뒤집은 뒤 영상, (b) "빠르다/싸다" 대신 부팅 시간·RAM·JSON 구조·MCP 로 메시지 변경.
알려진 문제: check-scenario 는 net.ts 변경(T45, setNet 3~15초 블로킹) 후 한 번도 안 돌림 — WRAP-UP 전에 한 번 돌릴 것(약 12분). src/triage.ts:31 tsc 오류(기존). scripts/demo-vibe.mjs:66 폰트 경로 Windows 하드코딩. platform.ts:92,94 빈 catch. bench-agent.mjs:163 빈 catch. %TEMP% 의 crewbench-*/t45/t48/t49/hero-* 폴더 권한 거부로 못 지움.
MANUAL: T43 Mac/Linux 측정, T48 클립 5개를 사용자가 직접 봄, T44 hero.gif(T50 이 대체).
다음: 사용자 결정 전에는 dev 에 진행할 TODO 없음 → QA/WRAP-UP(check-scenario 포함).
