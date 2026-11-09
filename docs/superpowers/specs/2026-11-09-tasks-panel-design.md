# Task 패널: Google Tasks 연동 — 설계

- 날짜: 2026-11-09
- 대상: `mods/my-tasks/` (새 mod), `mods/my-tabs/main.js`, `install.ps1`, `README.md`, `tests/my-tasks-*.test.mjs`
- 범위: Google Tasks의 목록과 할 일을 보고, 추가·완료·편집·삭제·순서 변경·하위 할 일·목록 관리를 한다. Google Keep은 하지 않는다(공식 API가 Workspace 전용이고, 개인 계정용은 비공식 라이브러리뿐이다). 할 일을 에이전트 입력창에 넣는 버튼은 이번에 넣지 않는다.

## 확인한 것

- Google Tasks API는 개인 Gmail 계정에서 OAuth로 쓸 수 있다. 권한 범위 `https://www.googleapis.com/auth/tasks` 하나로 목록·할 일 읽기와 쓰기가 모두 된다.
- 마감일(`due`)은 날짜만 저장된다. 시간은 버려진다.
- 하위 할 일은 한 단계까지다(`parent`가 있는 할 일은 부모가 될 수 없다).
- 순서는 `tasks.move`의 `parent`, `previous`로 바꾼다. 목록 읽기는 한 번에 최대 100개, 그 뒤는 `nextPageToken`.
- OAuth 동의 화면이 "외부 · 테스트" 상태면 refresh token이 7일 뒤 만료된다. "프로덕션"으로 바꾸면 만료되지 않고, 로그인할 때 "확인되지 않은 앱" 경고가 뜬다.
- mod의 `exec`는 30초 제한이 있다. 사용자가 브라우저에서 허용을 누르는 시간은 이보다 길 수 있다.
- mod에는 `InputState`/`Input`(한 줄), `Editor`(여러 줄)가 있다(`my-files`가 쓴다).
- Node.js는 사용량 요약(ccusage) 때문에 이미 요구 사항이다. Node 18 이상의 내장 `fetch`를 쓰므로 `npm install`이 없다.

## 화면

```
┌ Task ─────────────────────────── ⟳ ┐
│ [내 할 일 ▾]               [+] [⋯]  │
│ ┌ 새 할 일 추가…                ┐   │
│ ○ 로그인 버그 고치기        11/12   │
│   메모 첫 줄이 흐리게…              │
│    ○ 하위 할 일                     │
│ ○ README 정리                       │
│ ▸ 완료됨 (5)                        │
└─────────────────────────────────────┘
```

- 탭 바의 패널 버튼 **Task**(Session 옆, 아이콘 `tasks.svg`). 패널 칸 id는 `tasks`.
- 맨 위: 목록 고르기(`[목록 이름 ▾]`, 눌러서 펼치는 목록), `[+]` 새 목록, `[⋯]` 메뉴(목록 이름 바꾸기, 목록 삭제, 로그아웃), `⟳` 새로 읽기.
- 그 아래 한 줄 입력칸 "새 할 일 추가…". Enter로 목록 맨 위에 추가한다. 빈 칸이면 아무것도 하지 않는다.
- 행: `○ 제목`과 오른쪽에 마감일(올해면 `M/D`, 다른 해면 `YYYY/M/D`, 지난 날짜는 경고 색). 메모가 있으면 첫 줄을 흐리게 한 줄 더. 하위 할 일은 한 단계 들여 쓴다.
- 미완료 할 일 아래 `▸ 완료됨 (N)`. 기본으로 접혀 있고, 누르면 펼친다(완료 시각 최신순, 들여쓰기 없이). 펼침 상태는 기억하지 않는다.
- 마지막으로 고른 목록은 `localStorage`에 기억한다. 그 목록이 없어졌으면 첫 번째 목록을 고른다.

## 조작

- **완료/되돌리기**: `○`를 누르면 완료, 완료됨의 `✓`를 누르면 미완료.
- **행에 마우스를 올리면** `[↑] [↓] [⇥] [⇤] [🗑]`. 해당하지 않는 버튼은 숨긴다.
  - `↑`/`↓`: 같은 부모 안에서 한 칸 위/아래. 첫 행이면 `↑`, 마지막 행이면 `↓`를 숨긴다.
  - `⇥`: 바로 위 형제의 하위로 넣는다(그 형제의 하위 끝으로). 하위 할 일, 하위가 달린 할 일, 같은 단계의 첫 행에서는 숨긴다.
  - `⇤`: 하위에서 빼서 부모 바로 다음에 둔다. 최상위 할 일에서는 숨긴다.
  - 완료됨의 행에는 `[🗑]`만 있다.
