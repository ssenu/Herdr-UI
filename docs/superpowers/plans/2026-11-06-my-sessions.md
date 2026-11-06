# Sessions 패널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 탭 바의 Session 버튼으로 여는 패널. 지금 저장소(또는 지금 폴더)에서 시작한 Claude Code 세션을 최근 순으로 보여 주고, 행을 누르면 새 탭에서 `claude -r <ID>`로 다시 연다.

**Architecture:** 새 mod `mods/my-sessions`. 경로 변환·출력 해석·범위 필터·표시 문구·목록 명령은 `logic.js`의 순수 함수로 두고 실제 PowerShell/sh 실행까지 테스트한다. `main.js`는 `mods/my-plugins/main.js`와 같은 구조(`location()`, `visible()`, `loading`/`again` 새로고침)다.

**Tech Stack:** Herdr mod API (`gpui-kit`, `gpui-base`, `herdr` `exec`/`run`), Node 24 `node --test`, Windows PowerShell 5.1, POSIX sh.

**Spec:** `docs/superpowers/specs/2026-11-06-my-sessions-design.md`

## Global Constraints

- 범위: Claude Code 세션만. 세션 삭제·이름 변경·미리보기·검색 없음.
- 대화 내용을 패널로 가져오지 않는다: 명령은 `cwd`, `customTitle`, `aiTitle`, `gitBranch`, 세션 ID, 수정 시각만 출력한다.
- 파일당 앞 **262144 바이트**(첫 `cwd`)와 끝 **65536 바이트**(마지막 제목·브랜치)만 읽는다. 읽는 파일은 최신순 최대 **300개**, 보여 주는 행은 최대 **100개**(넘으면 `최근 100개만 보여 줘요`).
- 앞부분에 `cwd`가 없는 파일은 빈 세션: 목록에서 뺀다.
- 세션 ID는 UUID 형식만 받는다.
- 제목 우선순위 `customTitle` → `aiTitle` → `(제목 없음)`.
- 칩은 정확히 `전체`(기본), `지금 폴더`. 칩 전환은 다시 읽지 않는다.
- 빈 화면: `이 저장소에 세션이 없어요` / `이 폴더에서 시작한 세션이 없어요`; 폴더 없음 `폴더가 없어요`; 처음 읽는 중 `불러오는 중…`.
- 경로는 셸 스크립트 문자열에 그대로 넣지 않는다: sh는 인자로, PowerShell은 작은따옴표 리터럴(`'`, U+2018, U+2019, U+201A, U+201B는 두 번)로.
- `logic.js`는 `herdr`/`gpui-*`를 import하지 않는다. render 중에 `cx.notify()`를 부르지 않는다.
- 테스트는 파일을 명시해서 실행: `node --test tests/my-sessions-logic.test.mjs`. 전체는 `npm test`.
- 파일 편집은 편집 도구로(셸 heredoc은 백슬래시를 망가뜨린다). 테스트에서 세션 내용은 임시 폴더에 만든 가짜 파일만 쓴다. 실제 `~/.claude/projects` 내용을 출력하거나 보고서에 옮기지 않는다.

## File Structure

- Create `mods/my-sessions/logic.js`, `mods/my-sessions/main.js`, `mods/my-sessions/mod.json`, `mods/my-sessions/sessions.svg`.
- Create `tests/my-sessions-logic.test.mjs`.
- Modify `mods/my-tabs/main.js`, `install.ps1`, `package.json`, `README.md`.

---

### Task 1: 순수 로직 (경로 · 출력 해석 · 범위 · 표시)

**Files:**
- Create: `mods/my-sessions/logic.js`
- Test: `tests/my-sessions-logic.test.mjs`

**Interfaces:**
- Produces (`logic.js` exports):
  - `encodeProject(path: string): string`
  - `normPath(p): string`, `samePath(a, b): boolean`, `isUnder(path, base): boolean` (같거나 하위)
  - `startFolder(dir: string, cwd: string): string`
  - `worktreePaths(porcelain: string, root: string): string[]` (root 먼저, 중복 없음)
  - `sessionLines(stdout: string): { dir, id, mtime: number, cwd, customTitle, aiTitle, branch }[]`
  - `toSessions(rows): { id, title, mtime, branch, folder }[]`
  - `inScope(session, scope: "all"|"here", { worktrees, cwd }): boolean`
  - `pickSessions(sessions, scope, ctx, limit): { items, more: boolean }` (최신순)
  - `relativeTime(ms: number, now: number): string`
  - `sessionMeta(session, root: string, now: number): string`
  - `tabTitle(title: string): string` (탭 이름용, 최대 40자)
  - `emptyText(scope): string`

