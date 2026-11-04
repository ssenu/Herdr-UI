# Files 패널 파일 이름 검색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Files 패널 트리 화면 맨 위에 입력칸을 두고, 현재 루트 아래 모든 파일(`.git` 제외, 최대 50,000개)을 이름으로 퍼지 검색해 결과를 트리 대신 보여 준다.

**Architecture:** 순수 로직(퍼지 매칭·정렬·강조 구간, 목록 명령, 목록 출력 해석)은 `mods/my-files/logic.js`에 두고 `node --test`로 검사한다. `mods/my-files/main.js`는 `InputState`/`Input` 입력칸, 루트별 인덱스 캐시(첫 입력 때 명령 한 번으로 만들고, 폴더 감시가 바뀜을 알리면 오래됨 표시), 결과 행(트리 행과 같은 클릭·드래그·`⋯`)을 더한다.

**Tech Stack:** Herdr mod API (`gpui-kit`, `gpui-base` `InputState`/`Input`, `herdr` `exec`), Node 24 `node --test`, Windows PowerShell 5.1 (.NET `IO.Directory`), POSIX `sh`/`find`.

**Spec:** `docs/superpowers/specs/2026-11-04-files-search-design.md`

## Global Constraints

- 검색 대상은 파일 이름(경로)만. 내용 검색 없음.
- 모든 파일 포함(`.gitignore` 무시 안 함), **`.git` 폴더만 제외**, 링크·정션 폴더는 따라가지 않음.
- 인덱스 상한 **50,000개** (`INDEX_LIMIT = 50000`); 넘으면 `파일이 너무 많아 처음 50,000개에서만 찾아요`.
- 결과 최대 **200개**; 넘으면 `더 있어요 · 검색어를 더 입력하세요`. 0개면 `‘<검색어>’와 맞는 파일이 없어요`.
- 입력칸 플레이스홀더 정확히 `이 폴더에서 파일 찾기`; 만드는 중 표시 `목록 만드는 중…`; 실패 `파일 목록을 만들지 못했어요: <이유>`.
- 키: ↑/↓ 선택, Enter 열기, Esc 검색어 지우기.
- 경로는 셸 스크립트 문자열에 그대로 넣지 않는다: sh는 인자로, PowerShell은 작은따옴표 리터럴(`'`·`‘`·`’`·`‚`·`‛`는 두 번)로.
- `logic.js`는 `herdr`/`gpui-*`를 import하지 않는다.
- render 중에 `cx.notify()`를 부르지 않는다. `InputState.new`는 `init`에서만.
- 테스트는 파일을 명시해서 실행: `node --test tests/my-files-logic.test.mjs`. 전체는 `npm test`.
- 파일 편집은 편집 도구로(셸 heredoc은 백슬래시를 망가뜨린다).
- 저장소(`C:\MyCode\herdr-UI`)가 원본. 앱 확인은 `~/.config/herdr-app/mods/my-files`로 복사한 뒤.

## File Structure

- Modify `mods/my-files/logic.js` — 검색 함수(`fuzzyMatch`, `searchPaths`, `splitPath`, `segments`)와 목록 함수(`INDEX_LIMIT`, `psQuote`, `indexCommand`, `indexLines`) 추가.
- Modify `tests/my-files-logic.test.mjs` — 테스트 추가.
- Modify `mods/my-files/main.js` — 입력칸, 인덱스, 결과 목록; `⋯` 버튼을 메서드로 빼서 트리 행과 결과 행이 같이 씀.
- Modify `README.md`.

---

### Task 1: 퍼지 매칭 (logic.js)

**Files:**
- Modify: `mods/my-files/logic.js` (append)
- Test: `tests/my-files-logic.test.mjs` (append)

**Interfaces:**
- Produces:
  - `fuzzyMatch(query: string, path: string): { score: number, hits: number[] } | null`
  - `searchPaths(paths: string[], query: string, limit: number): { results: { path, score, hits }[], more: boolean }`
  - `splitPath(path: string): { dir: string, name: string }`
  - `segments(text: string, hits: number[]): { text: string, hit: boolean }[]`

