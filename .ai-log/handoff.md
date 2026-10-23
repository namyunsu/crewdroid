# Handoff (2026-10-24, shift 7)
이번 shift: 일 못 함. 옛 shift(claude -p, PID 28620, 10-23 22:14 시작)와 그 T15 작업자가 아직 살아서 src/snapshot.ts 를 고치고 에뮬(포트 5580)을 돌림. 새 작업자를 같이 돌리면 AVD 가 깨져 중단. 누구도 죽이지 않음.
다음: 옛 shift 가 끝나거나 사람이 PID 28620 을 정리한 뒤 T15 재개 (T15 → T16 → T17 → T18 → T19).
T15 이어받기 메모:
- 이미지 sparse 완료(.sha256 있음): 31 4107→1267MiB, 34 8203→1235, 36 1811→1469.
- hw.ramSize=1536 은 API 34 에서 2560 으로 자동 상향됨 → RAM 으로 스냅샷 줄이기 안 통함 [확인함 qemu 로그].
- default_boot 에 ram.img+ram.bin 중복, 3개 합 ~11GB. ANDROID_SNAPSHOT_COMPRESS 지원 확인. 목표: ram.bin ≤ 0.6GB/개.
- %TEMP%\AndroidEmulator 에 죽은 클론 TMP*.qcow2 23개(~180MB).
- 증거: .ai-log/evidence/T15-2.txt. 포트 5599 점유 → --server-port 5595.
