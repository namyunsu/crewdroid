# Handoff (2026-10-23, shift 4)
완료: T01~T12 전부 (todo-archive.md). todo.md 에 열린 항목 없음. 에뮬레이터 모두 꺼 둠.
다음: 새 요구사항은 /brief 로. 후보는 REPORT.md.
알아둘 것:
- 포트 5599 를 PID 23568 이 점유 → 검증은 --server-port 5595.
- MANUAL: docs/demo/techs.gif 눈 확인(왼쪽 s22 검은 화면 [모름]).
- PUT 은 idempotency-key 를 무시 [추론]. outbox drain 타임아웃 경로 미검증.
- 에뮬 기동은 src/emulator.ts(숨김 PowerShell). up 의 "booted" 줄이 두 번 찍히는 원인 미확인.