- [ ] **Step 1: Write the failing tests** — append to `tests/my-files-logic.test.mjs`:

```js
test("fuzzyMatch: letters in order, case-insensitive, file name first", () => {
  assert.deepEqual(L.fuzzyMatch("mainjs", "mods/my-files/main.js").hits, [14, 15, 16, 17, 19, 20]);
  assert.ok(L.fuzzyMatch("MAIN", "mods/my-files/main.js"));
  assert.equal(L.fuzzyMatch("xyz", "mods/my-files/main.js"), null);
  assert.equal(L.fuzzyMatch("nm", "main.js"), null); // order matters
  assert.equal(L.fuzzyMatch("   ", "main.js"), null);
});

test("fuzzyMatch: every space-separated part must match", () => {
  assert.deepEqual(L.fuzzyMatch("files main", "mods/my-files/main.js").hits, [8, 9, 10, 11, 12, 14, 15, 16, 17]);
  assert.equal(L.fuzzyMatch("files zzz", "mods/my-files/main.js"), null);
});

test("fuzzyMatch scores: file name, consecutive letters, word starts", () => {
  const s = (q, p) => L.fuzzyMatch(q, p).score;
  assert.ok(s("main", "src/main.js") > s("main", "main/src/x.js"));
  assert.ok(s("abc", "abc.txt") > s("abc", "axbxc.txt"));
  assert.ok(s("fb", "FooBar.js") > s("fb", "fxxb.js"));
});

test("searchPaths: best first, limit and more", () => {
  const paths = ["main/src/x.js", "src/main.js", "docs/readme.md", "a/main.js"];
  const r = L.searchPaths(paths, "main", 2);
  assert.deepEqual(r.results.map(x => x.path), ["a/main.js", "src/main.js"]);
  assert.equal(r.more, true);
  assert.deepEqual(L.searchPaths(paths, "readme", 200), { results: [{ path: "docs/readme.md", ...L.fuzzyMatch("readme", "docs/readme.md") }], more: false });
  assert.deepEqual(L.searchPaths(paths, "zzz", 200), { results: [], more: false });
});

test("splitPath and segments", () => {
  assert.deepEqual(L.splitPath("mods/my-files/main.js"), { dir: "mods/my-files", name: "main.js" });
  assert.deepEqual(L.splitPath("README.md"), { dir: "", name: "README.md" });
  assert.deepEqual(L.segments("main.js", [0, 1, 5]), [{ text: "ma", hit: true }, { text: "in.", hit: false }, { text: "j", hit: true }, { text: "s", hit: false }]);
  assert.deepEqual(L.segments("ab", []), [{ text: "ab", hit: false }]);
  assert.deepEqual(L.segments("", []), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/my-files-logic.test.mjs`
Expected: new tests FAIL (`L.fuzzyMatch is not a function`), the existing 17 PASS.

- [ ] **Step 3: Implement** — append to `mods/my-files/logic.js`:

