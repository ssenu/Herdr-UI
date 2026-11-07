# 파일 뷰어 탭 — 설계

- 날짜: 2026-11-07
- 대상: 새 mod `mods/my-viewer`, `mods/my-new-menu`, `mods/my-tabs`, `mods/my-files`, `mods/my-files-drag`, `install.ps1`, `README.md`, `package.json`, `tests/`
- 범위: 탭 하나에 파일 하나를 여는 텍스트 뷰어·편집기. 이미지·PDF 표시, 탭 안의 파일 트리, 탭 안의 파일 탭은 하지 않는다.

## 구성

- `my-viewer`: `tab.new { name, space, mod: "my-viewer", props }`로 만드는 탭 전체 mod. 탭 하나에 파일 하나. 파일을 연 뒤에는 다른 파일로 바꾸지 않는다.
- `my-new-menu`: 기본 `new-menu`의 복제본(`mod.clone`과 같은 방식, `cloned_from` 기록). Terminal 아래에 "파일 뷰어" 항목을 더한다. `my-tabs`의 `+`가 이 메뉴를 연다.
- `my-tabs`: 탭 바 위치를 측정해 바뀔 때만 `setShared("my-tabs.bounds", {x, y, width, height})`로 알린다.
- `my-files`: 드래그 정보에 절대경로와 머신을 더한다. `my-files-drag`가 `my-tabs.bounds`를 직접 읽는다.
- `my-files-drag`: 놓은 위치로 행동을 고른다(아래 "드롭").

## 여는 방법

- **`+` → 파일 뷰어**: `tab.new { name: "파일 뷰어", mod: "my-viewer", props: { root, on } }`. `root`는 포커스된 칸의 폴더, `on`은 그 머신. 탭에는 `my-files`의 파일 찾기(`indexCommand`, `searchPaths`)와 같은 검색 화면이 나오고, 고르면 그 탭에 열린다. 파일을 고르면 `tab.rename`으로 탭 이름을 파일 이름으로 바꾼다.
- **탭 바에 드롭**: 파일이면 `tab.new { name: 파일 이름, mod: "my-viewer", props: { path, on } }`.
- **이미 열린 파일**: 새 탭을 만들지 않고 그 탭을 보여 준다(다른 스페이스면 `space.select` 후 `tab.select`). `run()`은 mod 안에서 값을 돌려주지 않고 탭 mod의 `props()`에 자기 탭 ID가 없으므로(확인함), 여는 쪽이 고유한 임시 탭 이름을 props와 함께 주고, `my-viewer`가 그 이름으로 자기 탭을 찾은 뒤 이름을 바꾸고 `shared("my-viewer.open")`(`{ "<on>|<path>": tabId }`)과 `shared("my-viewer.own")`(`{ token: { tab, path } }`)에 기록한다. 지금 `spaces()`에 없는 탭 ID는 없는 것으로 친다.

## 드롭 (`my-files-drag`)

놓은 위치 → 행동. 판단은 `logic.js`의 `dropAction`:

| 위치 | 파일 | 폴더 |
|---|---|---|
| Files 패널 위 | 취소 | 취소 |
| 탭 바 위 | 뷰어 탭으로 열기 | 알림 "폴더는 열 수 없어요" |
| 그 밖 | 터미널에 경로 입력(지금과 같음) | 터미널에 경로 입력 |

- 드래그 이름표: 탭 바 위에서는 `놓으면 새 탭으로 열기`, 그 밖에는 지금처럼 `놓으면 입력`.
- 측정 전(마우스가 탭 바를 지나기 전)에는 "창 맨 위 40px"로 판단한다. Files 패널이 같은 방식으로 측정한 좌표를 드래그 레이어에서 쓰고 있다.

## 파일별 동작

| 파일 | 동작 |
|---|---|
| 코드·일반 텍스트 | `Editor`로 편집, Ctrl+S 저장 (CRLF 유지) |
| `.md`, `.markdown` | `[보기] [편집]` 전환, 보기로 시작 |
| 텍스트가 아닌 파일 | 파일 이름과 `[외부 프로그램으로 열기]`(`my-files-open` 메뉴, 로컬만) |
| 400,000자 초과 | 읽기 전용 + 잘렸다는 표시 |
| 원격 파일 | 읽기 전용 + `[nano로 열기]`(새 탭: 뷰어 탭에는 나눌 터미널 칸이 없다) |
| 파일이 없거나 못 읽음 | 이유와 `[다시 읽기]` |