- [ ] **Step 1: Write the failing tests** — create `tests/my-sessions-logic.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-sessions/logic.js", import.meta.url).href);

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

test("encodeProject: everything but letters and digits becomes a dash", () => {
  assert.equal(L.encodeProject("C:\\MyCode\\herdr-UI"), "C--MyCode-herdr-UI");
  assert.equal(L.encodeProject("C:/Users/me/바탕 화면/x"), "C--Users-me-------x");
  assert.equal(L.encodeProject("/home/me/a.b_c"), "-home-me-a-b-c");
  assert.equal(L.encodeProject("C:\\MyCode\\app\\"), "C--MyCode-app");
  assert.equal(L.encodeProject("C:\\"), "C--");
});

test("samePath and isUnder", () => {
  assert.ok(L.samePath("C:\\MyCode\\App", "c:/mycode/app/"));
  assert.ok(!L.samePath("/home/A", "/home/a"));
  assert.ok(L.isUnder("C:\\MyCode\\app\\sub", "c:/mycode/app"));
  assert.ok(L.isUnder("/r/app", "/r/app"));
  assert.ok(!L.isUnder("/r/app-old", "/r/app"));
  assert.ok(!L.isUnder("/r", "/r/app"));
});

test("startFolder: the folder the session's storage name stands for", () => {
  assert.equal(L.startFolder("C--MyCode-app", "C:\\MyCode\\app"), "C:\\MyCode\\app");
  assert.equal(L.startFolder("C--MyCode-app", "C:\\MyCode\\app\\mods\\x"), "C:\\MyCode\\app");
  assert.equal(L.startFolder("c--mycode-app", "C:\\MyCode\\App\\x"), "C:\\MyCode\\App");
  assert.equal(L.startFolder("C--", "C:\\Users"), "C:\\");
  assert.equal(L.startFolder("-r-app", "/r/app/sub"), "/r/app");
  assert.equal(L.startFolder("-other", "/r/app/sub"), "/r/app/sub"); // not found: cwd itself
});

test("worktreePaths", () => {
  const out = "worktree C:/r/app\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/r/app-wt\nHEAD def\ndetached\n\n";
  assert.deepEqual(L.worktreePaths(out, "C:\\r\\app"), ["C:\\r\\app", "C:/r/app-wt"]);
  assert.deepEqual(L.worktreePaths("", "/r"), ["/r"]);
});

test("sessionLines: tab-separated rows with JSON tokens", () => {
  const line = ["FILE", "C--r-app", U1, "1700000000", '"C:\\\\r\\\\app"', "", '"제목 \\"하나\\""', '"main"'].join("\t");
  assert.deepEqual(L.sessionLines(`${line}\r\n\r\n`), [
    { dir: "C--r-app", id: U1, mtime: 1700000000, cwd: "C:\\r\\app", customTitle: "", aiTitle: '제목 "하나"', branch: "main" },
  ]);
  const badToken = ["FILE", "d", U1, "1", '"/r"', '"broken', '"ok"', ""].join("\t");
  assert.equal(L.sessionLines(badToken)[0].customTitle, "");
  assert.equal(L.sessionLines(badToken)[0].aiTitle, "ok");
  assert.deepEqual(L.sessionLines(["FILE", "d", U1, "1", "", "", "", ""].join("\t")), []); // no cwd
  assert.deepEqual(L.sessionLines(["FILE", "d", U1, "x", '"/r"', "", "", ""].join("\t")), []); // bad time
  assert.deepEqual(L.sessionLines("something else\n"), []);
});

test("toSessions: title order, start folder, UUID ids only", () => {
  const base = { dir: "-r-app", id: U1, mtime: 5, cwd: "/r/app/sub", branch: "main" };
  const [a] = L.toSessions([{ ...base, customTitle: "내 이름", aiTitle: "자동" }]);
  assert.deepEqual(a, { id: U1, title: "내 이름", mtime: 5, branch: "main", folder: "/r/app" });
  assert.equal(L.toSessions([{ ...base, customTitle: "", aiTitle: "자동\n제목" }])[0].title, "자동 제목");
  assert.equal(L.toSessions([{ ...base, customTitle: "", aiTitle: "" }])[0].title, "(제목 없음)");
  assert.deepEqual(L.toSessions([{ ...base, id: "../evil", customTitle: "", aiTitle: "" }]), []);
  assert.deepEqual(L.toSessions([{ ...base, id: "--dangerous", customTitle: "", aiTitle: "" }]), []);
});

test("inScope and pickSessions", () => {
  const ctx = { worktrees: ["C:\\r\\app", "C:/r/wt"], cwd: "C:\\r\\app\\sub" };
  const s = (id, folder, mtime) => ({ id, title: id, mtime, branch: "", folder });
  const list = [s("root", "C:\\r\\app", 3), s("sub", "C:\\r\\app\\sub", 5), s("wt", "C:\\r\\wt", 4), s("old", "C:\\r\\app-old", 9)];
  assert.ok(L.inScope(list[0], "all", ctx));
  assert.ok(L.inScope(list[2], "all", ctx));
  assert.ok(!L.inScope(list[3], "all", ctx));
  assert.ok(!L.inScope(list[0], "here", ctx));
  assert.ok(L.inScope(list[1], "here", ctx));
  assert.deepEqual(L.pickSessions(list, "all", ctx, 2), { items: [list[1], list[2]], more: true });
  assert.deepEqual(L.pickSessions(list, "here", ctx, 2), { items: [list[1]], more: false });
  assert.deepEqual(L.pickSessions(list, "all", ctx, 3).more, false);
});

test("relativeTime", () => {
  const now = 1000 * 60 * 60 * 24 * 400;
  assert.equal(L.relativeTime(now - 30 * 1000, now), "방금");
  assert.equal(L.relativeTime(now - 5 * 60 * 1000, now), "5분 전");
  assert.equal(L.relativeTime(now - 3 * 3600 * 1000, now), "3시간 전");
  assert.equal(L.relativeTime(now - 2 * 86400 * 1000, now), "2일 전");
  assert.equal(L.relativeTime(now - 65 * 86400 * 1000, now), "2개월 전");
  assert.equal(L.relativeTime(now + 5000, now), "방금");
});

test("sessionMeta: time, branch, and the folder unless it is the root", () => {
  const now = 10 * 3600 * 1000;
  const at = 7 * 3600; // seconds: three hours before now
  const s = (folder, branch) => ({ id: U2, title: "t", mtime: at, branch, folder });
  assert.equal(L.sessionMeta(s("C:\\r\\app", "main"), "C:/r/app", now), "3시간 전 · main");
  assert.equal(L.sessionMeta(s("C:\\r\\app\\mods\\x", "main"), "C:/r/app", now), "3시간 전 · main · mods/x");
  assert.equal(L.sessionMeta(s("C:\\r\\wt", ""), "C:/r/app", now), "3시간 전 · wt");
});

test("tabTitle and emptyText", () => {
  assert.equal(L.tabTitle("짧은 제목"), "짧은 제목");
  const long = L.tabTitle("가".repeat(60));
  assert.equal(long.length, 40);
  assert.ok(long.endsWith("…"));
  assert.equal(L.emptyText("all"), "이 저장소에 세션이 없어요");
  assert.equal(L.emptyText("here"), "이 폴더에서 시작한 세션이 없어요");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/my-sessions-logic.test.mjs`