```js
// Letters of `part` in order inside `lower` from index `from`: their positions, or null.
function subsequence(lower, part, from) {
  const out = [];
  let j = from;
  for (const ch of part) {
    const i = lower.indexOf(ch, j);
    if (i < 0) return null;
    out.push(i);
    j = i + ch.length;
  }
  return out;
}

const wordStart = (path, i) => i === 0 || "/.-_ ".includes(path[i - 1]) || (/[a-z]/.test(path[i - 1]) && /[A-Z]/.test(path[i]));

function matchParts(parts, path) {
  const lower = path.toLowerCase(), nameStart = path.lastIndexOf("/") + 1, hits = new Set();
  let score = -path.length;
  for (const part of parts) {
    let found = subsequence(lower, part, nameStart), inName = true;
    if (!found) { found = subsequence(lower, part, 0); inName = false; }
    if (!found) return null;
    if (inName) score += 100;
    let prev = -2;
    for (const i of found) {
      score += 10;
      if (i === prev + 1) score += 15;
      if (wordStart(path, i)) score += 20;
      prev = i;
      hits.add(i);
    }
  }
  return { score, hits: [...hits].sort((a, b) => a - b) };
}

const queryParts = query => String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Fuzzy file-path match: every space-separated part of the query must appear in order (ignoring case),
 * tried in the file name first, then the whole path. Higher score is better; hits are matched positions.
 */
export function fuzzyMatch(query, path) {
  const parts = queryParts(query);
  return parts.length ? matchParts(parts, path) : null;
}

/** Matching paths, best first (then shorter, then alphabetical); at most `limit`, `more` if cut. */
export function searchPaths(paths, query, limit) {
  const parts = queryParts(query), all = [];
  if (!parts.length) return { results: [], more: false };
  for (const path of paths) {
    const m = matchParts(parts, path);
    if (m) all.push({ path, ...m });
  }
  all.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { results: all.slice(0, limit), more: all.length > limit };
}

/** "a/b/c.txt" → { dir: "a/b", name: "c.txt" }. */
export function splitPath(path) {
  const i = path.lastIndexOf("/");
  return { dir: i < 0 ? "" : path.slice(0, i), name: path.slice(i + 1) };
}

/** Runs of matched / unmatched characters, for highlighting. */
export function segments(text, hits) {
  const set = new Set(hits), out = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i), last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i], hit });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/my-files-logic.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add mods/my-files/logic.js tests/my-files-logic.test.mjs
git commit -m "my-files: fuzzy file path matching for search"
```

---

### Task 2: 파일 목록 명령 (logic.js)

**Files:**
- Modify: `mods/my-files/logic.js` (append)
- Test: `tests/my-files-logic.test.mjs` (append)

**Interfaces:**
- Produces:
  - `INDEX_LIMIT = 50000`
  - `psQuote(s: string): string` — PowerShell 작은따옴표 리터럴(`'`, U+2018, U+2019, U+201A, U+201B를 두 번).
  - `indexCommand(root: string, windows: boolean): { command: string, args: string[] }` — 출력: 루트 기준 상대경로 한 줄에 하나, 최대 `INDEX_LIMIT + 1`줄. 루트가 없으면 0이 아닌 종료 코드.
  - `indexLines(stdout: string, windows: boolean): { paths: string[], truncated: boolean }` — `/` 구분, `./` 없음.

- [ ] **Step 1: Write the failing tests** — append to `tests/my-files-logic.test.mjs` (add the imports at the top of the file next to the existing ones):

```js
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
```

