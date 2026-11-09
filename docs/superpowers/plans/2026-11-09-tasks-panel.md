# Task 패널 (Google Tasks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Herdr side panel `my-tasks` that shows and edits Google Tasks (lists, tasks, one level of subtasks, reorder) through a dependency-free Node helper.

**Architecture:** The mod (`main.js`) never talks to Google. It runs `node <app>/mods/my-tasks/tasks.mjs <command> ...` with Herdr's `exec`, and the helper prints one JSON line. `google.mjs` holds OAuth + REST with injected `fetch`/file functions so it is unit-tested; `logic.js` holds the mod's pure decisions (tree, moves, labels, error text).

**Tech Stack:** Herdr mod API (`gpui-kit`, `gpui-base`, `herdr`), Node 18+ built-ins (`fetch`, `node:http`, `node:crypto`), `node --test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-09-tasks-panel-design.md`.
- No npm dependencies. Node built-ins only.
- OAuth scope exactly `https://www.googleapis.com/auth/tasks`. PKCE (`S256`) with `state`, loopback redirect `http://127.0.0.1:<port>`.
- Helper output: always one stdout JSON line, `{"ok":true,"data":...}` or `{"ok":false,"error":{"kind":"...","message":"..."}}`, exit code 0.
- Error kinds from the helper: `no-client`, `no-login`, `expired`, `network`, `api`, `usage`, `internal`. Kinds made by the mod: `timeout`, `no-node`, `bad-output`.
- Config folder: `<app>/my-tasks/` (`client.json`, `token.json`); the helper finds it as `../../my-tasks` from its own file. Never inside the repo.
- Free-text arguments go after `--`; flags only before `--`.
- Refresh every `120000` ms while the panel shows; login waits with `exec` `timeout: 310000`, the helper gives up after `300000` ms.
- UI copy is Korean, exactly as written in the tasks below.
- Mods can't import outside their folder; `logic.js` must not import `herdr`/`gpui-*` (tests load it with plain Node).
- Run tests in Git Bash: `node --test tests/*.test.mjs`.

---

### Task 1: Pure mod logic (`logic.js`)

**Files:**
- Create: `mods/my-tasks/logic.js`
- Test: `tests/my-tasks-logic.test.mjs`

**Interfaces:**
- Produces (all exported from `mods/my-tasks/logic.js`):
  - `REFRESH_MS = 120000`, `LOGIN_TIMEOUT_MS = 310000`, `APP_DIR_SCRIPT` (string for `node -e`)
  - `helperPath(appDir: string) → string`
  - `command(name: string, positional?: string[], flags?: Record<string,string|null|undefined>) → string[]`
  - `parseOutput(stdout: string, stderr?: string) → {ok:true,data} | {ok:false,error:{kind,message}}`
  - `execError(e: unknown) → {kind:"timeout"|"no-node", message}`
  - `buildTree(tasks) → { roots: Array<Task & {children: Task[]}>, done: Task[] }`
  - `moveArgs(tree, id, dir: "up"|"down"|"indent"|"outdent") → {parent: string|null, previous: string|null} | null`
  - `canMove(tree, id, dir) → boolean`
  - `todayString(date?: Date) → "YYYY-MM-DD"` (local date)
  - `dueLabel(due: string|null, today: string) → {text, overdue} | null`
  - `parseDue(text: string) → "YYYY-MM-DD" | null | undefined` (`undefined` = bad format)
  - `errorText(error) → {screen:"login"|"bar", kind, text, detail: string|null}`
  - `deleteText(task, childCount) → string`, `listDeleteText(list, count) → string`, `notesPreview(notes) → string|null`

- [ ] **Step 1: Write the failing test**

Create `tests/my-tasks-logic.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-tasks/logic.js", import.meta.url).href);

const T = (id, position, extra = {}) => ({ id, title: id, position, status: "needsAction", parent: null, ...extra });

test("constants", () => {
  assert.equal(L.REFRESH_MS, 120000);
  assert.equal(L.LOGIN_TIMEOUT_MS, 310000);
  assert.match(L.APP_DIR_SCRIPT, /HERDR_APP_HOME/);
});

test("helperPath joins the app folder and the helper", () => {
  assert.equal(L.helperPath("/home/a/.config/herdr-app"), "/home/a/.config/herdr-app/mods/my-tasks/tasks.mjs");
  assert.equal(L.helperPath("C:\\Users\\a\\.config\\herdr-app\\"), "C:\\Users\\a\\.config\\herdr-app/mods/my-tasks/tasks.mjs");
});

test("command puts flags before -- and free text after", () => {
  assert.deepEqual(L.command("add", ["L1", "제목"], { parent: "p" }), ["add", "--parent", "p", "--", "L1", "제목"]);
  assert.deepEqual(L.command("move", ["L", "t"], { parent: null, previous: "q" }), ["move", "--previous", "q", "--", "L", "t"]);
  assert.deepEqual(L.command("lists"), ["lists", "--"]);
});

test("parseOutput reads the last JSON line", () => {
  assert.deepEqual(L.parseOutput('noise\n{"ok":true,"data":[1]}\n'), { ok: true, data: [1] });
  assert.deepEqual(L.parseOutput('{"ok":false,"error":{"kind":"api","message":"x"}}'), { ok: false, error: { kind: "api", message: "x" } });
  assert.deepEqual(L.parseOutput("", "Error: Cannot find module 'x'\n  at y"), { ok: false, error: { kind: "bad-output", message: "Error: Cannot find module 'x'" } });
  assert.deepEqual(L.parseOutput("not json"), { ok: false, error: { kind: "bad-output", message: "not json" } });
  assert.deepEqual(L.parseOutput(""), { ok: false, error: { kind: "bad-output", message: "출력 없음" } });
});

test("execError tells a time limit from a missing program", () => {
  assert.equal(L.execError(new Error("timed out after 30000ms")).kind, "timeout");
  assert.equal(L.execError(new Error("program not found")).kind, "no-node");
});

test("buildTree orders by position, nests children, splits completed (newest first)", () => {
  const tree = L.buildTree([
    T("b", "00002"), T("a", "00001"), T("a2", "00002", { parent: "a" }), T("a1", "00001", { parent: "a" }),
    T("x", "00003", { status: "completed", completed: "2026-11-01T00:00:00.000Z" }),
    T("y", "00004", { status: "completed", completed: "2026-11-05T00:00:00.000Z" }),
  ]);
  assert.deepEqual(tree.roots.map(r => r.id), ["a", "b"]);
  assert.deepEqual(tree.roots[0].children.map(c => c.id), ["a1", "a2"]);
  assert.deepEqual(tree.roots[1].children, []);
  assert.deepEqual(tree.done.map(d => d.id), ["y", "x"]);
});

test("buildTree: a child whose parent is not open, or a grandchild, shows at the top level", () => {
  const tree = L.buildTree([
    T("c", "00001", { parent: "gone" }), T("p", "00002", { status: "completed" }), T("d", "00003", { parent: "p" }), T("e", "00000"),
    T("f", "00004"), T("f1", "00001", { parent: "f" }), T("g", "00005", { parent: "f1" }),
  ]);
  assert.deepEqual(tree.roots.map(r => r.id), ["e", "c", "d", "f", "g"]);
  assert.deepEqual(tree.roots[3].children.map(c => c.id), ["f1"]);
});

test("buildTree tolerates no input", () => {
  assert.deepEqual(L.buildTree(undefined), { roots: [], done: [] });
});

const tree = L.buildTree([T("a", "1"), T("a1", "1", { parent: "a" }), T("a2", "2", { parent: "a" }), T("b", "2"), T("c", "3"), T("c1", "1", { parent: "c" })]);

test("moveArgs up/down stay inside the same parent", () => {
  assert.equal(L.moveArgs(tree, "a", "up"), null);
  assert.deepEqual(L.moveArgs(tree, "b", "up"), { parent: null, previous: null });
  assert.deepEqual(L.moveArgs(tree, "c", "up"), { parent: null, previous: "a" });
  assert.deepEqual(L.moveArgs(tree, "a2", "up"), { parent: "a", previous: null });
  assert.equal(L.moveArgs(tree, "a1", "up"), null);
  assert.deepEqual(L.moveArgs(tree, "a", "down"), { parent: null, previous: "b" });
  assert.equal(L.moveArgs(tree, "c", "down"), null);
  assert.deepEqual(L.moveArgs(tree, "a1", "down"), { parent: "a", previous: "a2" });
  assert.equal(L.moveArgs(tree, "a2", "down"), null);
});

test("moveArgs indent goes under the sibling above, at the end of its children", () => {
  assert.equal(L.moveArgs(tree, "a", "indent"), null); // first row
  assert.deepEqual(L.moveArgs(tree, "b", "indent"), { parent: "a", previous: "a2" });
  assert.equal(L.moveArgs(tree, "c", "indent"), null); // has children
  assert.equal(L.moveArgs(tree, "a2", "indent"), null); // already a child
  const flat = L.buildTree([T("x", "1"), T("y", "2")]);
  assert.deepEqual(L.moveArgs(flat, "y", "indent"), { parent: "x", previous: null });
});

test("moveArgs outdent puts a child right after its parent", () => {
  assert.equal(L.moveArgs(tree, "a", "outdent"), null);
  assert.deepEqual(L.moveArgs(tree, "a1", "outdent"), { parent: null, previous: "a" });
});

test("moveArgs and canMove: unknown id or direction", () => {
  assert.equal(L.moveArgs(tree, "zz", "up"), null);
  assert.equal(L.moveArgs(tree, "b", "sideways"), null);
  assert.equal(L.canMove(tree, "b", "up"), true);
  assert.equal(L.canMove(tree, "a", "up"), false);
});

test("todayString is the local date", () => {
  assert.equal(L.todayString(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("dueLabel: this year, another year, overdue, none", () => {
  assert.equal(L.dueLabel(null, "2026-11-09"), null);
  assert.deepEqual(L.dueLabel("2026-11-12T00:00:00.000Z", "2026-11-09"), { text: "11/12", overdue: false });
  assert.deepEqual(L.dueLabel("2027-01-03T00:00:00.000Z", "2026-11-09"), { text: "2027/1/3", overdue: false });
  assert.deepEqual(L.dueLabel("2026-11-08T00:00:00.000Z", "2026-11-09"), { text: "11/8", overdue: true });
  assert.deepEqual(L.dueLabel("2026-11-09T00:00:00.000Z", "2026-11-09"), { text: "11/9", overdue: false });
});

test("parseDue accepts YYYY-MM-DD or blank", () => {
  assert.equal(L.parseDue(""), null);
  assert.equal(L.parseDue("   "), null);
  assert.equal(L.parseDue("2026-11-12"), "2026-11-12");
  assert.equal(L.parseDue(" 2026-11-12 "), "2026-11-12");
  assert.equal(L.parseDue("2026-13-01"), undefined);
  assert.equal(L.parseDue("2026-02-30"), undefined);
  assert.equal(L.parseDue("11/12"), undefined);
});

test("errorText: login kinds go to the login screen", () => {
  assert.deepEqual(L.errorText({ kind: "no-client", message: "OAuth 클라이언트 파일이 없어요: C:/x/client.json" }),
    { screen: "login", kind: "no-client", text: "OAuth 클라이언트 파일이 필요해요", detail: "OAuth 클라이언트 파일이 없어요: C:/x/client.json" });
  assert.deepEqual(L.errorText({ kind: "no-login", message: "로그인이 필요해요" }),
    { screen: "login", kind: "no-login", text: "Google 계정 연결이 필요해요", detail: null });
  assert.deepEqual(L.errorText({ kind: "expired", message: "" }),
    { screen: "login", kind: "expired", text: "로그인이 만료됐어요. 다시 로그인해 주세요", detail: null });
});

test("errorText: the rest go to the error bar", () => {
  assert.equal(L.errorText({ kind: "network", message: "fetch failed" }).text, "인터넷 연결을 확인해 주세요");
  assert.equal(L.errorText({ kind: "timeout", message: "" }).text, "응답이 늦어 결과를 모르겠어요. 새로 읽어 확인해 주세요");
  assert.equal(L.errorText({ kind: "no-node", message: "" }).text, "Node.js가 필요해요");
  assert.equal(L.errorText({ kind: "api", message: "Invalid task list ID" }).text, "Invalid task list ID");
  assert.equal(L.errorText({ kind: "api", message: "" }).text, "Google Tasks 오류");
  assert.equal(L.errorText({ kind: "usage", message: "알 수 없는 명령: x" }).text, "내부 오류: 알 수 없는 명령: x");
  assert.equal(L.errorText({ kind: "bad-output", message: "boom" }).text, "내부 오류: boom");
  assert.deepEqual(L.errorText(undefined), { screen: "bar", kind: "internal", text: "내부 오류: 알 수 없는 오류", detail: null });
  assert.equal(L.errorText({ kind: "network" }).screen, "bar");
});

test("deleteText picks 을/를 and mentions children", () => {
  assert.equal(L.deleteText({ title: "README 정리" }, 0), '"README 정리"를 지울까요?');
  assert.equal(L.deleteText({ title: "회의록" }, 0), '"회의록"을 지울까요?');
  assert.equal(L.deleteText({ title: "로그인 버그" }, 2), '"로그인 버그"를 지울까요? 하위 2개도 함께 지워져요.');
  assert.equal(L.deleteText({ title: "fix bug" }, 0), '"fix bug"을(를) 지울까요?');
  assert.equal(L.deleteText({ title: "" }, 0), '"(제목 없음)"을 지울까요?');
});

test("listDeleteText mentions how many tasks go with it", () => {
  assert.equal(L.listDeleteText({ title: "업무" }, 3), '"업무" 목록과 할 일 3개를 지울까요?');
  assert.equal(L.listDeleteText({ title: "업무" }, 0), '"업무" 목록을 지울까요?');
});

test("notesPreview is the first non-blank line", () => {
  assert.equal(L.notesPreview("\n  첫 줄 \n둘째"), "첫 줄");
  assert.equal(L.notesPreview(null), null);
  assert.equal(L.notesPreview(""), null);
  assert.equal(L.notesPreview("  \n "), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/my-tasks-logic.test.mjs`
