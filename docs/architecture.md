# 구조

## 구성요소
- `src/cli.ts` 명령 진입점: up/down/prepare/identity/net/hammer/judge/measure/run. 모든 adb 는 `src/adb.ts` 가드(emulator-<port> 만).
- `src/emulator.ts` 에뮬레이터 숨김 기동 공용 함수(PowerShell Start-Process Hidden). `snapshot.ts`/`up.ts`/`measure.ts` 가 사용.
- `src/up.ts` + `profiles/galaxy.json` 기종·API 혼합 N대. 기종은 `wm size/density` 로 적용.
- `src/net.ts` 기기별 네트워크 상태(airplane/nodata/slow/flaky). `src/hammer.ts` 가상 사용자 N명 API 부하. `src/judge.ts` 규칙 판정.
- `src/scenario.ts` 다자 시나리오 실행기: up -> 앱 설치 -> 기기별 반복(시드 지연) + 네트워크 스케줄 -> outbox 비움 대기 -> judge -> down.
- `src/record.ts` 여러 기기 화면을 나란히 녹화(데모 GIF).
- `src/mcp.ts` `crewdroid mcp` stdio MCP 서버(공식 SDK `McpServer` + `StdioServerTransport`, `.mcp.json` 의 `crewdroid`). 도구 `devices`/`up`/`down`/`net`/`judge`/`hammer`/`run` 은 CLI 가 부르는 같은 함수를 감싼 얇은 래퍼(입력은 zod). 기능 모듈은 `export const mcpTools: Tool[]` 만 두면 `src/*.ts` 를 훑는 `serve()` 가 자동 등록(T20/T21/T22 의 env/app/triage/screen/perf/apk). 오류는 `isError: true` + CLI 와 같은 메시지, 긴 도구(`up`/`run`)는 `timeoutSec` 을 받고 진행 줄을 logging 알림으로 보낸다. stdout 은 프로토콜 전용이라 `console.log` 도 stderr 로 돌린다.
- `src/env.ts`(위치·배터리·회전·다크모드·글꼴·로케일·SMS/통화), `src/app.ts`(권한·딥링크·데이터 삭제·백업·자원 압박), `src/triage.ts`/`screen.ts`/`perf.ts`/`apk.ts`(진단), `src/fold.ts`(폴드/플립), `src/record.ts`(공용 녹화기), `src/slim.ts`(경량화). 모두 `src/adb.ts` 가드 경유.
- `sample/server` 샘플 서버(`BUGGY=1`), `probe-app/` 샘플 앱(outbox 오프라인 동기화).

## 데이터 흐름
앱(에뮬레이터, 10.0.2.2) -> 샘플 서버 -> 서버 데이터 파일 -> judge 규칙 -> 종료 코드·보고서(`docs/measurements/`).

## 배포
없음. `ai/work` push 후 autopilot 이 `main` 병합.

## 에이전트가 읽는 파일
- `AGENTS.md` 영문 단일 원본(Codex·Cursor·Copilot·Gemini 등). `CLAUDE.md` 첫 줄 `@AGENTS.md` 로 Claude Code 도 같은 내용을 읽는다(CLAUDE.md 가 있으면 AGENTS.md 는 무시되므로).
- `.agents/skills/<이름>/SKILL.md` 교차 호환 스킬 경로. 플러그인 `.claude-plugin/plugin.json` 의 `skills` 가 `./.agents/skills` 를 직접 가리켜 `skills/` 복사본은 없다.
- `.claude-plugin/plugin.json`(mcpServers -> `${CLAUDE_PLUGIN_ROOT}/bin/crewdroid.mjs mcp`) + `marketplace.json`(source `./`): `claude plugin marketplace add namyunsu/crewdroid` -> `claude plugin install crewdroid@crewdroid`. `.mcp.json` 은 저장소 안 작업용.
- 검사: `node scripts/check-agent-files.mjs`.
