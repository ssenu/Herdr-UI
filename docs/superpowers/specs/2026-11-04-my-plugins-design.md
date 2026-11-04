# Plugins 패널 (MCP · Skills 목록) — 설계

- 날짜: 2026-11-04
- 대상: 새 mod `mods/my-plugins`, `mods/my-tabs`, `install.ps1`, `README.md`, `package.json`, `tests/`
- 범위: **읽기 전용**. 켜기/끄기/삭제/설치는 하지 않는다(열린 세션에 바로 반영되지 않고, `~/.claude.json`은 실행 중인 Claude Code가 수시로 다시 써서 직접 고치면 충돌한다).

## 진입

- `my-tabs`: GitHub 버튼 옆에 **Plugin** 버튼(`panelButton("plugins", "Plugin", "mods/my-plugins/plugins.svg")`). `enabled` 목록에 `"plugins"`도 항상 넣는다.
- 레이아웃: `panel-body`의 `children` 끝에 `{ "id": "plugins", "type": "block", "content": { "mod": "my-plugins" } }`. `install.ps1`이 없으면 추가(멱등).

## 대상 (위치)

`location()`은 GitHub 패널과 같은 방식: 포커스된 칸의 `cwd`와 원격 머신 `on`(로컬이면 null).

- `home`: 그 머신의 홈. 로컬 Windows는 `USERPROFILE`, 원격/유닉스는 `$HOME`. 목록 스크립트 출력으로 받는다.
- `repo`: `git rev-parse --show-toplevel` (cwd 기준). git이 아니면 `repo = cwd`.

