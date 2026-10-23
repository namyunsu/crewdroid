# crewdroid — 시험 케이스

태그: `[verify]` 해당 Todo 의 verify 가 자동으로 확인 · `[e2e]` 여러 Todo 를 가로지름 · `[manual]` 사람이 확인.
UI·웹 서비스가 없어서 XSS·새로고침 연타 같은 웹 케이스는 해당 없음. 대신 잘못된 입력·안전 경계를 본다.

## FR-01 기준 측정
- 3대 동시 기동 후 대당 디스크·부팅·RAM·CPU 가 모두 0보다 큰 값으로 기록된다 `[verify]` T01
- old-avd-1~3 의 파일 수정 시각이 측정 전후로 같다(-read-only) `[verify]` T01
- 존재하지 않는 AVD 이름 → 0 아닌 종료 코드와 이름이 포함된 메시지 `[verify]` T01

## 안전 (전 FR 공통)
- `emulator-5580` 외 serial(`R3CT…`, `192.168.0.2:5555`, 빈 값) → adb 를 부르기 전에 예외 `[verify]` T01
- `crewdroid down` 이 crewdroid 가 띄우지 않은 에뮬레이터(5554, 5570 의 old-avd)를 끄지 않는다 `[verify]` T04

## FR-02 경량 이미지
- ATD 에서 카메라 촬영·사진 선택·업로드 각각 ok/fail 한 줄 `[verify]` T02

## FR-03 복제 고유값
- 복제 3대의 ANDROID_ID·MAC 이 서로 다르다(못 바꾸는 값은 이유가 문서에 있다) `[verify]` T03

## FR-04 혼합 기동
- 3대가 서로 다른 프로필·API 로 뜨고 `wm size/density` 가 프로필 값과 같다 `[verify]` T04
- 프로필 수보다 많은 N → 겹침 허용하되 같은 프로필+API 조합은 최소화 `[verify]` T04
- 측정 비교표에 기준 대비 디스크·부팅·RAM·CPU 증감이 있다 `[verify]` T04
- 삼성 실기기(Remote Test Lab)에서 `adb shell wm size` / `wm density` 를 찍어 `profiles/galaxy.json` 의 unverified 값을 채운다 `[manual]`

## FR-05 네트워크
- 비행기·데이터 끊김에서 업로드 실패, 느림에서 5배 이상 느림, 들락날락에서 실패 후 재시도 성공 `[verify]` T05
- 업로드 도중 끊김 → 서버에 반쪽 파일이 남지 않는다 `[verify]` T05
- 두 기기의 들락날락 일정이 서로 다르다 `[verify]` T05

## FR-06 AI 조작
- mobile-mcp 기기 목록에 crewdroid serial 이 보이고 접근성 스냅샷을 받는다 `[verify]` T06
- Maestro `--shard-all 2` 로 두 기종에서 같은 흐름 통과 `[verify]` T06

## FR-07 판정
- 버그 모드: 같은 멱등키 재시도 → 중복으로 보고, 오래된 버전 덮어쓰기 → lost update 로 보고, 종료 코드 1 `[verify]` T07
- 정상 모드: 위반 0, 종료 코드 0 `[verify]` T07
- 규칙 파일 문법 오류 → 위반이 아니라 설정 오류로 구분된 메시지 `[verify]` T07

## FR-08 API 동시 요청
- 버그 모드 50명×20회에서 5번 중 4번 이상 위반 발견, 정상 모드 5번 모두 통과 `[verify]` T08

## FR-09 오프라인
- 오프라인 저장 → 앱 재시작 → 재연결 후 서버 행 수가 정확히 기대값 `[verify]` T09
- 한쪽이 오프라인인 동안 같은 건 수정 → CONFLICT 한 줄 `[verify]` T09

## FR-10 다자 현장 시나리오
- 버그 모드 3 seed 중 2번 이상 위반 발견, 정상 모드 3번 모두 통과 `[verify]` T10
- 보고서에 기기별 프로필·API·네트워크 타임라인이 있다 `[verify]` T10

## FR-11 MVP
- crewdroid 기동으로 private-app techs.multi.ts 3회 연속 통과 `[e2e]` T11
- 전후 비교표(디스크·부팅·RAM·CPU·소요 시간) `[verify]` T11
- 데모 GIF 에서 3대가 서로 다른 기종 비율로 보이고 통화가 이어진다 `[manual]` T11
