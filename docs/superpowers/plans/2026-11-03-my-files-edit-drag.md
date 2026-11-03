# my-files (편집 + 드래그로 경로 넣기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** herdr Files 패널을 `my-files`로 복제해, 로컬 파일 편집(Ctrl+S 저장, 저장 안 한 내용 유지, 디스크 변경 감지·충돌 처리)과 "행을 끌어 터미널에 놓으면 절대경로 입력" 기능을 넣는다.

**Architecture:** 판단 로직(경로 만들기, 따옴표 처리, 편집 가능 여부, 디스크 변경 시 결정, 저장 실패 분류)은 herdr API를 쓰지 않는 `mods/my-files/logic.js`로 분리해 `node --test`로 검증한다. UI와 herdr 호출은 `mods/my-files/main.js`가 맡는다. 드래그는 mod가 OS 드래그를 시작할 수 없으므로, 행을 누른 채 패널을 벗어나면 창 전체를 덮는 투명 overlay mod(`my-files-drag`)가 놓기를 받아 `cx.write_to_clipboard` + `terminal.paste`로 경로를 넣는다.

**Tech Stack:** herdr-app mod (JavaScript ES2022, `gpui-kit`/`gpui-base`/`herdr` 모듈), Node 24 `node:test` (logic.js 단위 테스트), `herdr-app check` / `herdr-app shot` (mod 로드·렌더 확인).

**Spec:** `<repo>\docs\superpowers\specs\2026-11-03-my-files-edit-drag-design.md`

## Global Constraints

- herdr 앱 폴더: `~/.config/herdr-app` (`%USERPROFILE%\.config\herdr-app`). 아래 경로 `mods/...`, `layouts/...`는 모두 이 폴더 기준.
- 기본 `files` mod와 탭 바(`mods/tabs`)는 수정하지 않는다. 레이아웃 칸 id는 `files` 그대로 둔다.
- 참고 코드 `herdr-files-drag-path (작성자의 이전 코드)`의 mod는 설치하지 않는다(코드만 가져온다).
- 드래그로 넣는 경로: 절대경로. `[\s'"&()^%!,;=]`가 있으면 `"경로"`, 끝에 공백 하나. Enter 없음.
- 편집 가능 조건: 로컬 스페이스 && 400,000자 이하 && 텍스트(`\0` 없음). 나머지는 읽기 전용 + [nano로 열기].
- 저장 단축키: 바인딩 문자열 `"cmd-s"` (gpui에서 `cmd`는 모든 플랫폼의 기본 수정키 = Windows의 Ctrl).
- UI 문구: "원격 파일 · 읽기 전용", "큰 파일 · 일부만 표시", "nano로 열기", "디스크의 파일이 바뀌었어요", "내 것으로 덮어쓰기", "디스크 버전 불러오기", "저장하지 못했어요", "경로를 붙여넣지 못했어요".
- git 저장소가 없으므로 커밋 단계는 없다. 대신 매 Task 끝에 `herdr-app check`를 통과시킨다. mod 파일은 저장하면 바로 hot reload된다.
- `herdr-app check`가 실패하면 그 Task를 끝난 것으로 치지 않는다.

## File Structure

| 파일 | 역할 |
|---|---|
| Create `mods/my-files/` (mod.clone) | `files` 복제본. `cloned_from` 기록 |
| Create `mods/my-files/logic.js` | 순수 함수: `absolutePath`, `quoteForPrompt`, `editability`, `previewText`, `syncDecision`, `saveFailure`, 상수 `PREVIEW_LIMIT`, `REASONS` |
| Modify `mods/my-files/main.js` | Files 패널 UI + 드래그 시작 + 버퍼·저장·동기화·충돌·nano |
| Create `mods/my-files-drag/main.js`, `mod.json` | 드래그 중 투명 overlay: 이름표, 놓으면 경로 붙여넣기 |
| Modify `layouts/my-layout.json` | Files 칸 `"mod": "files"` → `"my-files"` |
| Create `<repo>\tests\my-files-logic.test.mjs` | logic.js 단위 테스트 |

---

### Task 1: logic.js 순수 함수 + 단위 테스트

