# Task 패널: 로컬 모드와 Google 연동 모드 — 설계

- 날짜: 2026-11-10
- 기반: `2026-11-09-tasks-panel-design.md` (Google Tasks 패널)
- 대상: `mods/my-tasks/local.mjs` (새 파일), `mods/my-tasks/tasks.mjs`, `mods/my-tasks/logic.js`, `mods/my-tasks/main.js`, `tests/my-tasks-*.test.mjs`, `README.md`
- 범위: Google 설정 없이 바로 쓰는 **로컬 모드**를 기본으로 두고, 지금의 Google Tasks 연동은 **연동 모드**로 남긴다. 두 모드의 데이터는 따로 보관하며 옮기거나 동기화하지 않는다.

## 목적

다른 사람이 이 저장소로 설치하면 Google Cloud에서 OAuth 클라이언트를 만들어야 Task 패널을 쓸 수 있다. 로컬 모드는 Node만으로 바로 쓰고, 연동은 원하는 사람만 한다.

## 저장 (`local.mjs`)

- 파일: `<앱 폴더>/my-tasks/local.json` (클라이언트·토큰과 같은 폴더). 모양:
  `{ "lists": [{ "id", "title" }], "tasks": { "<목록 id>": [ { id, title, notes, due, status, completed, parent } ] } }`
- 파일이 없으면 목록 "내 할 일" 하나로 만들어 바로 저장한다.
- 파일이 JSON이 아니거나 모양이 틀리면 오류 `local`("로컬 저장 파일을 읽지 못했어요: <경로>")을 내고, 그 명령은 쓰지 않는다(덮어써서 잃지 않게).
- `google.mjs`와 같은 함수 이름·인자·반환 모양: `status`, `lists`, `listAdd`, `listRename`, `listDelete`, `tasks`, `add`, `update`, `done`, `undone`, `remove`, `move`. 할 일은 `id, title, notes, due, status, completed, parent, position`을 돌려준다. `position`은 배열 안의 순서를 8자리 숫자 문자열로(`"00000003"`).
- 동작은 Google과 같게:
  - `add`: 부모 없으면 목록 맨 앞, 부모 있으면 그 부모 바로 뒤(첫 하위).
  - `move`: `previous`가 있으면 그 바로 뒤, 없으면 부모가 있을 때 부모 바로 뒤, 부모도 없으면 맨 앞. `parent`는 주어진 값(없으면 최상위).
  - `update`: 주어진 필드만. `due`는 `YYYY-MM-DDT00:00:00.000Z` 또는 `null`.
  - `done`: `status: "completed"`, `completed`: 지금 시각 ISO. `undone`: `needsAction`, `completed: null`.
  - `remove`: 그 할 일과 그 할 일을 부모로 가진 할 일을 지운다.
  - `listDelete`: 목록과 그 할 일을 지운다. 목록이 0개가 될 수 있다.
  - 없는 목록·할 일·부모·`previous`는 오류 `api`("목록을 찾을 수 없어요" / "할 일을 찾을 수 없어요").
- 쓰기는 지금의 `writeFile`(임시 파일에 쓰고 바꿔치기)로 한다. id는 `env.newId()`(무작위 16진수 16자).

## 보조 스크립트 (`tasks.mjs`)

- 모든 명령이 `--backend local|google` 플래그를 받는다. 없으면 `google`(지금과 같음). 다른 값은 `usage`.
- `login`, `logout`은 `google`에서만. `local`이면 `usage`("로컬 모드에는 로그인이 없어요").
- `makeEnv`에 `localPath`(`<폴더>/local.json`)와 `newId`를 더한다.

## 패널 (`main.js`)

- 모드는 `localStorage`의 `my-tasks.mode`(`"local"` | `"google"`). 패널은 모든 명령에 `--backend <모드>`를 붙인다.
- 처음(모드 기록 없음): 첫 새로 읽기에서 Google `status`를 한 번 확인한다. 성공(클라이언트와 토큰이 있음)이면 `google`, 아니면 `local`로 정하고 기억한다. 지금 Google로 쓰는 사람은 그대로 Google로 열린다.
- 마지막으로 고른 목록은 모드별로 `my-tasks.list.local`, `my-tasks.list.google`에 기억한다. `google`은 처음 한 번 옛 키 `my-tasks.list`를 이어받는다.
- 헤더: `Task` 옆에 작은 표시 `로컬` 또는 `Google`.
- `[⋯]` 메뉴:
  - 로컬: 목록 이름 바꾸기 · 목록 삭제 · **Google Tasks 연동**
  - Google: 목록 이름 바꾸기 · 목록 삭제 · **로컬로 전환** · 로그아웃
- 모드 바꾸기는 큐에 들어가는 작업이다. 앞의 작업이 다 끝난 뒤 모드를 바꾸고(편집·확인·이름 입력·메뉴·오류 줄을 비우고 목록을 새로 고른다) 전체를 다시 읽는다. Google로 바꿨는데 클라이언트나 로그인이 없으면 지금의 로그인 화면이 나온다.
- 로그인 화면에 **[로컬로 돌아가기]**를 둔다(로그인을 기다리는 중이면 기다림도 취소한다).
- 로컬로 전환해도 Google 로그인은 남는다(로그아웃은 따로).
- 2분 자동 새로 읽기는 Google 모드에서만. ⟳는 두 모드 모두.
- `errorText`: `local` → 오류 줄, 문구는 메시지 그대로.

## 테스트

- `tests/my-tasks-local.test.mjs`(메모리 파일): 처음 파일 만들기와 저장, 깨진 파일 거부(쓰지 않음), 목록 추가·이름·삭제(할 일도), 추가 위치(맨 앞, 첫 하위), `move`(previous 뒤, 부모 뒤, 맨 앞, 최상위로), `update` 필드와 `due`, `done`/`undone`, `remove`가 하위도 지움, `position` 형식, 없는 목록·할 일 오류.
- `tests/my-tasks-cli.test.mjs`: `--backend` 해석(기본 google, local, 잘못된 값), local에서 `login` 거부, `main`이 local 백엔드로 `lists`를 돌려줌, `makeEnv`의 `localPath`.
- `tests/my-tasks-logic.test.mjs`: `errorText({kind:"local"})`.

## 문서

README: 기능 한눈에·mod 표의 Task 설명을 "로컬 저장 또는 Google Tasks 연동"으로, Task 패널 절 맨 앞에 두 모드 설명(기본 로컬, `[⋯] → Google Tasks 연동`), "처음 한 번: Google 계정 연결"은 연동 모드에만 필요하다고, 요구 사항에서 OAuth 클라이언트는 연동 모드만, 한계에 "로컬 할 일은 이 PC의 `local.json`에만 있다(복사하면 백업). 두 모드의 할 일은 서로 옮겨지지 않는다".