Expected: FAIL (cannot find module `mods/my-tasks/logic.js`).

- [ ] **Step 3: Write the implementation**

Create `mods/my-tasks/logic.js`:

```js
// Pure helpers for my-tasks. No herdr or gpui imports, so `node --test` can load this file.

export const REFRESH_MS = 120000;
export const LOGIN_TIMEOUT_MS = 310000;
// Printed by `node -e`: the Herdr app folder, where the installed helper lives under mods/my-tasks.
export const APP_DIR_SCRIPT = "process.stdout.write(process.env.HERDR_APP_HOME || require('path').join(require('os').homedir(), '.config', 'herdr-app'))";

export function helperPath(appDir) {
  return appDir.replace(/[\\/]+$/, "") + "/mods/my-tasks/tasks.mjs";
}

/** Helper arguments: flags (empty ones dropped), then `--`, then the free-text positionals. */
export function command(name, positional = [], flags = {}) {
  const pairs = Object.entries(flags).filter(([, v]) => v != null && v !== "").flatMap(([k, v]) => [`--${k}`, String(v)]);
  return [name, ...pairs, "--", ...positional];
}

const firstLine = s => (s ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? "";

/** The helper's answer: its last non-blank stdout line as JSON, or a bad-output error. */
export function parseOutput(stdout, stderr = "") {
  const lines = (stdout ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  try {
    const value = JSON.parse(last);
    if (value && typeof value.ok === "boolean") return value;
  } catch {}
  return { ok: false, error: { kind: "bad-output", message: (firstLine(stderr) || last).slice(0, 200) || "출력 없음" } };
}

/** `exec` rejected: its time limit, or the program could not start. */
export function execError(e) {
  const text = String(e?.message ?? e ?? "");
  return /time/i.test(text) ? { kind: "timeout", message: text } : { kind: "no-node", message: text };
}

const byPosition = (a, b) => ((a.position ?? "") < (b.position ?? "") ? -1 : (a.position ?? "") > (b.position ?? "") ? 1 : 0);

/**
 * Open tasks as roots (by position) with one level of children; completed tasks newest first.
 * A task whose parent is not an open root (gone, completed, or itself a child) shows as a root.
 */
export function buildTree(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const open = list.filter(t => t.status !== "completed");
  const ids = new Set(open.map(t => t.id));
  const isTop = t => !t.parent || !ids.has(t.parent);
  const topIds = new Set(open.filter(isTop).map(t => t.id));
  const roots = open.filter(t => isTop(t) || !topIds.has(t.parent)).sort(byPosition)
    .map(t => ({ ...t, children: topIds.has(t.id) ? open.filter(c => c.parent === t.id).sort(byPosition) : [] }));
  const done = list.filter(t => t.status === "completed")
    .sort((a, b) => ((b.completed ?? "") < (a.completed ?? "") ? -1 : (b.completed ?? "") > (a.completed ?? "") ? 1 : 0));
  return { roots, done };
}

function locate(tree, id) {
  const r = tree.roots.findIndex(t => t.id === id);
  if (r >= 0) return { siblings: tree.roots, index: r, parent: null, node: tree.roots[r] };
  for (const root of tree.roots) {
    const c = root.children.findIndex(t => t.id === id);
    if (c >= 0) return { siblings: root.children, index: c, parent: root, node: root.children[c] };
  }
  return null;
}

/** Where `tasks.move` should put the task for one button press, or null when it can't move that way. */
export function moveArgs(tree, id, dir) {
  const at = locate(tree, id);
  if (!at) return null;
  const { siblings, index, parent, node } = at, parentId = parent?.id ?? null;
  if (dir === "up") return index > 0 ? { parent: parentId, previous: siblings[index - 2]?.id ?? null } : null;
  if (dir === "down") return index < siblings.length - 1 ? { parent: parentId, previous: siblings[index + 1].id } : null;
  if (dir === "indent") {
    if (parent || index === 0 || node.children.length) return null;
    const target = siblings[index - 1];
    return { parent: target.id, previous: target.children.at(-1)?.id ?? null };
  }
  if (dir === "outdent") return parent ? { parent: null, previous: parent.id } : null;
  return null;
}

export const canMove = (tree, id, dir) => moveArgs(tree, id, dir) !== null;

const pad = n => String(n).padStart(2, "0");
export function todayString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "11/12" this year, "2027/1/3" another year; overdue when before today. Null without a due date. */
export function dueLabel(due, today) {
  if (!due) return null;
  const day = due.slice(0, 10), [y, m, d] = day.split("-").map(Number);
  const text = day.slice(0, 4) === today.slice(0, 4) ? `${m}/${d}` : `${y}/${m}/${d}`;
  return { text, overdue: day < today };
}

/** The due field: "YYYY-MM-DD", null when blank, undefined when it isn't a real date. */
export function parseDue(text) {
  const value = (text ?? "").trim();
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.getUTCFullYear() === +m[1] && date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3] ? value : undefined;
}

const LOGIN = { "no-client": "OAuth 클라이언트 파일이 필요해요", "no-login": "Google 계정 연결이 필요해요", expired: "로그인이 만료됐어요. 다시 로그인해 주세요" };
const BAR = { network: "인터넷 연결을 확인해 주세요", timeout: "응답이 늦어 결과를 모르겠어요. 새로 읽어 확인해 주세요", "no-node": "Node.js가 필요해요" };

/** What the panel shows for an error: the login screen, or a line in the error bar. */
export function errorText(error) {
  const kind = error?.kind ?? "internal", message = error?.message ?? "";
  if (Object.hasOwn(LOGIN, kind)) return { screen: "login", kind, text: LOGIN[kind], detail: kind === "no-client" ? message : null };
  if (Object.hasOwn(BAR, kind)) return { screen: "bar", kind, text: BAR[kind], detail: null };
  if (kind === "api") return { screen: "bar", kind, text: message || "Google Tasks 오류", detail: null };
  return { screen: "bar", kind, text: `내부 오류: ${message || "알 수 없는 오류"}`, detail: null };
}

// 을 after a final consonant, 를 after a vowel; 을(를) when the last letter isn't Hangul. Trailing ")" etc. don't count.
function objectParticle(word) {
  const code = (word.replace(/[^\p{L}\p{N}]+$/u, "").at(-1) ?? "").charCodeAt(0) - 0xac00;
  if (code < 0 || code >= 11172) return "을(를)";
  return code % 28 ? "을" : "를";
}

export function deleteText(task, childCount) {
  const title = task.title || "(제목 없음)";
  const base = `"${title}"${objectParticle(title)} 지울까요?`;
  return childCount ? `${base} 하위 ${childCount}개도 함께 지워져요.` : base;
}

export function listDeleteText(list, count) {
  return count ? `"${list.title}" 목록과 할 일 ${count}개를 지울까요?` : `"${list.title}" 목록을 지울까요?`;
}

export function notesPreview(notes) {
  return firstLine(notes) || null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/my-tasks-logic.test.mjs`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add mods/my-tasks/logic.js tests/my-tasks-logic.test.mjs
