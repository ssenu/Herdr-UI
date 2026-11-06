# Sessions 패널 (Claude 세션 목록) — 설계

- 날짜: 2026-11-06
- 대상: 새 mod `mods/my-sessions`, `mods/my-tabs`, `install.ps1`, `README.md`, `package.json`, `tests/`
- 범위: Claude Code 세션만. 읽기 + 새 탭에서 다시 열기. 세션 삭제·이름 변경·미리보기·검색은 하지 않는다. Codex는 나중에 칩으로 더할 수 있게 로직을 `claude` 전용 함수로 나눠 둔다.

## 진입

- `my-tabs`: Plugin 버튼 오른쪽에 **Session** 버튼(`panelButton("sessions", "Session", "mods/my-sessions/sessions.svg")`). `enabled`에 `"sessions"`를 항상 넣는다. 아이콘은 다른 탭처럼 선 아이콘.
- 레이아웃: `panel-body` 끝에 `{ "id": "sessions", "type": "block", "content": { "mod": "my-sessions" } }`. `install.ps1`이 없으면 추가(멱등).

## 데이터 (이 PC에서 확인한 형식)

- 세션 파일: `<home>/.claude/projects/<저장 폴더>/<세션ID>.jsonl` (저장 폴더 바로 아래 파일만. 하위 폴더는 보지 않는다.)
- 저장 폴더 이름: 시작 폴더 경로의 영문자·숫자 외 모든 문자를 `-`로 바꾼 것(`C:\MyCode\herdr-UI` → `C--MyCode-herdr-UI`).
- 제목: `{"type":"custom-title","customTitle":…}`, `{"type":"ai-title","aiTitle":…}` 레코드. 끝 64KB에서 **마지막** 값을 쓴다. 우선순위 `customTitle` → `aiTitle` → `(제목 없음)`.
- 폴더·브랜치: 레코드의 `"cwd"`, `"gitBranch"`. 앞 256KB의 **첫** `cwd`, 끝 64KB의 **마지막** `gitBranch`(없으면 표시 안 함).
- 빈 세션: 앞 256KB에 `cwd`가 없으면 목록에서 뺀다(사용자 메시지 없는 파일).
- 시간: 파일 수정 시각.
- 대화 내용은 패널로 가져오지 않는다: 명령이 위 값들만 뽑아 출력한다.

## 시작 폴더

`claude -r <ID>`는 세션의 저장 폴더에 해당하는 폴더에서 실행한다. 파일의 첫 `cwd`가 저장 폴더 이름과 다를 수 있으므로(이 PC 21개 중 2개):

- `startFolder(dirName, cwd)`: `cwd`부터 위로 올라가며 `encodeProject(x) === dirName`인 첫 경로. 없으면 `cwd`.

## 범위

- `root` = `git rev-parse --show-toplevel`(포커스된 칸의 폴더 기준). git이 아니면 그 폴더.
- `worktrees` = `git worktree list --porcelain`의 `worktree <path>` 줄들(`root` 포함). 실패하면 `[root]`.
- **[전체]**(기본): 시작 폴더가 `worktrees` 중 하나와 같거나 그 하위.
- **[지금 폴더]**: 시작 폴더가 포커스된 칸의 폴더와 같음.
- 후보 저장 폴더: `encodeProject(w)`와 같거나 `encodeProject(w) + "-"`로 시작하는 이름. 이름만으로는 `herdr-UI-old`도 걸리므로 시작 폴더 경로 비교로 다시 거른다.
- 경로 비교: Windows 드라이브 경로는 `\`·`/`·대소문자 무시, 끝 구분자 무시. 하위 판정은 `기준 + "/"`로 시작.

## 읽기

한 번의 명령으로 후보 폴더를 훑는다.

- 로컬 Windows: `powershell -NoProfile -Command`. 파일은 `FileShare.ReadWrite`로 열어(세션이 실행 중이어도 읽음) 앞/끝을 바이트로 읽고 UTF-8로 디코드, 정규식으로 값 추출. 경로는 작은따옴표 리터럴(`'`, U+2018, U+2019, U+201A, U+201B는 두 번)로만 넣는다.
- 원격·유닉스: `sh -c <script> sessions <projects 폴더>`. `head -c`, `tail -c`, `grep -a -o`, `stat -c %Y || stat -f %m`.
- 출력(줄 단위, 탭 구분): 맨 앞 `HOME`/`PROJECT` 없이 파일마다 한 줄 `FILE<TAB><저장 폴더><TAB><세션ID><TAB><수정 시각 epoch 초><TAB><cwd JSON 토큰><TAB><custom JSON 토큰><TAB><ai JSON 토큰><TAB><branch JSON 토큰>`. 값이 없으면 빈 칸. JSON 토큰은 따옴표 포함 원문이며 `logic.js`가 `JSON.parse`로 푼다(깨지면 빈 값). JSON 문자열 토큰에는 실제 탭·줄바꿈이 없으므로 구분이 안전하다.
- 명령은 스크립트 안에서 홈을 얻어 `<home>/.claude/projects`를 쓴다. 후보 이름은 sh에는 인자로, PowerShell에는 리터럴로 넘긴다. 후보 폴더 고르기는 명령이 `ls`한 저장 폴더 이름을 `logic.js`가 거르는 대신, 명령에 `encodeProject(w)` 접두어들을 넘겨 스크립트가 거른다(한 번에 끝나도록).
- 파일이 많을 때를 위해 후보 파일을 수정 시각 최신순으로 **최대 300개**까지만 읽는다. exec 제한(8 MiB, 30초) 안.
- 패널이 보일 때, 대상(폴더·원격·범위)이 바뀔 때, ⟳, 패널이 보이는 동안 30초마다 다시 읽는다. `loading`/`again` 방식(`my-github`와 같음). 범위 칩은 다시 읽지 않고 받아 둔 목록을 거른다.

