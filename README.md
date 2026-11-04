# Herdr-UI

[Herdr](https://github.com/herdrdev/herdr) 데스크톱 앱을 더 편하게 쓰기 위한 mod 모음입니다.
오른쪽 패널의 Files를 편집 가능한 패널로 바꾸고, GitHub 이슈·PR 패널과 MCP·스킬 목록 패널을 추가합니다.

| mod | 하는 일 |
|---|---|
| `my-files` | 기본 Files 패널의 복제본. 파일 편집·저장, `.md` 보기 모드, 드래그로 경로 넣기 |
| `my-files-drag` | 드래그하는 동안 창 전체를 덮는 투명 레이어 (이름표 표시, 놓으면 붙여넣기) |
| `my-files-open` | 파일 행의 `⋯` 메뉴: 기본 프로그램 / VS Code / 탐색기에서 보기 / 경로 복사 |
| `my-github` | 현재 저장소의 GitHub 이슈·PR 패널 (gh CLI 사용) |
| `my-plugins` | 지금 폴더에서 Claude Code·Codex가 보는 MCP 서버와 스킬 목록 (읽기 전용) |
| `my-tabs` | 기본 탭 바의 복제본. Files · Changes 옆에 GitHub · Plugin 버튼 추가 |

## 기능

### Files 패널 (`my-files`)

- **편집과 저장**: 로컬 텍스트 파일을 패널에서 바로 고치고 **Ctrl+S**로 저장합니다.
  - 저장하지 않은 파일은 목록과 헤더에 **●** 가 붙습니다. 다른 파일이나 스페이스로 갔다 와도 고친 내용이 남아 있습니다(앱을 끄면 사라짐).
  - 다른 곳(에이전트, git 등)에서 파일이 바뀌면, 고치지 않은 파일은 화면이 자동으로 새로고침되고, 고친 파일은 **"디스크의 파일이 바뀌었어요"** 표시줄이 뜹니다. [내 것으로 덮어쓰기] / [디스크 버전 불러오기] 중 고릅니다.
  - CRLF 줄바꿈 파일은 CRLF로 저장됩니다.
- **읽기 전용 + nano**: 원격 스페이스(ssh 머신)의 파일과 400,000자가 넘는 파일은 읽기 전용입니다. **[nano로 열기]** 를 누르면 오른쪽에 칸을 나눠 nano로 엽니다.
- **`.md` 보기 모드**: `.md` / `.markdown` 파일은 렌더링된 화면으로 먼저 열립니다. 오른쪽 위 **[보기] [편집]** 으로 오갑니다. 편집 중인 내용(저장 전)도 보기에 반영됩니다.
- **외부 프로그램으로 열기**: 각 행 오른쪽의 **`⋯`** 를 누르면 [기본 프로그램으로 열기] [VS Code로 열기] [탐색기에서 보기] [경로 복사] 메뉴가 뜹니다. 폴더도 됩니다. 원격 스페이스에서는 보이지 않습니다.
- **[바탕화면]**: 헤더의 칩을 누르면 포커스된 칸 대신 바탕화면 폴더를 보여 줍니다. 다시 누르면 원래대로.
- **파일 찾기**: 목록 위 입력칸에 이름 일부를 치면 지금 폴더 아래 **모든 파일**(`.git` 제외)에서 퍼지 검색합니다(`mainjs` → `mods/my-files/main.js`). 공백으로 나누면 조각이 모두 맞아야 합니다. ↑/↓ 선택, Enter 열기, Esc 지우기. 결과 행도 클릭·드래그·`⋯` 가 트리와 같습니다. 처음 입력할 때 목록을 만들고, 폴더가 바뀌면 다음 입력 때 다시 만듭니다.
- **드래그로 경로 넣기**: 파일·폴더를 누른 채 패널 밖으로 끌어 터미널 위에서 놓으면, 마지막으로 선택한 터미널의 프롬프트에 **절대경로**가 입력됩니다(Enter는 누르지 않음). 공백 등이 있으면 `"따옴표"`로 감쌉니다. 패널 위로 돌아와 놓으면 취소.

### GitHub 패널 (`my-github`)

- 탭 바의 **GitHub** 버튼으로 엽니다. 포커스된 칸의 폴더가 속한 저장소를 보여 줍니다.
- **[이슈] [PR]** 탭과 **[전체] [내 것] [닫힘]** 필터. 최근 업데이트순 30개.
  - PR에는 초안 여부, 리뷰 상태(승인 / 변경 요청 / 리뷰 대기), CI 결과(✓ / ✗ / ●)가 표시됩니다.
- 항목을 누르면 본문과 코멘트를 마크다운으로 보여 주고, **[브라우저로 열기]** 가 있습니다.
- **에이전트에게 넘기기**
  - 포커스된 칸이 에이전트(Claude Code 등)면 **[→ Claude Code 입력창에 넣기]**: 작업 문구를 입력창에 넣습니다(Enter는 직접).
  - 아니면 **[새 탭에서 Claude 시작]**: `#번호 제목` 탭을 만들고 Claude가 그 문구로 바로 시작합니다.
  - 문구 예: ``GitHub 이슈 #12 "로그인 버그" 를 해결해줘. <url>`` + ``내용과 코멘트는 `gh issue view 12 --comments` 로 확인해.``
- **목록에서 드래그**: 행을 끌어 터미널 위에 놓으면 `이슈 #78 "제목" https://github.com/… ` 한 줄이 입력됩니다.
- 패널이 보일 때만 2분마다 새로고침합니다. 헤더의 ⟳ 로 바로 새로고침.

### Plugins 패널 (`my-plugins`)

- 탭 바의 **Plugin** 버튼으로 엽니다. 포커스된 칸의 폴더에서 에이전트가 쓰는 **MCP 서버**와 **스킬**을 보여 줍니다. 읽기만 하고 아무것도 바꾸지 않습니다.
- 헤더의 **[Claude] [Codex]**: 포커스된 칸이 Codex면 Codex, 아니면 Claude가 자동으로 골라집니다. 직접 눌러 바꿀 수 있습니다(다른 칸으로 가면 다시 자동).
- **[MCP] [Skills]** 탭. 출처별로 묶어 보여 줍니다.

  | | MCP | Skills |
  |---|---|---|
  | Claude | `~/.claude.json`(전역, 이 폴더의 로컬), 저장소의 `.mcp.json`(프로젝트) | `~/.claude/skills`(전역), 저장소의 `.claude/skills`(프로젝트), 설치된 플러그인의 `skills/`(플러그인:이름) |
  | Codex | `~/.codex/config.toml`(전역), 저장소의 `.codex/config.toml`(프로젝트) | `~/.agents/skills`(전역), 지금 폴더부터 저장소 루트까지의 `.agents/skills`(프로젝트) |

- MCP 행에는 실행 명령이나 URL이, 스킬 행에는 설명이 보입니다. Codex에서 `enabled = false` 인 서버는 `꺼짐`.
- 행을 누르면 상세: 스킬은 SKILL.md 본문(마크다운), MCP는 설정. **env·헤더·토큰 같은 비밀 값은 `••••` 로 가립니다.**
- **드래그**: 스킬 행을 터미널에 놓으면 Claude는 `/이름 `(플러그인은 `/플러그인:이름 `), Codex는 `$이름 ` 이 입력됩니다. MCP 행은 `이름 MCP `.
- 각 행의 **`⋯`**: SKILL.md 또는 설정 파일을 기본 프로그램 / VS Code / 탐색기로 엽니다(로컬만).
- 원격 스페이스에서는 그 머신의 설정을 읽습니다.
- 패널이 보일 때와 폴더·에이전트가 바뀔 때 다시 읽습니다. ⟳ 로 바로 새로고침.

## 요구 사항

- Herdr 앱 (0.1.12에서 확인). 설치 스크립트는 Windows(PowerShell)용입니다. 다른 OS는 [수동 설치](#수동-설치)를 보세요.
- GitHub 패널: [GitHub CLI](https://cli.github.com) `gh` 가 설치되고 로그인돼 있어야 합니다(`gh auth login`). 원격 스페이스에서 쓰려면 그 머신에도 gh가 있어야 합니다.
- [nano로 열기]: 그 머신에 `nano`가 있어야 합니다. Windows에서는 Git for Windows에 들어 있습니다.
- [VS Code로 열기]: `code` 명령이 PATH에 있어야 합니다(VS Code 설치 시 기본값).

## 설치 (Windows)

Herdr를 한 번 실행한 뒤:

```powershell
git clone https://github.com/ssenu/Herdr-UI.git
cd Herdr-UI
.\install.cmd            # 또는: powershell -ExecutionPolicy Bypass -File .\install.ps1
```

설치 스크립트가 하는 일:

1. `mods\` 의 여섯 mod를 `~\.config\herdr-app\mods\` 에 복사합니다.
2. 레이아웃 `my-layout` 을 고칩니다. 없으면 기본 레이아웃 `main` 을 `my-layout` 으로 복제한 뒤 고칩니다.
   - Files 칸: `files` → `my-files`
   - 탭 바: `tabs` → `my-tabs`
   - 오른쪽 패널(`panel-body`)에 `github` 칸(`my-github`) 추가
   - 오른쪽 패널(`panel-body`)에 `plugins` 칸(`my-plugins`) 추가
   - 고치기 전 파일은 `my-layout.json.bak-<시각>` 으로 백업합니다.
3. 지금 레이아웃이 `my-layout` 이 아니면 그 레이아웃으로 바꿉니다.

옵션:

```powershell
.\install.ps1 -Layout work      # 내 다른 레이아웃(layouts\work.json)에 연결
.\install.ps1 -ModsOnly         # mod만 복사하고 레이아웃은 건드리지 않음
```

Herdr 기본 레이아웃(`main`, `terminals`, `win98`)은 직접 고칠 수 없어서 대상으로 줄 수 없습니다.
mod와 레이아웃은 저장하면 바로 적용되므로 앱을 다시 켤 필요가 없습니다.

## 수동 설치

1. `mods/` 안의 여섯 폴더를 `~/.config/herdr-app/mods/` 에 복사합니다.
2. 쓰는 레이아웃(`~/.config/herdr-app/layouts/<이름>.json`, 기본 레이아웃이면 먼저 `herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`)에서:
   - `"mod": "files"` → `"mod": "my-files"`
   - `"mod": "tabs"` → `"mod": "my-tabs"`
   - `"id": "panel-body"` 의 `children` 끝에 추가:
     ```json
     { "id": "github", "type": "block", "content": { "mod": "my-github" } },
     { "id": "plugins", "type": "block", "content": { "mod": "my-plugins" } }
     ```
3. `herdr-app status` 의 `errors` 가 비어 있으면 됩니다.

## 업데이트

```powershell
git pull
.\install.cmd
```

mod는 덮어쓰고, 레이아웃은 이미 연결돼 있으면 그대로 둡니다(다시 실행해도 안전).

## 제거

1. 백업(`layouts\my-layout.json.bak-<시각>`)을 `my-layout.json` 으로 되돌리거나, 위 네 가지를 원래대로(`files`, `tabs`, github·plugins 칸 삭제) 고칩니다.
2. `~\.config\herdr-app\mods\` 에서 `my-files`, `my-files-drag`, `my-files-open`, `my-github`, `my-plugins`, `my-tabs` 폴더를 지웁니다.

## 알려진 한계

- 드래그로 넣는 경로·문구는 놓은 칸이 아니라 **마지막으로 선택한 터미널**에 들어갑니다(mod가 칸의 화면 위치를 알 수 없음). 그리고 **클립보드 내용이 바뀝니다**.
- 원격 파일은 패널에서 편집할 수 없습니다(nano로 엽니다). 저장하지 않은 편집 내용은 앱을 끄면 사라집니다.
- 파일 찾기는 폴더당 처음 50,000개 파일에서만 찾고, 결과는 200개까지 보여 줍니다. 링크·정션 폴더 안은 찾지 않습니다.
- `.md` 보기에서 상대경로 이미지·링크는 동작하지 않습니다.
- `my-files`, `my-tabs` 는 기본 mod의 복제본이라 Herdr가 기본 `files`/`tabs` 를 업데이트해도 자동으로 따라가지 않습니다.
- 탭 바를 `my-tabs` 로 바꾸면 스페이스별로 기억하던 패널 선택이 한 번 초기화됩니다.
- Plugins 패널은 읽기 전용입니다(켜기/끄기·삭제는 각 에이전트에서: Claude는 `/mcp`, `claude mcp remove`). Codex 시스템 스킬과 `/etc/codex/skills` 는 보이지 않습니다. 설정을 바꾼 뒤 열린 세션에 반영되는지는 에이전트에 달려 있습니다.
- Plugins 패널은 Claude 플러그인이 제공하는 MCP 서버와 꺼 둔 플러그인/서버 상태(`enabledPlugins`, `disabledMcpServers`)를 반영하지 않습니다. Codex의 `CODEX_HOME`은 무시하고 `~/.codex`를 읽으며, 원격 스페이스는 유닉스(sh) 머신으로 가정합니다.

## 개발

```powershell
npm test                                              # logic.js 단위 테스트 (Node 22+)
herdr-app check $env:USERPROFILE\.config\herdr-app\mods\my-files   # 설치된 mod 로드 확인
```

- 화면·herdr 호출은 각 mod의 `main.js`, 테스트 가능한 판단 로직은 `logic.js` 에 있습니다.
- `docs/superpowers/` 에 기능별 설계 문서와 구현 계획이 있습니다.
- Windows에서 gpui는 Ctrl 단축키를 `"ctrl-s"` 로 보고합니다(문서의 `"cmd-s"` 가 아님).

## 라이선스

Apache License 2.0 — [LICENSE](LICENSE), [NOTICE](NOTICE).
`my-files` 와 `my-tabs` 는 Herdr에 들어 있는 `files`, `tabs` mod(Apache-2.0)를 복제해 수정한 것입니다.