Expected: FAIL — `Cannot find module …/mods/my-sessions/logic.js`.

- [ ] **Step 3: Implement** — create `mods/my-sessions/logic.js`:

```js
// Pure helpers for my-sessions. No herdr or gpui imports, so `node --test` can load this file.

// Keeps "C:\" and "/" whole; drops a trailing separator otherwise.
function trimSep(p) {
  const s = String(p ?? "");
  if (s === "/" || /^[A-Za-z]:[\\/]$/.test(s)) return s;
  return s.replace(/[\\/]+$/, "") || s;
}

/** Claude Code's folder name under ~/.claude/projects for a working folder. */
export function encodeProject(path) {
  return trimSep(path).replace(/[^A-Za-z0-9]/g, "-");
}

/** For comparing paths: "/" separators, no trailing one; Windows drive paths ignore case. */
export function normPath(p) {
  let s = String(p ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:/.test(s)) s = s.toLowerCase();
  return s;
}

export const samePath = (a, b) => normPath(a) === normPath(b);

/** path is base or inside it. */
export function isUnder(path, base) {
  const p = normPath(path), b = normPath(base);
  return p === b || p.startsWith(b + "/");
}

function parentPath(p) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return null;
  if (i === 0) return p.length > 1 ? p[0] : null;
  const up = p.slice(0, i);
  if (/^[A-Za-z]:$/.test(up)) return p.length > 3 ? up + p[i] : null;
  return up;
}

/**
 * The folder a session was stored for: cwd or the nearest parent whose encoded name is `dir`
 * (the first recorded cwd can be a subfolder). `claude -r` must run there. Falls back to cwd.
 */
export function startFolder(dir, cwd) {
  const start = trimSep(cwd), drive = /^[A-Za-z]:/.test(start);
  const same = x => (drive ? encodeProject(x).toLowerCase() === String(dir).toLowerCase() : encodeProject(x) === dir);
  let cur = start;
  for (let n = 0; cur !== null && n < 64; n++) {
    if (same(cur)) return cur;
    cur = parentPath(cur);
  }
  return start;
}

/** `git worktree list --porcelain` → the worktree folders, root first, no duplicates. */
export function worktreePaths(porcelain, root) {
  const out = [root];
  for (const line of String(porcelain ?? "").split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) continue;
    const path = line.slice("worktree ".length);
    if (path && !out.some(p => samePath(p, path))) out.push(path);
  }
  return out;
}

function jsonToken(token) {
  if (!token) return "";
  try {
    const v = JSON.parse(token);
    return typeof v === "string" ? v : "";
  } catch { return ""; }
}

/** sessionsCommand's output → rows. Lines without a usable cwd or time are dropped. */
export function sessionLines(stdout) {
  const rows = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const f = line.split("\t");
    if (f[0] !== "FILE" || f.length < 8) continue;
    const cwd = jsonToken(f[4]), mtime = Number(f[3]);
    if (!cwd || !Number.isFinite(mtime)) continue;
    rows.push({ dir: f[1], id: f[2], mtime, cwd, customTitle: jsonToken(f[5]), aiTitle: jsonToken(f[6]), branch: jsonToken(f[7]) });
  }
  return rows;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows → sessions to show. The id goes into a command line, so only real UUIDs pass. */
export function toSessions(rows) {
  return rows.filter(r => UUID.test(r.id)).map(r => ({
    id: r.id,
    title: (r.customTitle || r.aiTitle || "(제목 없음)").replace(/\s+/g, " ").trim(),
    mtime: r.mtime,
    branch: r.branch,
    folder: startFolder(r.dir, r.cwd),
  }));
}

/** "all": started in a worktree of this repository or below. "here": started in the focused folder. */
export function inScope(session, scope, { worktrees, cwd }) {
  return scope === "here" ? samePath(session.folder, cwd) : worktrees.some(w => isUnder(session.folder, w));
}

/** Sessions in scope, newest first, at most `limit`. */
export function pickSessions(sessions, scope, ctx, limit) {
  const all = sessions.filter(s => inScope(s, scope, ctx)).sort((a, b) => b.mtime - a.mtime || (a.id < b.id ? -1 : 1));
  return { items: all.slice(0, limit), more: all.length > limit };
}

export function relativeTime(ms, now) {
  const minutes = Math.floor((now - ms) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

const slashes = p => String(p).replaceAll("\\", "/").replace(/\/+$/, "");

/** The row's second line: time · branch · folder (left out when it is the repository root). */
export function sessionMeta(session, root, now) {
  let folder = null;
  if (!samePath(session.folder, root)) {
    folder = isUnder(session.folder, root)
      ? slashes(session.folder).slice(slashes(root).length + 1)
      : slashes(session.folder).split("/").pop();
  }
  return [relativeTime(session.mtime * 1000, now), session.branch || null, folder].filter(Boolean).join(" · ");
}

/** A session title as a tab name. */
export function tabTitle(title) {
  return title.length > 40 ? title.slice(0, 39) + "…" : title;
}

export function emptyText(scope) {
  return scope === "here" ? "이 폴더에서 시작한 세션이 없어요" : "이 저장소에 세션이 없어요";
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/my-sessions-logic.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add mods/my-sessions/logic.js tests/my-sessions-logic.test.mjs
git commit -m "my-sessions: paths, session rows, scope and labels"
```

