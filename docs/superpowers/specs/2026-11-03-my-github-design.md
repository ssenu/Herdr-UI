# my-github: GitHub 이슈·PR 패널 + 에이전트에게 넘기기 — 설계

- 날짜: 2026-11-03
- 대상: herdr 앱 설정 `~/.config/herdr-app` (Windows: `%USERPROFILE%\.config\herdr-app`)
- 선행 작업: `my-files` (같은 오른쪽 패널 스택에 들어감). 패턴은 같다: 판단 로직은 `logic.js` + `node --test`, mod는 `herdr-app check`.

## 목표

1. 탭 바의 GitHub 버튼으로 오른쪽 패널에 현재 저장소의 이슈·PR 목록을 띄운다.
2. 항목을 눌러 본문·코멘트를 보고, 브라우저로 열 수 있다.
3. 이슈·PR을 에이전트에게 넘긴다. 포커스된 칸이 에이전트면 그 입력창에 작업 문구를 넣고(Enter 없음), 아니면 새 탭에서 Claude를 시작한다.

## 범위 밖

- PR 체크아웃 / worktree 만들기, CI 실패 알림, 코멘트 작성·라벨 변경 등 GitHub에 쓰는 작업.
- 에이전트 고르기 목록(▾). 대상은 포커스된 칸의 에이전트 하나.
- Claude 외 에이전트로 새 탭 시작.
- 30개를 넘는 목록의 페이지 넘기기.

## 1. 구성

| 대상 | 내용 |
|---|---|
| `mods/my-github/` (새 mod) | `main.js`(UI + herdr 호출), `logic.js`(순수 함수), `github.svg`(직접 그린 단순한 PR 모양 아이콘. GitHub 로고 사용 안 함), `mod.json`: `{ "place": "none" }` |
| `mods/my-tabs/` | `herdr-app do mod.clone '{"name":"tabs","as":"my-tabs"}'`. Changes 버튼 옆에 GitHub 버튼(`panelButton("github", "GitHub", "mods/my-github/github.svg")`) 추가. 패널 목록 `enabled`에 `"github"`를 더한다(`shared("workspace.panels") ?? ["files","changes"]`에 없으면 추가). |
| `layouts/my-layout.json` | `panel-body` 스택 children에 `{ "id": "github", "type": "block", "content": { "mod": "my-github" } }` 추가. 탭 바 블록의 `"mod": "tabs"` → `"my-tabs"`. 바꾸기 전 `my-layout.json.bak2`로 백업. |

- 기본 `tabs` mod와 다른 기본 mod는 수정하지 않는다.
- 탭 바 복제본은 버튼 추가 외에 원본과 동작이 같아야 한다(스페이스별 패널 기억 포함).

## 2. 저장소 찾기

- 기준 위치: Files·Changes와 같은 `location()` (포커스된 칸의 `cwd`, 머신 `on`).
- `exec("gh", ["repo", "view", "--json", "nameWithOwner,url"], { cwd, on })`로 저장소를 알아낸다.
- 위치가 바뀌면(`key()` 변화) 다시 알아내고 목록을 새로 가져온다. 위치별로 마지막 탭·필터를 기억한다.
- 실패는 `ghError(stderr, startFailed)`로 분류해 안내 문구를 보여 준다.
  - `missing`: gh를 실행할 수 없음 (`exec`가 reject) → "이 머신에 gh가 없어요"
  - `auth`: stderr에 `gh auth login` 또는 `authentication` → "gh 로그인이 필요해요 (gh auth login)"
  - `norepo`: stderr에 `not a git repository` 또는 `no git remotes` 또는 `none of the git remotes` → "GitHub 저장소가 아니에요"
  - `other`: 나머지 → stderr 첫 줄을 그대로 보여 준다.
- 위치가 없으면(폴더 없음) "폴더가 없어요".

## 3. 목록

- 탭: [이슈] [PR]. 그 아래 필터 칩: [전체] [내 것] [닫힘].
- 인자는 `listArgs(kind, filter)`가 만든다 (`kind`: `"issue" | "pr"`, `filter`: `"open" | "mine" | "closed"`).
  - 공통: `[kind, "list", "--limit", "30", "--json", FIELDS[kind]]`
  - open: `--state open` / mine: `--state open --search "involves:@me"` / closed: `--state closed`
  - 이슈 필드: `number,title,author,labels,updatedAt,comments,url,state`
  - PR 필드: `number,title,author,labels,updatedAt,comments,url,state,isDraft,reviewDecision,statusCheckRollup`
- 정렬은 gh 기본(최근 생성순)이 아니라 `updatedAt` 내림차순으로 다시 정렬한다.
- 행 표시:
  - 공통: `#번호`, 제목(한 줄 말줄임), 작성자 login, 라벨(최대 3개, 라벨 색 무시하고 테마 색), `relativeTime(updatedAt, now)`, 코멘트 수(0이면 생략)
  - PR: 초안이면 "초안", `reviewLabel(reviewDecision)`, `ciSummary(statusCheckRollup)` 아이콘(pass ✓ 초록, fail ✗ 빨강, pending ● 노랑, null 생략)
