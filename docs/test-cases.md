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

## FR-16 기기 환경 (`crewdroid env`)
- 위치·배터리·회전·다크·글자 크기·앱 로케일·gsm 상태를 걸면 되읽은 값이 같고 샘플 앱 `ENV` 로그가 일치한다 `[verify]` T20
- `battery 150`, `rotate 9`, serial `R3CT…` → adb 호출 전에 종료 코드 1 `[verify]` T20
- 3대 유휴 RAM 전후 차이가 +5 % 이내 (`features.md`) `[verify]` T20

## FR-17 앱 제어 (`crewdroid app`)
- 권한 부여→조회 granted=true→회수→false `[verify]` T21
- 커스텀 스킴 딥링크·강제 승인한 https App Link 가 샘플 앱에 도착해 `LINK` 로그 `[verify]` T21
- Doze 강제 → `dumpsys deviceidle` IDLE, standby rare → 버킷 40, 저장공간 2GB 채움 → `df` 감소 후 복구 `[verify]` T21
- ATD 에 LocalTransport 가 없으면 backup 은 이유와 함께 종료 코드 1 `[verify]` T21

## FR-18 진단
- 샘플 앱 크래시 유발 → `triage` 가 `ProbeActivity` 프레임이 있는 크래시 1건, ANR 유발 → ANR ≥ 1 `[verify]` T22
- `screen` 에 버튼 bounds 가 `wm size` 안, `perf` TotalTime>0·frames>0, `apk` 가 package·minSdk·권한을 읽음, 없는 파일 → 1 `[verify]` T22

## FR-19 MCP 서버
- stdio 클라이언트로 `listTools` 에 devices/judge/net/up, `judge` 도구가 위반을 돌려주고, serial `R3CT1234` 는 `isError` `[verify]` T24
- Claude Code 에서 `.mcp.json` 으로 붙여 `devices` 도구 호출 `[manual]` T24

## FR-20 에이전트 파일
- AGENTS.md 가 cli 의 모든 명령을 담고, CLAUDE.md 첫 줄 `@AGENTS.md`, `claude plugin validate --strict .` 통과 `[verify]` T25
- 다른 PC 에서 `claude plugin marketplace add namyunsu/crewdroid` 후 설치 (공개 뒤) `[manual]` T25

## FR-21 스킬
- 스킬 6개 frontmatter 규칙·150줄 이하·언급한 명령 존재, ```bash verify``` 블록 전부 기기에서 종료 코드 0 `[verify]` T26
- Claude Code 새 세션에서 "앱이 죽었어" 라고만 말해도 android-triage 가 트리거된다 `[manual]` T26

## FR-22 공개 준비
- 추적 파일(docs·.ai-log 제외)에 개인 경로·계정·PC명·USB serial 없음, LICENSE MIT, README 필수 블록, `npm pack` 후 `npx crewdroid --help`, server.json 일치 `[verify]` T27
- 공개 전환·npm publish·Registry 등록은 `docs/release.md` 순서대로 사람이 `[manual]` T27

## FR-23 데모 GIF
- 3패널 모두 살아 있고 비율이 다르며, ≤ 3MB·≤ 20초, private-app 화면 없음 `[verify]` T29

## FR-24 멱등키
- 정상 모드 같은 키 PUT 2회 → 같은 버전·쓰기 로그 1줄, 다른 키 → 버전 2개, BUGGY → 버전 2개 `[verify]` T23

## FR-25 API 31 SurfaceView
- API 31·34 에서 SurfaceView 영역 screencap 이 단색이 아니거나, API 31 이 `surfaceView:false` + WARN 줄 `[verify]` T28

## FR-26 setup
- 이미 설치된 PC 에서 `setup` → 전부 present, 다운로드 없음 `[verify]` T35
- 빈 폴더 `--dry-run` → 단계·크기만, 폴더 비어 있음; `--only cmdline-tools,platform-tools --yes` → adb 실행됨; `--yes` 없이 비대화형 → 1 `[verify]` T35
- 깨끗한 Linux/mac 에서 `npx crewdroid setup --yes` 후 `crewdroid up` `[manual]` T35

## FR-27 1대 up
- 인자 없는 `up` → 1대(s24ultra, API 34/36), `--api 31` → API 31, `--api 99` → 1, `devices` 에 보임, 1대 기동 시간 3회 기록 `[verify]` T36

## FR-28 설치·실행·로그
- 설치 성공/APK 아닌 파일 실패, launch 액티비티 자동 찾기, `--restart` 로 크래시 감지, logs 가 그 앱 줄만 `[verify]` T37

## FR-29 캡처·입력
- shot PNG 크기 = wm size·단색 아님, MCP shot 이 이미지로 옴, 특수문자 입력·버튼 누르기·스크롤 끝·뒤로 가기, 후보 없음·화면 밖 좌표 → 1 `[verify]` T38
- 한글 입력: 되거나 이유와 함께 실패(결과 기록) `[verify]` T38

## FR-30 바이브 코딩 루프
- MCP 만으로 up→install→launch→shot→screen→type→tap→logs→restart crash→down, 전체 시간 기록 `[verify]` T39
- Claude Code 새 세션에서 "내 안드로이드 앱 띄워서 화면 봐 줘" 로 android-vibe-loop 이 트리거 `[manual]` T39

## FR-31 소개
- README 첫 화면에 pitch·4줄 시작·GIF, README 명령이 전부 실제 명령, 표의 숫자마다 측정 파일 링크 `[verify]` T40

## FR-32 0.2.0
- 1패널 데모 GIF 살아 있음·≤3MB·≤25초, 버전 0.2.0 일치 `[verify]` T41
- 사무실 PC 에서 `npm publish` + `mcp-publisher publish` `[manual]` T41

## FR-33 macOS·Linux
- OS 전용 코드가 src/platform.ts 밖에 없음, 플랫폼 주입 단위 테스트, Windows 회귀 없음 `[verify]` T43
- Apple Silicon Mac 에서 setup → up → shot → down, 시간 기록 `[manual]` T43
- Linux(KVM) 에서 같은 흐름 `[manual]` T43

## FR-34 소개 모션 그래픽
- 15초±1, ≤5MB, 장면 5개 모두 단색 아니고 서로 다름, 장면 2 숫자 = single.md `[verify]` T44
- GitHub 라이트·다크에서 보고 15초 안에 무슨 도구인지 알겠는지 `[manual]` T44
- 데모 앱 클립 5개(기동·AI 조작·오프라인·접기·다크)가 실제로 움직이고 잘림·대비 문제 없음 `[verify]` T48
- 소개 영상 v2: 15초 중 11초 이상 실제 녹화, 장면 안에서도 움직임, 터미널 명령이 클립과 일치 `[verify]` T50; 사용자가 보고 OK `[manual]` T50
