# Handoff (2026-10-24 shift 70)
이번 shift(51~70): 일 안 함. 다른 세션이 T15 를 02:16 까지 계속 수정 중이고 에뮬레이터 프로세스도 떠 있음. 충돌 방지로 대기.
다음: 옛 세션 종료 후 T15 재개(미커밋 변경 src/avd.ts·cli.ts·snapshot.ts·slim.ts, scripts/check-disk.mjs 확인부터). 순서 T15 → T16 → T17 → T18 → T19.
T15 이어받기 메모:
- 이미지 sparse 완료(.sha256 있음): 31 4107→1267MiB, 34 8203→1235, 36 1811→1469.
- hw.ramSize=1536 은 API 34 에서 2560 으로 자동 상향됨 → RAM 으로 스냅샷 줄이기 안 통함 [확인함 qemu 로그].
- default_boot 에 ram.img+ram.bin 중복, 3개 합 ~11GB. ANDROID_SNAPSHOT_COMPRESS 지원 확인. 목표: ram.bin ≤ 0.6GB/개.
- %TEMP%\AndroidEmulator 에 죽은 클론 TMP*.qcow2 23개(~180MB).
- 증거: .ai-log/evidence/T15-2.txt. 포트 5599 점유 → --server-port 5595.