---

### Task 2: 세션 목록 명령 (실제 PowerShell·sh 테스트)

**Files:**
- Modify: `mods/my-sessions/logic.js` (append)
- Test: `tests/my-sessions-logic.test.mjs` (append)

**Interfaces:**
- Consumes: `sessionLines` (Task 1).
- Produces:
  - `psQuote(s: string): string`
  - `sessionsCommand(prefixes: string[], windows: boolean): { command: string, args: string[] }` — `prefixes`는 `encodeProject` 결과. 저장 폴더 이름이 접두어와 같거나 `접두어-`로 시작하면 후보. 출력 형식은 `sessionLines`가 읽는 `FILE<TAB>저장폴더<TAB>ID<TAB>epoch초<TAB>cwd토큰<TAB>custom토큰<TAB>ai토큰<TAB>branch토큰`. 홈은 Windows `USERPROFILE`, sh `HOME`. `~/.claude/projects`가 없으면 출력 없이 종료 코드 0.

- [ ] **Step 1: Write the failing tests** — append to `tests/my-sessions-logic.test.mjs`:

```js
test("psQuote doubles straight and typographic single quotes", () => {
  assert.equal(L.psQuote("it's"), "'it''s'");
  assert.equal(L.psQuote("‘a’b‚c‛"), "'‘‘a’’b‚‚c‛‛'");
});

test("sessionsCommand: prefixes go in as arguments or quoted literals", () => {
  const sh = L.sessionsCommand(["-r-app", "-r-wt"], false);
  assert.equal(sh.command, "sh");
  assert.equal(sh.args[0], "-c");
  assert.deepEqual(sh.args.slice(2), ["sessions", "-r-app", "-r-wt"]);
  assert.ok(sh.args[1].includes("head -n 300"));
  const ps = L.sessionsCommand(["C--r-app"], true);
  assert.equal(ps.command, "powershell");
  assert.ok(ps.args[2].includes("@('C--r-app')"));
  assert.ok(ps.args[2].includes("-First 300"));
});

// A fake home holding fake session files; nothing here touches the real ~/.claude.
function sessionsFixture() {
  const home = pjoin(mkdtempSync(pjoin(tmpdir(), "sessions-")), "a&b it's it’s 홈");
  const projects = pjoin(home, ".claude", "projects");
  const put = (dir, id, records) => {
    mkdirSync(pjoin(projects, dir), { recursive: true });
    writeFileSync(pjoin(projects, dir, `${id}.jsonl`), records.map(r => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n");
  };
  const pad = JSON.stringify({ type: "pad", text: "x".repeat(300000) });
  const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
  // Text quoting "cwd":"…" inside a message is escaped in the file, so it must not count as the cwd.
  put("C--r-app", id(1), [
    { type: "user", message: '"cwd":"C:\\fake" "aiTitle":"fake"' },
    { type: "user", cwd: "C:\\r\\app\\sub", gitBranch: "old" },
    { type: "ai-title", aiTitle: "첫 제목" },
    { type: "ai-title", aiTitle: '나중 "제목"' },
    { type: "user", cwd: "C:\\r\\app\\sub", gitBranch: "main" },
  ]);
  put("C--r-app", id(2), [{ cwd: "C:\\r\\app" }, { type: "custom-title", customTitle: "내 이름" }, { type: "ai-title", aiTitle: "자동" }]);
  put("C--r-app", id(3), [{ type: "mode", mode: "default" }]); // empty session: no cwd
  put("C--r-app", id(4), [pad, { cwd: "C:\\r\\app" }]); // cwd past the first 256 KB: treated as empty
  put("C--r-app", id(5), [{ cwd: "C:\\r\\app" }, { type: "ai-title", aiTitle: "오래된 제목" }, pad, { type: "x" }]); // title before the last 64 KB is not read
  mkdirSync(pjoin(projects, "C--r-app", id(1)), { recursive: true });
  writeFileSync(pjoin(projects, "C--r-app", id(1), `${id(9)}.jsonl`), JSON.stringify({ cwd: "C:\\r\\app" }) + "\n"); // a nested file is not a session
  put("C--r-app-old", id(6), [{ cwd: "C:\\r\\app-old" }]); // name matches; main.js filters it by path
  put("C--r-app2", id(7), [{ cwd: "C:\\r\\app2" }]); // no dash after the prefix: not a candidate
  put("C--other", id(8), [{ cwd: "C:\\other" }]);
  put("-r-unix", id(9), [{ cwd: "/r/unix" }]); // Unix storage names start with a dash
  return { home, id };
}
for (const windows of [true, false]) {
  const shell = windows ? "powershell" : "sh";
  const runs = !spawnSync(shell, windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"]).error;
  test(`sessionsCommand runs (${shell})`, { skip: !runs || (windows && process.platform !== "win32") }, () => {
    const { home, id } = sessionsFixture();
    const env = { ...process.env, USERPROFILE: home, HOME: windows ? home : home.replaceAll("\\", "/") };
    const c = L.sessionsCommand(["C--r-app"], windows);
    const r = spawnSync(c.command, c.args, { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    const rows = L.sessionLines(r.stdout);
    assert.deepEqual(rows.map(x => x.id).sort(), [id(1), id(2), id(5), id(6)]);
    const by = n => rows.find(x => x.id === id(n));
    assert.equal(by(1).dir, "C--r-app");
    assert.equal(by(1).cwd, "C:\\r\\app\\sub");
    assert.equal(by(1).aiTitle, '나중 "제목"');
    assert.equal(by(1).branch, "main");
    assert.ok(by(1).mtime > 1600000000);
    assert.equal(by(2).customTitle, "내 이름");
    assert.equal(by(2).aiTitle, "자동");
    assert.equal(by(5).aiTitle, "");
    assert.equal(by(6).dir, "C--r-app-old");
    const unix = L.sessionsCommand(["-r-unix"], windows);
    const dash = spawnSync(unix.command, unix.args, { encoding: "utf8", env });
    assert.equal(dash.status, 0, dash.stderr);
    assert.deepEqual(L.sessionLines(dash.stdout).map(x => [x.dir, x.id, x.cwd]), [["-r-unix", id(9), "/r/unix"]]);
    // No projects folder: nothing, and no failure.
    const empty = { ...env, USERPROFILE: pjoin(home, "none"), HOME: windows ? pjoin(home, "none") : pjoin(home, "none").replaceAll("\\", "/") };
    const none = spawnSync(c.command, c.args, { encoding: "utf8", env: empty });
    assert.equal(none.status, 0, none.stderr);
    assert.deepEqual(L.sessionLines(none.stdout), []);
  });
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/my-sessions-logic.test.mjs`
Expected: new tests FAIL (`L.psQuote is not a function` …); Task 1's PASS.