**Files:**
- Create: `mods/my-files/` (복제)
- Create: `mods/my-files/logic.js`
- Test: `<repo>\tests\my-files-logic.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces (Task 2, 3이 사용):
  - `PREVIEW_LIMIT: number` (= 400000)
  - `REASONS: { remote: string, truncated: string }`
  - `absolutePath(root: string, rel: string, opts: { remote: boolean, windows: boolean }): string`
  - `quoteForPrompt(path: string): string`
  - `editability(opts: { remote: boolean, text: string }): { editable: boolean, reason: "remote" | "truncated" | null }`
  - `previewText(text: string): string`
  - `syncDecision(buf: { base: string | null, dirty: boolean, value: string }, disk: string | null): "none" | "adopt" | "reload" | "conflict" | "drop"`
  - `saveFailure(base: string | null, disk: string | null): "conflict" | "error"`

- [ ] **Step 1: files mod 복제**

Run (Bash):
```bash
herdr-app do mod.clone '{"name":"files","as":"my-files"}'
ls ~/.config/herdr-app/mods/my-files
cat ~/.config/herdr-app/mods/my-files/mod.json
```
Expected: `main.js`, `mod.json`, `chevron-down.svg`, `chevron-right.svg`, `file.svg`, `folder.svg` 등이 있고, `mod.json`에 `"cloned_from": { "name": "files", ... }`가 있다.

- [ ] **Step 2: 실패하는 테스트 작성**

Create `<repo>\tests\my-files-logic.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";

const app = process.env.HERDR_APP_HOME ?? join(homedir(), ".config", "herdr-app");
const L = await import(pathToFileURL(join(app, "mods", "my-files", "logic.js")).href);

test("absolutePath: local Windows uses backslashes and trims the root's trailing separator", () => {
  assert.equal(L.absolutePath("C:/MyCode/x", "src/a.js", { remote: false, windows: true }), "C:\\MyCode\\x\\src\\a.js");
  assert.equal(L.absolutePath("C:\\MyCode\\x\\", "src/a.js", { remote: false, windows: true }), "C:\\MyCode\\x\\src\\a.js");
});

test("absolutePath: empty rel returns the root itself", () => {
  assert.equal(L.absolutePath("C:/x", "", { remote: false, windows: true }), "C:\\x");
  assert.equal(L.absolutePath("/", "", { remote: true, windows: true }), "/");
});

test("absolutePath: remote keeps forward slashes even from a Windows client", () => {
  assert.equal(L.absolutePath("/home/u/p", "a b.txt", { remote: true, windows: true }), "/home/u/p/a b.txt");
});

test("absolutePath: local non-Windows keeps forward slashes", () => {
  assert.equal(L.absolutePath("/Users/u/p/", "a.txt", { remote: false, windows: false }), "/Users/u/p/a.txt");
});

test("quoteForPrompt: plain path gets only a trailing space", () => {
  assert.equal(L.quoteForPrompt("C:\\a\\b.js"), "C:\\a\\b.js ");
});

test("quoteForPrompt: spaces and shell specials are double-quoted", () => {
  assert.equal(L.quoteForPrompt("C:\\바탕 화면\\a.js"), "\"C:\\바탕 화면\\a.js\" ");
  assert.equal(L.quoteForPrompt("/p/a&b"), "\"/p/a&b\" ");
  assert.equal(L.quoteForPrompt("/p/(x)"), "\"/p/(x)\" ");
});

test("editability: remote wins over everything", () => {
  assert.deepEqual(L.editability({ remote: true, text: "x" }), { editable: false, reason: "remote" });
});

test("editability: text over PREVIEW_LIMIT is truncated and read-only", () => {
  assert.equal(L.PREVIEW_LIMIT, 400000);
  assert.deepEqual(L.editability({ remote: false, text: "a".repeat(400001) }), { editable: false, reason: "truncated" });
  assert.deepEqual(L.editability({ remote: false, text: "a".repeat(400000) }), { editable: true, reason: null });
});

test("previewText: cuts at PREVIEW_LIMIT with a marker", () => {
  assert.equal(L.previewText("abc"), "abc");
  const long = "a".repeat(400005);
  assert.equal(L.previewText(long), "a".repeat(400000) + "\n… (file truncated)");
});

test("REASONS: Korean labels", () => {
  assert.equal(L.REASONS.remote, "원격 파일 · 읽기 전용");
  assert.equal(L.REASONS.truncated, "큰 파일 · 일부만 표시");
});

