# 공개 체크리스트 (사람만 하는 단계)

에이전트는 아래를 실행하지 않는다. 순서대로 직접 한다. 시작 전에 `node scripts/check-public.mjs` 가 `OK: public-release checks passed` 를 내는지 확인한다.

## 0. 공개 전에 결정할 것

`check-public.mjs` 의 스크럽은 `docs/**`, `.ai-log/**` 와 몇 개 파일을 보지 않는다. 저장소를 공개하면 그대로 보이므로 지울지 남길지 정한다.

- `CLAUDE.md`: 프로젝트 지시문에 `private-app` 와 `<private-app repo>` 경로가 있다. 스크럽에서 일부러 뺐다. T25 가 첫 줄을 `@AGENTS.md` 로 줄이면 사라진다. 안 줄었으면 이 줄을 지운다.
- `docs/` 에서 `private-app`, PC 이름(`NYS`), 계정(`jjkng`), 로컬 경로가 나오는 파일: `docs/adr/0001-stack.md`, `docs/architecture.md`, `docs/infra.md`, `docs/measurements/mvp.json`, `docs/measurements/mvp.md`, `docs/measurements/ram.md`, `docs/measurements/slim.md`, `docs/prd.md`, `docs/source/requirements-2026-10-23.md`, `docs/sources.md`, `docs/test-cases.md`, `docs/todo-archive.md`, `docs/todo.md`.
- `.ai-log/` 에서 같은 문자열이 나오는 파일: `friction.md`, `REPORT.md`, `heartbeat-NYS-Desktop.md` (파일 이름이 PC 이름이다).
- 다시 찾기: `grep -rlE "private-app|NYS|jjkng|D:.workspace|C:.Users" docs .ai-log`
- 지우려면 파일을 지우거나 고친 뒤 커밋한다. 이미 올라간 기록까지 지우려면 공개 전에 `git filter-repo` 로 이력을 다시 쓴다 (공개 뒤에는 늦다).
- `src/integrations/private-app.ts` 와 `scripts/mvp-private-app.mjs` 는 다른 사람 PC 에서 쓸 수 없다. 남길지 정한다.

## 1. 저장소 공개

```bash
gh repo edit namyunsu/crewdroid --visibility public --accept-visibility-change-consequences
```

## 2. npm 배포

```bash
npm login
npm publish --access public
npx -y crewdroid --help   # up 과 mcp 가 보여야 한다
```

## 3. MCP Registry

`server.json` 의 `name` 은 `package.json` 의 `mcpName` 과 같아야 하고, npm 에 올라간 뒤에만 통과한다.

```bash
mcp-publisher init
mcp-publisher login github
mcp-publisher publish
```

## 4. GitHub topics (7개)

```bash
gh repo edit namyunsu/crewdroid --add-topic android --add-topic emulator --add-topic mcp --add-topic mcp-server --add-topic claude-code --add-topic agent-skills --add-topic mobile-testing
```

## 5. 목록 등록 PR

### punkpeye/awesome-mcp-servers

- 제목: `Add crewdroid`
- 본문: `crewdroid: multi-user Android field lab for AI agents. Boots N headless emulators with mixed Galaxy profiles and Android versions, sets per-device network states, and judges server data for duplicate / missing / overwrite bugs. MCP server: npx -y crewdroid mcp. MIT.`
- 한 줄 (Developer Tools 또는 비슷한 분류, 알파벳 순): `- [namyunsu/crewdroid](https://github.com/namyunsu/crewdroid) 📇 🏠 🪟 🐧 - Multi-user Android emulator lab: mixed Galaxy profiles, per-device network states, concurrency judging.`
- 분류와 아이콘 규칙은 PR 올리기 전에 그 저장소 README 맨 위 범례로 다시 맞춘다.

### travisvn/awesome-claude-skills

- 제목: `Add crewdroid (Android multi-user testing skill)`
- 본문: `crewdroid ships Agent Skills for Android debugging and offline-sync concurrency testing on N headless emulators (crash/ANR triage, deep links, jank, offline outbox duplicates and lost updates). Install: claude plugin marketplace add namyunsu/crewdroid. MIT.`

## 6. claude-community 제출

Claude Code 플러그인 마켓에 올리는 단계다. 제출 양식과 요구 항목은 공개 직전에 공식 문서에서 확인한다 (바뀔 수 있어 여기에 적지 않는다). 플러그인 이름 `crewdroid`, 마켓 `crewdroid`, 저장소 `namyunsu/crewdroid` 를 쓴다. 설치 확인:

```bash
claude plugin marketplace add namyunsu/crewdroid
claude plugin install crewdroid@crewdroid
```

## 7. Cursor 딥링크 만들기

README 의 링크를 바꿀 때만 한다 (설정을 base64 로 넣는다).

```bash
node -e 'console.log("cursor://anysphere.cursor-deeplink/mcp/install?name=crewdroid&config=" + Buffer.from(JSON.stringify({command:"npx",args:["-y","crewdroid","mcp"]})).toString("base64"))'
```

현재 값 `config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImNyZXdkcm9pZCIsIm1jcCJdfQ==` 이 위 설정과 같다.

## 8. 0.2.0 배포 (0.1.0 이 이미 나간 뒤)

`package.json` 과 `server.json` 은 이미 0.2.0 이고 `CHANGELOG.md` 에 0.2.0 항목이 있다. 시작 전에 `node scripts/check-public.mjs` 가 `OK: public-release checks passed` 를 내는지 확인한다.

회사 PC (npm 배포; 브라우저 승인이 필요하다):

```bash
git pull
npm publish --access public   # 브라우저가 열리면 승인
npx -y crewdroid@0.2.0 --help
```

아무 PC (npm 에 0.2.0 이 올라간 뒤에만 통과한다):

```bash
mcp-publisher login github
mcp-publisher publish
```