- [ ] **Step 3: Implement** — append to `mods/my-sessions/logic.js`:

```js
/** A PowerShell single-quoted literal. PowerShell also reads typographic single quotes as quotes. */
export function psQuote(s) {
  return "'" + String(s).replace(/['\u2018\u2019\u201A\u201B]/g, m => m + m) + "'";
}

const HEAD_BYTES = 262144, TAIL_BYTES = 65536, MAX_FILES = 300;

/**
 * One command printing a FILE line per session under ~/.claude/projects/<prefix or prefix-*>:
 * only the first cwd, the last titles and the last branch, read from the file's two ends.
 * Files without a cwd in the first part are skipped. See sessionLines for the format.
 */
export function sessionsCommand(prefixes, windows) {
  if (windows) {
    const token = key => `'"${key}":("(?:[^"\\\\]|\\\\.)*")'`;
    const script = [
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$base = Join-Path $env:USERPROFILE '.claude\\projects'",
      "if (-not [IO.Directory]::Exists($base)) { exit 0 }",
      `$prefixes = @(${prefixes.map(psQuote).join(", ")})`,
      "$files = @(foreach ($d in [IO.Directory]::GetDirectories($base)) { $n = [IO.Path]::GetFileName($d); foreach ($p in $prefixes) { " +
        "if ($n -ieq $p -or $n.StartsWith($p + '-', [StringComparison]::OrdinalIgnoreCase)) { ([IO.DirectoryInfo]$d).GetFiles('*.jsonl'); break } } })",
      `$files = @($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First ${MAX_FILES})`,
      "$utf8 = [Text.UTF8Encoding]::new($false)",
      "function Last($text, $pattern) { $m = [regex]::Matches($text, $pattern); if ($m.Count) { $m[$m.Count - 1].Groups[1].Value } else { '' } }",
      "foreach ($f in $files) { try { " +
        "$s = [IO.File]::Open($f.FullName, 'Open', 'Read', 'ReadWrite, Delete'); " +
        "try { $len = $s.Length; " +
        `$b = New-Object byte[] ([Math]::Min($len, ${HEAD_BYTES})); [void]$s.Read($b, 0, $b.Length); $head = $utf8.GetString($b); ` +
        `$n = [Math]::Min($len, ${TAIL_BYTES}); [void]$s.Seek(-$n, 'End'); $b = New-Object byte[] $n; [void]$s.Read($b, 0, $n); $tail = $utf8.GetString($b) ` +
        "} finally { $s.Close() }; " +
        `$m = [regex]::Match($head, ${token("cwd")}); if (-not $m.Success) { continue }; ` +
        "$t = [DateTimeOffset]::new($f.LastWriteTimeUtc).ToUnixTimeSeconds(); " +
        `$custom = Last $tail ${token("customTitle")}; $ai = Last $tail ${token("aiTitle")}; $branch = Last $tail ${token("gitBranch")}; ` +
        "\"FILE`t$($f.Directory.Name)`t$($f.BaseName)`t$t`t$($m.Groups[1].Value)`t$custom`t$ai`t$branch\" " +
        "} catch {} }",
    ].join("; ");
    return { command: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  const grab = (key, pick) => `grep -a -o -E '"${key}":"([^"\\\\]|\\\\.)*"' | ${pick} -n 1 | sed 's/^"[A-Za-z]*"://'`;
  const script =
    'base="$HOME/.claude/projects"; [ -d "$base" ] || exit 0; cd "$base" || exit 1; ' +
    // "./" first: on Unix every storage name starts with "-", which head, tail and stat would read as an option.
    'for p in "$@"; do for f in "./$p"/*.jsonl "./$p"-*/*.jsonl; do [ -f "$f" ] || continue; ' +
    'm=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f"); printf "%s\\t%s\\n" "$m" "$f"; done; done | ' +
    `sort -u | sort -rn | head -n ${MAX_FILES} | while IFS="$(printf "\\t")" read -r m f; do ` +
    `cwd=$(head -c ${HEAD_BYTES} "$f" | ${grab("cwd", "head")}); [ -n "$cwd" ] || continue; ` +
    `custom=$(tail -c ${TAIL_BYTES} "$f" | ${grab("customTitle", "tail")}); ` +
    `ai=$(tail -c ${TAIL_BYTES} "$f" | ${grab("aiTitle", "tail")}); ` +
    `branch=$(tail -c ${TAIL_BYTES} "$f" | ${grab("gitBranch", "tail")}); ` +
    'rest=${f#./}; dir=${rest%%/*}; id=${f##*/}; id=${id%.jsonl}; ' +
    'printf "FILE\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$dir" "$id" "$m" "$cwd" "$custom" "$ai" "$branch"; done';
  return { command: "sh", args: ["-c", script, "sessions", ...prefixes] };
}
```

Notes: `token("cwd")` must produce the PowerShell text `'"cwd":("(?:[^"\\]|\\.)*")'`. In `grab`, the JS `\\\\` is `\\` in the single-quoted shell text. If a real-script test fails because of escaping, print the generated script and fix the JS string; do not weaken the test.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/my-sessions-logic.test.mjs`
Expected: PASS; the `powershell` runtime case must run (not skip). Report the `sh` case's outcome.