- **편집**: 행(체크 표시와 버튼 밖)을 누르면 그 자리에서 펼쳐진다. 제목(한 줄), 메모(여러 줄), 마감일(`YYYY-MM-DD`, 비우면 없음) 칸과 `[저장] [취소]`. 마감일 형식이 틀리면 저장하지 않고 칸 아래에 "YYYY-MM-DD로 적어 주세요". 한 번에 한 행만 펼친다. 다른 항목을 펼치면 앞의 편집은 버린다.
- **삭제 확인**: 행 자리에 `"제목"을 지울까요? [삭제] [취소]`. 하위가 있으면 `하위 N개도 함께 지워져요.`를 덧붙인다.
- **목록**: `[+]`는 맨 위에 이름 입력칸을 띄우고 Enter로 만든 뒤 그 목록을 고른다. `[⋯] › 이름 바꾸기`도 같은 입력칸. `[⋯] › 목록 삭제`는 `"목록 이름" 목록과 할 일 N개를 지울까요? [삭제] [취소]`.
- **새로 읽기**: 패널이 처음 보일 때, `⟳`, 패널이 보이는 동안 120000 ms마다. 편집 중이거나 실행 중인 동작이 있으면 자동 새로 읽기는 건너뛴다.

## 로그인

- 준비(README에 안내, 사용자가 한 번): Google Cloud 프로젝트에서 Tasks API 켜기 → OAuth 동의 화면(외부, 게시 상태 "프로덕션") → OAuth 클라이언트 "데스크톱 앱" 만들어 JSON을 `~/.config/herdr-app/my-tasks/client.json`에 저장.
- 로그인 전 화면: "Google 계정 연결이 필요해요", 준비 3단계 요약, `[로그인]`. 클라이언트 파일이 없으면(`no-client`) 그 경로를 보여 주고 `[로그인]` 대신 `[다시 확인]`.
- `[로그인]` → `node tasks.mjs login`을 `exec`의 `timeout: 310000`으로 실행한다(`exec`는 최대 600000 ms까지 기다릴 수 있으므로 분리된 자식 프로세스가 필요 없다). 이 명령은 `127.0.0.1`의 임의 포트에서 응답을 기다리며(PKCE, `state` 확인), 브라우저를 스스로 연다(Windows `rundll32 url.dll,FileProtocolHandler`, macOS `open`, Linux `xdg-open`). 코드를 토큰으로 바꿔 `token.json`에 쓰고 `{"ok":true}`를 낸 뒤 끝난다. 300초가 지나면 오류로 끝난다. 브라우저 창에는 "연결됐어요. 이 창을 닫아도 돼요" 또는 실패 이유를 보여 준다.
- 기다리는 동안 화면은 "브라우저에서 허용해 주세요… [취소]". `[취소]`는 결과를 버릴 뿐이다(보조 스크립트는 300초 뒤 스스로 끝난다). 성공하면 목록을 읽는다.
- `logout`: Google에 토큰 취소 요청을 보내고(실패해도 진행) `token.json`을 지운다.
- 파일은 모두 `~/.config/herdr-app/my-tasks/`(`client.json`, `token.json`). 저장소에는 들어가지 않는다.

## 보조 스크립트 (`mods/my-tasks/tasks.mjs`)

명령:

| 분류 | 명령 |
|---|---|
| 계정 | `status`, `login`, `logout` |
| 목록 | `lists`, `list-add <제목>`, `list-rename <id> <제목>`, `list-delete <id>` |
| 할 일 | `tasks <목록>`, `add <목록> <제목> [--parent <id>]`, `update <목록> <id> <json>`, `done <목록> <id>`, `undone <목록> <id>`, `delete <목록> <id>`, `move <목록> <id> [--parent <id>] [--previous <id>]` |

- 출력은 언제나 stdout에 JSON 한 줄: 성공 `{"ok":true,"data":...}`, 실패 `{"ok":false,"error":{"kind":"...","message":"..."}}`. 종료 코드는 둘 다 0(오류는 JSON으로 말한다).
- `kind`: `no-client`(클라이언트 파일 없음·읽을 수 없음), `no-login`(토큰 없음), `expired`(refresh가 `invalid_grant`), `network`(fetch 자체 실패), `api`(그 밖의 HTTP 오류, `message`는 Google의 `error.message`), `usage`(잘못된 인자).
- 명령마다 access token의 만료 60초 전부터는 먼저 갱신해 `token.json`을 다시 쓴다.
- `tasks`: `showCompleted=true`, `showHidden=true`, `maxResults=100`, 페이지를 끝까지 읽는다. 돌려주는 필드: `id`, `title`, `notes`, `due`, `status`, `completed`, `parent`, `position`.
- `update`의 `<json>`은 `{title?, notes?, due?}`. `due`는 `YYYY-MM-DD` 또는 `null`. API에는 `YYYY-MM-DDT00:00:00.000Z`로 보낸다.
- `done`은 `status: "completed"`, `undone`은 `status: "needsAction", completed: null`로 patch.
- mod는 스크립트 경로를 처음 한 번 `node -e`로 앱 폴더(`HERDR_APP_HOME`, 없으면 `~/.config/herdr-app`)를 물어 `<앱 폴더>/mods/my-tasks/tasks.mjs`로 정한다. 스크립트는 자기 위치에서 `../../my-tasks/`를 설정 폴더로 쓴다(설치본이면 `<앱 폴더>/my-tasks/`).
- 자유 문자열(제목, json)은 `--` 뒤에 둔다. 플래그는 `--` 앞에만 온다.
- mod는 항상 이 PC에서 실행한다(`on`을 주지 않는다). 할 일은 계정의 것이라 스페이스의 머신과 상관없다.