git commit -m "my-tasks: pure logic for the task tree, moves, labels and errors"
```

---

### Task 2: Google OAuth and REST (`google.mjs`)

**Files:**
- Create: `mods/my-tasks/google.mjs`
- Test: `tests/my-tasks-google.test.mjs`

**Interfaces:**
- `env` object passed to every function: `{ fetch(url, init) → Promise<Response-like {status, ok, text(), json()}>, readFile(path) → string|null, writeFile(path, text), removeFile(path), now() → ms, clientPath, tokenPath }`.
- Produces (exported): `SCOPE`, `AUTH_URL`, `TOKEN_URL`, `REVOKE_URL`, `API`, `class TasksError extends Error { kind }`, `readClient(env) → {id, secret}`, `readToken(env)`, `authUrl(client, {redirect, challenge, state}) → string`, `exchangeCode(env, client, {code, verifier, redirect})`, `accessToken(env) → string`, `status(env) → {loggedIn:true}`, `lists(env) → [{id,title}]`, `listAdd(env,title)`, `listRename(env,id,title)`, `listDelete(env,id) → null`, `tasks(env,list) → Task[]` (fields `id,title,notes,due,status,completed,parent,position`, missing → null), `add(env,list,title,parent?)`, `update(env,list,id,{title?,notes?,due?})`, `done(env,list,id)`, `undone(env,list,id)`, `remove(env,list,id) → null`, `move(env,list,id,{parent?,previous?})`, `logout(env) → null`.

- [ ] **Step 1: Write the failing test**

Create `tests/my-tasks-google.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
const G = await import(new URL("../mods/my-tasks/google.mjs", import.meta.url).href);

function respond({ status = 200, json } = {}) {
  const text = json === undefined ? "" : JSON.stringify(json);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text || "{}") };
}

function fakeEnv({ client = { installed: { client_id: "cid", client_secret: "sec" } }, token = { access_token: "at", refresh_token: "rt", expiry: 10_000_000 }, now = 1_000_000, responses = [] } = {}) {
  const files = new Map(), calls = [];
  if (client) files.set("/c.json", typeof client === "string" ? client : JSON.stringify(client));
  if (token) files.set("/t.json", JSON.stringify(token));
  return {
    clientPath: "/c.json", tokenPath: "/t.json", files, calls, now: () => now,
    readFile: p => files.get(p) ?? null, writeFile: (p, s) => { files.set(p, s); }, removeFile: p => { files.delete(p); },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return respond(next ?? { json: {} });
    },
  };
}
const kindIs = kind => e => e instanceof G.TasksError && e.kind === kind;

test("lists with a fresh token: no refresh, bearer header, only id and title", async () => {
  const env = fakeEnv({ responses: [{ json: { items: [{ id: "L1", title: "내 할 일", etag: "x" }] } }] });
  assert.deepEqual(await G.lists(env), [{ id: "L1", title: "내 할 일" }]);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].url, `${G.API}/users/@me/lists?maxResults=100`);
  assert.equal(env.calls[0].headers.Authorization, "Bearer at");
});

test("a token expiring within 60 s is refreshed first and saved", async () => {
  const env = fakeEnv({ token: { access_token: "old", refresh_token: "rt", expiry: 1_000_000 + 30_000 }, responses: [{ json: { access_token: "new", expires_in: 3600 } }, { json: { items: [] } }] });
  await G.lists(env);
  assert.equal(env.calls[0].url, G.TOKEN_URL);
  assert.equal(env.calls[0].method, "POST");
  const form = new URLSearchParams(env.calls[0].body);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "rt");
  assert.equal(form.get("client_id"), "cid");
  assert.equal(form.get("client_secret"), "sec");
  assert.deepEqual(JSON.parse(env.files.get("/t.json")), { access_token: "new", refresh_token: "rt", expiry: 1_000_000 + 3_600_000 });
  assert.equal(env.calls[1].headers.Authorization, "Bearer new");
});

test("refresh refused with invalid_grant means expired", async () => {
  const env = fakeEnv({ token: { access_token: "old", refresh_token: "rt", expiry: 0 }, responses: [{ status: 400, json: { error: "invalid_grant" } }] });
  await assert.rejects(G.lists(env), kindIs("expired"));
});

test("missing token, missing or broken client file", async () => {
  await assert.rejects(G.lists(fakeEnv({ token: null })), kindIs("no-login"));
  await assert.rejects(G.lists(fakeEnv({ client: null })), kindIs("no-client"));
  await assert.rejects(G.lists(fakeEnv({ client: "{nope" })), kindIs("no-client"));
  await assert.rejects(G.lists(fakeEnv({ client: { installed: {} } })), kindIs("no-client"));
  await assert.rejects(G.status(fakeEnv({ client: null })), kindIs("no-client"));
  assert.deepEqual(await G.status(fakeEnv()), { loggedIn: true });
});

test("network failure and HTTP errors", async () => {
  await assert.rejects(G.lists(fakeEnv({ responses: [new TypeError("fetch failed")] })), kindIs("network"));
  await assert.rejects(G.lists(fakeEnv({ responses: [{ status: 404, json: { error: { message: "Not Found" } } }] })),
    e => e.kind === "api" && e.message === "Not Found");
  await assert.rejects(G.lists(fakeEnv({ responses: [{ status: 401, json: {} }] })), kindIs("expired"));
});

test("tasks reads every page and fills missing fields with null", async () => {
  const env = fakeEnv({ responses: [
    { json: { items: [{ id: "a", title: "A", status: "needsAction", position: "1", etag: "e" }], nextPageToken: "p2" } },
    { json: { items: [{ id: "b", title: "B", status: "completed", completed: "2026-11-01T00:00:00.000Z", position: "2", parent: "a" }] } },
  ] });
  const result = await G.tasks(env, "L/1");
  assert.equal(env.calls[0].url, `${G.API}/lists/L%2F1/tasks?showCompleted=true&showHidden=true&maxResults=100`);
  assert.equal(env.calls[1].url, `${G.API}/lists/L%2F1/tasks?showCompleted=true&showHidden=true&maxResults=100&pageToken=p2`);
  assert.deepEqual(result[0], { id: "a", title: "A", notes: null, due: null, status: "needsAction", completed: null, parent: null, position: "1" });
  assert.equal(result[1].parent, "a");
});

test("add, with and without a parent", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "n", title: "x" } }, { json: { id: "m", title: "y" } }] });
  await G.add(env, "L", "x");
  await G.add(env, "L", "y", "P");
  assert.equal(env.calls[0].url, `${G.API}/lists/L/tasks`);
  assert.equal(env.calls[0].method, "POST");
  assert.deepEqual(JSON.parse(env.calls[0].body), { title: "x" });
  assert.equal(env.calls[1].url, `${G.API}/lists/L/tasks?parent=P`);
});

test("update sends only the given fields, due as a UTC midnight timestamp", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "T" } }, { json: { id: "T" } }, { json: { id: "T" } }] });
  await G.update(env, "L", "T", { title: "새", notes: "메모", due: "2026-11-12" });
  await G.update(env, "L", "T", { due: null });
  await G.update(env, "L", "T", { title: "only" });
  assert.equal(env.calls[0].url, `${G.API}/lists/L/tasks/T`);
  assert.equal(env.calls[0].method, "PATCH");
  assert.deepEqual(JSON.parse(env.calls[0].body), { title: "새", notes: "메모", due: "2026-11-12T00:00:00.000Z" });
  assert.deepEqual(JSON.parse(env.calls[1].body), { due: null });
  assert.deepEqual(JSON.parse(env.calls[2].body), { title: "only" });
});

test("done and undone", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "T" } }, { json: { id: "T" } }] });
  await G.done(env, "L", "T");
  await G.undone(env, "L", "T");
  assert.deepEqual(JSON.parse(env.calls[0].body), { status: "completed" });
  assert.deepEqual(JSON.parse(env.calls[1].body), { status: "needsAction", completed: null });
  assert.equal(env.calls[1].method, "PATCH");
});

test("remove answers null on 204", async () => {
  const env = fakeEnv({ responses: [{ status: 204 }] });
  assert.equal(await G.remove(env, "L", "T"), null);
  assert.equal(env.calls[0].method, "DELETE");
  assert.equal(env.calls[0].url, `${G.API}/lists/L/tasks/T`);
});

test("move passes parent and previous only when given", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "T" } }, { json: { id: "T" } }] });
  await G.move(env, "L", "T", { parent: "P", previous: "Q" });
  await G.move(env, "L", "T", { parent: null, previous: null });
  assert.equal(env.calls[0].url, `${G.API}/lists/L/tasks/T/move?parent=P&previous=Q`);
  assert.equal(env.calls[0].method, "POST");
  assert.equal(env.calls[1].url, `${G.API}/lists/L/tasks/T/move`);
});

test("list add, rename, delete", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "N", title: "새 목록", etag: "e" } }, { json: { id: "N", title: "이름" } }, { status: 204 }] });
  assert.deepEqual(await G.listAdd(env, "새 목록"), { id: "N", title: "새 목록" });
  assert.deepEqual(await G.listRename(env, "N", "이름"), { id: "N", title: "이름" });
  assert.equal(await G.listDelete(env, "N"), null);
  assert.equal(env.calls[0].url, `${G.API}/users/@me/lists`);
  assert.equal(env.calls[0].method, "POST");
  assert.deepEqual(JSON.parse(env.calls[0].body), { title: "새 목록" });
  assert.equal(env.calls[1].method, "PATCH");
  assert.equal(env.calls[1].url, `${G.API}/users/@me/lists/N`);
  assert.equal(env.calls[2].method, "DELETE");
});

test("logout revokes the refresh token and removes the file, even when revoking fails", async () => {
  const env = fakeEnv({ responses: [{ json: {} }] });
  assert.equal(await G.logout(env), null);
  assert.equal(env.calls[0].url, G.REVOKE_URL);
  assert.equal(new URLSearchParams(env.calls[0].body).get("token"), "rt");
  assert.equal(env.files.has("/t.json"), false);
  const failing = fakeEnv({ responses: [new TypeError("fetch failed")] });
  assert.equal(await G.logout(failing), null);
  assert.equal(failing.files.has("/t.json"), false);
  const none = fakeEnv({ token: null });
  assert.equal(await G.logout(none), null);
  assert.equal(none.calls.length, 0);
});

test("authUrl asks for offline access with PKCE", () => {
  const url = new URL(G.authUrl({ id: "cid", secret: "sec" }, { redirect: "http://127.0.0.1:5555", challenge: "ch", state: "st" }));
  assert.equal(url.origin + url.pathname, G.AUTH_URL);
  const q = url.searchParams;
  assert.equal(q.get("client_id"), "cid");
  assert.equal(q.get("redirect_uri"), "http://127.0.0.1:5555");
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("scope"), "https://www.googleapis.com/auth/tasks");
  assert.equal(q.get("code_challenge"), "ch");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("state"), "st");
  assert.equal(q.get("access_type"), "offline");
  assert.equal(q.get("prompt"), "consent");
});