## 화면 (`main.js`)

- 헤더: `Sessions` · 저장소 이름(원격이면 `머신:이름`) · ⟳.
- 칩 줄: `[전체] [지금 폴더]`.
- 행(최근 활동 순, 최대 100개, 넘으면 `최근 100개만 보여 줘요`):
  - 첫 줄: 제목(길면 자름).
  - 둘째 줄(작고 흐리게): `3시간 전 · main · mods/my-files`. 시작 폴더가 `root`면 폴더 생략. `root` 밖(다른 worktree)이면 그 폴더 이름. 지금 폴더 칩에서도 같은 형식.
- 클릭: `run("tab.new", { name: 제목, folder: 시작 폴더, argv: ["claude", "-r", 세션ID] })`. 실패하면 `notify({ title: "세션을 열지 못했어요", body, level: "error", timeout: 5000 })`.
- 빈 화면: `이 저장소에 세션이 없어요` / `이 폴더에서 시작한 세션이 없어요`. 폴더가 없으면 `폴더가 없어요`. 처음 읽는 중 `불러오는 중…`.
- 읽기 실패: 받아 둔 목록이 있으면 위에 `⚠ <이유>` 줄, 없으면 메시지 자리에 이유.

## 함수 (`logic.js`, 순수)

- `encodeProject(path)`, `samePath(a, b)`, `isUnder(path, base)`(같거나 하위), `startFolder(dirName, cwd)`.
- `worktreePaths(porcelain, root)` → 경로 목록(`root` 포함, 중복 없음).
- `sessionsCommand(prefixes, windows)` → `{ command, args }`.
- `sessionLines(stdout)` → `[{ dir, id, mtime, cwd, customTitle, aiTitle, branch }]` (JSON 토큰 해석, `cwd` 없는 줄은 뺌).
- `toSessions(rows)` → `{ id, title, mtime, branch, folder }` 목록(제목 우선순위, `folder = startFolder`). `id`는 UUID 형식만 받는다(그 외 행은 버린다: `argv`로 넘기는 값이므로).
- `inScope(session, scope, { worktrees, cwd })`, `sortRecent(sessions)`.
- `relativeTime(ms, now)` (`방금`, `n분 전`, `n시간 전`, `n일 전`, `n개월 전`), `sessionMeta(session, root, now)` → 둘째 줄 문자열.

## 테스트

`tests/my-sessions-logic.test.mjs` (`npm test`에 추가):

- `encodeProject`(한글·공백·드라이브), `startFolder`(같음, 하위 cwd → 저장 폴더 경로, 못 찾으면 cwd), `isUnder`(`herdr-UI-old`는 `herdr-UI` 하위 아님), `worktreePaths`.
- `sessionLines`(CRLF, 깨진 토큰, cwd 없음), `toSessions`(제목 우선순위, UUID 아닌 id 버림), `inScope`, `sortRecent`, `relativeTime`, `sessionMeta`.
- 실제 PowerShell·sh 실행: 임시 HOME에 특수문자 폴더(`&`, `'`, `’`, 한글, 공백)와 세션 파일(제목 여러 개, 앞 256KB 밖의 cwd, 빈 세션, 하위 폴더의 jsonl)을 만들어 출력 확인.

## 문서

README: mod 표, 기능 절(`Sessions 패널`), 설치 "일곱 mod", 수동 설치·제거, 알려진 한계:
- 이미 열려 있는 세션은 표시할 수 없다(에이전트 정보에 세션 ID가 없음). 같은 세션을 두 탭에서 쓰지 않도록 조심.
- Claude Code 내부 파일 형식에 기댄다.