- [ ] **Step 5: Commit**

```bash
git add mods/my-sessions/logic.js tests/my-sessions-logic.test.mjs
git commit -m "my-sessions: one command reading session titles from file ends"
```

---

### Task 3: 패널 mod

**Files:**
- Create: `mods/my-sessions/main.js`, `mods/my-sessions/mod.json`, `mods/my-sessions/sessions.svg`

**Interfaces:**
- Consumes (logic.js): `encodeProject, worktreePaths, sessionLines, toSessions, pickSessions, sessionMeta, tabTitle, emptyText, sessionsCommand`.
- Produces: block mod `my-sessions`; layout block id `sessions` (Task 4 wires it). Panel visible when `panel-body.active === "sessions"`.

- [ ] **Step 1: Create `mods/my-sessions/mod.json`**

```json
{ "place": "none" }
```

- [ ] **Step 2: Create `mods/my-sessions/sessions.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/></svg>
```

- [ ] **Step 3: Create `mods/my-sessions/main.js`**

```js
// Sessions panel: Claude Code sessions started in the focused pane's repository (or just its folder),
// newest first. A row reopens the session in a new tab with `claude -r <id>`. Local or remote.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, run, notify, theme, layout, window } from "herdr";
import { encodeProject, worktreePaths, sessionLines, toSessions, pickSessions, sessionMeta, tabTitle, emptyText, sessionsCommand } from "./logic.js";

const REFRESH_MS = 30000, SHOW_LIMIT = 100;

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
const base = p => String(p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(p ?? "");
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The repository around cwd, its worktrees, and the sessions stored for them. Throws when unreadable.
async function collect({ cwd, on }) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
  const inRepo = top?.code === 0 && Boolean(top.stdout.trim());
  const root = inRepo ? top.stdout.trim() : cwd;
  const list = inRepo ? await exec("git", ["worktree", "list", "--porcelain"], { cwd, on }).catch(() => null) : null;
  const worktrees = worktreePaths(list?.code === 0 ? list.stdout : "", root);
  const c = sessionsCommand(worktrees.map(encodeProject), !on && window()?.platform === "windows");
  const r = await exec(c.command, c.args, { on });
  if (r.code !== 0) throw new Error((r.stderr || "").trim() || "세션 목록을 읽지 못했어요");
  return { root, worktrees, sessions: toSessions(sessionLines(r.stdout)) };
}

export default class Sessions extends View {
  init(_props, cx) {
    this.scope = "all"; this.context = null; this.data = null; this.error = null;
    this.loading = false; this.again = false; this.wasShown = this.visible();
    if (this.wasShown) this.refresh(cx);
    cx.timer.every(REFRESH_MS, cx => { if (this.visible()) this.refresh(cx); });
  }

  // Whether the panel is open on this tab; true when the layout has no such panel.
  visible() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !body) return true;
    return !panel.hidden && body.active === "sessions";
  }

  refresh(cx) {
    const next = key();
    if (next !== this.context?.key) {
      const loc = location();
      this.context = { key: next, cwd: loc.cwd, on: loc.on };
      this.data = null; this.error = null; this.loading = false; this.again = false;
    }
    if (!this.context.cwd) return;
    if (this.loading) { this.again = true; return; }
    const context = this.context;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const data = await collect(context);
        if (this.context === context) { this.data = data; this.error = null; }
      } catch (e) {
        if (this.context === context) this.error = String(e?.message ?? e);
      } finally {
        if (this.context === context) {
          this.loading = false;
          if (this.again) { this.again = false; this.refresh(cx); }
        }
        cx.notify();
      }
    });
  }

  open(session) {
    try { run("tab.new", { name: tabTitle(session.title), folder: session.folder, argv: ["claude", "-r", session.id] }); }
    catch (e) { notify({ title: "세션을 열지 못했어요", body: String(e), level: "error", timeout: 5000 }); }
  }

  render(cx) {
    const shown = this.visible();
    if (shown && (!this.wasShown || key() !== this.context?.key)) this.refresh(cx);
    this.wasShown = shown;
    const t = theme(), c = this.context, d = this.data, now = Date.now();
    const picked = d ? pickSessions(d.sessions, this.scope, { worktrees: d.worktrees, cwd: c.cwd }, SHOW_LIMIT) : { items: [], more: false };
    const name = d?.root ?? c?.cwd;
    const where = name ? (c?.on ? `${c.on}:${base(name)}` : base(name)) : "";
    const message = !c?.cwd ? "폴더가 없어요" : !d ? (this.error || "불러오는 중…") : emptyText(this.scope);
    const chip = (id, label, on, onClick) => h_flex().id(id).h(24).px(9).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => { onClick(); cx.notify(); }).child(label);
    return v_flex().id("sessions").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Sessions"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(where))
        .child(div().id("sessions-refresh").w(20).cursor_pointer().text_color(t.muted)
          .on_click((_e, cx) => { this.refresh(cx); cx.notify(); }).child(this.loading ? "…" : "⟳")))
      .child(h_flex().h(38).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
        .child(chip("sessions-all", "전체", this.scope === "all", () => { this.scope = "all"; }))
        .child(chip("sessions-here", "지금 폴더", this.scope === "here", () => { this.scope = "here"; })))
      .child(v_flex().id("sessions-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .when(Boolean(this.error && d), el => el.child(div().px(8).py(4).text_size(12).text_color(t.ansi1).child(`⚠ ${this.error}`)))
        .children(picked.items.map(s => v_flex().id(`session-${s.id}`).flex_none().px(8).py(6).gap(3).rounded(7).cursor_pointer().hover(st => st.bg(t.hover))
          .on_click(() => this.open(s))
          .child(div().min_w(0).truncate().child(s.title))
          .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(sessionMeta(s, d.root, now)))))
        .when(picked.more, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("최근 100개만 보여 줘요")))
        .when(picked.items.length === 0, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(message))));
  }
}
```

