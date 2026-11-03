# `.md` 보기 모드 + 이슈·PR 드래그 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** my-files에서 `.md` 파일을 렌더링된 보기 화면으로 먼저 열고 [보기]/[편집]으로 오가게 한다. my-github 목록 행을 끌어 터미널에 놓으면 `이슈 #N "제목" URL ` 한 줄이 들어가게 한다.

**Architecture:** 판별/문구는 각 mod의 `logic.js`(순수, `node --test`). UI는 기존 `main.js`에 최소 수정. 드래그는 기존 `my-files-drag` overlay를 재사용하고 아이콘만 props로 받게 한다.

**Spec:** `<repo>\docs\superpowers\specs\2026-11-03-md-preview-and-gh-drag-design.md`

## Global Constraints

- herdr 앱 폴더 `~/.config/herdr-app`. 수정 대상은 `mods/my-files`, `mods/my-github`, `mods/my-files-drag`뿐. 기본 mod·레이아웃은 건드리지 않는다.
- `.md` 판별: `/\.(md|markdown)$/i`. `.md` 버퍼는 `view: "preview"`로 시작.
- 칩 문구: "보기", "편집". 빈 문서 문구: "빈 문서".
- 드래그 문구: `` `${kind === "pr" ? "PR" : "이슈"} #${number} "${title}" ${url} ` `` (끝 공백 하나, Enter 없음). 이름표 아이콘 "🔗".
- `cx.notify()`를 render 중에 부르지 않는다(throw). LF 줄바꿈 유지. git 없음: 커밋 없음.
- 게이트: `herdr-app check <mod 폴더>` 통과, `herdr-app status`의 `"errors": []`. 테스트는 파일 지정: `cd <repo> && node --test tests/<file>.test.mjs`.

---

### Task 1: my-files `.md` 보기 모드

**Files:** Modify `mods/my-files/logic.js`, `mods/my-files/main.js`; Test `<repo>\tests\my-files-logic.test.mjs`

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/my-files-logic.test.mjs` 끝에 추가:
```js

test("isMarkdown: .md and .markdown, any case", () => {
  assert.equal(L.isMarkdown("README.md"), true);
  assert.equal(L.isMarkdown("docs/Guide.MD"), true);
  assert.equal(L.isMarkdown("notes.markdown"), true);
  assert.equal(L.isMarkdown("a.mdx"), false);
  assert.equal(L.isMarkdown("md"), false);
  assert.equal(L.isMarkdown(null), false);
});
```
Run: `node --test tests/my-files-logic.test.mjs` → Expected FAIL (`L.isMarkdown is not a function`).

- [ ] **Step 2: logic.js** — `mods/my-files/logic.js` 끝에 추가:
```js

/** Markdown files open in the rendered view first. */
export function isMarkdown(path) {
  return /\.(md|markdown)$/i.test(path ?? "");
}
```
Run the test → Expected PASS (17 tests).

- [ ] **Step 3: main.js import** — `gpui-base` import에 `TextView`를, `./logic.js` import에 `isMarkdown`을 추가:
```js
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
```
(`./logic.js` import 목록 끝에 `, isMarkdown` 추가.)

- [ ] **Step 4: makeBuffer** — `const buf = { state, base: text, ... saving: false };` 줄을 다음으로 바꾼다:
```js
    const buf = { state, base: text, dirty: false, conflict: false, editable, reason, saving: false, view: isMarkdown(path) ? "preview" : "edit", rev: 0 };
```
같은 메서드의 change 핸들러 첫 줄에 `buf.rev++;`를 넣는다:
```js
    if (editable) state.on("change", (_e, cx) => {
      buf.rev++;
      const dirty = !sameText(state.value(), buf.base);
      if (dirty !== buf.dirty) { buf.dirty = dirty; cx.notify(); }
    });
```

- [ ] **Step 5: reload** — 버퍼를 새로 만드는 분기에서 보기 모드를 이어받고, set_value 분기에서 rev를 올린다. `reload(path, buf, disk)` 메서드를 다음으로 바꾼다:
```js
  reload(path, buf, disk) {
    const next = editability({ remote: Boolean(this.on), text: disk });
    if (next.editable !== buf.editable || next.reason !== buf.reason) {
      buf.state.release();
      const fresh = this.makeBuffer(path, disk);
      fresh.view = buf.view;
      this.buffers.set(path, fresh);
      return;
    }
    buf.base = disk; buf.dirty = false; buf.conflict = false; buf.rev++;
    buf.state.set_value(previewText(disk));
  }
```

- [ ] **Step 6: render — 칩 줄** — render의 `const bar = () => ...;` 줄 바로 아래에 칩 헬퍼를 추가:
```js
    const chip = (id, label, on, onClick) => h_flex().id(id).h(24).px(9).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
