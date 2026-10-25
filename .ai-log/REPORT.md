# crewdroid · 2026-10-26 07:55
## 작업 내역 요약
완료 29 / BLOCKED 2 / 전체 31 · dev URL 없음(로컬 CLI)
## 이제 되는 것
- `crewdroid env <serial> <geo|battery|rotate|dark|font|locale|sms|call>`: 에뮬레이터의 위치·배터리·회전·다크모드·글꼴·언어·문자·전화를 한 줄로 바꾼다.
- `crewdroid app <serial> perm|open|links|clear|backup|pressure|fill-storage`: 앱 권한, 딥링크, 데이터 삭제, 백업, 메모리·저장공간 압박을 건다.
- `crewdroid perf` 가 API 31 기기에서 화면을 검게 만들지 않는다(앱을 껐다가 2초 뒤 다시 시작).
- AGENTS.md 명령 표가 실제 CLI 와 맞고, 어긋나면 `node scripts/check-agent-files.mjs` 가 실패한다.
## 알아둘 것
없음
## 페인포인트
- BLOCKED: 옛 AVD 3대 + android-33 이미지 삭제 — 삭제 명령이 자동 권한 분류기에 거부됨.
- BLOCKED: 공개용 데모 GIF — 샘플 앱 화면이 정지라 녹화에 움직임이 없음(probe-app 수정 필요).
- QA: 로컬 e2e 대상이 없어 건너뜀(ENV_NO_E2E_TARGET).
## 앞으로 할 일
직접 확인할 것:
- `.agents/skills/android-perf/SKILL.md:60` 에 `am start -S -W` 가 남아 있음(스킬 수정은 승인 필요) [확인함]
- `docs/measurements/features.md` 자동 행 라벨이 "T22" 로 찍힘 [확인함]
정해야 할 것:
- 옛 AVD(old-avd-1~3)와 android-33 google_apis 이미지를 직접 지울지(디스크 확보)
- 데모 GIF 를 위해 probe-app 에 주기 갱신 UI 를 추가해도 되는지
다음 후보:
- 데모 GIF 재시도: 공개 README 노출에 필요
- 샘플 서버 PUT 멱등성 수정: 응답 유실 재시도가 가짜 충돌로 보임
- 영문 README·공개 준비 점검(`check-public`)
- 느린 망 2MB 업로드 120초 미동기화 원인 조사(재현 조건 필요)
