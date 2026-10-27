# crewdroid · 2026-10-27 12:40
## 작업 내역 요약
완료 약 55 / BLOCKED 9 / 열린 dev 0 (status.md 기준) · dev URL 없음(로컬 CLI)
## 이제 되는 것
- `node scripts/check-coexist.mjs` 로 기기 도우미가 mobile-mcp·Maestro 와 같이 쓰일 때 어떻게 되는지 6가지 상황을 잰다.
- 결과는 `docs/measurements/coexist.md` 표로 본다.
## 알아둘 것
없음
## 페인포인트
- 도우미 공존 측정이 3번 중 1번 실패(부팅 직후 mcp 호출, Maestro 실행 중 screen). 도우미 때문인지 부팅 직후 불안정인지는 표본이 적어 모름.
- Maestro 실행 중 `screen` 때 Maestro 흐름 자체가 3번째에도 실패.
- QA는 로컬 e2e 대상이 없어 BLOCKED(에뮬레이터 시험은 각 verify 스크립트가 맡음).
## 앞으로 할 일
직접 확인할 것:
- 공개 저장소 push 뒤 GitHub Actions 전 작업이 초록인지 본다.
- Mac/Linux 에서 측정(T43), 소개 클립(T48) 확인.
- `check-coexist.mjs` 를 몇 번 더 돌려 실패가 도우미 탓인지 가린다.
정해야 할 것:
- 도우미가 3초 쥐는 정책을 바꿀지(측정 반복 뒤).
다음 후보:
- Maestro 기반 `run`/`sweep` (Phase 1): 핵심 기능이라 사람 리뷰와 함께.
- 0.2.0 배포: 공개 저장소에서 바로 릴리스.
- README 첫 화면 정리: 소개 문구를 바이브 코딩 중심으로.
- 시드 버그 벤치(Phase 2): mobile-mcp 단독 대비 효과 수치화.

## 결정 필요
- 도우미 공존 측정 실패(case a 부팅 직후 mcp, case f Maestro 중 screen)의 원인 가리기: T61(auto-plan)이 이미 다룬 빈틈이라 자동으로 다시 계획하지 않음. 반복 측정 + case f 경로 기록 + coexist.md 수기 문단 보존을 Todo 로 할지 사람이 정한다.

자동 계획: 더 만들 Todo 없음 (FR 전부 DONE 검증됨, T51 이후 UI 변경 없음, 남은 항목은 BLOCKED/사람 세션·사용자 결정 대기)