- [ ] **Step 4: Deploy and load-check**

Run (Git Bash):
```bash
rm -rf ~/.config/herdr-app/mods/my-sessions && cp -r mods/my-sessions ~/.config/herdr-app/mods/my-sessions
herdr-app check "$USERPROFILE/.config/herdr-app/mods/my-sessions"
```
Expected: `check passed`.

- [ ] **Step 5: Tests and commit**

Run: `node --test tests/my-sessions-logic.test.mjs` → PASS.
```bash
git add mods/my-sessions/main.js mods/my-sessions/mod.json mods/my-sessions/sessions.svg
git commit -m "my-sessions: panel listing Claude sessions, opening one in a new tab"
```

---

### Task 4: 탭 바 버튼 · 설치 · 문서

**Files:**
- Modify: `mods/my-tabs/main.js`, `install.ps1`, `package.json`, `README.md`

**Interfaces:**
- Consumes: block mod `my-sessions`, `mods/my-sessions/sessions.svg`, layout block id `sessions`.

- [ ] **Step 1: my-tabs**

In `mods/my-tabs/main.js`, in the `const enabled = …` line, change `"github", "plugins"` to `"github", "plugins", "sessions"`. After the line with `panelButton("plugins", "Plugin", "mods/my-plugins/plugins.svg")` add:
```js
      .when(enabled.includes("sessions"), el => el.child(panelButton("sessions", "Session", "mods/my-sessions/sessions.svg")))
```

- [ ] **Step 2: install.ps1** (keep UTF-8 **with BOM**: check `head -c 3 install.ps1 | od -An -tx1` → ` ef bb bf`)

