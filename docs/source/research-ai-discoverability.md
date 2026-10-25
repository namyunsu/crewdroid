# crewdroid — AI 코딩 에이전트에게 발견·채택되는 배포 채널 조사 (2026-10-25)

전제: 저장소는 곧 GitHub 공개. 대상은 사람보다 에이전트(Claude Code·Cursor·Codex·Gemini/Antigravity CLI·Copilot). 검증 못 한 항목은 [unverified].

## 1. MCP 서버 배포

**공식 MCP Registry (registry.modelcontextprotocol.io)** — 메타데이터만 저장, 패키지는 npm에 먼저 공개(`registry.npmjs.org`만 허용). 절차: `package.json`에 `"mcpName": "io.github.<user>/crewdroid"` 추가 → `npm publish --access public` → `mcp-publisher init`(server.json 생성: `name`·`description`·`repository`·`version`·`packages[{registryType:"npm", identifier, version, transport:{type:"stdio"}}]`) → `mcp-publisher login github`(디바이스 코드) → `mcp-publisher publish`. `name`은 `mcpName`과 일치해야 하고 GitHub 인증이면 `io.github.<user>/` 접두 필수. [S1][S2] 설계상 호스트 앱이 직접 읽지 않고 **하위 집계기(마켓플레이스)가 주기적으로 끌어감**; 비공개 서버는 불가, 공개 설치 경로(npm)만 있으면 소스 비공개도 가능. 아직 preview(데이터 리셋 가능). [S3]

**집계기 현황**
- **PulseMCP**: 신규 제출 **중단** 중. "공식 Registry에 올려라, 재개 시 자동 수집" 명시. [S4]
- **Glama**: GitHub 공개 저장소 자동 색인(3rd-party 서술), `io.github.<user>/…` 네임스페이스를 GitHub 계정으로 "Claim"; Registry 연동 항목은 Registry 데이터가 이름·설명을 계속 덮어씀. [S5][S6]
- **Smithery**: 이제 GitHub 저장소 제출이 아니라 **공개 HTTPS 엔드포인트(Streamable HTTP) 또는 `.mcpb` 번들**만 받음. stdio 로컬 서버는 MCPB로 포장해야 함. [S7]
- **mcp.so**: 저장소 URL 폼 제출, 검토 있음; $39 내면 검토 없이 즉시·배지·우선 노출. 자체 공개 수치 연 2.2M 방문. [S8]
- **Cline Marketplace**: GitHub 이슈로 제출(저장소 URL·400×400 PNG·이유). 조건: "README.md(또는 llms-install.md)만 주고 Cline이 설치 성공하는지 테스트". 별 795, 이슈 2.9k 적체. [S9]
- **Cursor**: `cursor://anysphere.cursor-deeplink/mcp/install?name=<n>&config=<base64 mcp.json>` 딥링크를 README 버튼으로. 프로젝트 설정 `.cursor/mcp.json`. 디렉터리는 cursor.directory(커뮤니티). [S10][S11]
- **VS Code/Copilot**: 확장 뷰 `@mcp` 갤러리(GitHub MCP Registry 기반, 큐레이션). [S12]

**Claude Code**
- 프로젝트 `.mcp.json`(루트, `{"mcpServers":{…}}`) — 대화형 세션은 승인 프롬프트, `-p`/SDK는 묻지 않고 로드. [S13]
- 플러그인 = `.claude-plugin/plugin.json` + `skills/<n>/SKILL.md` + `agents/*.md` + `hooks/hooks.json` + 루트 `.mcp.json`(`${CLAUDE_PLUGIN_ROOT}`로 경로). `name`은 kebab-case, `claude-`·`anthropic-` 접두 금지. 플러그인 루트 `CLAUDE.md`는 로드 안 됨. [S14]
- 배포: 같은 저장소에 `.claude-plugin/marketplace.json`(`name`·`owner`·`plugins:[{name, source:"./"}]`) 넣으면 끝 → 사용자는 `claude plugin marketplace add <owner>/<repo>` + `claude plugin install crewdroid@<mkt>`(또는 `--marketplace` 한 줄). `claude plugin validate --strict .`로 검증. [S15][S16]
- 상위 채널: `claude-community`(anthropics/claude-plugins-community, 저자 제출·자동 검증), Anthropic 디렉터리(claude.ai/directory/manage — **유료 플랜 + GitHub 저장소 필요**). CLI가 `<claude-code-hint>`를 stderr로 내보내 설치 권유하는 기능은 **공식 마켓플레이스 등재 플러그인만**. [S16][S17][S18]