test("exchangeCode saves the tokens", async () => {
  const env = fakeEnv({ token: null, responses: [{ json: { access_token: "a2", refresh_token: "r2", expires_in: 100 } }] });
  await G.exchangeCode(env, { id: "cid", secret: "sec" }, { code: "c", verifier: "v", redirect: "http://127.0.0.1:1" });
  const form = new URLSearchParams(env.calls[0].body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "c");
  assert.equal(form.get("code_verifier"), "v");
  assert.equal(form.get("redirect_uri"), "http://127.0.0.1:1");
  assert.deepEqual(JSON.parse(env.files.get("/t.json")), { access_token: "a2", refresh_token: "r2", expiry: 1_000_000 + 100_000 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/my-tasks-google.test.mjs`
Expected: FAIL (cannot find module `mods/my-tasks/google.mjs`).

- [ ] **Step 3: Write the implementation**

Create `mods/my-tasks/google.mjs`:

```js
// Google OAuth (installed app, PKCE) and the Tasks REST API. Everything outside this file
// (fetch, files, the clock) comes in through `env`, so tests can replace it.

export const SCOPE = "https://www.googleapis.com/auth/tasks";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const API = "https://tasks.googleapis.com/tasks/v1";

export class TasksError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

export function readClient(env) {
  const raw = env.readFile(env.clientPath);
  if (raw == null) throw new TasksError("no-client", `OAuth 클라이언트 파일이 없어요: ${env.clientPath}`);
  let json;
  try { json = JSON.parse(raw); } catch { throw new TasksError("no-client", `클라이언트 파일을 읽지 못했어요: ${env.clientPath}`); }
  const c = json?.installed ?? json?.web ?? json ?? {};
  if (!c.client_id || !c.client_secret) throw new TasksError("no-client", `클라이언트 파일에 client_id가 없어요: ${env.clientPath}`);
  return { id: c.client_id, secret: c.client_secret };
}

export function readToken(env) {
  const raw = env.readFile(env.tokenPath);
  if (raw != null) {
    try { const t = JSON.parse(raw); if (t?.refresh_token) return t; } catch {}
  }
  throw new TasksError("no-login", "로그인이 필요해요");
}

export function authUrl(client, { redirect, challenge, state }) {
  const q = new URLSearchParams({
    client_id: client.id, redirect_uri: redirect, response_type: "code", scope: SCOPE,
    code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent",
  });
  return `${AUTH_URL}?${q}`;
}

async function postForm(env, url, form) {
  let r;
  try {
    r = await env.fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  } catch (e) { throw new TasksError("network", String(e?.message ?? e)); }
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: body ?? {} };
}

const oauthMessage = r => r.body.error_description || r.body.error || `HTTP ${r.status}`;

export async function exchangeCode(env, client, { code, verifier, redirect }) {
  const r = await postForm(env, TOKEN_URL, {
    code, client_id: client.id, client_secret: client.secret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier,
  });
  if (!r.ok) throw new TasksError("api", oauthMessage(r));
  const token = { access_token: r.body.access_token, refresh_token: r.body.refresh_token, expiry: env.now() + (r.body.expires_in ?? 3600) * 1000 };
  env.writeFile(env.tokenPath, JSON.stringify(token));
  return token;
}

/** A usable access token, refreshed (and saved) when it expires within 60 seconds. */
export async function accessToken(env) {
  const client = readClient(env), token = readToken(env);
  if (token.access_token && token.expiry - 60000 > env.now()) return token.access_token;
  const r = await postForm(env, TOKEN_URL, { client_id: client.id, client_secret: client.secret, refresh_token: token.refresh_token, grant_type: "refresh_token" });
  if (!r.ok) {
    if (r.body.error === "invalid_grant") throw new TasksError("expired", "로그인이 만료됐어요");
    throw new TasksError("api", oauthMessage(r));
  }
  const next = { ...token, access_token: r.body.access_token, expiry: env.now() + (r.body.expires_in ?? 3600) * 1000 };
  env.writeFile(env.tokenPath, JSON.stringify(next));
  return next.access_token;
}

async function api(env, method, path, { query, body } = {}) {
  const token = await accessToken(env);
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
  let r;
  try {
    r = await env.fetch(`${API}${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new TasksError("network", String(e?.message ?? e)); }
  if (r.status === 204) return null;
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    if (r.status === 401) throw new TasksError("expired", "로그인이 만료됐어요");
    throw new TasksError("api", json?.error?.message || `HTTP ${r.status}`);
  }
  return json;
}

const enc = encodeURIComponent;
const TASK_FIELDS = ["id", "title", "notes", "due", "status", "completed", "parent", "position"];
const pickTask = t => Object.fromEntries(TASK_FIELDS.map(k => [k, t?.[k] ?? null]));
const pickList = l => ({ id: l.id, title: l.title });

async function allPages(env, path, query) {
  const out = [];
  let pageToken;
  do {
    const r = await api(env, "GET", path, { query: { ...query, ...(pageToken ? { pageToken } : {}) } });
    out.push(...(r?.items ?? []));
    pageToken = r?.nextPageToken;
  } while (pageToken);
  return out;
}

export async function status(env) {
  readClient(env);
  readToken(env);
  return { loggedIn: true };
}

export async function lists(env) {
  return (await allPages(env, "/users/@me/lists", { maxResults: "100" })).map(pickList);
}
export const listAdd = async (env, title) => pickList(await api(env, "POST", "/users/@me/lists", { body: { title } }));
export const listRename = async (env, id, title) => pickList(await api(env, "PATCH", `/users/@me/lists/${enc(id)}`, { body: { title } }));
export const listDelete = async (env, id) => { await api(env, "DELETE", `/users/@me/lists/${enc(id)}`); return null; };

export async function tasks(env, list) {
  return (await allPages(env, `/lists/${enc(list)}/tasks`, { showCompleted: "true", showHidden: "true", maxResults: "100" })).map(pickTask);
}
export const add = async (env, list, title, parent) =>
  pickTask(await api(env, "POST", `/lists/${enc(list)}/tasks`, { query: parent ? { parent } : undefined, body: { title } }));

export async function update(env, list, id, fields) {
  const body = {};
  if ("title" in fields) body.title = fields.title;
  if ("notes" in fields) body.notes = fields.notes;
  if ("due" in fields) body.due = fields.due == null ? null : `${fields.due}T00:00:00.000Z`;
  return pickTask(await api(env, "PATCH", `/lists/${enc(list)}/tasks/${enc(id)}`, { body }));
}
export const done = async (env, list, id) => pickTask(await api(env, "PATCH", `/lists/${enc(list)}/tasks/${enc(id)}`, { body: { status: "completed" } }));
export const undone = async (env, list, id) =>
  pickTask(await api(env, "PATCH", `/lists/${enc(list)}/tasks/${enc(id)}`, { body: { status: "needsAction", completed: null } }));
export const remove = async (env, list, id) => { await api(env, "DELETE", `/lists/${enc(list)}/tasks/${enc(id)}`); return null; };

export async function move(env, list, id, { parent, previous } = {}) {
  const query = {};
  if (parent) query.parent = parent;
  if (previous) query.previous = previous;
  return pickTask(await api(env, "POST", `/lists/${enc(list)}/tasks/${enc(id)}/move`, { query }));
}

/** Revokes the refresh token at Google (best effort) and forgets it. */
export async function logout(env) {
  let token = null;
  try { token = readToken(env); } catch {}
  if (token) {
    try {
      await env.fetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: token.refresh_token }).toString() });
    } catch {}
  }
  env.removeFile(env.tokenPath);
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/my-tasks-google.test.mjs`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add mods/my-tasks/google.mjs tests/my-tasks-google.test.mjs
git commit -m "my-tasks: Google OAuth and Tasks REST calls with injectable fetch and files"
```

---

### Task 3: Command-line helper (`tasks.mjs`)

**Files:**
- Create: `mods/my-tasks/tasks.mjs`
- Test: `tests/my-tasks-cli.test.mjs`

**Interfaces:**
- Consumes: everything from `./google.mjs` (Task 2).
- Produces: `parseCommand(argv: string[]) → {name, args}` (throws `TasksError("usage")`), `makeEnv(dir?) → env`, `main(argv, env?, out?) → Promise<void>` (calls `out(jsonLine)` once). Command line: `node tasks.mjs <name> [--flag value]... -- [positional]...`.

- [ ] **Step 1: Write the failing test**

Create `tests/my-tasks-cli.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
const C = await import(new URL("../mods/my-tasks/tasks.mjs", import.meta.url).href);

const usage = e => e?.kind === "usage";

test("parseCommand: flags before --, free text after", () => {
  assert.deepEqual(C.parseCommand(["add", "--parent", "p", "--", "L", "제목"]), { name: "add", args: { parent: "p", list: "L", title: "제목" } });
  assert.deepEqual(C.parseCommand(["add", "--", "L", "--weird"]), { name: "add", args: { list: "L", title: "--weird" } });
  assert.deepEqual(C.parseCommand(["move", "--previous", "q", "--", "L", "T"]), { name: "move", args: { previous: "q", list: "L", id: "T" } });
  assert.deepEqual(C.parseCommand(["lists", "--"]), { name: "lists", args: {} });
  assert.deepEqual(C.parseCommand(["lists"]), { name: "lists", args: {} });
});

test("parseCommand: update reads its JSON", () => {
  assert.deepEqual(C.parseCommand(["update", "--", "L", "T", '{"title":"a","due":null}']), { name: "update", args: { list: "L", id: "T", fields: { title: "a", due: null } } });
  assert.deepEqual(C.parseCommand(["update", "--", "L", "T", '{"due":"2026-11-12"}']).args.fields, { due: "2026-11-12" });
});

test("parseCommand: refuses what it doesn't know", () => {
  assert.throws(() => C.parseCommand(["nope"]), usage);
  assert.throws(() => C.parseCommand([]), usage);
  assert.throws(() => C.parseCommand(["tasks", "--"]), usage); // missing list
  assert.throws(() => C.parseCommand(["tasks", "--parent", "x", "--", "L"]), usage); // flag not allowed
  assert.throws(() => C.parseCommand(["add", "--parent"]), usage); // flag without value
  assert.throws(() => C.parseCommand(["update", "--", "L", "T", "{bad"]), usage);
  assert.throws(() => C.parseCommand(["update", "--", "L", "T", '{"due":"11/12"}']), usage);
  assert.throws(() => C.parseCommand(["update", "--", "L", "T", "[1]"]), usage);
});

function memEnv(files = {}, responses = []) {
  const map = new Map(Object.entries(files));
  return {
    clientPath: "/c.json", tokenPath: "/t.json", now: () => 0,
    readFile: p => map.get(p) ?? null, writeFile: (p, s) => map.set(p, s), removeFile: p => map.delete(p),
    fetch: async () => { const j = responses.shift() ?? {}; return { status: 200, ok: true, text: async () => JSON.stringify(j), json: async () => j }; },
  };
}
const capture = () => { const lines = []; return { lines, out: s => { lines.push(s); } }; };

test("main prints one JSON line for errors", async () => {
  const a = capture();
  await C.main(["status"], memEnv(), a.out);
  assert.equal(a.lines.length, 1);
  const r = JSON.parse(a.lines[0]);
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, "no-client");
  const b = capture();
  await C.main(["nope"], memEnv(), b.out);
  assert.equal(JSON.parse(b.lines[0]).error.kind, "usage");
});

test("main prints data on success", async () => {
  const files = { "/c.json": JSON.stringify({ installed: { client_id: "c", client_secret: "s" } }), "/t.json": JSON.stringify({ access_token: "a", refresh_token: "r", expiry: 9e15 }) };
  const a = capture();
  await C.main(["lists", "--"], memEnv(files, [{ items: [{ id: "L", title: "내 할 일" }] }]), a.out);
  assert.deepEqual(JSON.parse(a.lines[0]), { ok: true, data: [{ id: "L", title: "내 할 일" }] });
});

test("makeEnv keeps its files in <app>/my-tasks", () => {
  const env = C.makeEnv("/app/my-tasks");
  assert.equal(env.clientPath.replaceAll("\\", "/"), "/app/my-tasks/client.json");
  assert.equal(env.tokenPath.replaceAll("\\", "/"), "/app/my-tasks/token.json");
  assert.equal(typeof env.fetch, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/my-tasks-cli.test.mjs`
Expected: FAIL (cannot find module `mods/my-tasks/tasks.mjs`).

- [ ] **Step 3: Write the implementation**

Create `mods/my-tasks/tasks.mjs`:

```js
// Google Tasks helper for the my-tasks mod: `node tasks.mjs <command> [--flag value]... -- [args]...`
// Prints exactly one JSON line: {"ok":true,"data":...} or {"ok":false,"error":{"kind":"...","message":"..."}}.
// Its files live in <Herdr app folder>/my-tasks/ (two folders up from this file, then my-tasks).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import * as G from "./google.mjs";

const SPEC = {
  status: [], login: [], logout: [], lists: [],
  "list-add": ["title"], "list-rename": ["id", "title"], "list-delete": ["id"],
  tasks: ["list"], add: ["list", "title"], update: ["list", "id", "json"],
  done: ["list", "id"], undone: ["list", "id"], delete: ["list", "id"], move: ["list", "id"],
};
const FLAGS = { add: ["parent"], move: ["parent", "previous"] };
const LOGIN_WAIT_MS = 300000;
const usage = message => new G.TasksError("usage", message);

export function parseCommand(argv) {
  const [name, ...rest] = argv;
  if (!name || !Object.hasOwn(SPEC, name)) throw usage(`알 수 없는 명령: ${name ?? ""}`);
  const allowed = FLAGS[name] ?? [], args = {}, positional = [];
  let i = 0;
  for (; i < rest.length && rest[i] !== "--"; i++) {
    const m = /^--([a-z]+)$/.exec(rest[i]);
    if (!m || !allowed.includes(m[1]) || i + 1 >= rest.length || rest[i + 1] === "--") throw usage(`${name}: 잘못된 인자 ${rest[i]}`);
    args[m[1]] = rest[++i];
  }
  positional.push(...rest.slice(i + 1));
  if (positional.length !== SPEC[name].length) throw usage(`${name}: 인자 ${SPEC[name].length}개가 필요해요`);
  SPEC[name].forEach((k, j) => { args[k] = positional[j]; });
  if (name === "update") {
    let fields;
    try { fields = JSON.parse(args.json); } catch { throw usage("update: JSON을 읽지 못했어요"); }
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw usage("update: JSON 객체가 필요해요");
    if ("due" in fields && fields.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fields.due)) throw usage("update: due는 YYYY-MM-DD 또는 null");
    delete args.json;
    args.fields = fields;
  }
  return { name, args };
}

export function makeEnv(dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "my-tasks")) {
  return {
    fetch: (...a) => globalThis.fetch(...a),
    readFile: p => { try { return readFileSync(p, "utf8"); } catch { return null; } },
    writeFile: (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s, { mode: 0o600 }); },
    removeFile: p => rmSync(p, { force: true }),
    now: () => Date.now(),
    clientPath: join(dir, "client.json"),
    tokenPath: join(dir, "token.json"),
  };
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref(); } catch {}
}

const b64url = buf => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const html = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Waits on 127.0.0.1 for Google's redirect, then saves the tokens. Gives up after LOGIN_WAIT_MS.
function login(env) {
  const client = G.readClient(env);
  const verifier = b64url(randomBytes(32)), challenge = b64url(createHash("sha256").update(verifier).digest()), state = b64url(randomBytes(16));
  return new Promise((resolve, reject) => {
    let redirect = "", finished = false;
    const page = (res, message) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>Herdr Task</title><p style="font:16px sans-serif;margin:40px">${html(message)}</p>`);
    };
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      if (error) reject(error); else resolve({ loggedIn: true });
    };
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/") { res.writeHead(404).end(); return; }
      if (url.searchParams.get("state") !== state) { page(res, "요청이 맞지 않아요. Herdr에서 다시 로그인해 주세요."); return; }
      const denied = url.searchParams.get("error");
      if (denied) { page(res, `연결하지 못했어요: ${denied}`); finish(new G.TasksError("api", `로그인을 거부했어요: ${denied}`)); return; }
      try {
        await G.exchangeCode(env, client, { code: url.searchParams.get("code") ?? "", verifier, redirect });
        page(res, "연결됐어요. 이 창을 닫아도 돼요.");
        finish(null);
      } catch (e) {
        page(res, `연결하지 못했어요: ${e?.message ?? e}`);
        finish(e);
      }
    });
    const timer = setTimeout(() => finish(new G.TasksError("api", "로그인 시간이 지났어요. 다시 시도해 주세요")), LOGIN_WAIT_MS);
    server.on("error", e => finish(new G.TasksError("internal", String(e?.message ?? e))));
    server.listen(0, "127.0.0.1", () => {
      redirect = `http://127.0.0.1:${server.address().port}`;
      openBrowser(G.authUrl(client, { redirect, challenge, state }));
    });
  });
}

async function run(env, { name, args: a }) {
  switch (name) {
    case "status": return G.status(env);
    case "login": return login(env);
    case "logout": return G.logout(env);
    case "lists": return G.lists(env);
    case "list-add": return G.listAdd(env, a.title);
    case "list-rename": return G.listRename(env, a.id, a.title);
    case "list-delete": return G.listDelete(env, a.id);
    case "tasks": return G.tasks(env, a.list);
    case "add": return G.add(env, a.list, a.title, a.parent);
    case "update": return G.update(env, a.list, a.id, a.fields);
    case "done": return G.done(env, a.list, a.id);
    case "undone": return G.undone(env, a.list, a.id);
    case "delete": return G.remove(env, a.list, a.id);
    case "move": return G.move(env, a.list, a.id, { parent: a.parent, previous: a.previous });
  }
  throw usage(`알 수 없는 명령: ${name}`);
}

export async function main(argv, env = makeEnv(), out = s => process.stdout.write(s + "\n")) {
  let line;
  try {
    const data = await run(env, parseCommand(argv));
    line = JSON.stringify({ ok: true, data: data ?? null });
  } catch (e) {
    line = JSON.stringify({ ok: false, error: { kind: e instanceof G.TasksError ? e.kind : "internal", message: String(e?.message ?? e) } });
  }
  await out(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), makeEnv(), s => new Promise(r => process.stdout.write(s + "\n", r))).then(() => process.exit(0));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/my-tasks-cli.test.mjs`
Expected: PASS, all tests.

- [ ] **Step 5: Smoke-run the real entry point**

Run (Git Bash): `node mods/my-tasks/tasks.mjs status --`
Expected: one line like `{"ok":false,"error":{"kind":"no-client","message":"OAuth 클라이언트 파일이 없어요: C:\\MyCode\\herdr-UI\\my-tasks\\client.json"}}` (from the repo the folder is `<repo>/my-tasks`; installed it is `<app>/my-tasks`). And `node mods/my-tasks/tasks.mjs nope` prints `"kind":"usage"`.

- [ ] **Step 6: Commit**

```bash
git add mods/my-tasks/tasks.mjs tests/my-tasks-cli.test.mjs
git commit -m "my-tasks: command-line helper with loopback login"
```

---

### Task 4: The panel (`main.js`, `mod.json`, icon)

**Files:**
- Create: `mods/my-tasks/mod.json`, `mods/my-tasks/tasks.svg`, `mods/my-tasks/main.js`

**Interfaces:**
- Consumes from `./logic.js` (Task 1): `REFRESH_MS, LOGIN_TIMEOUT_MS, APP_DIR_SCRIPT, helperPath, command, parseOutput, execError, buildTree, moveArgs, canMove, dueLabel, todayString, parseDue, errorText, deleteText, listDeleteText, notesPreview`.
- Consumes the helper's command line (Task 3) through `exec("node", [script, ...command(...)])`.
- Produces: a layout block mod `my-tasks`, panel id `tasks` (Task 5 wires it in).
- Herdr API used (see `~/.config/herdr-app/herdr.d.ts`, `gpui-kit.d.ts`): `exec(cmd, args, {timeout})`, `theme()`, `layout()`, `InputState`/`Input` (`on("submit")`, `value()`, `set_value()`, `focus()`), `TextareaState`/`Textarea`, `localStorage`, `cx.spawn`, `cx.timer.every`, element `.on_hover((hovered, cx) => …)`.

There is no unit test for this file (it needs the Herdr runtime). Verification is `herdr-app check` plus loading in the app.

- [ ] **Step 1: Create `mods/my-tasks/mod.json`**

```json
{ "place": "none" }
```

- [ ] **Step 2: Create `mods/my-tasks/tasks.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="m7.5 9 1.5 1.5L11.5 8M7.5 15l1.5 1.5 2.5-2.5M14 9.5h3M14 15.5h3"/></svg>
```

- [ ] **Step 3: Create `mods/my-tasks/main.js`**

```js
// Google Tasks in a side panel: lists, tasks with one level of subtasks, add / complete / edit / delete / reorder.
// Every Google call goes through tasks.mjs (node), which prints one JSON line. Jobs run one at a time, in order.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, theme, layout } from "herdr";
import {
  REFRESH_MS, LOGIN_TIMEOUT_MS, APP_DIR_SCRIPT, helperPath, command, parseOutput, execError, buildTree, moveArgs, canMove,
  dueLabel, todayString, parseDue, errorText, deleteText, listDeleteText, notesPreview,
} from "./logic.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const SETUP = [
  "1. Google Cloud에서 Tasks API를 켜고 OAuth 동의 화면을 만듭니다 (게시 상태: 프로덕션).",
  "2. OAuth 클라이언트를 '데스크톱 앱'으로 만들고 JSON을 client.json으로 저장합니다.",
  "3. [로그인]을 누르고 브라우저에서 허용합니다.",
];
const MOVES = [["up", "↑"], ["down", "↓"], ["indent", "⇥"], ["outdent", "⇤"]];

export default class Tasks extends View {
  init(_props, cx) {
    this.script = null; // the helper's path, found on the first call
    this.screen = "loading"; // "loading" | "login" | "list"
    this.loginInfo = errorText({ kind: "no-login" });
    this.waiting = null; // the login attempt being waited on
    this.lists = []; this.listId = localStorage.getItem("list");
    this.tasks = []; this.tree = buildTree([]);
    this.showDone = false; this.pickOpen = false; this.menuOpen = false;
    this.edit = null; // { id, error }
    this.confirm = null; // { kind: "task" | "list", id, text, ids? }
    this.naming = null; // { mode: "new" | "rename", id }
    this.hover = null;
    this.busy = new Set(); this.queue = []; this.running = null;
    this.error = null; // { text, job }
    this.wasShown = false;

    this.addInput = InputState.new({ placeholder: "새 할 일 추가…" });
    this.addInput.on("submit", (_e, cx) => { this.addTask(cx); cx.notify(); });
    this.nameInput = InputState.new({ placeholder: "목록 이름" });
    this.nameInput.on("submit", (_e, cx) => { this.submitName(cx); cx.notify(); });
    this.titleInput = InputState.new({ placeholder: "제목" });
    this.titleInput.on("submit", (_e, cx) => { this.save(cx); cx.notify(); });
    this.notesInput = TextareaState.new({ placeholder: "메모", rows: 3 });
    this.dueInput = InputState.new({ placeholder: "마감일 YYYY-MM-DD" });
    this.dueInput.on("submit", (_e, cx) => { this.save(cx); cx.notify(); });

    cx.timer.every(REFRESH_MS, cx => {
      if (this.visible() && this.screen === "list" && this.idle()) { this.enqueue(this.refreshJob(), cx); cx.notify(); }
    });
  }

  // Whether the panel is open on this tab; true when the layout has no such panel.
  visible() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !body) return true;
    return !panel.hidden && body.active === "tasks";
  }

  idle() {
    return !this.running && !this.queue.length && !this.edit && !this.confirm && !this.naming;
  }

  // Runs the helper. Never throws: { ok: true, data } or { ok: false, error }.
  async call(args, timeout) {
    if (!this.script) {
      let r;
      try { r = await exec("node", ["-e", APP_DIR_SCRIPT]); }
      catch (e) { return { ok: false, error: execError(e) }; }
      if (r.code !== 0 || !r.stdout.trim()) return { ok: false, error: { kind: "no-node", message: r.stderr } };
      this.script = helperPath(r.stdout.trim());
    }
    try {
      const r = await exec("node", [this.script, ...args], timeout ? { timeout } : {});
      return parseOutput(r.stdout, r.stderr);
    } catch (e) { return { ok: false, error: execError(e) }; }
  }

  refreshJob() {
    return { refresh: "all" };
  }

  // A job: { run?() → result, before?(), undo?(), done?(data), mark?: task id, refresh?: "all" | "tasks" }.
  enqueue(job, cx) {
    job.before?.();
    this.queue.push(job);
    this.pump(cx);
  }

  pump(cx) {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift();
    this.running = job;
    if (job.mark) this.busy.add(job.mark);
    cx.spawn(async cx => {
      let r;
      try { r = job.run ? await job.run() : { ok: true }; }
      catch (e) { r = { ok: false, error: { kind: "internal", message: String(e) } }; }
      let error = r.ok ? null : r.error, retry = r.ok ? null : job;
      if (r.ok) job.done?.(r.data); else job.undo?.();
      // Read again after the job, failed or not: the next job (a second ↓, say) works from what Google has now.
      if (job.refresh) {
        const e = job.refresh === "all" ? await this.fetchAll() : await this.fetchTasks();
        if (e && !error) { error = e; retry = this.refreshJob(); }
      }
      if (job.mark) this.busy.delete(job.mark);
      this.running = null;
      if (error) this.fail(error, retry); else this.error = null;
      cx.notify();
      this.pump(cx);
    });
  }

  fail(error, job) {
    const e = errorText(error);
    if (e.screen === "login") {
      this.screen = "login"; this.loginInfo = e; this.queue = []; this.error = null;
      return;
    }
    this.error = { text: e.text, job };
  }

  // Lists, then the chosen list's tasks. Returns an error or null.
  async fetchAll() {
    const l = await this.call(command("lists"));
    if (!l.ok) return l.error;
    this.lists = l.data;
    if (!this.lists.some(x => x.id === this.listId)) this.choose(this.lists[0]?.id ?? null);
    return this.fetchTasks();
  }

  async fetchTasks() {
    const listId = this.listId;
    if (!listId) { this.setTasks([]); this.screen = "list"; return null; }
    const t = await this.call(command("tasks", [listId]));
    if (listId !== this.listId) return null;
    if (!t.ok) return t.error;
    this.setTasks(t.data);
    this.screen = "list";
    return null;
  }

  choose(id) {
    this.listId = id;
    if (id) localStorage.setItem("list", id); else localStorage.removeItem("list");
    this.edit = null; this.confirm = null; this.showDone = false;
    this.setTasks([]);
  }

  setTasks(list) {
    this.tasks = list;
    this.tree = buildTree(list);
    const has = id => list.some(t => t.id === id);
    if (this.edit && !has(this.edit.id)) this.edit = null;
    if (this.confirm?.kind === "task" && !has(this.confirm.id)) this.confirm = null;
  }

  login(cx) {
    if (this.waiting) return;
    const attempt = {};
    this.waiting = attempt;
    cx.spawn(async cx => {
      const r = await this.call(command("login"), LOGIN_TIMEOUT_MS);
      if (this.waiting !== attempt) return; // cancelled
      this.waiting = null;
      if (r.ok) { this.screen = "loading"; this.enqueue(this.refreshJob(), cx); }
      else {
        const e = errorText(r.error);
        this.loginInfo = e.screen === "login" ? e : { ...this.loginInfo, text: e.text, detail: null };
      }
      cx.notify();
    });
  }

  logout(cx) {
    this.menuOpen = false;
    this.enqueue({
      run: () => this.call(command("logout")),
      done: () => { this.screen = "login"; this.loginInfo = errorText({ kind: "no-login" }); this.lists = []; this.setTasks([]); },
    }, cx);
  }

  chooseList(id, cx) {
    this.pickOpen = false;
    if (id === this.listId) return;
    this.choose(id);
    this.enqueue({ refresh: "tasks" }, cx);
  }

  addTask(cx) {
    const title = this.addInput.value().trim(), list = this.listId;
    if (!title || !list) return;
    this.addInput.set_value("");
    this.enqueue({ refresh: "tasks", run: () => this.call(command("add", [list, title])) }, cx);
  }

  startNaming(mode) {
    this.menuOpen = false; this.pickOpen = false;
    const current = this.lists.find(l => l.id === this.listId);
    if (mode === "rename" && !current) return;
    this.naming = { mode, id: current?.id ?? null };
    this.nameInput.set_value(mode === "rename" ? current.title : "");
    this.nameInput.focus();
  }

  submitName(cx) {
    const naming = this.naming, title = this.nameInput.value().trim();
    if (!naming || !title) return;
    this.naming = null;
    if (naming.mode === "new") this.enqueue({ refresh: "all", run: () => this.call(command("list-add", [title])), done: data => this.choose(data.id) }, cx);
    else this.enqueue({ refresh: "all", run: () => this.call(command("list-rename", [naming.id, title])) }, cx);
  }

  // Shown at once; put back if Google refuses.
  toggle(task, cx) {
    if (this.busy.has(task.id)) return;
    const list = this.listId, finish = task.status !== "completed", before = { status: task.status, completed: task.completed };
    const set = values => {
      const x = this.tasks.find(t => t.id === task.id);
      if (x) { Object.assign(x, values); this.setTasks(this.tasks); }
    };
    this.enqueue({
      mark: task.id,
      before: () => set(finish ? { status: "completed", completed: new Date().toISOString() } : { status: "needsAction", completed: null }),
      undo: () => set(before),
      run: () => this.call(command(finish ? "done" : "undone", [list, task.id])),
    }, cx);
  }

  openEdit(task) {
    if (this.busy.has(task.id)) return;
    this.confirm = null;
    this.edit = { id: task.id, error: null };
    this.titleInput.set_value(task.title ?? "");
    this.notesInput.set_value(task.notes ?? "");
    this.dueInput.set_value(task.due ? task.due.slice(0, 10) : "");
    this.titleInput.focus();
  }

  save(cx) {
    const edit = this.edit, list = this.listId;
    if (!edit) return;
    const due = parseDue(this.dueInput.value());
    if (due === undefined) { edit.error = "YYYY-MM-DD로 적어 주세요"; return; }
    const fields = { title: this.titleInput.value().trim(), notes: this.notesInput.value(), due };
    this.edit = null;
    this.enqueue({ mark: edit.id, refresh: "tasks", run: () => this.call(command("update", [list, edit.id, JSON.stringify(fields)])) }, cx);
  }

  askDelete(task) {
    this.edit = null;
    const kids = this.tree.roots.find(r => r.id === task.id)?.children ?? [];
    this.confirm = { kind: "task", id: task.id, text: deleteText(task, kids.length), ids: [...kids.map(k => k.id), task.id] };
  }

  // Children first, then the task. On a retry, ones already gone are skipped.
  deleteTask(cx) {
    const c = this.confirm, list = this.listId;
    if (!c) return;
    this.confirm = null;
    this.enqueue({
      mark: c.id, refresh: "tasks",
      run: async () => {
        for (const id of c.ids.filter(id => this.tasks.some(t => t.id === id))) {
          const r = await this.call(command("delete", [list, id]));
          if (!r.ok) return r;
        }
        return { ok: true };
      },
    }, cx);
  }

  // Worked out when the job runs, from the tree as Google last sent it.
  move(task, dir, cx) {
    const list = this.listId;
    this.enqueue({
      mark: task.id, refresh: "tasks",
      run: async () => {
        const args = moveArgs(this.tree, task.id, dir);
        return args ? this.call(command("move", [list, task.id], args)) : { ok: true };
      },
    }, cx);
  }

  askDeleteList() {
    this.menuOpen = false;
    const current = this.lists.find(l => l.id === this.listId);
    if (!current) return;
    this.edit = null;
    this.confirm = { kind: "list", id: current.id, text: listDeleteText(current, this.tasks.length) };
  }

  deleteList(cx) {
    const c = this.confirm;
    if (!c) return;
    this.confirm = null;
    this.enqueue({
      refresh: "all",
      run: () => this.call(command("list-delete", [c.id])),
      done: () => { if (this.listId === c.id) this.choose(null); },
    }, cx);
  }

  header(t) {
    return h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().child("Task"))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
        .child(this.running || this.queue.length ? "동기화 중…" : ""))
      .child(div().id("tasks-refresh").w(20).cursor_pointer().text_color(t.muted)
        .on_click((_e, cx) => { if (!this.waiting) this.enqueue(this.refreshJob(), cx); cx.notify(); }).child("⟳"));
  }

  loginView(t, button) {
    const info = this.loginInfo, noClient = info.kind === "no-client";
    return v_flex().flex_1().min_h(0).p(16).gap(10)
      .child(div().font_semibold().child(info.text))
      .when(Boolean(info.detail), el => el.child(div().text_size(12).text_color(t.dim).child(info.detail)))
      .children(SETUP.map(line => div().text_size(12).text_color(t.muted).child(line)))
      .child(div().text_size(12).text_color(t.dim).child("자세한 방법은 README의 Task 패널 절을 보세요."))
      .child(this.waiting
        ? h_flex().gap(8).items_center()
          .child(div().text_size(12).child("브라우저에서 허용해 주세요…"))
          .child(button("tasks-login-cancel", "취소", () => { this.waiting = null; }))
        : h_flex().child(noClient
          ? button("tasks-recheck", "다시 확인", cx => this.enqueue(this.refreshJob(), cx))
          : button("tasks-login", "로그인", cx => this.login(cx))));
  }

  listView(t, button, icon) {
    const current = this.lists.find(l => l.id === this.listId);
    const out = [
      h_flex().h(38).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(h_flex().id("tasks-pick").h(24).px(8).flex_1().min_w(0).gap(6).items_center().rounded(6).cursor_pointer().text_size(12)
          .border_1().border_color(t.border).hover(s => s.bg(t.hover))
          .on_click((_e, cx) => { this.pickOpen = !this.pickOpen; this.menuOpen = false; cx.notify(); })
          .child(div().flex_1().min_w(0).truncate().child(current?.title ?? "목록 없음"))
          .child(div().flex_none().text_color(t.muted).child("▾")))
        .child(button("tasks-list-new", "+", () => this.startNaming("new")))
        .child(button("tasks-menu", "⋯", () => { this.menuOpen = !this.menuOpen; this.pickOpen = false; })),
    ];
    if (this.pickOpen) out.push(v_flex().flex_none().p(6).gap(1).border_b(1).border_color(t.border)
      .children(this.lists.map(l => h_flex().id(`tasks-pick-${l.id}`).h(26).px(8).items_center().rounded(6).cursor_pointer().text_size(12)
        .bg(l.id === this.listId ? t.selected : t.background).hover(s => s.bg(t.hover))
        .on_click((_e, cx) => { this.chooseList(l.id, cx); cx.notify(); })
        .child(div().flex_1().min_w(0).truncate().child(l.title)))));
    if (this.menuOpen) out.push(h_flex().flex_none().px(10).py(6).gap(6).flex_wrap().border_b(1).border_color(t.border)
      .when(Boolean(current), el => el
        .child(button("tasks-list-rename", "목록 이름 바꾸기", () => this.startNaming("rename")))
        .child(button("tasks-list-delete", "목록 삭제", () => this.askDeleteList())))
      .child(button("tasks-logout", "로그아웃", cx => this.logout(cx))));
    if (this.naming) out.push(h_flex().h(38).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().text_size(12).text_color(t.dim).child(this.naming.mode === "new" ? "새 목록" : "이름"))
      .child(Input.new(this.nameInput).flex_1().h(26).text_size(12.5))
      .child(button("tasks-name-ok", "확인", cx => this.submitName(cx)))
      .child(button("tasks-name-cancel", "취소", () => { this.naming = null; })));
    if (this.confirm?.kind === "list") out.push(h_flex().flex_none().px(10).py(6).gap(6).items_center().flex_wrap().border_b(1).border_color(t.border).text_size(12)
      .child(div().child(this.confirm.text))
      .child(button("tasks-list-delete-ok", "삭제", cx => this.deleteList(cx)))
      .child(button("tasks-list-delete-cancel", "취소", () => { this.confirm = null; })));
    if (this.listId) out.push(h_flex().h(38).flex_none().px(10).items_center().border_b(1).border_color(t.border)
      .child(Input.new(this.addInput).flex_1().h(26).text_size(12.5)));
    if (this.error) out.push(h_flex().flex_none().px(10).py(6).gap(6).items_center().flex_wrap().border_b(1).border_color(t.border).text_size(12)
      .child(div().flex_1().min_w(0).text_color(t.ansi1).child(`⚠ ${this.error.text}`))
      .when(Boolean(this.error.job), el => el.child(button("tasks-retry", "다시 시도", cx => {
        const job = this.error?.job;
        this.error = null;
        if (job) this.enqueue(job, cx);
      })))
      .child(button("tasks-error-close", "닫기", () => { this.error = null; })));
    out.push(this.body(t, button, icon));
    return out;
  }

  body(t, button, icon) {
    const list = v_flex().id("tasks-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1);
    const note = text => div().p(8).text_size(12).text_color(t.dim).child(text);
    if (this.screen === "loading") return list.child(note("불러오는 중…"));
    if (!this.listId) return list.child(note("목록이 없어요. [+]로 만들어 보세요."));
    const { roots, done } = this.tree;
    const rows = roots.flatMap(r => [this.row(r, 0, t, button, icon), ...r.children.map(c => this.row(c, 1, t, button, icon))]);
    const empty = roots.length ? [] : [note(done.length ? "남은 할 일이 없어요." : "할 일이 없어요.")];
    const doneRows = !done.length ? [] : [
      h_flex().id("tasks-done-toggle").h(28).px(8).mt(6).items_center().rounded(6).cursor_pointer().text_size(12).text_color(t.muted)
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => { this.showDone = !this.showDone; cx.notify(); })
        .child(`${this.showDone ? "▾" : "▸"} 완료됨 (${done.length})`),
      ...(this.showDone ? done.map(d => this.row(d, 0, t, button, icon)) : []),
    ];
    return list.children([...rows, ...empty, ...doneRows]);
  }

  row(task, depth, t, button, icon) {
    const done = task.status === "completed", id = task.id, pad = 8 + depth * 18;
    if (this.confirm?.kind === "task" && this.confirm.id === id) {
      return h_flex().id(`task-${id}`).flex_none().pl(pad).pr(8).py(6).gap(6).items_center().flex_wrap().rounded(7).bg(t.hover).text_size(12)
        .child(div().child(this.confirm.text))
        .child(button("task-delete-ok", "삭제", cx => this.deleteTask(cx)))
        .child(button("task-delete-cancel", "취소", () => { this.confirm = null; }));
    }
    if (this.edit?.id === id) {
      return v_flex().id(`task-${id}`).flex_none().pl(pad).pr(8).py(6).gap(6).rounded(7).bg(t.hover)
        .child(Input.new(this.titleInput).w_full().h(26).text_size(12.5))
        .child(Textarea.new(this.notesInput).w_full().text_size(12))
        .child(Input.new(this.dueInput).w_full().h(26).text_size(12))
        .when(Boolean(this.edit.error), el => el.child(div().text_size(11).text_color(t.ansi1).child(this.edit.error)))
        .child(h_flex().gap(6)
          .child(button("task-save", "저장", cx => this.save(cx)))
          .child(button("task-edit-cancel", "취소", () => { this.edit = null; })));
    }
    const busy = this.busy.has(id), hovered = this.hover === id && !busy;
    const due = done ? null : dueLabel(task.due, todayString()), preview = done ? null : notesPreview(task.notes);
    const remove = icon(`task-del-${id}`, "🗑", () => this.askDelete(task));
    const tools = !hovered ? [] : done ? [remove]
      : MOVES.filter(([dir]) => canMove(this.tree, id, dir)).map(([dir, label]) => icon(`task-${dir}-${id}`, label, cx => this.move(task, dir, cx))).concat([remove]);
    return v_flex().id(`task-${id}`).flex_none().pl(pad).pr(8).py(5).gap(2).rounded(7).hover(s => s.bg(t.hover))
      .on_hover((h, cx) => { if (h) this.hover = id; else if (this.hover === id) this.hover = null; cx.notify(); })
      .child(h_flex().gap(8).items_center().min_w(0)
        .child(div().id(`task-check-${id}`).flex_none().w(16).cursor_pointer().text_color(done ? t.ansi2 : t.muted)
          .on_click((_e, cx) => { this.toggle(task, cx); cx.notify(); }).child(done ? "✓" : "○"))
        .child(div().id(`task-title-${id}`).flex_1().min_w(0).truncate().text_color(done ? t.dim : t.foreground)
          .when(!done, el => el.cursor_pointer().on_click((_e, cx) => { this.openEdit(task); cx.notify(); }))
          .child(task.title || "(제목 없음)"))
        .when(busy, el => el.child(div().flex_none().text_color(t.dim).child("…")))
        .children(tools)
        .when(!hovered && !busy && Boolean(due), el => el.child(div().flex_none().text_size(11).text_color(due.overdue ? t.ansi1 : t.dim).child(due.text))))
      .when(Boolean(preview), el => el.child(div().pl(24).text_size(11).text_color(t.dim).truncate().child(preview)));
  }

  render(cx) {
    const shown = this.visible();
    if (shown && !this.wasShown && !this.waiting) this.enqueue(this.refreshJob(), cx);
    this.wasShown = shown;
    const t = theme();
    const button = (id, label, onClick) => h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).cursor_pointer()
      .text_size(12).text_color(t.foreground).border_1().border_color(t.border).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const icon = (id, label, onClick) => div().id(id).w(18).flex_none().text_center().cursor_pointer().text_size(12)
      .text_color(t.muted).hover(s => s.text_color(t.foreground))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const root = v_flex().id("tasks").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(this.header(t));
    if (this.screen === "login") return root.child(this.loginView(t, button));
    return root.children(this.listView(t, button, icon));
  }
}
```

- [ ] **Step 4: Load-check the mod**

Copy the folder into the app (mod.json first) and check it loads. In PowerShell:

```powershell
$to = "$env:USERPROFILE\.config\herdr-app\mods\my-tasks"
New-Item -ItemType Directory -Force $to | Out-Null
Copy-Item mods\my-tasks\mod.json $to -Force
Copy-Item mods\my-tasks\* $to -Recurse -Force
herdr-app check "$env:USERPROFILE\.config\herdr-app\mods\my-tasks"
```

Expected: no errors. If `check` reports an unknown element method (for example `w_full`, `mt`, `text_center`, `on_hover` on a `div`), look it up in `~/.config/herdr-app/gpui-kit.d.ts` and use the closest existing method; report each substitution.

- [ ] **Step 5: Run the whole suite**

Run (Git Bash): `node --test tests/*.test.mjs`
Expected: PASS (existing tests plus the three new files).

- [ ] **Step 6: Commit**

```bash
git add mods/my-tasks/mod.json mods/my-tasks/tasks.svg mods/my-tasks/main.js
git commit -m "my-tasks: the Task panel (login, lists, tasks, edits, reorder) over the helper"
```

---

### Task 5: Wire it in (tab bar button, installer, tests script, README)

**Files:**
- Modify: `mods/my-tabs/main.js` (lines ~178 and ~202)
- Modify: `install.ps1` (mods list, panel-body block, final message)
- Modify: `package.json` (`scripts.test`)
- Modify: `README.md`

**Interfaces:**
- Consumes: mod `my-tasks`, panel id `tasks`, icon `mods/my-tasks/tasks.svg` (Task 4).

- [ ] **Step 1: Tab bar button in `mods/my-tabs/main.js`**

Replace:

```js
    const enabled = [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "github", "plugins", "sessions"])];
```

with:

```js
    const enabled = [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "github", "plugins", "sessions", "tasks"])];
```

and after the line

```js
      .when(enabled.includes("sessions"), el => el.child(panelButton("sessions", "Session", "mods/my-sessions/sessions.svg")))
```

add:

```js
      .when(enabled.includes("tasks"), el => el.child(panelButton("tasks", "Task", "mods/my-tasks/tasks.svg")))
```

- [ ] **Step 2: `install.ps1`**

Replace the `$mods = @(...)` line with:

```powershell
$mods = @("my-files", "my-files-drag", "my-files-open", "my-github", "my-new-menu", "my-plugins", "my-sessions", "my-status", "my-status-dash", "my-tab-drag", "my-tabs", "my-tasks", "my-usage-dash", "my-viewer")
```

After the `sessions` block (the `if (-not (@($panelBody.children) | Where-Object { $_.id -eq "sessions" })) { ... }`), add:

```powershell
if (-not (@($panelBody.children) | Where-Object { $_.id -eq "tasks" })) {
  $tasks = [pscustomobject]@{ id = "tasks"; type = "block"; content = [pscustomobject]@{ mod = "my-tasks" } }
  $panelBody.children = @($panelBody.children) + $tasks
}
```

Replace the last message line with:

```powershell
Write-Host "완료. 탭 바에 Files · Changes · GitHub · Plugin · Session · Task 버튼이 보이면 성공이에요."
```

- [ ] **Step 3: `package.json` test script**

Append ` tests/my-tasks-logic.test.mjs tests/my-tasks-google.test.mjs tests/my-tasks-cli.test.mjs` to the end of the `scripts.test` string (inside the quotes).

- [ ] **Step 4: README**

Make these edits in `README.md`:

1. In "## 기능 한눈에", after the Sessions bullet add:
   `- **Task 패널**: Google Tasks 목록과 할 일 보기·추가·완료·편집·삭제, 하위 할 일과 순서 바꾸기`
   and change the tab bar bullet's `패널 버튼(GitHub · Plugin · Session)` to `패널 버튼(GitHub · Plugin · Session · Task)`.
2. In the mod table, after the `my-sessions` row add:
   `| \`my-tasks\` | Google Tasks 목록과 할 일 패널 (Node.js와 직접 만든 OAuth 클라이언트 사용) |`
   and change the `my-tabs` row's `GitHub · Plugin · Session 버튼 추가` to `GitHub · Plugin · Session · Task 버튼 추가`.
3. After the whole "### Sessions 패널 (`my-sessions`)" section (before "### 시스템 모니터"), add:

```markdown
### Task 패널 (`my-tasks`)

- 탭 바의 **Task** 버튼으로 엽니다. Google Tasks의 목록과 할 일을 보여 주고, 패널에서 바로 고칩니다.
- 맨 위에서 목록을 고르고, `[+]` 로 새 목록을 만들고, `[⋯]` 에서 목록 이름 바꾸기·삭제와 로그아웃을 합니다. 마지막으로 고른 목록을 기억합니다.
- 입력칸에 쓰고 Enter를 누르면 목록 맨 위에 추가됩니다. `○` 를 누르면 완료되고, 완료한 할 일은 아래 **완료됨**을 펼쳐 보고 `✓` 로 되돌립니다.
- 행에 마우스를 올리면 `↑` `↓`(순서), `⇥`(바로 위 할 일의 하위로), `⇤`(하위에서 빼기), `🗑`(삭제, 한 번 더 확인)가 나옵니다. 하위 할 일은 Google Tasks처럼 한 단계까지입니다.
- 제목을 누르면 그 자리에서 제목·메모·마감일(`YYYY-MM-DD`)을 고칩니다. 마감일은 날짜만 있고, 지난 날짜는 강조색입니다.
- 패널이 보이는 동안 2분마다 다시 읽고, ⟳ 로 바로 새로고침합니다. 원격 스페이스에서도 이 PC에서 실행합니다.

**처음 한 번: Google 계정 연결**

1. [Google Cloud 콘솔](https://console.cloud.google.com)에서 프로젝트를 만들고, **API 및 서비스 → 라이브러리**에서 **Google Tasks API**를 사용 설정합니다.
2. **OAuth 동의 화면**에서 사용자 유형 **외부**로 앱을 만들고, **게시 상태를 "프로덕션"으로** 바꿉니다. "테스트" 상태로 두면 Google이 7일마다 로그인을 끊습니다.
3. **사용자 인증 정보 → OAuth 클라이언트 ID 만들기**에서 유형 **데스크톱 앱**을 고르고, 만든 클라이언트의 JSON을 내려받아 `~\.config\herdr-app\my-tasks\client.json` 으로 저장합니다(폴더가 없으면 만듭니다).
4. 패널의 **[로그인]** 을 누르면 브라우저가 열립니다. "Google에서 확인하지 않은 앱" 경고가 뜨면 직접 만든 앱이므로 **고급 → (앱 이름)(으)로 이동**을 눌러 계속하고 허용합니다.

- 요청하는 권한은 Google Tasks 하나(`auth/tasks`)뿐입니다. 토큰은 `~\.config\herdr-app\my-tasks\token.json` 에만 저장되고 저장소에는 들어가지 않습니다. 로그아웃하면 Google에 토큰 취소를 보내고 파일을 지웁니다.
```

4. In "## 요구 사항", after the Sessions bullet add:
   `- Task 패널: Node.js 18 이상(\`node\` 명령)과 직접 만든 Google Cloud OAuth 클라이언트([Task 패널](#task-패널-my-tasks) 참고).`
5. In "## 설치 (Windows)": change `열세 mod` to `열네 mod`, and after the `sessions` 칸 bullet add
   `   - 오른쪽 패널(\`panel-body\`)에 \`tasks\` 칸(\`my-tasks\`) 추가`
6. In "## 원하는 기능만 설치하기" table, the **탭 바와 패널** row becomes:
   `| **탭 바와 패널** (GitHub · Plugins · Sessions · Task, \`+\` 파일 뷰어, 탭 끌어 분할) | \`my-tabs\`, \`my-new-menu\`, \`my-tab-drag\`, \`my-github\`, \`my-plugins\`, \`my-sessions\`, \`my-tasks\`, \`my-viewer\`, \`my-files\`, \`my-files-drag\`, \`my-files-open\` | \`"mod": "tabs"\` → \`"my-tabs"\`, \`panel-body\` 에 github · plugins · sessions · tasks 칸 추가 |`
   and in the bullet below change `GitHub · Plugin · Session 버튼은 \`my-tabs\` 에 있고, 버튼은 세 패널이 있다고 보고 항상 보입니다.` to `GitHub · Plugin · Session · Task 버튼은 \`my-tabs\` 에 있고, 버튼은 네 패널이 있다고 보고 항상 보입니다.`
7. In "## 수동 설치": change `열세 폴더` to `열네 폴더`, and the JSON block becomes:

```json
{ "id": "github", "type": "block", "content": { "mod": "my-github" } },
{ "id": "plugins", "type": "block", "content": { "mod": "my-plugins" } },
{ "id": "sessions", "type": "block", "content": { "mod": "my-sessions" } },
{ "id": "tasks", "type": "block", "content": { "mod": "my-tasks" } }
```

8. In "## 제거": step 1 `github·plugins·sessions 칸 삭제` → `github·plugins·sessions·tasks 칸 삭제`; step 2's folder list gets `my-tasks` after `my-tabs`; add step 4:
   `4. Task 패널의 연결까지 지우려면 패널에서 로그아웃한 뒤 \`~\.config\herdr-app\my-tasks\` 를 지웁니다.`
9. In "## 알려진 한계", after the 시스템 모니터 bullet add:
   `- Task 패널은 Google Tasks만 다룹니다(Google Keep 없음). 마감 시각, 반복, 하위의 하위는 Google Tasks API에 없어서 다루지 않습니다. 순서는 끌기 대신 버튼으로 바꿉니다. 할 일이 많은 목록은 읽을 때 100개마다 요청이 하나씩 늘어납니다.`

- [ ] **Step 5: Verify**

Run (Git Bash): `node --test tests/*.test.mjs` → PASS. Run `npm test` → PASS.
Run (PowerShell): `.\install.ps1 -ModsOnly` then `herdr-app check "$env:USERPROFILE\.config\herdr-app\mods\my-tabs"` and `herdr-app check "$env:USERPROFILE\.config\herdr-app\mods\my-tasks"` → no errors.
Check `grep -n "열세" README.md` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add mods/my-tabs/main.js install.ps1 package.json README.md
git commit -m "my-tasks: Task button in the tab bar, installer, tests script, README"
```