텍스트 판별: 확장자가 알려진 바이너리(이미지, PDF, 압축, 실행 파일 등)이거나 읽은 내용에 NUL 문자가 있으면 텍스트가 아니다.

## 저장과 초안

- 저장하지 않은 탭: `tab.rename`으로 이름 앞에 `● `를 붙이고, 저장하면 뗀다.
- 로컬 파일만 초안을 만든다(원격은 읽기 전용).
- 초안 파일: `<앱 폴더>/data/my-viewer/drafts/<경로 해시>.json`. 내용 `{ path, text, base }`. `base`는 고치기 시작할 때 읽은 원본 내용의 해시.
- 쓰기: 마지막 입력 1초 뒤. 저장하면 지운다. 고친 내용이 원본과 같아져도 지운다.
- 파일을 열 때 초안이 있으면(그리고 초안의 `path`가 이 파일이면) 초안 내용을 띄우고 `●`를 붙인다.
  - 원본 해시가 `base`와 같으면 표시줄 없음.
  - 다르면 표시줄: `디스크의 파일이 바뀌었어요` `[초안 유지]` `[디스크 버전 불러오기]`. 불러오면 초안을 지운다.
- 고치는 중 다른 곳에서 파일이 바뀌면(`watchFolder`): 고치지 않았으면 자동으로 새로고침, 고쳤으면 `[내 것으로 덮어쓰기]` `[디스크 버전 불러오기]`(`my-files`와 같음).
- `my-files`와 뷰어 탭은 편집 내용을 공유하지 않는다. 한쪽에서 저장하면 다른 쪽이 위 표시줄로 알게 된다.
- 탭 닫기 확인 창은 두지 않는다: mod가 `Ctrl+Shift+W`나 메뉴로 닫는 것을 막을 방법이 없다.

## 함수 (`mods/my-viewer/logic.js`, 순수)

- `dropAction({ position, panel, tabs, dir })` → `"cancel" | "open" | "folder" | "paste"` (여는 쪽과 함께 쓰는 `viewer-open.js`에 둔다.)
- `viewKind(path, text)` → `"text" | "markdown" | "binary"`.
- `textHash(text)`, `draftName(path)`: 짧고 안정적인 해시, 파일 이름에 쓸 수 있는 형태.
- `restoreState(draft, path, diskText)` → `{ text, dirty, conflict }`.
- `dirtyName(name, dirty)`: 탭 이름에 `● ` 붙이고 떼기(원래 이름에 `● `가 있어도 안전하게).
- `openKey(on, path)`, `liveTab(open, key, spaces)`: 이미 열린 탭 찾기.

mod는 자기 폴더 밖을 불러올 수 없다(확인함). 그래서 `my-files`의 `logic.js`는 `mods/my-viewer/files-logic.js`로, `viewer-open.js`는 `my-viewer`, `my-files-drag`, `my-new-menu`에 복사본을 두고, 테스트가 내용이 같은지 확인한다.

## 테스트

`tests/my-viewer-logic.test.mjs` (`npm test`에 추가):

- `dropAction`: 패널·탭 바·그 밖, 폴더, `tabs` 없음, 경계값.
- `viewKind`: 코드, md, 대문자 확장자, 바이너리 확장자, NUL 포함, 확장자 없는 텍스트.
- `textHash`·`draftName`: 같은 입력은 같고, 다른 경로는 다르고, 한글·공백·드라이브 경로도 파일 이름으로 안전.
- `restoreState`: 초안 없음, 같은 원본, 바뀐 원본, 다른 경로의 초안, 깨진 초안.
- `dirtyName`, `liveTab`(닫힌 탭의 ID는 없는 것으로).

화면 동작은 사용자가 확인한다.

## 문서

README: mod 표, 기능 절(`파일 뷰어`), 설치 mod 수, 수동 설치·제거. 알려진 한계:

- 이미지·PDF는 탭에서 보여 주지 않는다(기본 프로그램으로 연다).
- 초안은 그 PC에만 남는다. 저장하지 않고 초안을 버리려면 `[디스크 버전 불러오기]`.
- 탭 닫기 전에 묻지 않는다. 대신 다시 열면 초안이 복원된다.
- `my-new-menu`는 기본 mod의 복제본이라 Herdr 업데이트를 자동으로 따라가지 않는다.