| | MCP | Skills |
|---|---|---|
| Claude | `home/.claude.json` `mcpServers` → `전역`<br>`home/.claude.json` `projects[cwd].mcpServers` → `로컬` (키는 cwd, 없으면 repo로도 찾음. Windows 경로는 `\`·`/`·대소문자 무시 비교)<br>`repo/.mcp.json` `mcpServers` → `프로젝트` | `home/.claude/skills/*/SKILL.md` → `전역`<br>`repo/.claude/skills/*/SKILL.md` → `프로젝트`<br>`home/.claude/plugins/installed_plugins.json` 각 항목 `installPath/skills/*/SKILL.md` → `플러그인:<이름>` (`이름` = `"superpowers@market"`의 `@` 앞) |
| Codex | `home/.codex/config.toml` `[mcp_servers.*]` → `전역`<br>`repo/.codex/config.toml` → `프로젝트` | `home/.agents/skills/*/SKILL.md` → `전역`<br>`cwd`부터 `repo`까지 각 폴더의 `.agents/skills/*/SKILL.md` → `프로젝트` |

- 시스템 스킬(Codex 내장), `/etc/codex/skills`는 범위 밖.
- 같은 이름이 여러 출처에 있으면 모두 보인다(출처 배지로 구분).
- 플러그인이 여러 버전(배열)이면 첫 항목만.

## 읽기

- 파일: `readTextFile(path, { on })`. 없으면 0개(오류 아님).
- 폴더 목록: 한 번의 명령으로 "스킬 폴더 → 하위 폴더 이름" 목록과 `home`을 받는다.
  - 원격/유닉스: `exec("sh", ["-c", script, "plugins", ...dirs], { on })`. `~`는 스크립트 안에서 `$HOME`으로.
  - 로컬 Windows: `exec("powershell", ["-NoProfile", "-Command", script])`, 출력은 UTF-8로 강제.
  - 출력 형식: 첫 줄 `HOME\t<경로>`, 이후 `DIR\t<스킬 폴더>\t<하위 이름>` 줄들. 파싱은 `logic.js`.
  - 경로는 sh에는 인자로 넘기고, PowerShell에는 작은따옴표 리터럴(`'` → `''`)로만 넣는다(따옴표·`&` 문제 방지).
- 순서: ① 목록 스크립트(home + 스킬 하위 폴더) → ② 설정 파일과 SKILL.md들을 병렬로 읽기.
- 새로고침: 패널이 보일 때(`visible()`, GitHub 패널과 같은 방식), 대상(cwd·on·에이전트)이 바뀔 때, ⟳ 버튼. 주기 polling 없음. 진행 중에 또 요청되면 끝난 뒤 한 번 더(`loading`/`again`).

## 파싱 (`logic.js`, 순수 함수)

- `claudeMcp(json, cwd, repo)` → `[{ name, source, config, file }]`. `source` ∈ `전역`/`로컬`/`프로젝트`.
- `parseToml(text)` → `[mcp_servers.<이름>]`과 `[mcp_servers.<이름>.env]` 같은 하위 표만 해석. 지원: 기본 문자열(`"…"`, 이스케이프 `\" \\ \n \t`), 리터럴 문자열(`'…'`), 정수, `true/false`, 한 줄·여러 줄 배열, 인라인 표 `{ k = v }`, 따옴표 친 키 `[mcp_servers."my.server"]`, `#` 주석. 그 밖의 줄은 무시. 해석 못 하는 값이 `mcp_servers` 안에 있으면 그 서버에 `error`.
- `codexMcp(toml)` → `[{ name, config, enabled }]` (`enabled = false`만 꺼짐).
- `frontmatter(md)` → `{ name, description, body }`. `---`로 시작하지 않으면 name은 폴더 이름, description 빈 값, body 전체. 값의 따옴표는 벗긴다. 여러 줄(`>`/`|`) description은 이어 붙인다.
- `serverSummary(config)` → `stdio <command> <args…>` 또는 `http <url>` (`type`이 `sse`면 `sse <url>`). 80자에서 자름.
- `redact(config)` → 깊은 복사. `env`, `headers`, `http_headers`, `env_http_headers`의 값, 그리고 키 이름에 `token|secret|key|password|auth`(대소문자 무시)가 들어간 문자열 값을 `••••`로.
- `sortItems(items)` → 출처 순서 `프로젝트` → `로컬` → `전역` → `플러그인:*`(이름순), 그 안에서 이름순.
- `dragText(item, agent)` → Claude 스킬 `/이름 `, Claude 플러그인 스킬 `/플러그인:이름 `, Codex 스킬 `$이름 `, MCP `이름 MCP `.
- `agentKind(agentName)` → 이름에 `codex`(대소문자 무시)가 있으면 `"codex"`, 아니면 `"claude"`.
- `listingLines(stdout)` → `{ home, dirs: Map<스킬 폴더, 하위 이름[]> }`.

## 화면 (`main.js`)

- 헤더: `Plugins` · `[Claude] [Codex]` 칩 · ⟳. 그 아래 `[MCP] [Skills]` 탭. 그 아래 작은 글씨로 폴더 이름(원격이면 `머신:경로`).
- 에이전트 선택: 포커스된 칸의 에이전트(GitHub 패널의 `target()`과 같은 방식으로 찾음)로 `agentKind`. 사용자가 칩을 누르면 그 칸(주소)에 있는 동안 유지. 포커스 칸이 바뀌면 다시 자동.
- 목록: 출처별 묶음 제목(`프로젝트` 등) 아래 행.
  - MCP 행: `이름` + 흐린 `serverSummary`. Codex `enabled=false`면 흐리게 + `꺼짐` 배지. `error`면 `읽지 못함` 배지.
  - 스킬 행: `이름` + 흐린 description 첫 줄.
  - 행 오른쪽 `⋯`(로컬일 때만): `openOverlay({ mod: "my-files-open", kind: "popup", width: 200, height: 136, props: { path, dir: false } })`. `path` = 스킬은 SKILL.md, MCP는 그 설정 파일. 클릭·mouse down 전파 막음.
- 상세: 행을 누르면 상세로 바뀌고 `← 목록`.
  - 스킬: `TextView.markdown`으로 frontmatter를 뺀 본문. 위에 이름·출처·경로.
  - MCP: `redact`한 설정을 `key: value` 줄로(중첩은 들여쓰기). 위에 이름·출처·파일.
  - 대상이 바뀌면 상세는 닫는다.
- 드래그: `my-github`와 같은 방식(`my-files-drag` 오버레이, 아이콘 `🧩`), 문구는 `dragText`.
- 빈 화면: 해당 탭에 항목이 없으면 `이 폴더와 전역에 MCP 서버가 없어요` / `… 스킬이 없어요`.

## 오류

- 파일 없음 → 0개.
- JSON/TOML 해석 실패 → 그 출처 묶음 자리에 `<파일 이름>을 읽지 못했어요` 줄, 나머지는 정상 표시.
- SKILL.md 읽기 실패 → 그 스킬은 폴더 이름만, description `읽지 못했어요`.
- 목록 스크립트 실패(원격 연결 불가 등) → 헤더 아래 오류 줄, 목록 비움.

## 테스트

`tests/my-plugins-logic.test.mjs` (`npm test`에 추가):

- `claudeMcp`: 전역·로컬(경로 표기 차이 포함)·프로젝트, `mcpServers` 없음.
- `parseToml`/`codexMcp`: 문자열 두 종류와 이스케이프, 배열(여러 줄), 인라인 표, 따옴표 키, 주석, `enabled=false`, 다른 표 무시, 깨진 값.
- `frontmatter`: 일반, 따옴표, 여러 줄 description, frontmatter 없음.
- `redact`, `serverSummary`, `sortItems`, `dragText`, `agentKind`, `listingLines`.

수동 확인: 이 PC(Claude 실제 설정), 임시 `~/.codex/config.toml`·`~/.agents/skills/test/SKILL.md`로 Codex 확인 후 삭제, 원격 스페이스(연결될 때).

## 문서

- README: mod 표, 기능 절(`Plugins 패널`), 요구 사항 없음(파일만 읽음), 제거 목록에 `my-plugins`, 레이아웃 수동 설치에 `plugins` 칸.