- 새로고침: 패널이 처음 보일 때, 위치·탭·필터가 바뀔 때, 헤더 [⟳] 버튼, 그리고 120초마다. 불러오는 중에는 헤더에 "불러오는 중…". 가져오기는 한 번에 하나만(진행 중이면 새 요청은 끝난 뒤 한 번 더).
- 빈 목록: "열린 이슈가 없어요" / "열린 PR이 없어요" / "닫힌 항목이 없어요" / "나와 관련된 항목이 없어요".

### logic 함수 정의

- `ciSummary(rollup)`: 배열이 아니거나 비면 `null`. 항목마다 상태를 본다(`CheckRun`은 `status`/`conclusion`, `StatusContext`는 `state`).
  - 하나라도 실패(`conclusion` ∈ FAILURE, TIMED_OUT, CANCELLED, ACTION_REQUIRED, STARTUP_FAILURE 또는 `state` ∈ FAILURE, ERROR)면 `"fail"`
  - 아니고 하나라도 미완료(`status` ≠ COMPLETED, 또는 `state` ∈ PENDING, EXPECTED)면 `"pending"`
  - 나머지는 `"pass"` (SUCCESS, NEUTRAL, SKIPPED 포함)
- `reviewLabel(decision)`: APPROVED → "승인", CHANGES_REQUESTED → "변경 요청", REVIEW_REQUIRED → "리뷰 대기", 그 외 → `null`.
- `relativeTime(iso, now)`: 1분 미만 "방금", 60분 미만 "N분 전", 24시간 미만 "N시간 전", 30일 미만 "N일 전", 365일 미만 "N개월 전", 이상 "N년 전" (내림).
- `agentPrompt(kind, item)`: `item = { number, title, url }`.
  - 이슈: ``GitHub 이슈 #${number} "${title}" 를 해결해줘. ${url}\n내용과 코멘트는 `gh issue view ${number} --comments` 로 확인해.``
  - PR: ``GitHub PR #${number} "${title}" 를 해결해줘. ${url}\n내용과 코멘트는 `gh pr view ${number} --comments` 로 확인해.``
- `tabName(item)`: `#${number} ${title}`, 40자를 넘으면 39자 + "…".
- `ghError(stderr, startFailed)`: 위 2절의 분류. 반환 `{ kind, message }`.

## 4. 상세 화면

- 항목을 누르면 `exec("gh", [kind, "view", String(number), "--json", "number,title,body,author,labels,state,comments,url,createdAt"], { cwd, on })`.
- 표시: 제목, `#번호 · 상태 · 작성자 · relativeTime(createdAt)`, 본문을 `TextView.markdown`으로, 코멘트를 순서대로(작성자 · 시각 + 마크다운 본문). 본문이 비면 "본문 없음".
- 헤더: ← (목록으로), 제목, 버튼 두 개.
  - **[브라우저로 열기]**: `cx.open_url(item.url)`.
  - **[에이전트에게]**: 렌더할 때마다 대상을 다시 판단한다.
    - 포커스된 칸이 에이전트면(`agents()` 중 `focused`인 것, 없으면 포커스된 pane의 `program.agent`; `focused().agent`는 agent 블록 전용이라 쓰지 않음) 라벨 `→ ${program.name} 입력창에 넣기`(이름이 없으면 "에이전트"). 누르면 `cx.write_to_clipboard(agentPrompt(...))` 후 `run("terminal.paste", {})`. Enter는 보내지 않는다.
    - 아니면 라벨 `새 탭에서 Claude 시작`. 누르면 `run("tab.new", { name: tabName(item), folder: cwd, argv: ["claude"], task: agentPrompt(...) })`.
- 상세는 위치별로 하나만 기억한다. 목록으로 돌아가면 상세 데이터는 버린다.

## 5. 오류 처리

- 목록·상세 가져오기 실패: 해당 영역에 `ghError` 문구. 이전 목록이 있으면 유지하고 헤더에 짧게 오류 표시.
- 붙여넣기·새 탭 실패(예외): `notify({ title: "에이전트에게 넘기지 못했어요", body, level: "error", timeout: 5000 })`.
- gh 출력이 JSON이 아니면 `other`로 처리.

## 6. 검증

- 자동: `node --test tests/my-github-logic.test.mjs` (listArgs, ciSummary, reviewLabel, relativeTime, agentPrompt, tabName, ghError), `herdr-app check`를 `mods/my-github`와 `mods/my-tabs`에, `herdr-app status` 오류 없음.
- 직접 (사용자):
  1. 탭 바 GitHub 버튼으로 패널이 열리고 닫힌다. Files·Changes 버튼도 그대로 동작한다. 스페이스를 바꿨다 돌아오면 패널 선택이 기억된다.
  2. GitHub 저장소 폴더에서 이슈·PR 목록과 필터 칩이 동작한다. PR 행에 리뷰·CI 표시가 나온다.
  3. 항목 상세에서 본문·코멘트가 마크다운으로 보이고 [브라우저로 열기]가 동작한다.
  4. 에이전트 칸을 포커스하고 [에이전트에게] → 입력창에 문구가 들어가고 Enter는 안 눌린다.
  5. 셸 칸을 포커스하고 [에이전트에게] → 새 탭이 `#번호 제목`으로 생기고 Claude가 문구로 시작한다.
  6. git 저장소가 아닌 폴더에서 "GitHub 저장소가 아니에요"가 뜬다.