```
충돌 표시줄 `.when(Boolean(buf?.conflict), ...)` 블록 바로 다음(`.when(!file, ...)` 앞)에 추가:
```js
      .when(Boolean(buf) && isMarkdown(file), el => el.child(bar()
        .child(chip("files-view-preview", "보기", buf.view === "preview", () => { buf.view = "preview"; }))
        .child(chip("files-view-edit", "편집", buf.view === "edit", () => { buf.view = "edit"; }))))
```

- [ ] **Step 7: render — 본문** — 마지막 `.when(Boolean(file), el => el.child(buf ? v_flex().id("files-editor")... : div()...))` 블록을 다음으로 바꾼다(편집기 부분은 그대로):
```js
      .when(Boolean(file), el => el.child(!buf
        ? div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")
        : buf.view === "preview"
          ? v_flex().id("files-preview").flex_1().min_h(0).overflow_y_scrollbar().p(14)
            .child(buf.state.value().trim()
              ? TextView.markdown(`files-md-${buf.rev}`, buf.state.value()).selectable(true)
              : div().text_color(t.dim).child("빈 문서"))
          : v_flex().id("files-editor").flex_1().min_h(0)
            .on_key_down((e, cx) => { if (isSaveKey(e.keystroke)) { cx.stop_propagation(); this.save(file, cx); cx.notify(); } })
            .child(Editor.new(buf.state).flex_1().min_h(0))));
```

- [ ] **Step 8: 게이트** — `herdr-app check ~/.config/herdr-app/mods/my-files && herdr-app status`, 테스트 재실행. Expected: 통과, `"errors": []`, 17/17.

---

### Task 2: my-github 행 드래그 + overlay 아이콘

**Files:** Modify `mods/my-github/logic.js`, `mods/my-github/main.js`, `mods/my-files-drag/main.js`; Test `<repo>\tests\my-github-logic.test.mjs`

- [ ] **Step 1: 실패하는 테스트 추가** — `tests/my-github-logic.test.mjs` 끝에:
```js

test("dragText: one line, trailing space", () => {
  assert.equal(L.dragText("issue", { number: 78, title: "WS 테스트", url: "https://github.com/o/r/issues/78" }), '이슈 #78 "WS 테스트" https://github.com/o/r/issues/78 ');
  assert.equal(L.dragText("pr", { number: 77, title: "API", url: "https://github.com/o/r/pull/77" }), 'PR #77 "API" https://github.com/o/r/pull/77 ');
});
```
Run → Expected FAIL (`L.dragText is not a function`).

- [ ] **Step 2: logic.js** — `mods/my-github/logic.js` 끝에:
```js

/** What a row dragged onto a terminal types: kind, number, title and link, then a space. */
export function dragText(kind, { number, title, url }) {
  return `${kind === "pr" ? "PR" : "이슈"} #${number} "${title}" ${url} `;
}
```
Run → Expected PASS (11 tests).

- [ ] **Step 3: my-files-drag 아이콘 props** — `mods/my-files-drag/main.js`에서:
```js
    const t = theme(), { name = "", dir = false } = props() ?? {};
```
→
```js
    const t = theme(), { name = "", dir = false, icon } = props() ?? {};
```
그리고 `.child(dir ? "📁" : "📄")` → `.child(icon ?? (dir ? "📁" : "📄"))`.
Run: `herdr-app check ~/.config/herdr-app/mods/my-files-drag` → 통과.

- [ ] **Step 4: my-github import** — `herdr` import에 `openOverlay` 추가, `./logic.js` import 끝에 `, dragText` 추가.

- [ ] **Step 5: dropOut 메서드** — `target()` 메서드 바로 위에 추가:
```js
  // The pointer left the panel with a row held: my-files-drag takes over and types the row on release.
  dropOut() {
    const drag = this.drag; this.drag = null;
    if (!drag) return;
    const panel = this.origin && this.size ? { ...this.origin, width: this.size.width, height: this.size.height } : null;
    openOverlay({ mod: "my-files-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { ...drag, panel } });
  }
```

- [ ] **Step 6: 행 핸들러** — `row()`의 `.on_click((_e, cx) => { this.openDetail(item, cx); cx.notify(); })` 줄 바로 위에:
```js
      .on_mouse_down("left", () => { this.drag = { text: dragText(this.kind, item), name: `#${item.number} ${item.title}`, icon: "🔗" }; })
```

- [ ] **Step 7: 루트 핸들러** — render의 `return v_flex().id("github")...text_color(t.foreground).text_size(13)` 다음 줄(`.children(...)` 앞)에:
```js
      .on_mouse_up("left", () => { this.drag = null; })
      // Window-relative panel box (pointer minus its in-panel offset): a drop back on it cancels.
      .on_mouse_move(e => { if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; })
      .on_size_change(size => { this.size = size; })
      .on_hover(hovered => { if (!hovered) this.dropOut(); })
```

- [ ] **Step 8: 게이트** — `herdr-app check` (my-github, my-files-drag, my-files), `herdr-app status`, `node --test tests/my-github-logic.test.mjs tests/my-files-logic.test.mjs`. Expected: 모두 통과, `"errors": []`.
