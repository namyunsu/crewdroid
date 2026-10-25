# Handoff (2026-10-26, shift 1 of 2026-10-26 run)
완료: T16(RAM 3998~4197 MiB, 녹화 pull 재시도 src/record.ts), T23(샘플 서버 멱등키), T24(crewdroid mcp 서버).
다음: batch 2 = T17(옛 AVD 삭제, T16 APPROVE 됨) + T27(공개 준비), batch 3 = T22 + T25, 이후 T26.
알아둘 것:
- mvp-private-app 가 -lowram 설정에서 3번 중 1번 채팅 15초 초과로 실패. mvp --runs 3 로 확인 필요 [모름].
- ram.md 표는 3930(시도1), ram.json 은 4197/3998 — 4300 MiB 기준 통과. GB(10진)로는 4.4 GB.
- 워커 워크트리는 ai/work 위로 옮겨 시작시킬 것, ISB_PRIVATE_APP_SERVER 지정 필요.
- 포트 5599 점유 가능 → --server-port 5595.