test("syncDecision", () => {
  assert.equal(L.syncDecision({ base: "a", dirty: false, value: "a" }, "a"), "none");
  assert.equal(L.syncDecision({ base: "a", dirty: true, value: "b" }, "a"), "none");
  assert.equal(L.syncDecision({ base: "a", dirty: false, value: "a" }, "c"), "reload");
  assert.equal(L.syncDecision({ base: "a", dirty: true, value: "b" }, "c"), "conflict");
  assert.equal(L.syncDecision({ base: "a", dirty: true, value: "c" }, "c"), "adopt");
  assert.equal(L.syncDecision({ base: "a", dirty: false, value: "a" }, null), "drop");
  assert.equal(L.syncDecision({ base: "a", dirty: true, value: "b" }, null), "conflict");
});

test("saveFailure: unchanged disk is a plain error, changed disk is a conflict", () => {
  assert.equal(L.saveFailure("a", "a"), "error");
  assert.equal(L.saveFailure("a", "b"), "conflict");
  assert.equal(L.saveFailure("a", null), "conflict");
  assert.equal(L.saveFailure(null, null), "error");
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `cd <repo> && node --test tests/`
Expected: FAIL — `logic.js`가 없어서 `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: logic.js 구현**

Create `mods/my-files/logic.js`:
```js
// Pure helpers for my-files. No herdr or gpui imports, so `node --test` can load this file.

/** Longest text shown (and the longest that stays editable). */
export const PREVIEW_LIMIT = 400000;

/** Why a file is read-only, as shown in the header. */
export const REASONS = { remote: "원격 파일 · 읽기 전용", truncated: "큰 파일 · 일부만 표시" };

/** The absolute path a terminal should see. Local Windows paths use backslashes. */
export function absolutePath(root, rel, { remote, windows }) {
  const p = rel ? `${root.replace(/[\\/]+$/, "")}/${rel}` : root;
  return !remote && windows ? p.replace(/\//g, "\\") : p;
}

/** What gets typed into the prompt: quoted when the shell would split or interpret it, plus a space. */
export function quoteForPrompt(path) {
  return (/[\s'"&()^%!,;=]/.test(path) ? `"${path}"` : path) + " ";
}

/** Whether the panel may edit this text. Remote files can't be written; truncated ones would lose their tail. */
export function editability({ remote, text }) {
  if (remote) return { editable: false, reason: "remote" };
  if (text.length > PREVIEW_LIMIT) return { editable: false, reason: "truncated" };
  return { editable: true, reason: null };
}

/** The text put in the editor. */
export function previewText(text) {
  return text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) + "\n… (file truncated)" : text;
}

/**
 * What to do with an open buffer after reading the file again.
 * none: disk still matches base. adopt: disk now equals the unsaved edits.
 * reload: no edits, take the disk. conflict: edits and a different disk. drop: no edits, file gone.
 */
export function syncDecision({ base, dirty, value }, disk) {
  if (disk === base) return "none";
  if (disk === null) return dirty ? "conflict" : "drop";
  if (dirty && value === disk) return "adopt";
  return dirty ? "conflict" : "reload";
}

/** A rejected save: the disk moved away from base (conflict) or it didn't (some other error). */
export function saveFailure(base, disk) {
  return disk === base ? "error" : "conflict";
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd <repo> && node --test tests/`
Expected: PASS — 12 tests, 0 fail. (Node가 ESM 문법 감지로 `.js`를 모듈로 읽는다는 경고는 무시해도 된다.)

---

### Task 2: 드래그로 경로 넣기 (my-files-drag + my-files 연결 + 레이아웃 전환)

**Files:**
- Create: `mods/my-files-drag/main.js`, `mods/my-files-drag/mod.json`
- Modify: `mods/my-files/main.js` (import, 아이콘 경로, 행 핸들러, 루트 핸들러, 메서드 2개 추가)
- Modify: `layouts/my-layout.json` (`"mod": "files"` 한 곳)

**Interfaces:**
- Consumes: `absolutePath`, `quoteForPrompt` (Task 1)
- Produces:
  - overlay props 계약: `{ text: string, name: string, dir: boolean, panel: { x, y, width, height } | null }` (+ herdr가 넣어 주는 `overlay` id)
  - `Files#absolute(path: string): string`, `Files#dropOut(): void`, 필드 `this.drag`, `this.origin`, `this.size`

- [ ] **Step 1: my-files-drag mod 만들기**

Create `mods/my-files-drag/mod.json`:
```json
{ "place": "none" }
```

Create `mods/my-files-drag/main.js`:
```js
// Drag layer for my-files: a transparent full-window overlay opened when a row is dragged out of
// the Files panel. The name follows the pointer; releasing outside the panel types props.text
// into the focused terminal (clipboard + terminal.paste), releasing back over the panel cancels.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, notify } from "herdr";

const inside = (b, p) => b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

export default class MyFilesDrag extends View {
  init() { this.pos = null; this.done = false; }

  finish(position, cx) {
    if (this.done) return;
    this.done = true; cx.notify(); // hides the label at once
    const { text, panel, overlay } = props() ?? {};
    try {
      // ponytail: lands in the focused terminal, not the one under the pointer (panes() has no bounds),
      // and replaces the clipboard.
      if (text && position && !inside(panel, position)) {
        cx.write_to_clipboard(text);
        run("terminal.paste", {});
      }
    } catch (e) {
      notify({ title: "경로를 붙여넣지 못했어요", body: String(e), level: "error", timeout: 3000 });
    } finally {
      if (overlay) closeOverlay(overlay);
    }
  }

  render() {
    const t = theme(), { name = "", dir = false } = props() ?? {};
    return div().id("my-files-drag").size_full().bg("#00000001")
      .on_mouse_move((e, cx) => { if (!this.done) { this.pos = e.position; cx.notify(); } })
      .on_mouse_up("left", (e, cx) => this.finish(e.position, cx))
      // Released before this layer opened: the next press just closes it.
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.finish(null, cx); })
      .when(Boolean(this.pos) && !this.done, el => el.child(
        h_flex().absolute().left(this.pos.x + 14).top(this.pos.y + 12).h(26).px(10).gap(6).items_center()
          .rounded(7).bg(t.popover).border_1().border_color(t.accent).text_color(t.foreground).text_size(12)
          .child(dir ? "📁" : "📄").child(name)
          .child(div().text_color(t.dim).child("· 놓으면 경로 입력"))));
  }
}
```

Run: `herdr-app check ~/.config/herdr-app/mods/my-files-drag`
Expected: 0 종료, 오류 없음.

- [ ] **Step 2: my-files/main.js — import와 아이콘 경로**

`mods/my-files/main.js`에서:

1번 줄 주석을 바꾼다:
```js
// Herdr's Files panel, cloned as my-files. Drag a row out over a terminal to type its absolute path
// there (drawn by mods/my-files-drag).
```

`herdr` import 줄을 바꾸고, 그 아래에 logic import를 추가한다:
```js
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, openOverlay } from "herdr";
import { absolutePath, quoteForPrompt } from "./logic.js";
```

`rows()` 안의 아이콘 경로 두 곳을 `mods/files/`에서 `mods/my-files/`로 바꾼다:
```js
        .child(entry.dir ? svg(`mods/my-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/my-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
```

- [ ] **Step 3: my-files/main.js — 메서드 2개 추가**

`current(context) { ... }` 메서드 바로 아래에 추가한다:
```js
  // Absolute path as the terminal should see it.
  absolute(path) {
    return absolutePath(this.root, path, { remote: Boolean(this.on), windows: window()?.platform === "windows" });
  }

  // The pointer left the panel with a row held: a full-window layer takes over the drag and
  // pastes on release. ponytail: mods can't start a real OS drag; the overlay stands in for it.
  dropOut() {
    const drag = this.drag; this.drag = null;
    if (!drag) return;
    const panel = this.origin && this.size ? { ...this.origin, width: this.size.width, height: this.size.height } : null;
    openOverlay({ mod: "my-files-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { ...drag, panel } });
  }
```

- [ ] **Step 4: my-files/main.js — 행과 루트에 마우스 핸들러**

`rows()`의 `.on_click(...)` 줄 바로 위에 추가한다:
```js
        .on_mouse_down("left", () => { this.drag = { text: quoteForPrompt(this.absolute(path)), name: entry.name, dir: entry.dir }; })
```

`render()`의 `return v_flex().id("files")...text_size(13)` 줄 바로 다음에 추가한다:
```js
      .on_mouse_up("left", () => { this.drag = null; })
      // Window-relative panel box (pointer minus its in-panel offset): a drop back on it cancels.
      .on_mouse_move(e => { if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; })
      .on_size_change(size => { this.size = size; })
      .on_hover(hovered => { if (!hovered) this.dropOut(); })
```

Run: `herdr-app check ~/.config/herdr-app/mods/my-files`
Expected: 0 종료, 오류 없음.

- [ ] **Step 5: 레이아웃을 my-files로 전환**

Run (Bash):
```bash
cd ~/.config/herdr-app/layouts
cp my-layout.json my-layout.json.bak
grep -c '"mod": "files"' my-layout.json
```
Expected: `1`. 1이 아니면 멈추고 해당 줄들을 확인한다.

Edit `layouts/my-layout.json`의 Files 블록:
```json
                    {
                      "id": "files",
                      "type": "block",
                      "content": {
                        "mod": "my-files"
                      }
                    },
```

Run: `herdr-app status` → Expected: `"errors": []`.

- [ ] **Step 6: 직접 확인**

1. 탭 바의 Files 버튼으로 패널을 연다. 아이콘이 보이고 목록이 기본 Files와 똑같이 동작한다. (`herdr-app shot` 으로 캡처해 확인 가능)
2. 터미널 칸을 한 번 클릭해 포커스한 뒤, Files에서 파일을 누른 채 패널 밖으로 끈다 → 커서 옆에 "📄 이름 · 놓으면 경로 입력"이 따라온다.
3. 터미널 위에서 놓는다 → `C:\...\파일 ` 형태의 절대경로가 입력되고 Enter는 눌리지 않는다.
4. 공백이 있는 경로(예: `바탕 화면` 아래 파일)를 끌어 놓으면 `"..." `로 감싸진다.
5. 끌다가 패널 위로 돌아와 놓으면 아무것도 입력되지 않는다.
6. 그냥 클릭(끌지 않음)하면 기존처럼 파일이 열리고 overlay가 뜨지 않는다.

문제가 있으면 `herdr-app status`의 `errors`와 `%APPDATA%\herdr\herdr-client.log`를 확인한다. 되돌리기: `cp my-layout.json.bak my-layout.json`.

---

### Task 3: 편집·저장·동기화·충돌·nano (main.js 최종본)

**Files:**
- Modify: `mods/my-files/main.js` (전체 교체)

**Interfaces:**
- Consumes: Task 1의 모든 export, Task 2의 `absolute`, `dropOut`, overlay props 계약
- Produces:
  - `this.buffers: Map<string, Buffer>`; `Buffer = { state: EditorState, base: string | null, dirty: boolean, conflict: boolean, editable: boolean, reason: "remote" | "truncated" | null, saving: boolean }`
  - `this.saved.get(key) = { folders: Set<string>, file: string | null, buffers: Map<string, Buffer> }`
  - 메서드: `makeBuffer(path, text)`, `dropClean(keep)`, `syncBuffers(context)`, `reload(path, buf, disk)`, `save(path, cx)`, `overwrite(path, cx)`, `loadDisk(path, cx)`, `openInNano(path)`
  - 키 바인딩: `{ keystroke: "cmd-s", action: "my_files::Save", context: "MyFilesEditor" }`

- [ ] **Step 1: main.js 전체 교체**

`mods/my-files/main.js`를 아래 내용으로 바꾼다. (Task 2의 드래그 코드가 그대로 포함되어 있다.)
```js
// Herdr's Files panel, cloned as my-files. Adds two things:
//  - local text files are editable: Ctrl+S saves through writeTextFile's stale check, unsaved edits
//    survive switching files and spaces (in memory only), and disk changes reload clean buffers or
//    flag a conflict on dirty ones;
//  - dragging a row out of the panel opens mods/my-files-drag, which types the row's absolute path
//    into the focused terminal on release.
// Remote and truncated files stay read-only, with a button to open them in nano beside.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, openOverlay, run, notify } from "herdr";
import { absolutePath, quoteForPrompt, editability, previewText, syncDecision, saveFailure, REASONS } from "./logic.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const GONE = "This file is no longer available";

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Reparse points keep directory attributes even when dangling; check their target.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replaceAll("'", "''") + "'"]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map(); this.buffers = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    cx.bind_keys([{ keystroke: "cmd-s", action: "my_files::Save", context: "MyFilesEditor" }]);
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  // Absolute path as the terminal should see it.
  absolute(path) {
    return absolutePath(this.root, path, { remote: Boolean(this.on), windows: window()?.platform === "windows" });
  }

  // The pointer left the panel with a row held: a full-window layer takes over the drag and
  // pastes on release. ponytail: mods can't start a real OS drag; the overlay stands in for it.
  dropOut() {
    const drag = this.drag; this.drag = null;
    if (!drag) return;
    const panel = this.origin && this.size ? { ...this.origin, width: this.size.width, height: this.size.height } : null;
    openOverlay({ mod: "my-files-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { ...drag, panel } });
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) {
        this.dropClean(null);
        this.saved.set(this.context.key, { folders: this.folders, file: this.file, buffers: this.buffers });
      }
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.buffers = saved?.buffers ?? new Map();
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        await this.syncBuffers(context);
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // One open file: its editor, the disk text it was last read or saved as (base), and its state.
  makeBuffer(path, text) {
    const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
    const { editable, reason } = editability({ remote: Boolean(this.on), text });
    const state = EditorState.new({ language: LANG[ext] ?? ext, readonly: !editable, value: previewText(text),
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    const buf = { state, base: text, dirty: false, conflict: false, editable, reason, saving: false };
    if (editable) state.on("change", (_e, cx) => {
      const dirty = state.value() !== buf.base;
      if (dirty !== buf.dirty) { buf.dirty = dirty; cx.notify(); }
    });
    return buf;
  }

  // Unsaved buffers stay; every other one except `keep` is released.
  dropClean(keep) {
    for (const [path, buf] of this.buffers) if (path !== keep && !buf.dirty) { buf.state.release(); this.buffers.delete(path); }
  }

  show(path, cx) {
    this.dropClean(path); this.file = path; this.fileError = null;
    if (!path || !cx || this.buffers.has(path)) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context) || this.buffers.has(path)) return;
        if (text === null) { this.fileError = GONE; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        this.buffers.set(path, this.makeBuffer(path, text));
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // Takes the disk text into a buffer with no edits to keep (recreated if it changes editability).
  reload(path, buf, disk) {
    const next = editability({ remote: Boolean(this.on), text: disk });
    if (next.editable !== buf.editable || next.reason !== buf.reason) {
      buf.state.release();
      this.buffers.set(path, this.makeBuffer(path, disk));
      return;
    }
    buf.base = disk; buf.dirty = false; buf.conflict = false;
    buf.state.set_value(previewText(disk));
  }

  // After a folder change: clean buffers follow the disk, dirty ones that diverged become conflicts.
  async syncBuffers(context) {
    const { cwd: root, on } = context;
    for (const [path, buf] of [...this.buffers]) {
      if (buf.saving) continue;
      let disk;
      try { disk = await readTextFile(`${root}/${path}`, { on }); } catch { continue; }
      if (!this.current(context) || this.buffers.get(path) !== buf || buf.saving) continue;
      if (disk !== null && disk.includes("\0")) continue;
      switch (syncDecision({ base: buf.base, dirty: buf.dirty, value: buf.state.value() }, disk)) {
        case "none": buf.conflict = false; break;
        case "adopt": buf.base = disk; buf.dirty = false; buf.conflict = false; break;
        case "reload": this.reload(path, buf, disk); break;
        case "conflict": buf.conflict = true; break;
        case "drop":
          buf.state.release(); this.buffers.delete(path);
          if (this.file === path) this.fileError = GONE;
          break;
      }
    }
  }

  save(path, cx) {
    const buf = path ? this.buffers.get(path) : null;
    if (!buf?.editable || buf.saving) return;
    const file = `${this.root}/${path}`, value = buf.state.value(), base = buf.base;
    buf.saving = true;
    cx.spawn(async cx => {
      try {
        await writeTextFile(file, value, base);
        buf.base = value; buf.conflict = false; buf.dirty = buf.state.value() !== value;
      } catch (e) {
        // writeTextFile rejects stale snapshots and real failures alike: the disk tells them apart.
        const disk = await readTextFile(file).catch(() => undefined);
        if (disk !== undefined && saveFailure(base, disk) === "conflict") buf.conflict = true;
        else notify({ title: "저장하지 못했어요", body: `${path}\n${e}`, level: "error", timeout: 5000 });
      } finally { buf.saving = false; cx.notify(); }
    });
  }

  // Conflict: keep my edits, using what's on disk now as the expected snapshot.
  overwrite(path, cx) {
    const buf = this.buffers.get(path);
    if (!buf || buf.saving) return;
    const file = `${this.root}/${path}`;
    cx.spawn(async cx => {
      try {
        buf.base = await readTextFile(file);
        buf.conflict = false;
        this.save(path, cx);
      } catch (e) { notify({ title: "저장하지 못했어요", body: `${path}\n${e}`, level: "error", timeout: 5000 }); }
      finally { cx.notify(); }
    });
  }

  // Conflict: throw my edits away and take the disk.
  loadDisk(path, cx) {
    const buf = this.buffers.get(path);
    if (!buf) return;
    const file = `${this.root}/${path}`, on = this.on;
    cx.spawn(async cx => {
      try {
        const disk = await readTextFile(file, { on });
        if (this.buffers.get(path) !== buf) return;
        if (disk === null) {
          buf.state.release(); this.buffers.delete(path);
          if (this.file === path) this.fileError = GONE;
        } else this.reload(path, buf, disk);
      } catch (e) { notify({ title: "파일을 읽지 못했어요", body: `${path}\n${e}`, level: "error", timeout: 5000 }); }
      finally { cx.notify(); }
    });
  }

  // A split to the right of the focused pane, on the space's machine, running nano on the file.
  openInNano(path) {
    const folder = this.absolute(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    run("terminal.open", { argv: ["nano", this.absolute(path)], folder, place: "right" });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      const dirty = !entry.dir && this.buffers.get(path)?.dirty;
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", () => { this.drag = { text: quoteForPrompt(this.absolute(path)), name: entry.name, dir: entry.dir }; })
        .on_click((_e, cx) => { if (entry.dir) this.toggle(path, cx); else { this.show(path, cx); cx.notify(); } })
        .child(entry.dir ? svg(`mods/my-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/my-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(dirty), el => el.child(div().text_size(11).text_color(t.accent).child("●")))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), file = this.file, buf = file ? this.buffers.get(file) : null;
    const button = (id, label, onClick) => h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).cursor_pointer()
      .text_size(12).text_color(t.foreground).border_1().border_color(t.border).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const readonly = Boolean(file) && (Boolean(this.fileError) || Boolean(buf && !buf.editable));
    const bar = () => h_flex().h(34).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_mouse_up("left", () => { this.drag = null; })
      // Window-relative panel box (pointer minus its in-panel offset): a drop back on it cancels.
      .on_mouse_move(e => { if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; })
      .on_size_change(size => { this.size = size; })
      .on_hover(hovered => { if (!hovered) this.dropOut(); })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
          .child(file ? (buf?.dirty ? `● ${file}` : file) : this.root?.split(/[\\/]/).pop() ?? "")))
      .when(readonly, el => el.child(bar().text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(buf?.reason ? REASONS[buf.reason] : "미리보기 불가"))
        .child(button("files-nano", "nano로 열기", () => this.openInNano(file)))))
      .when(Boolean(buf?.conflict), el => el.child(bar()
        .child(div().flex_1().min_w(0).truncate().text_color(t.blocked).child("디스크의 파일이 바뀌었어요"))
        .child(button("files-overwrite", "내 것으로 덮어쓰기", cx => this.overwrite(file, cx)))
        .child(button("files-load", "디스크 버전 불러오기", cx => this.loadDisk(file, cx)))))
      .when(!file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(file), el => el.child(buf
        ? v_flex().id("files-editor").flex_1().min_h(0).key_context("MyFilesEditor")
          .on_action("my_files::Save", (_e, cx) => { this.save(file, cx); cx.notify(); })
          .child(Editor.new(buf.state).flex_1().min_h(0))
        : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
```

- [ ] **Step 2: check 통과**

Run: `herdr-app check ~/.config/herdr-app/mods/my-files && herdr-app status`
Expected: check 0 종료, status `"errors": []`.
- `bind_keys`가 액션 이름을 거부하면(check 오류에 action/keystroke 언급) 액션 이름을 `"my_files::save"` 또는 `"MyFiles::Save"`로 바꿔 `bind_keys`와 `on_action` 두 곳을 같이 고치고 다시 check 한다.
- `on_hover`/`key_context` 등이 없다는 오류가 나면 `mods/my-files/gpui-kit.d.ts`에서 이름을 확인해 맞춘다.

- [ ] **Step 3: 편집·저장 확인**

테스트용 파일을 만든다 (Bash):
```bash
mkdir -p <repo>/scratch && printf 'hello\n' > <repo>/scratch/edit-me.txt
```
herdr에서 `<repo>` 폴더의 터미널을 포커스하고 Files 패널을 연다.
1. `scratch/edit-me.txt`를 연다 → 읽기 전용 표시줄이 없다.
2. 글자를 입력한다 → 헤더 파일명 앞과 목록 행에 ●가 생긴다. 다시 원래대로 지우면 ●가 사라진다.
3. 수정 후 편집기 안에서 Ctrl+S → ●가 사라진다. `cat <repo>/scratch/edit-me.txt`로 반영 확인.
4. Ctrl+S가 반응하지 않으면: herdr `keys.json`이나 편집기가 `ctrl-s`를 먼저 가져가는 경우다. `bind_keys`의 `keystroke`를 `"ctrl-s"`로 바꿔 시도하고, 그래도 안 되면 `v_flex().id("files-editor")`에 `.on_key_down((e, cx) => { if (e.keystroke === "cmd-s") { cx.stop_propagation(); this.save(file, cx); cx.notify(); } })`를 추가한다.

- [ ] **Step 4: 저장 안 한 내용 유지 확인**

1. `edit-me.txt`를 고치고 저장하지 않은 채 ←로 돌아가 다른 파일을 열었다가 다시 `edit-me.txt`를 연다 → 고친 내용이 그대로, ● 유지.
2. 다른 스페이스로 전환했다가 돌아온다 → 같은 결과.
3. 고치지 않은 파일은 다른 파일을 열면 버퍼가 버려진다(다시 열면 디스크에서 새로 읽음).

- [ ] **Step 5: 디스크 변경·충돌 확인**

1. `edit-me.txt`를 열고 고치지 않은 상태에서 (Bash) `printf 'outside\n' >> <repo>/scratch/edit-me.txt` → 수 초 안에 화면에 `outside`가 나타난다(폴더 감시, 늦어도 10초 타이머).
2. 편집기에서 한 글자 고친 뒤(●) 같은 명령을 다시 실행 → "디스크의 파일이 바뀌었어요" 표시줄이 뜬다.
3. [디스크 버전 불러오기] → 내 수정이 사라지고 디스크 내용이 보이며 ●와 표시줄이 사라진다.
4. 다시 고치고, 바깥에서 파일을 바꾸고, [내 것으로 덮어쓰기] → 내 내용으로 저장되고 표시줄과 ●가 사라진다. `cat`으로 확인.
5. 고친 상태에서 바깥에서 바꾼 뒤 Ctrl+S → 저장이 거부되고 충돌 표시줄이 뜬다(오류 알림이 아님).

- [ ] **Step 6: 읽기 전용 + nano 확인**

큰 파일을 만든다 (Bash):
```bash
node -e "require('fs').writeFileSync('./scratch/big.txt', 'a'.repeat(500000))"
```
1. `big.txt`를 연다 → "큰 파일 · 일부만 표시" 표시줄과 [nano로 열기]. 입력이 안 된다.
2. [nano로 열기] → 포커스된 칸 오른쪽에 새 칸이 생기고 `nano <repo>\scratch\big.txt`가 열린다. `Ctrl+X`로 닫는다.
3. 원격 스페이스(remote-host)가 있으면: 그 스페이스의 터미널을 포커스하고 파일을 연다 → "원격 파일 · 읽기 전용". [nano로 열기] → 새 칸이 remote-host에서 열리는지 확인(프롬프트 호스트명). 로컬에서 열리면 `run("terminal.open", ...)` 대신 `run("pane.split", { direction: "right", argv: ["nano", this.absolute(path)] })`로 바꿔 다시 확인한다.
4. 알려진 동작: nano 칸이 포커스를 받으면 Files 패널은 그 칸의 작업 폴더 기준으로 바뀐다. 원래 터미널을 다시 클릭하면 이전 상태(저장 안 한 버퍼 포함)가 돌아온다.

- [ ] **Step 7: 드래그 회귀 확인**

Task 2 Step 6의 1~6을 다시 확인한다.

---

### Task 4: 마무리 검증·정리

**Files:**
- Delete: `<repo>\scratch\` (테스트용 파일)

- [ ] **Step 1: 전체 자동 확인**

Run (Bash):
```bash
cd <repo> && node --test tests/
herdr-app check ~/.config/herdr-app/mods/my-files
herdr-app check ~/.config/herdr-app/mods/my-files-drag
herdr-app status
```
Expected: 테스트 전부 PASS, check 둘 다 0 종료, status `"errors": []`.

- [ ] **Step 2: 스펙 검증 목록 대조**

스펙 "5. 검증"의 1~7을 하나씩 체크한다. 7번: 레이아웃을 잠시 `main`으로 바꿔(`herdr-app do layout.switch '{"name":"main"}'`) 기본 Files가 그대로 동작하는지 보고 `my-layout`으로 돌아온다(`herdr-app do layout.switch '{"name":"my-layout"}'`).

- [ ] **Step 3: 정리**

Run (Bash): `rm -rf <repo>/scratch`
`layouts/my-layout.json.bak`은 남겨 둔다(되돌리기용).
