# 0004 AI 에이전트 노출 채널 — 저장소 자체를 에이전트 친화적으로, 등록은 공개 뒤 사람이

- 날짜: 2026-10-26 · 상태: 확정 (사용자, /brief 문답) · 근거: `docs/source/research-ai-discoverability.md` (출처 42개)
- 결정: (1) 저장소 안에 `AGENTS.md` + `CLAUDE.md` 첫 줄 `@AGENTS.md` + `.agents/skills/` + `.mcp.json` + `.claude-plugin/{plugin,marketplace}.json` 을 둔다 — 클론 즉시 모든 에이전트가 읽는 공통분모. (2) crewdroid 는 stdio MCP 서버로도 돈다(공식 SDK). (3) npm 패키지(`crewdroid`, `mcpName io.github.namyunsu/crewdroid`) + MCP Registry `server.json` 을 준비하되, 공개 전환·`npm publish`·Registry/awesome/claude-community 등록은 사람이 `docs/release.md` 순서대로 한다. (4) LICENSE MIT.
- 뺀 것: Smithery(HTTP/MCPB 만 받음), PulseMCP(제출 중단), mcp.so 유료 우선, llms.txt(에이전트가 읽는 1차 근거 없음), GEMINI.md 전용(Antigravity CLI 전환 중).
- 이유: 집계기들은 공식 Registry 를 끌어가고, Registry 는 npm 공개를 전제하므로 공개 전 할 수 있는 건 저장소 파일뿐이다. CLAUDE.md 가 있으면 Claude Code 가 AGENTS.md 를 무시하므로 import 한 줄이 필수.