Change the mod list to:
```powershell
$mods = @("my-files", "my-files-drag", "my-files-open", "my-github", "my-plugins", "my-sessions", "my-tabs")
```
After the `if (-not (@($panelBody.children) | Where-Object { $_.id -eq "plugins" })) { … }` block add:
```powershell
if (-not (@($panelBody.children) | Where-Object { $_.id -eq "sessions" })) {
  $sessions = [pscustomobject]@{ id = "sessions"; type = "block"; content = [pscustomobject]@{ mod = "my-sessions" } }
  $panelBody.children = @($panelBody.children) + $sessions
}
```
Change the final message to:
```powershell
Write-Host "완료. 탭 바에 Files · Changes · GitHub · Plugin · Session 버튼이 보이면 성공이에요."
```

- [ ] **Step 3: package.json**

Append ` tests/my-sessions-logic.test.mjs` to the `test` script and change the description to `"Herdr mods: editable Files panel, drag paths into terminals, GitHub issues/PR panel, MCP and skills panel, Claude sessions panel"`.

Run: `npm test` → all PASS.

- [ ] **Step 4: README**

- Intro line: `오른쪽 패널의 Files를 편집 가능한 패널로 바꾸고, GitHub 이슈·PR 패널, MCP·스킬 목록 패널, Claude 세션 목록 패널을 추가합니다.`
- Mod table, after `my-plugins`: `` | `my-sessions` | 지금 저장소의 Claude Code 세션 목록. 누르면 새 탭에서 다시 열기 | ``
- `my-tabs` row: `기본 탭 바의 복제본. Files · Changes 옆에 GitHub · Plugin · Session 버튼 추가`
- After the `### Plugins 패널` section:
```markdown
### Sessions 패널 (`my-sessions`)

- 탭 바의 **Session** 버튼으로 엽니다. 포커스된 칸의 저장소에서 시작한 Claude Code 세션을 최근 순으로 보여 줍니다(최대 100개).
- **[전체]**: 저장소 루트와 하위 폴더, git worktree에서 시작한 세션. **[지금 폴더]**: 포커스된 칸의 폴더에서 시작한 세션만.
- 행에는 세션 제목(직접 붙인 이름 → 자동 제목)과 `3시간 전 · main · mods/x`(시간 · 브랜치 · 폴더)가 보입니다.
- 행을 누르면 **새 탭**이 세션 제목 이름으로 열리고, 그 세션의 시작 폴더에서 `claude -r <ID>` 가 실행됩니다.
- 세션 파일의 앞뒤 일부만 읽어 제목·폴더·브랜치만 가져옵니다. 대화 내용은 읽어 오지 않습니다.
- 원격 스페이스에서는 그 머신의 세션을 읽습니다. 패널이 보이는 동안 30초마다 다시 읽고, ⟳ 로 바로 새로고침합니다.
```
- 설치 step 1 and 수동 설치: "여섯" → "일곱". 설치 step 2: add `` - 오른쪽 패널(`panel-body`)에 `sessions` 칸(`my-sessions`) 추가 `` after the plugins bullet. 수동 설치 JSON: add `{ "id": "sessions", "type": "block", "content": { "mod": "my-sessions" } }` after the plugins line (with the comma the JSON needs).
- 제거: "위 네 가지" → "위 다섯 가지", "github·plugins 칸 삭제" → "github·plugins·sessions 칸 삭제", add `my-sessions` to the folder list.
- 알려진 한계:
```markdown
- Sessions 패널은 이미 열려 있는 세션을 표시하지 못합니다(에이전트 정보에 세션 ID가 없음). 같은 세션을 두 탭에서 쓰지 않도록 조심하세요. Claude Code의 내부 파일 형식에 기대므로, 형식이 바뀌면 제목이 안 보일 수 있습니다. Codex 세션은 보이지 않습니다.
```

- [ ] **Step 5: Installer test in a temporary Herdr home**

Run (PowerShell):
```powershell
$tmp = Join-Path $env:TEMP "herdr-sessions-test"; Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$tmp\layouts" | Out-Null
Copy-Item "$env:USERPROFILE\.config\herdr-app\layouts\my-layout.json" "$tmp\layouts\my-layout.json"
$env:HERDR_APP_HOME = $tmp; .\install.ps1; .\install.ps1; Remove-Item Env:HERDR_APP_HOME
(Select-String -Path "$tmp\layouts\my-layout.json" -Pattern '"id":\s*"sessions"').Count
Test-Path "$tmp\mods\my-sessions\main.js"
```
Expected: both runs succeed; `1`; `True`.

- [ ] **Step 6: Commit**

```bash
git add mods/my-tabs/main.js install.ps1 package.json README.md
git commit -m "my-sessions: Session button, installer and README"
```

- [ ] **Step 7: Real install and check with the user** (controller)

Run `powershell -ExecutionPolicy Bypass -File .\install.ps1`, `herdr-app status` (`errors` empty). Ask the user to check: the Session button is right of Plugin; this repository's sessions appear with titles; [전체]/[지금 폴더] switch instantly; clicking opens a new tab that resumes the right session — including a session whose recorded cwd is a subfolder; another repository's panel shows its own sessions; a folder with no sessions shows the empty text.
