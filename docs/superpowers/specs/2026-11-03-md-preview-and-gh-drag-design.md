# `.md` 보기 모드 (my-files) + 이슈·PR 드래그 (my-github) — 설계

- 날짜: 2026-11-03
- 대상: `~/.config/herdr-app/mods/my-files`, `my-github`, `my-files-drag`
- 선행: `2026-11-03-my-files-edit-drag-design.md`, `2026-11-03-my-github-design.md`

## 1. `.md` 보기 모드 (my-files)

- 대상: 경로가 `.md` 또는 `.markdown`으로 끝나는 파일(대소문자 무관). `logic.js`의 `isMarkdown(path)`.
- 버퍼에 `view: "preview" | "edit"` 와 `rev: number`(0부터)를 둔다. `.md` 버퍼는 `view: "preview"`로 시작하고, 아니면 `"edit"`. 버퍼가 살아 있는 동안 마지막 선택을 유지한다(버퍼가 사라지면 다음에 다시 보기로 열림).
- `rev`는 편집기 `change` 이벤트마다, 그리고 `reload`로 디스크 내용을 받을 때마다 1 증가한다.
- 헤더: `.md` 버퍼가 열려 있을 때만, 헤더 아래 줄에 **[보기] [편집]** 두 칩을 둔다(선택된 쪽 강조). 칩을 누르면 `buf.view`를 바꾼다.
- 보기 화면: `TextView.markdown(\`files-md-${rev}\`, buf.state.value()).selectable(true)` 를 세로 스크롤 영역(`p(14)`)에 그린다. 내용이 비면 "빈 문서". 링크는 TextView 기본 동작(브라우저로 열기).
- 편집 화면: 지금과 같다(Ctrl+S 저장 포함).
- 보기 화면에서도 ●, 충돌 표시줄, 읽기 전용 표시줄(+nano)은 그대로 보인다. Ctrl+S는 편집 화면에서만 동작한다.
- 범위 밖: 상대경로 링크·이미지, 스크롤 위치 유지, 분할(나란히) 보기.

## 2. 이슈·PR 드래그 (my-github)

- 문구: `logic.js`의 `dragText(kind, item)` → `` `${kind === "pr" ? "PR" : "이슈"} #${number} "${title}" ${url} ` `` (끝 공백 하나, Enter 없음).
- 동작(my-files와 같은 패턴):
  - 목록 행 `on_mouse_down("left")`: `this.drag = { text: dragText(this.kind, item), name: \`#${number} ${title}\`, icon: "🔗" }`.
  - 패널 루트: `on_mouse_up("left")` → `this.drag = null`; `on_mouse_move` → 패널 좌상단 창 좌표 기록; `on_size_change` → 크기 기록; `on_hover(false)` → `this.drag`가 있으면 `openOverlay({ mod: "my-files-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { ...drag, panel } })`.
  - 그냥 클릭은 지금처럼 상세를 연다. 상세 화면에는 드래그를 넣지 않는다.
- `my-files-drag`: 이름표 아이콘을 `props.icon`으로 받을 수 있게 한다(없으면 기존처럼 `dir ? "📁" : "📄"`). 그 외 변경 없음.
- 한계(기존과 같음): 마지막으로 선택한 터미널에 들어가고, 클립보드가 바뀐다.

## 3. 검증

- 자동: `node --test tests/my-files-logic.test.mjs tests/my-github-logic.test.mjs` (새 테스트: `isMarkdown`, `dragText`), `herdr-app check` (my-files, my-files-drag, my-github, my-tabs), `herdr-app status` 오류 없음.
- 직접(사용자):
  1. `.md` 파일이 보기 화면으로 열리고 [편집]/[보기]로 오간다. 편집에서 고친 내용(저장 전)이 보기에 반영된다. 편집에서 Ctrl+S 저장.
  2. `.md`가 아닌 파일은 지금과 같다(칩 없음).
  3. 이슈 행을 끌어 Claude 입력창 위에 놓으면 `이슈 #N "제목" URL ` 한 줄이 들어간다. 패널 위에서 놓으면 취소, 그냥 클릭은 상세.
  4. Files 드래그는 여전히 📄/📁와 경로로 동작한다.