파일 나누기:

- `mods/my-tasks/main.js`: 화면과 상태.
- `mods/my-tasks/logic.js` (순수): `buildTree(tasks)` → 미완료 트리(`position` 순, 부모 없는 하위는 최상위로)와 완료 목록; `moveArgs(tree, id, dir)` → `dir`이 `up|down|indent|outdent`일 때 `{parent, previous}` 또는 `null`(할 수 없음); `canMove(tree, id, dir)`; `dueLabel(due, today)` → `{text, overdue}`; `parseDue(text)` → `YYYY-MM-DD | null | undefined`(틀린 형식); `errorText(error)`.
- `mods/my-tasks/google.mjs`: OAuth(주소 만들기, 코드 교환, 갱신, 취소)와 REST 요청. `fetch`와 파일 읽기·쓰기를 인자로 받아 테스트에서 바꿔 끼운다.
- `mods/my-tasks/tasks.mjs`: 인자 해석과 출력만.

## 동작 중 상태와 오류

- 완료/되돌리기는 화면에 먼저 반영하고 실행한다. 실패하면 되돌리고 오류를 보인다.
- 그 밖의 동작은 해당 행(또는 목록 줄)에 `…`를 표시하고 실행한 뒤, 끝나면 성공·실패 모두 목록을 다시 읽는다.
- 동작은 큐에 넣어 한 번에 하나씩, 누른 순서대로 실행한다. `moveArgs`는 실행 직전의 최신 트리로 계산한다.
- 오류는 패널 맨 위 한 줄: `⚠ 이유 [다시 시도] [닫기]`. `[다시 시도]`는 마지막으로 실패한 명령을 다시 실행한다.
- `errorText`:
  - `no-client`, `no-login`, `expired` → 오류 줄 대신 로그인 전 화면(`expired`는 "로그인이 만료됐어요. 다시 로그인해 주세요"를 덧붙임).
  - `network` → "인터넷 연결을 확인해 주세요".
  - `exec` 30초 초과 → "응답이 늦어 결과를 모르겠어요. 새로 읽어 확인해 주세요".
  - `exec`가 시작하지 못함(Node 없음) → "Node.js가 필요해요".
  - `api` → Google의 메시지. `usage` → "내부 오류: " + 메시지.

## 테스트

- `tests/my-tasks-logic.test.mjs`: `buildTree`(위치순, 하위 묶기, 부모 없는 하위, 완료 분리), `moveArgs`/`canMove`(위·아래·첫 행·마지막 행, 들여쓰기의 대상과 금지 경우, 내어쓰기 위치), `dueLabel`(올해·다른 해·지남·없음), `parseDue`, `errorText`.
- `tests/my-tasks-google.test.mjs`: 가짜 `fetch`와 메모리 파일로 — 만료 전 갱신과 `token.json` 다시 쓰기, `invalid_grant` → `expired`, 토큰 없음 → `no-login`, 클라이언트 없음 → `no-client`, fetch 예외 → `network`, HTTP 오류 → `api`와 메시지, 페이지 이어 읽기, 각 명령의 메서드·주소·본문, `due` 변환, `undone`의 `completed: null`.
- 실제 로그인과 Google 데이터 변경은 사용자가 확인한다.

## 설치와 문서

- `install.ps1`: mod 목록에 `my-tasks`(mod.json 먼저 복사하는 기존 순서 그대로), `panel-body`에 `{ id: "tasks", type: "block", content: { mod: "my-tasks" } }`가 없으면 추가.
- `mods/my-tabs/main.js`: `enabled`에 `"tasks"`, Session 다음에 `panelButton("tasks", "Task", "mods/my-tasks/tasks.svg")`.
- README: "기능 한눈에"에 Task 패널 한 줄, mod 표에 `my-tasks`, "Task 패널" 절(조작, 준비 3단계, 7일 로그아웃과 "확인되지 않은 앱" 경고 설명, 파일 위치), 요구 사항에 Google Cloud OAuth 클라이언트, 선택 설치 "탭 바와 패널" 묶음과 수동 설치의 `panel-body` 칸 목록에 `tasks` 추가.
