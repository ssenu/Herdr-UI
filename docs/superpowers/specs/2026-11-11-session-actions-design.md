# Sessions 패널: 세션 이름 수정과 삭제 — 설계

- 날짜: 2026-11-11
- 대상: `mods/my-sessions/logic.js`, `mods/my-sessions/main.js`, `tests/my-sessions-logic.test.mjs`, `README.md`
- 범위: 세션 행의 `⋯`로 이름 수정과 삭제. 세션 파일 밖의 부속 기록(`~/.claude`의 file-history, todos 등)은 건드리지 않는다.

## 확인한 것

- 세션은 `~/.claude/projects/<저장 폴더>/<세션 UUID>.jsonl`. 같은 이름의 폴더(`<UUID>/`, 하위 에이전트 기록 등)가 있을 수 있다.
- Claude Code의 `/rename`은 파일 끝에 `{"type":"custom-title","customTitle":"…","sessionId":"…"}` 한 줄을 덧붙인다. 패널은 이미 마지막 64 KB에서 마지막 `customTitle`을 제목으로 읽는다.
- 저장 폴더 이름은 `encodeProject`의 결과라 `[A-Za-z0-9-]`뿐이다.
- 열려 있는 세션은 `~/.claude/sessions/<pid>.json`과 살아 있는 프로세스로 안다(목록의 LIVE 줄과 같은 규칙).

## 화면

- 행 제목 줄 오른쪽 끝에 `⋯`(누름과 클릭이 행으로 가지 않는다: 세션이 열리지 않는다). 다시 누르면 닫힌다. 한 번에 한 행만.
- `⋯`를 누르면 행 바로 아래(행 밖, 형제 요소)에 상자: `[이름 수정] [삭제] [닫기]`. 열려 있는 세션은 `[삭제]` 대신 흐린 글씨 "열려 있는 세션은 지울 수 없어요".
- 이름 수정: 상자가 입력칸(지금 제목, "(제목 없음)"이면 빈칸) + `[저장] [취소]`로 바뀐다. Enter도 저장. 빈칸이면 아무것도 하지 않는다.
- 삭제: 상자가 확인 문구 + `[삭제] [취소]`로 바뀐다.
  - 이 PC: `"제목" 세션을 휴지통으로 보낼까요?`
  - 원격: `"제목" 세션을 완전히 지울까요? 되돌릴 수 없어요.`
- 실행 중: "이름 바꾸는 중…" / "지우는 중…". 성공하면 상자를 닫고 목록을 다시 읽는다. 실패하면 `⚠ 이유 [닫기]`(그래도 목록은 다시 읽는다).
- 다른 저장소로 가면(목록이 바뀌면) 실행 중이 아닌 상자는 닫힌다. 다시 읽은 목록에 그 세션이 없으면 상자를 닫는다.

## 명령 (`logic.js`, 순수)

- `toSessions`가 세션에 `dir`(저장 폴더 이름)을 담고, `dir`가 `^[A-Za-z0-9-]+$`가 아니면 그 세션을 뺀다.
- `renameCommand(dir, id, title, windows)` → `{ command, args }`. `dir`·`id`(UUID) 검사, 제목은 공백을 한 칸으로 줄이고 다듬어 비면 예외 "이름이 비어 있어요". 덧붙일 줄은 `JSON.stringify({ type: "custom-title", customTitle, sessionId: id })`.
  - 파일이 없으면 종료 코드 2. 파일이 비어 있지 않고 줄바꿈으로 끝나지 않으면 줄바꿈을 먼저 쓴다. 그다음 줄 + 줄바꿈.
  - Windows: `powershell -NoProfile -Command`, 값은 `psQuote`로. UTF-8(BOM 없음)으로 덧붙인다.
  - 그 밖: `sh -c <script> rename <dir> <id> <line>` (값은 인자로).
- `deleteCommand(dir, id, windows)`: 같은 검사. 먼저 열려 있는지 본다(목록과 같은 규칙, 그 id가 살아 있으면 종료 코드 3, 아무것도 지우지 않는다). 파일이 없으면 2. 파일과(있으면) 같은 이름 폴더를 지운다.
  - Windows: `Microsoft.VisualBasic.FileIO.FileSystem`의 `DeleteFile`/`DeleteDirectory`에 `SendToRecycleBin`.
  - 그 밖: `rm -f` 파일, `rm -rf` 폴더. `sh -c <script> delete <dir> <id>`.
- 열려 있는지 보는 스크립트 조각은 `sessionsCommand`와 함께 쓴다(같은 문자열을 만드는 함수로 뽑는다).
- `actionError(code, stderr)`: 2 → "세션 파일이 없어요", 3 → "열려 있는 세션은 지울 수 없어요", 그 밖 → stderr 첫 줄 또는 "실패했어요".
- `deleteConfirmText(title, remote)`.
- `exec`가 시작하지 못하면 "명령을 실행하지 못했어요".

## 테스트

- 순수: `toSessions`의 `dir`과 잘못된 `dir` 제외, 두 명령의 인자 모양과 검사(잘못된 dir/id, 빈 제목), `actionError`, `deleteConfirmText`.
- 실행(PowerShell은 Windows에서, sh는 있으면): 임시 홈에서 줄바꿈 없는 파일과 있는 파일에 이름 덧붙이기(따옴표·`$`·백틱·한글 제목), `sessionsCommand`가 새 이름을 읽음, 없는 파일 2, 열려 있는 세션 삭제 3(파일 남음), 삭제 성공(파일과 폴더가 사라짐), 다시 삭제 2. Windows 실행 시험은 임시 파일 두 개를 휴지통으로 보낸다.

## 문서

README Sessions 절에 `⋯` 메뉴(이름 수정은 `/rename`과 같은 방식, 삭제는 휴지통 / 원격은 완전 삭제, 열려 있는 세션은 못 지움, 부속 기록은 남음) 한 항목.