```js
test("psQuote doubles straight and typographic single quotes", () => {
  assert.equal(L.psQuote("it's"), "'it''s'");
  assert.equal(L.psQuote("it’s ‘a‚b‛"), "'it’’s ‘‘a‚‚b‛‛'");
});

test("indexCommand: the root goes in as an argument or a quoted literal", () => {
  const sh = L.indexCommand("/r/it's", false);
  assert.equal(sh.command, "sh");
  assert.deepEqual(sh.args.slice(2), ["index", "/r/it's"]);
  assert.ok(sh.args[1].includes("head -n 50001"));
  const ps = L.indexCommand("C:\\a&b\\it's", true);
  assert.equal(ps.command, "powershell");
  assert.ok(ps.args[2].includes("'C:\\a&b\\it''s'"));
});

test("indexLines", () => {
  assert.deepEqual(L.indexLines("./a.txt\n./sub/b.md\n\n", false), { paths: ["a.txt", "sub/b.md"], truncated: false });
  assert.deepEqual(L.indexLines("a.txt\r\nsub\\b.md\r\n", true), { paths: ["a.txt", "sub/b.md"], truncated: false });
  assert.deepEqual(L.indexLines("./we\\ird.txt\n", false).paths, ["we\\ird.txt"]); // a backslash is a name character on Unix
  const many = Array.from({ length: L.INDEX_LIMIT + 1 }, (_, i) => `f${i}`).join("\n");
  const r = L.indexLines(many, false);
  assert.equal(r.paths.length, L.INDEX_LIMIT);
  assert.equal(r.truncated, true);
});

// The real scripts, on a folder whose name needs quoting.
function indexFixture() {
  const root = pjoin(mkdtempSync(pjoin(tmpdir(), "files-index-")), "a&b it's it’s 스킬");
  mkdirSync(pjoin(root, "sub"), { recursive: true });
  mkdirSync(pjoin(root, ".git"));
  mkdirSync(pjoin(root, ".hidden"));
  writeFileSync(pjoin(root, "top.txt"), "x");
  writeFileSync(pjoin(root, "sub", "inner.md"), "x");
  writeFileSync(pjoin(root, ".git", "HEAD"), "x");
  writeFileSync(pjoin(root, ".hidden", "x.txt"), "x");
  return root;
}
for (const windows of [true, false]) {
  const shell = windows ? "powershell" : "sh";
  const runs = !spawnSync(shell, windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"]).error;
  test(`indexCommand runs (${shell})`, { skip: !runs || (windows && process.platform !== "win32") }, () => {
    const native = indexFixture(), root = windows ? native : native.replaceAll("\\", "/");
    const c = L.indexCommand(root, windows);
    const r = spawnSync(c.command, c.args, { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(L.indexLines(r.stdout, windows).paths.sort(), [".hidden/x.txt", "sub/inner.md", "top.txt"]);
    const missing = L.indexCommand(root + "-missing", windows);
    assert.notEqual(spawnSync(missing.command, missing.args, { encoding: "utf8" }).status, 0);
  });
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/my-files-logic.test.mjs`
Expected: the new tests FAIL (`L.psQuote is not a function` …); others PASS.

- [ ] **Step 3: Implement** — append to `mods/my-files/logic.js`:

```js
/** How many paths the search index keeps. */
export const INDEX_LIMIT = 50000;

/** A PowerShell single-quoted literal. PowerShell also reads typographic single quotes as quotes. */
export function psQuote(s) {
  return "'" + String(s).replace(/['\u2018\u2019\u201A\u201B]/g, m => m + m) + "'";
}

/**
 * One command listing every file under root (relative paths, one per line), skipping .git folders
 * and not following links or junctions. Stops after INDEX_LIMIT + 1 lines. Fails if root is missing.
 */
export function indexCommand(root, windows) {
  if (windows) {
    const script = [
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      `$root = ${psQuote(root)}`,
      "if (-not [IO.Directory]::Exists($root)) { [Console]::Error.Write('folder not found'); exit 1 }",
      `$limit = ${INDEX_LIMIT + 1}; $n = 0`,
      "$sb = [Text.StringBuilder]::new(); $stack = [Collections.Generic.Stack[string]]::new(); $stack.Push($root)",
      "while ($stack.Count -gt 0 -and $n -lt $limit) { $d = $stack.Pop(); " +
        "try { foreach ($f in [IO.Directory]::EnumerateFiles($d)) { [void]$sb.Append($f.Substring($root.Length).TrimStart('\\', '/')).Append(\"`n\"); $n++; if ($n -ge $limit) { break } } } catch {}; " +
        "try { foreach ($s in [IO.Directory]::EnumerateDirectories($d)) { if ([IO.Path]::GetFileName($s) -ne '.git' -and -not ([IO.File]::GetAttributes($s) -band [IO.FileAttributes]::ReparsePoint)) { $stack.Push($s) } } } catch {} }",
      "[Console]::Out.Write($sb.ToString())",
    ].join("; ");
    return { command: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  const script = `cd "$1" || exit 1; find . -name .git -prune -o -type f -print | head -n ${INDEX_LIMIT + 1}`;
  return { command: "sh", args: ["-c", script, "index", root] };
}

