# 구조

## 구성요소
- `src/cli.ts` 명령 진입점: up/down/prepare/identity/net/hammer/judge/measure/run. 모든 adb 는 `src/adb.ts` 가드(emulator-<port> 만).
- `src/emulator.ts` 에뮬레이터 숨김 기동 공용 함수(PowerShell Start-Process Hidden). `snapshot.ts`/`up.ts`/`measure.ts` 가 사용.
- `src/up.ts` + `profiles/galaxy.json` 기종·API 혼합 N대. 기종은 `wm size/density` 로 적용.
- `src/net.ts` 기기별 네트워크 상태(airplane/nodata/slow/flaky). `src/hammer.ts` 가상 사용자 N명 API 부하. `src/judge.ts` 규칙 판정.
- `src/scenario.ts` 다자 시나리오 실행기: up -> 앱 설치 -> 기기별 반복(시드 지연) + 네트워크 스케줄 -> outbox 비움 대기 -> judge -> down.
- `src/integrations/private-app.ts` private-app 스펙 실행·3대 화면 녹화(MVP).
- `sample/server` 샘플 서버(`BUGGY=1`), `probe-app/` 샘플 앱(outbox 오프라인 동기화).

## 데이터 흐름
앱(에뮬레이터, 10.0.2.2) -> 샘플 서버 -> 서버 데이터 파일 -> judge 규칙 -> 종료 코드·보고서(`docs/measurements/`).

## 배포
없음. `ai/work` push 후 autopilot 이 `main` 병합.