## 2. 에이전트용 저장소 파일

| 파일 | 읽는 에이전트 | 근거 |
|---|---|---|
| `AGENTS.md` | Codex(루트→cwd, 합계 32 KiB), Cursor, Gemini CLI(`context.fileName` 설정 시), Copilot(coding agent·code review), Jules·Devin·Windsurf 등 20+; AAIF/Linux Foundation 관리, 6만+ 프로젝트 | [S19][S20][S21][S22] |
| `CLAUDE.md` | Claude Code. **CLAUDE.md가 있으면 AGENTS.md를 무시**(v2.1.277+; 없을 때만 AGENTS.md). 둘 다 쓰려면 CLAUDE.md 첫 줄 `@AGENTS.md`. Copilot도 루트 CLAUDE.md 단일 파일 허용 | [S23][S22] |
| `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | Copilot 전용 | [S22] |
| `GEMINI.md` | Gemini CLI(문서에 "2026-06-18 무료 티어는 Antigravity CLI로 대체" 명시) | [S21] |
| `.cursor/rules/*.mdc` | Cursor 전용 | [S24, 포럼] |
| `llms.txt` | 문서 사이트용(Mintlify 등 자동 생성, Lighthouse 감사). 에이전트가 실제로 읽는다는 1차 증거 없음; WebFetch가 docs llms.txt 안내를 주입하는 정도. CLI 저장소엔 후순위 | [S25][S26] |

결론: **AGENTS.md 하나 + CLAUDE.md(첫 줄 `@AGENTS.md`)** 조합이 전 에이전트 커버.

## 3. Claude Code 스킬

- `SKILL.md` frontmatter: `name`(디렉터리명 기본), `description`(+`when_to_use` 합쳐 1,536자 컷, 자동 호출의 유일한 단서), `allowed-tools`, `disable-model-invocation`, `user-invocable`, `model`, `effort`, `context: fork`, `agent`, `paths`, `argument-hint`, `hooks`. 본문 500줄 이하 권장, 참고자료는 별도 파일. **타 플랫폼 호환 필드는 `name/description/license/compatibility/metadata/allowed-tools`뿐**. [S27]
- 위치: 개인 `~/.claude/skills/`, 프로젝트 `.claude/skills/`, 플러그인 `<plugin>/skills/`(`/plugin:skill`로 네임스페이스). [S27]
- 교차 호환: Cursor는 `.cursor/skills`·`.agents/skills`에 더해 `.claude/skills`·`.codex/skills`도 읽음 [S28]; Gemini는 `.gemini/skills`·`.agents/skills` [S29]; Copilot은 `.github/skills`(대안 `.claude/skills`·`.agents/skills`) [S30]; Codex는 `.agents/skills`(3rd-party) [unverified][S31]. → **`.agents/skills/`가 사실상 공통분모.**
- skills.sh(Vercel): `npx skills add <owner>/<repo>`로 18+ 에이전트에 설치, 설치 수 기반 리더보드. 공개 GitHub 저장소면 등재. [S32]

## 4. npm

- `mcpName`이 npm↔Registry 연결 규약(위). `bin` 있으면 `npx crewdroid`·`npx -y @scope/crewdroid@latest`가 README·mcpServers 블록의 표준 설치선. [S1]
- `keywords`를 에이전트가 검색한다는 근거 없음 [unverified]. 대신 TanStack Intent처럼 **npm 패키지 안에 스킬 동봉** 패턴이 생김(설치된 버전에 맞는 스킬 로드). [S32]

## 5. GitHub

- 토픽 규모: `mcp` 106,568 / `claude-code` 102,311 / `mcp-server` 39,979 저장소. mobile-mcp는 `agent, android, emulator, ios, mcp, mobile`. 추천: `mcp, mcp-server, claude-code, agent-skills, android, android-emulator, mobile-testing`. [S33][S34][S35][S36]
- awesome 목록: **punkpeye/awesome-mcp-servers**(96.8k) PR, 공개 GitHub 저장소 필수, 카테고리 내 알파벳순, 에이전트 PR은 제목 끝 `🤖🤖🤖`로 패스트트랙 [S37]; **wong2/awesome-mcp-servers**(4.4k) PR 불가, mcpservers.org/submit [S38]; **hesreallyhim/awesome-claude-code** 이슈 템플릿만(PR은 Claude만), 카테고리 Agent Skills·Tooling 등 [S39]; **travisvn/awesome-claude-skills**(15.6k) PR, 모바일 항목은 iOS 시뮬레이터 스킬뿐·Android 없음 [S40].

## 6. README 한 방 채택 요건

mobile-mcp(10k): 한 줄 `npx -y @mobilenext/mobile-mcp@latest` + 복붙용 `mcpServers` JSON + Install in Cursor/VS Code 버튼 + npm 다운로드 배지 + 데모 영상 + 5줄 기능표 [S36]. Maestro(16.2k): `curl … | bash` 한 줄 + GIF 2개(하나는 에이전트가 MCP로 검증하는 장면) [S41]. 기준은 Cline 규칙 그대로: **"README만 주고 에이전트가 설치·실행 성공"**. crewdroid엔 `docs/measurements` 표(부팅 시간·RAM·N대)와 `docs/demo` GIF가 이미 있으니 상단에 끌어올리면 됨.

## 7. 함정

- PulseMCP 제출 중단 / Smithery는 GitHub 저장소 경로 폐지(HTTP·MCPB만) / mcp.so 유료 우선 / Cline 적체.
- Anthropic 디렉터리: 유료 claude.ai 플랜 + GitHub 저장소 필요. `claude-code-hint`는 공식 마켓플레이스 전용.
- Registry: preview·리셋 가능, npm 공개 선행 → **저장소 공개 전엔 npm도 공개 못 하니 전부 공개 후**. awesome-mcp-servers도 공개 저장소 필수.
- CLAUDE.md가 있으면 AGENTS.md 무시 — import 한 줄 빠뜨리면 Codex/Claude 지시가 갈라짐.
- 플러그인 이름 `claude-*` 금지, 플러그인 루트 CLAUDE.md 무효, frontmatter 비호환 필드는 claude.ai 업로드 실패.
- Gemini CLI → Antigravity CLI 전환 중(문서 자체 명시) — GEMINI.md 전용 투자 비권장.

## 순위표

| 순위 | 채널 | 효과(근거) | 비용 | 공개 필요? |
|---|---|---|---|---|
| 1 | 저장소 자체: `AGENTS.md`+`CLAUDE.md(@AGENTS.md)`+`.agents/skills/`+`.mcp.json`+`.claude-plugin/{plugin,marketplace}.json` | 모든 에이전트가 클론 즉시 읽음(S19–S30); Claude Code는 `marketplace add owner/repo` 한 줄 | 반나절 | 예(클론 가능해야) |
| 2 | npm 공개 + `mcpName` + 공식 MCP Registry | 집계기(Glama·PulseMCP 재개·GitHub)가 자동 수집(S3,S4,S5) | 1시간 | npm 공개 |
| 3 | README: 한 줄 npx + mcpServers 블록 + Cursor 딥링크 + GIF + 측정표 | mobile-mcp·Maestro 패턴, Cline 심사 기준(S9,S36,S41) | 2시간 | 예 |
| 4 | GitHub 토픽 7개 | 토픽 10만+ 규모 검색면(S33–S35) | 5분 | 예 |
| 5 | skills.sh `npx skills add` | 18+ 에이전트 설치, 리더보드(S32) | 스킬 구조만 맞추면 0 | 예 |
| 6 | punkpeye/awesome-mcp-servers PR, travisvn/awesome-claude-skills PR | 96.8k·15.6k 별, Android 항목 공백(S37,S40) | 30분 | 예 |
| 7 | claude-community 제출 | Anthropic 검증 배지, `/plugin` Discover 노출(S17) | 1시간 | 예 |
| 8 | Glama claim, Cline 이슈, mcp.so 무료 제출 | 보조 노출; 적체·덮어쓰기 주의(S5,S8,S9) | 각 15분 | 예 |
| 9 | Anthropic 디렉터리 | claude.ai·Cowork·Claude Code 동기화 | 유료 플랜+심사 | 예 |
| — | Smithery, PulseMCP, llms.txt, GEMINI.md 전용 | 현재 폐쇄/전환/근거 부족 | — | — |

## 출처

- S1 https://modelcontextprotocol.io/registry/quickstart
- S2 https://modelcontextprotocol.io/registry/package-types
- S3 https://modelcontextprotocol.io/registry/about
- S4 https://www.pulsemcp.com/submit
- S5 https://glama.ai/mcp/connectors/ai.ambix/ambix (Claim FAQ)
- S6 https://tallyfy.com/how-to-list-mcp-server-registry-smithery-glama-pulsemcp/ (3rd-party)
- S7 https://www.smithery.ai/docs/build/publish.md
- S8 https://mcp.so/submit
- S9 https://github.com/cline/mcp-marketplace
- S10 https://cursor.com/docs/mcp/install-links.md · https://docs.cursor.com/deeplinks
- S11 https://cursor.com/docs/context/mcp
- S12 https://code.visualstudio.com/docs/copilot/customization/mcp-servers · https://github.blog/ai-and-ml/generative-ai/how-to-find-install-and-manage-mcp-servers-with-the-github-mcp-registry/
- S13 https://code.claude.com/docs/en/mcp
- S14 https://code.claude.com/docs/en/plugins-reference
- S15 https://code.claude.com/docs/en/plugin-marketplaces
- S16 https://code.claude.com/docs/en/plugins/publish
- S17 https://code.claude.com/docs/en/plugins/anthropic-marketplaces.md
- S18 https://code.claude.com/docs/en/plugins/cli-hints
- S19 https://agents.md/
- S20 https://learn.chatgpt.com/docs/agent-configuration/agents-md
- S21 https://geminicli.com/docs/cli/gemini-md/
- S22 https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- S23 https://code.claude.com/docs/en/memory
- S24 https://forum.cursor.com/t/using-github-copilot-instructions-md-for-ai-rules/154879 (포럼, 3rd-party)
- S25 https://llmstxt.org/
- S26 https://presenc.ai/research/state-of-llms-txt-2026 (vendor)
- S27 https://code.claude.com/docs/en/skills
- S28 https://cursor.com/docs/context/skills
- S29 https://geminicli.com/docs/cli/skills/
- S30 https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills
- S31 https://dev.to/skillgild/how-to-install-skills-in-codex-cli-ihf (3rd-party) · https://developers.openai.com/codex/skills
- S32 https://vercel.com/docs/agent-resources/skills · https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem
- S33 https://github.com/topics/mcp
- S34 https://github.com/topics/claude-code
- S35 https://github.com/topics/mcp-server
- S36 https://github.com/mobile-next/mobile-mcp
- S37 https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/CONTRIBUTING.md · https://github.com/punkpeye/awesome-mcp-servers
- S38 https://github.com/wong2/awesome-mcp-servers
- S39 https://mintlify.wiki/hesreallyhim/awesome-claude-code/contributing
- S40 https://github.com/travisvn/awesome-claude-skills
- S41 https://github.com/mobile-dev-inc/maestro
- S42 https://agentskills.io/ (스킬 표준 개요)