/** indexCommand's output → relative "/" paths (at most INDEX_LIMIT) and whether it was cut. */
export function indexLines(stdout, windows) {
  const paths = [];
  for (const raw of String(stdout ?? "").split("\n")) {
    let line = raw.replace(/\r$/, "");
    if (windows) line = line.replaceAll("\\", "/");
    line = line.replace(/^\.\//, "");
    if (line) paths.push(line);
  }
  const truncated = paths.length > INDEX_LIMIT;
  return { paths: truncated ? paths.slice(0, INDEX_LIMIT) : paths, truncated };
}
```

Note: in the Windows script the JS source `'\\', '/'` produces the PowerShell text `'\', '/'`, and `\"\`n\"` produces `"`n"` (a newline in PowerShell).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/my-files-logic.test.mjs`
Expected: PASS; the `powershell` runtime case must run (not skip) on Windows. If the `sh` case fails only because of Git-Bash path handling, report it.

- [ ] **Step 5: Commit**

```bash
git add mods/my-files/logic.js tests/my-files-logic.test.mjs
git commit -m "my-files: one command to list every file under the root for search"
```

---

### Task 3: 검색 화면 (main.js) · README · 실제 확인

**Files:**
- Modify: `mods/my-files/main.js`
- Modify: `README.md`

**Interfaces:**
- Consumes (logic.js): `fuzzyMatch` (indirect), `searchPaths(paths, query, limit)`, `splitPath(path)`, `segments(text, hits)`, `indexCommand(root, windows)`, `indexLines(stdout, windows)`; existing `quoteForPrompt`.
- Existing main.js members used: `this.context` (`{ key, cwd, on }`), `this.root`, `this.on`, `this.buffers`, `this.marks`, `this.file`, `this.absolute(path)`, `this.show(path, cx)`, `this.drag`, `watch(root, cx)`.

- [ ] **Step 1: Imports**

In `mods/my-files/main.js` change
```js
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
```
to
```js
import { v_flex, h_flex, Editor, EditorState, TextView, InputState, Input } from "gpui-base";
```
and append to the `./logic.js` import list: `, searchPaths, splitPath, segments, indexCommand, indexLines`.

Below `const LANG = …` add:
```js
const RESULT_LIMIT = 200, REMOTE_INDEX_MS = 60000;
```

- [ ] **Step 2: State in `init`**

In `init`, right after `this.saved = new Map(); this.buffers = new Map();`, add:
```js
    // File search: the query, the selected result, and per-folder indexes (context key → index).
    this.query = ""; this.at = 0; this.indexes = new Map(); this.found = null;
    this.search = InputState.new({ placeholder: "이 폴더에서 파일 찾기" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); this.at = 0; this.ensureIndex(cx); cx.notify(); });
    this.search.on("submit", (_e, cx) => { this.openResult(cx); cx.notify(); });
```

- [ ] **Step 3: Mark the index stale on folder changes**

In `watch`, change the loop body
```js
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
```
to
```js
      try {
        while (this.context === context) {
          await watchFolder(root);
          const index = this.indexes.get(context.key);
          if (index) index.stale = true;
          if (this.current(context)) this.refresh(cx);
        }
      }
```

- [ ] **Step 4: Index, results, opening** — add these methods after `openInNano`:

```js
  // Builds (or rebuilds, when stale) the file list the search filters. Old results stay meanwhile.
  ensureIndex(cx) {
    const context = this.context;
    if (!this.query.trim() || !context?.cwd) return;
    const old = this.indexes.get(context.key);
    const outdated = !old || old.stale || Boolean(old.error) || (Boolean(context.on) && Date.now() - old.builtAt > REMOTE_INDEX_MS);
    if (old?.building || !outdated) return;
    const index = { paths: old?.paths ?? null, truncated: old?.truncated ?? false, builtAt: 0, stale: false, building: true, error: null };
    this.indexes.set(context.key, index);
    const windows = !context.on && window()?.platform === "windows";
    cx.spawn(async cx => {
      try {
        const c = indexCommand(context.cwd, windows);
        const r = await exec(c.command, c.args, { on: context.on });
        if (r.code !== 0) throw new Error((r.stderr || "").trim() || `exit ${r.code}`);
        const { paths, truncated } = indexLines(r.stdout, windows);
        index.paths = paths; index.truncated = truncated;
      } catch (e) {
        index.error = String(e?.message ?? e);
      } finally {
        index.building = false; index.builtAt = Date.now();
        cx.notify();
      }
    });
  }

  index() {
    return this.context ? this.indexes.get(this.context.key) ?? null : null;
  }

  // Search results for the current query, cached per (query, index paths).
  results() {
    const q = this.query.trim(), paths = this.index()?.paths;
    if (!q || !paths) return null;
    if (this.found?.q !== q || this.found.paths !== paths) this.found = { q, paths, value: searchPaths(paths, q, RESULT_LIMIT) };
    return this.found.value;
  }

  openResult(cx) {
    const r = this.results()?.results[this.at];
    if (r) this.show(r.path, cx);
  }

  clearSearch() {
    this.search.set_value("");
    this.query = ""; this.at = 0;
  }
```

- [ ] **Step 5: One `⋯` button for tree rows and result rows**

Add a method (before `rows`):
```js
  // Open with…: stops the press and click so the row neither drags, opens nor toggles.
  openButton(path, dir, t) {
    return div().id(`open-${path}`).w(20).h(20).flex_none().flex().items_center().justify_center().rounded(5)
      .text_color(t.dim).hover(s => s.bg(t.selected).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "my-files-open", kind: "popup", width: 200, height: 136, props: { path: this.absolute(path), dir } });
      })
      .child("⋯");
  }
```
In `rows`, replace the whole `// Open with…` comment line and the `.when(!this.on, el => el.child(div().id(\`open-${path}\`) … .child("⋯"))));` expression with:
```js
        .when(!this.on, el => el.child(this.openButton(path, entry.dir, t))));
```

- [ ] **Step 6: Result rows and the search view** — add after `rows`:

```js
  resultRow(r, i, t) {
    const path = r.path, { dir, name } = splitPath(path), start = path.length - name.length;
    const mark = this.marks[`${this.root}/${path}`], dirty = this.buffers.get(path)?.dirty;
    const nameHits = r.hits.filter(h => h >= start).map(h => h - start);
    return h_flex().id(`found-${path}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7).cursor_pointer()
      .when(i === this.at, el => el.bg(t.selected))
      .hover(s => s.bg(t.hover))
      .on_mouse_down("left", () => { this.drag = { text: quoteForPrompt(this.absolute(path)), name, dir: false }; })
      .on_click((_e, cx) => { this.at = i; this.show(path, cx); cx.notify(); })
      .child(svg("mods/my-files/file.svg").size(14).flex_none().text_color(t.muted))
      .child(h_flex().flex_none().overflow_hidden()
        .children(segments(name, nameHits).map(s => div().when(s.hit, el => el.text_color(t.accent).font_semibold()).child(s.text))))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dir))
      .when(Boolean(dirty), el => el.child(div().text_size(11).text_color(t.accent).child("●")))
      .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)))
      .when(!this.on, el => el.child(this.openButton(path, false, t)));
  }

  searchBar(t) {
    const index = this.index();
    return h_flex().h(36).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
      .on_key_down((e, cx) => {
        const n = this.results()?.results.length ?? 0;
        if (e.key === "down" && n) this.at = Math.min(this.at + 1, n - 1);
        else if (e.key === "up" && n) this.at = Math.max(this.at - 1, 0);
        else if (e.key === "escape" && this.query) this.clearSearch();
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().flex_none().text_color(t.dim).child("🔍"))
      .child(Input.new(this.search).flex_1().h_full().text_size(12.5).text_color(t.foreground))
      .when(Boolean(index?.building), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("목록 만드는 중…")));
  }

  foundView(t) {
    const index = this.index(), found = this.results(), q = this.query.trim();
    const note = text => div().p(8).text_size(12).text_color(t.dim).child(text);
    if (found && this.at >= found.results.length) this.at = Math.max(0, found.results.length - 1);
    return v_flex().id("files-found").flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .when(Boolean(index?.error), el => el.child(div().p(8).text_size(12).text_color(t.ansi1).child(`파일 목록을 만들지 못했어요: ${index.error}`)))
      .when(Boolean(index?.truncated), el => el.child(note("파일이 너무 많아 처음 50,000개에서만 찾아요")))
      .children(found ? found.results.map((r, i) => this.resultRow(r, i, t)) : [])
      .when(Boolean(found?.more), el => el.child(note("더 있어요 · 검색어를 더 입력하세요")))
      .when(Boolean(found) && found.results.length === 0, el => el.child(note(`‘${q}’와 맞는 파일이 없어요`)))
      .when(!found && !index?.error, el => el.child(note("목록 만드는 중…")));
  }
```

- [ ] **Step 7: Wire into `render`**

In `render`, replace
```js
      .when(!file, el => el.child(v_flex().id("files-tree")
```
with
```js
      .when(!file, el => el.child(this.searchBar(t)))
      .when(!file && Boolean(this.query.trim()), el => el.child(this.foundView(t)))
      .when(!file && !this.query.trim(), el => el.child(v_flex().id("files-tree")
```
(the rest of that `files-tree` expression stays as it is).

Also update the file's top comment: after the drag bullet add
```js
//  - a search box above the tree finds files by name (fuzzy) anywhere under the root (.git skipped);
```

- [ ] **Step 8: Tests, deploy, load-check**

Run: `node --test tests/my-files-logic.test.mjs` → PASS. `npm test` → PASS.
Run (Git Bash):
```bash
rm -rf ~/.config/herdr-app/mods/my-files && cp -r mods/my-files ~/.config/herdr-app/mods/my-files
herdr-app check "$USERPROFILE/.config/herdr-app/mods/my-files"
herdr-app status
```
Expected: check passes; status `errors` empty (ignore a pre-existing `cannot reach myserver`).

- [ ] **Step 9: README**

In `README.md` under `### Files 패널 (`my-files`)`, after the `**[바탕화면]**` bullet, add:
```markdown
- **파일 찾기**: 목록 위 입력칸에 이름 일부를 치면 지금 폴더 아래 **모든 파일**(`.git` 제외)에서 퍼지 검색합니다(`mainjs` → `mods/my-files/main.js`). 공백으로 나누면 조각이 모두 맞아야 합니다. ↑/↓ 선택, Enter 열기, Esc 지우기. 결과 행도 클릭·드래그·`⋯` 가 트리와 같습니다. 처음 입력할 때 목록을 만들고, 폴더가 바뀌면 다음 입력 때 다시 만듭니다.
```
In `## 알려진 한계` add:
```markdown
- 파일 찾기는 폴더당 처음 50,000개 파일에서만 찾고, 결과는 200개까지 보여 줍니다. 링크·정션 폴더 안은 찾지 않습니다.
```

- [ ] **Step 10: Commit**

```bash
git add mods/my-files/main.js README.md
git commit -m "my-files: search box to find files by name under the root"
```

- [ ] **Step 11: Hands-on check with the user** (controller, not the implementer)

Ask the user to check in the app: typing `mainjs` in this repo finds `mods/my-files/main.js` with highlighted letters; ↑/↓/Enter/Esc; clicking opens (`.md` in preview); `←` returns to the same results; drag a result into a terminal types the absolute path; `⋯` works; a big folder shows `목록 만드는 중…` then results; creating a new file then typing again finds it.
