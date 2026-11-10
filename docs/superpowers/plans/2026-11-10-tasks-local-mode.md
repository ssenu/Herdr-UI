# Task 패널 로컬 모드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `my-tasks` panel works with no setup by storing tasks in a local JSON file (local mode, the default), and keeps Google Tasks as an opt-in mode.

**Architecture:** A new `local.mjs` mirrors `google.mjs`'s functions and result shapes over `<app>/my-tasks/local.json`. `tasks.mjs` picks the backend per command from a `--backend local|google` flag (default `google`). The panel remembers the mode, passes the flag on every call, and offers mode switches in its `[⋯]` menu.

**Tech Stack:** Node built-ins, Herdr mod API, `node --test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-10-tasks-local-mode-design.md`.
- No npm dependencies.
- Local file: `<app>/my-tasks/local.json`, shape `{ "lists": [{ "id", "title" }], "tasks": { "<list id>": [ { id, title, notes, due, status, completed, parent } ] } }`. A broken file is never overwritten: error kind `local`, message `로컬 저장 파일을 읽지 못했어요: <path>`.
- `--backend` absent means `google` (existing behaviour unchanged). `login`/`logout` with `local` → `usage` `로컬 모드에는 로그인이 없어요`.
- Mode key `my-tasks.mode` (`"local"`/`"google"`); list keys `my-tasks.list.local`, `my-tasks.list.google` (google inherits old `my-tasks.list`).
- UI copy is Korean, exactly as written below.
- Tests: Git Bash `node --test tests/*.test.mjs`.

---

### Task 1: Local storage backend (`local.mjs`)

**Files:**
- Create: `mods/my-tasks/local.mjs`
- Test: `tests/my-tasks-local.test.mjs`

**Interfaces:**
- Consumes: `TasksError` from `./google.mjs` (`new TasksError(kind, message)`, has `.kind`).
- `env`: `{ localPath, readFile(path) → string|null, writeFile(path, text), newId() → string, now() → ms }`.
- Produces (exported, all async): `status(env) → {loggedIn:true}`, `lists(env) → [{id,title}]`, `listAdd(env,title)`, `listRename(env,id,title)`, `listDelete(env,id) → null`, `tasks(env,list) → Task[]`, `add(env,list,title,parent?)`, `update(env,list,id,{title?,notes?,due?})`, `done(env,list,id)`, `undone(env,list,id)`, `remove(env,list,id) → null`, `move(env,list,id,{parent?,previous?})`. Task = `{id,title,notes,due,status,completed,parent,position}`, `position` = array index as 8-digit string.

- [ ] **Step 1: Write the failing test**

Create `tests/my-tasks-local.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
const LO = await import(new URL("../mods/my-tasks/local.mjs", import.meta.url).href);

function memEnv(initial) {
  const files = new Map();
  if (initial !== undefined) files.set("/l.json", initial);
  let n = 0, writes = 0;
  return {
    localPath: "/l.json", files, get writes() { return writes; },
    readFile: p => files.get(p) ?? null,
    writeFile: (p, s) => { writes++; files.set(p, s); },
    newId: () => `id${++n}`,
    now: () => Date.UTC(2026, 10, 10, 1, 2, 3),
  };
}
const kind = k => e => e?.kind === k;
const titles = async (env, list) => (await LO.tasks(env, list)).map(t => t.title);

test("first use creates 내 할 일 and saves it", async () => {
  const env = memEnv();
  assert.deepEqual(await LO.lists(env), [{ id: "id1", title: "내 할 일" }]);
  assert.deepEqual(JSON.parse(env.files.get("/l.json")), { lists: [{ id: "id1", title: "내 할 일" }], tasks: { id1: [] } });
  assert.deepEqual(await LO.lists(env), [{ id: "id1", title: "내 할 일" }]);
  assert.deepEqual(await LO.status(env), { loggedIn: true });
});

test("a broken file is refused and left alone", async () => {
  for (const raw of ["{nope", "[]", JSON.stringify({ lists: {}, tasks: {} }), JSON.stringify({ lists: [], tasks: [] }), JSON.stringify({ lists: [{ id: "a" }], tasks: { a: {} } })]) {
    const env = memEnv(raw);
    await assert.rejects(LO.lists(env), e => e?.kind === "local" && e.message === "로컬 저장 파일을 읽지 못했어요: /l.json");
    await assert.rejects(LO.add(env, "a", "t"), kind("local"));
    assert.equal(env.files.get("/l.json"), raw);
    assert.equal(env.writes, 0);
  }
});

test("lists: add, rename, delete with their tasks", async () => {
  const env = memEnv();
  await LO.lists(env);
  assert.deepEqual(await LO.listAdd(env, "업무"), { id: "id2", title: "업무" });
  await LO.add(env, "id2", "보고서");
  assert.deepEqual(await LO.listRename(env, "id2", "회사"), { id: "id2", title: "회사" });
  assert.equal(await LO.listDelete(env, "id2"), null);
  assert.deepEqual(await LO.lists(env), [{ id: "id1", title: "내 할 일" }]);
  assert.equal(JSON.parse(env.files.get("/l.json")).tasks.id2, undefined);
  await assert.rejects(LO.listRename(env, "nope", "x"), e => e?.kind === "api" && e.message === "목록을 찾을 수 없어요");
  await assert.rejects(LO.listDelete(env, "nope"), kind("api"));
  await assert.rejects(LO.tasks(env, "nope"), kind("api"));
});

test("add puts new tasks first, subtasks right after their parent", async () => {
  const env = memEnv();
  const [{ id: L }] = await LO.lists(env);
  const a = await LO.add(env, L, "A");
  await LO.add(env, L, "B");
  const a1 = await LO.add(env, L, "A1", a.id);
  await LO.add(env, L, "A0", a.id);
  assert.deepEqual(await titles(env, L), ["B", "A", "A0", "A1"]);
  assert.deepEqual(a, { id: "id2", title: "A", notes: null, due: null, status: "needsAction", completed: null, parent: null, position: "00000000" });
  assert.equal(a1.parent, a.id);
  assert.deepEqual((await LO.tasks(env, L)).map(t => t.position), ["00000000", "00000001", "00000002", "00000003"]);
  await assert.rejects(LO.add(env, L, "x", "nope"), e => e?.kind === "api" && e.message === "할 일을 찾을 수 없어요");
});

test("move: after previous, first under a parent, out to the top level, first", async () => {
  const env = memEnv();
  const [{ id: L }] = await LO.lists(env);
  const c = await LO.add(env, L, "C"), b = await LO.add(env, L, "B"), a = await LO.add(env, L, "A"); // [A, B, C]
  await LO.move(env, L, a.id, { previous: c.id });
  assert.deepEqual(await titles(env, L), ["B", "C", "A"]);
  await LO.move(env, L, a.id, { parent: b.id });
  let all = await LO.tasks(env, L);
  assert.deepEqual(all.map(t => t.title), ["B", "A", "C"]);
  assert.equal(all[1].parent, b.id);
  await LO.move(env, L, a.id, { parent: null, previous: b.id });
  all = await LO.tasks(env, L);
  assert.deepEqual(all.map(t => t.title), ["B", "A", "C"]);
  assert.equal(all[1].parent, null);
  await LO.move(env, L, c.id, {});
  assert.deepEqual(await titles(env, L), ["C", "B", "A"]);
  await assert.rejects(LO.move(env, L, c.id, { previous: "nope" }), kind("api"));
  await assert.rejects(LO.move(env, L, "nope", {}), kind("api"));
  assert.deepEqual(await titles(env, L), ["C", "B", "A"]); // a failed move changes nothing
});

test("update, done, undone", async () => {
  const env = memEnv();
  const [{ id: L }] = await LO.lists(env);
  const t = await LO.add(env, L, "T");
  assert.deepEqual(await LO.update(env, L, t.id, { title: "새", notes: "메모", due: "2026-11-12" }),
    { ...t, title: "새", notes: "메모", due: "2026-11-12T00:00:00.000Z" });
  assert.equal((await LO.update(env, L, t.id, { due: null })).due, null);
  assert.equal((await LO.update(env, L, t.id, { title: "only" })).notes, "메모");
  const d = await LO.done(env, L, t.id);
  assert.equal(d.status, "completed");
  assert.equal(d.completed, "2026-11-10T01:02:03.000Z");
  const u = await LO.undone(env, L, t.id);
  assert.equal(u.status, "needsAction");
  assert.equal(u.completed, null);
  await assert.rejects(LO.done(env, L, "nope"), kind("api"));
});

test("remove takes the task's subtasks with it", async () => {
  const env = memEnv();
  const [{ id: L }] = await LO.lists(env);
  const p = await LO.add(env, L, "P");
  await LO.add(env, L, "P1", p.id);
  await LO.add(env, L, "Q");
  assert.equal(await LO.remove(env, L, p.id), null);
  assert.deepEqual(await titles(env, L), ["Q"]);
  await assert.rejects(LO.remove(env, L, p.id), kind("api"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/my-tasks-local.test.mjs`
Expected: FAIL (cannot find module `mods/my-tasks/local.mjs`).

- [ ] **Step 3: Write the implementation**

Create `mods/my-tasks/local.mjs`:

```js
// Local task storage for my-tasks: the same functions and result shapes as google.mjs, kept in one JSON
// file (env.localPath) on this PC. A file that can't be read is never overwritten.
import { TasksError } from "./google.mjs";

const DEFAULT_LIST = "내 할 일";
const FIELDS = ["id", "title", "notes", "due", "status", "completed", "parent"];

function valid(data) {
  return Boolean(data) && typeof data === "object" && Array.isArray(data.lists)
    && data.lists.every(l => l && typeof l.id === "string")
    && Boolean(data.tasks) && typeof data.tasks === "object" && !Array.isArray(data.tasks)
    && Object.values(data.tasks).every(Array.isArray);
}

const save = (env, data) => env.writeFile(env.localPath, JSON.stringify(data));

function load(env) {
  const raw = env.readFile(env.localPath);
  if (raw == null) {
    const id = env.newId();
    const data = { lists: [{ id, title: DEFAULT_LIST }], tasks: { [id]: [] } };
    save(env, data);
    return data;
  }
  let data = null;
  try { data = JSON.parse(raw); } catch {}
  if (!valid(data)) throw new TasksError("local", `로컬 저장 파일을 읽지 못했어요: ${env.localPath}`);
  return data;
}

// Loads, lets `fn` change the data, then saves. If `fn` throws, nothing is saved.
function change(env, fn) {
  const data = load(env);
  const result = fn(data);
  save(env, data);
  return result;
}

function listTasks(data, list) {
  if (!data.lists.some(l => l.id === list)) throw new TasksError("api", "목록을 찾을 수 없어요");
  return (data.tasks[list] ??= []);
}

function indexOf(arr, id) {
  const i = arr.findIndex(t => t.id === id);
  if (i < 0) throw new TasksError("api", "할 일을 찾을 수 없어요");
  return i;
}

const out = (task, index) => ({ ...Object.fromEntries(FIELDS.map(k => [k, task[k] ?? null])), position: String(index).padStart(8, "0") });
const outList = l => ({ id: l.id, title: l.title });

export async function status(env) {
  load(env);
  return { loggedIn: true };
}

export async function lists(env) {
  return load(env).lists.map(outList);
}

export async function listAdd(env, title) {
  return change(env, data => {
    const l = { id: env.newId(), title };
    data.lists.push(l);
    data.tasks[l.id] = [];
    return outList(l);
  });
}

export async function listRename(env, id, title) {
  return change(env, data => {
    const l = data.lists.find(x => x.id === id);
    if (!l) throw new TasksError("api", "목록을 찾을 수 없어요");
    l.title = title;
    return outList(l);
  });
}

export async function listDelete(env, id) {
  return change(env, data => {
    if (!data.lists.some(x => x.id === id)) throw new TasksError("api", "목록을 찾을 수 없어요");
    data.lists = data.lists.filter(x => x.id !== id);
    delete data.tasks[id];
    return null;
  });
}

export async function tasks(env, list) {
  return listTasks(load(env), list).map(out);
}

// Like Google: a new task goes first; a new subtask goes first under its parent.
export async function add(env, list, title, parent) {
  return change(env, data => {
    const arr = listTasks(data, list);
    const at = parent ? indexOf(arr, parent) + 1 : 0;
    const task = { id: env.newId(), title, notes: null, due: null, status: "needsAction", completed: null, parent: parent ?? null };
    arr.splice(at, 0, task);
    return out(task, at);
  });
}

export async function update(env, list, id, fields) {
  return change(env, data => {
    const arr = listTasks(data, list), i = indexOf(arr, id), task = arr[i];
    if ("title" in fields) task.title = fields.title;
    if ("notes" in fields) task.notes = fields.notes;
    if ("due" in fields) task.due = fields.due == null ? null : `${fields.due}T00:00:00.000Z`;
    return out(task, i);
  });
}

function setStatus(env, list, id, values) {
  return change(env, data => {
    const arr = listTasks(data, list), i = indexOf(arr, id);
    Object.assign(arr[i], values);
    return out(arr[i], i);
  });
}
export const done = async (env, list, id) => setStatus(env, list, id, { status: "completed", completed: new Date(env.now()).toISOString() });
export const undone = async (env, list, id) => setStatus(env, list, id, { status: "needsAction", completed: null });

export async function remove(env, list, id) {
  return change(env, data => {
    const arr = listTasks(data, list);
    indexOf(arr, id);
    data.tasks[list] = arr.filter(t => t.id !== id && t.parent !== id);
    return null;
  });
}

// Like Google's tasks.move: right after `previous`; else first under `parent`; else first in the list.
export async function move(env, list, id, { parent, previous } = {}) {
  return change(env, data => {
    const arr = listTasks(data, list);
    if (parent) indexOf(arr, parent);
    if (previous) indexOf(arr, previous);
    const [task] = arr.splice(indexOf(arr, id), 1);
    task.parent = parent || null;
    const at = previous ? indexOf(arr, previous) + 1 : parent ? indexOf(arr, parent) + 1 : 0;
    arr.splice(at, 0, task);
    return out(task, at);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/my-tasks-local.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mods/my-tasks/local.mjs tests/my-tasks-local.test.mjs
git commit -m "my-tasks: local storage backend with Google's shapes and ordering"
```

---

### Task 2: `--backend` in the helper, `local` error text

**Files:**
- Modify: `mods/my-tasks/tasks.mjs` (`parseCommand`, `makeEnv`, `run`, imports)
- Modify: `mods/my-tasks/logic.js` (`errorText`)
- Modify: `package.json` (`scripts.test`)
- Test: `tests/my-tasks-cli.test.mjs`, `tests/my-tasks-logic.test.mjs`

**Interfaces:**
- Consumes: `./local.mjs` (Task 1), same function names as `./google.mjs`.
- Produces: helper command line `node tasks.mjs <name> [--backend local|google] [other flags] -- [args]`; `parseCommand` puts `backend` in `args` only when given; `makeEnv(dir).localPath` = `<dir>/local.json`, `makeEnv(dir).newId()` = 16 hex chars; `errorText({kind:"local", message})` → `{screen:"bar", kind:"local", text: message || "로컬 저장 파일 오류", detail:null}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/my-tasks-cli.test.mjs`:

```js
test("parseCommand: --backend", () => {
  assert.deepEqual(C.parseCommand(["lists", "--backend", "local", "--"]), { name: "lists", args: { backend: "local" } });
  assert.deepEqual(C.parseCommand(["add", "--backend", "google", "--parent", "p", "--", "L", "x"]).args, { backend: "google", parent: "p", list: "L", title: "x" });
  assert.throws(() => C.parseCommand(["lists", "--backend", "cloud", "--"]), usage);
  assert.throws(() => C.parseCommand(["login", "--backend", "local", "--"]), e => e?.kind === "usage" && e.message === "로컬 모드에는 로그인이 없어요");
  assert.throws(() => C.parseCommand(["logout", "--backend", "local", "--"]), usage);
});

test("main with the local backend", async () => {
  let n = 0;
  const env = { ...memEnv(), localPath: "/l.json", newId: () => `id${++n}` };
  const a = capture();
  await C.main(["lists", "--backend", "local", "--"], env, a.out);
  assert.deepEqual(JSON.parse(a.lines[0]), { ok: true, data: [{ id: "id1", title: "내 할 일" }] });
  const b = capture();
  await C.main(["add", "--backend", "local", "--", "id1", "우유 사기"], env, b.out);
  assert.equal(JSON.parse(b.lines[0]).data.title, "우유 사기");
});

test("makeEnv has the local file and an id maker", () => {
  const env = C.makeEnv("/app/my-tasks");
  assert.equal(env.localPath.replaceAll("\\", "/"), "/app/my-tasks/local.json");
  assert.match(env.newId(), /^[0-9a-f]{16}$/);
  assert.notEqual(env.newId(), env.newId());
});
```

Append to `tests/my-tasks-logic.test.mjs`:

```js
test("errorText: a broken local file shows its message in the error bar", () => {
  assert.deepEqual(L.errorText({ kind: "local", message: "로컬 저장 파일을 읽지 못했어요: C:/a/local.json" }),
    { screen: "bar", kind: "local", text: "로컬 저장 파일을 읽지 못했어요: C:/a/local.json", detail: null });
  assert.equal(L.errorText({ kind: "local" }).text, "로컬 저장 파일 오류");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/my-tasks-cli.test.mjs tests/my-tasks-logic.test.mjs`
Expected: the new tests FAIL (`--backend` rejected as an unknown flag; `localPath` undefined; `local` text is `내부 오류: …`).

- [ ] **Step 3: Implement**

In `mods/my-tasks/tasks.mjs`:

1. After `import * as G from "./google.mjs";` add `import * as L from "./local.mjs";`
2. In `parseCommand`, change `const allowed = FLAGS[name] ?? [], args = {}, positional = [];` to `const allowed = [...(FLAGS[name] ?? []), "backend"], args = {}, positional = [];` and, right before `if (name === "update") {`, add:

```js
  if ("backend" in args && args.backend !== "local" && args.backend !== "google") throw usage("--backend는 local 또는 google이에요");
  if (args.backend === "local" && (name === "login" || name === "logout")) throw usage("로컬 모드에는 로그인이 없어요");
```

3. In `makeEnv`'s returned object, after `tokenPath: join(dir, "token.json"),` add:

```js
    localPath: join(dir, "local.json"),
    newId: () => randomBytes(8).toString("hex"),
```

4. Replace the whole `run` function with:

```js
async function run(env, { name, args: a }) {
  const B = a.backend === "local" ? L : G; // no flag: Google, as before modes existed
  switch (name) {
    case "status": return B.status(env);
    case "login": return login(env);
    case "logout": return G.logout(env);
    case "lists": return B.lists(env);
    case "list-add": return B.listAdd(env, a.title);
    case "list-rename": return B.listRename(env, a.id, a.title);
    case "list-delete": return B.listDelete(env, a.id);
    case "tasks": return B.tasks(env, a.list);
    case "add": return B.add(env, a.list, a.title, a.parent);
    case "update": return B.update(env, a.list, a.id, a.fields);
    case "done": return B.done(env, a.list, a.id);
    case "undone": return B.undone(env, a.list, a.id);
    case "delete": return B.remove(env, a.list, a.id);
    case "move": return B.move(env, a.list, a.id, { parent: a.parent, previous: a.previous });
  }
  throw usage(`알 수 없는 명령: ${name}`);
}
```

5. Update the file's first comment line to: `// Task helper for the my-tasks mod (local file or Google Tasks): \`node tasks.mjs <command> [--backend local|google] [--flag value]... -- [args]...\``

In `mods/my-tasks/logic.js` `errorText`, right before the `if (kind === "api")` line add:

```js
  if (kind === "local") return { screen: "bar", kind, text: message || "로컬 저장 파일 오류", detail: null };
```

In `package.json`, append ` tests/my-tasks-local.test.mjs` to the end of the `scripts.test` string.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/*.test.mjs`
Expected: PASS (all).
Smoke (Git Bash): `node mods/my-tasks/tasks.mjs lists --backend cloud --` prints `"kind":"usage"`. Do NOT run with `--backend local` from the repo (it would create `<repo>/my-tasks/local.json`; that folder is gitignored, but don't).

- [ ] **Step 5: Commit**

```bash
git add mods/my-tasks/tasks.mjs mods/my-tasks/logic.js package.json tests/my-tasks-cli.test.mjs tests/my-tasks-logic.test.mjs
git commit -m "my-tasks: --backend local|google in the helper; local errors in the error bar"
```

---

### Task 3: Modes in the panel (`main.js`)

**Files:**
- Modify: `mods/my-tasks/main.js`

**Interfaces:**
- Consumes: helper `--backend` flag (Task 2); `errorText` `local` kind.
- No unit test (Herdr runtime). Verify with `herdr-app check` and the full suite.

- [ ] **Step 1: Header comment**

Replace the first two lines of `mods/my-tasks/main.js` with:

```js
// Tasks in a side panel, kept in a local file or in Google Tasks: lists, tasks with one level of subtasks,
// add / complete / edit / delete / reorder. Every call goes through tasks.mjs (node) with --backend local|google,
// which prints one JSON line. Jobs run one at a time, in order.
```

- [ ] **Step 2: Mode state in `init`**

Replace:

```js
    this.lists = []; this.listId = localStorage.getItem("my-tasks.list");
```

with:

```js
    this.mode = localStorage.getItem("my-tasks.mode"); // "local" | "google"; null until the first read decides
    this.lists = []; this.listId = this.mode ? this.savedList(this.mode) : null;
```

and in the `cx.timer.every(REFRESH_MS, …)` callback replace

```js
      if (this.visible() && (this.screen === "list" || retryLoad) && this.idle()) { this.requestRefresh(cx); cx.notify(); }
```

with (only Google changes behind the panel's back):

```js
      if (this.mode === "google" && this.visible() && (this.screen === "list" || retryLoad) && this.idle()) { this.requestRefresh(cx); cx.notify(); }
```

- [ ] **Step 3: Mode methods**

Right after the `idle()` method, add:

```js
  // The list last chosen in that mode; Google inherits the key used before modes existed.
  savedList(mode) {
    return localStorage.getItem(`my-tasks.list.${mode}`) ?? (mode === "google" ? localStorage.getItem("my-tasks.list") : null);
  }

  // Switches the backend and starts over on its lists. Called only from inside a running job.
  setMode(mode) {
    this.mode = mode;
    localStorage.setItem("my-tasks.mode", mode);
    this.lists = []; this.listId = this.savedList(mode); this.loadedList = null; this.setTasks([]);
    this.edit = null; this.confirm = null; this.naming = null; this.pickOpen = false; this.menuOpen = false; this.showDone = false; this.error = null;
    this.screen = "loading";
  }

  // Queued, so jobs already waiting finish against the backend they were made for.
  switchMode(mode, cx) {
    this.menuOpen = false;
    this.waiting = null;
    this.enqueue({ refresh: "all", run: async () => { this.setMode(mode); return { ok: true }; } }, cx);
  }
```

- [ ] **Step 4: Pass the backend on every call**

Replace the whole `call` method with:

```js
  // Runs the helper with this mode's backend (or the one given). Never throws: { ok: true, data } or { ok: false, error }.
  async call(args, timeout, mode = this.mode) {
    if (!this.script) this.script = helperPath(appHome());
    const [name, ...rest] = args;
    try {
      const r = await exec("node", [this.script, name, "--backend", mode ?? "local", ...rest], timeout ? { timeout } : {});
      return parseOutput(r.stdout, r.stderr);
    } catch (e) { return { ok: false, error: execError(e) }; }
  }
```

- [ ] **Step 5: Decide the mode on the first read; remember lists per mode**

In `fetchAll`, insert at the very start of the method body (before `const l = await this.call(command("lists"));`):

```js
    if (!this.mode) {
      // First run: Google if this PC is already signed in, otherwise local.
      const s = await this.call(command("status"), undefined, "google");
      this.setMode(s.ok ? "google" : "local");
    }
```

In `choose`, replace

```js
    if (id) localStorage.setItem("my-tasks.list", id); else localStorage.removeItem("my-tasks.list");
```

with

```js
    const key = `my-tasks.list.${this.mode}`;
    if (id) localStorage.setItem(key, id); else localStorage.removeItem(key);
```

- [ ] **Step 6: Header badge**

In `header(t)`, replace

```js
      .child(div().font_semibold().child("Task"))
```

with

```js
      .child(div().font_semibold().child("Task"))
      .when(Boolean(this.mode), el => el.child(div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.dim)
        .child(this.mode === "google" ? "Google" : "로컬")))
```

- [ ] **Step 7: Menu items per mode**

In `listView`, replace

```js
      .child(button("tasks-logout", "로그아웃", cx => this.logout(cx))));
```

with

```js
      .when(this.mode === "local", el => el.child(button("tasks-to-google", "Google Tasks 연동", cx => this.switchMode("google", cx))))
      .when(this.mode === "google", el => el
        .child(button("tasks-to-local-menu", "로컬로 전환", cx => this.switchMode("local", cx)))
        .child(button("tasks-logout", "로그아웃", cx => this.logout(cx)))));
```

- [ ] **Step 8: "Back to local" on the login screen**

In `loginView`, replace the final `.child(this.waiting ? … : …);` expression (from `.child(this.waiting` to the end of the method's return statement) with:

```js
      .child(h_flex().gap(8).items_center()
        .children(this.waiting
          ? [div().text_size(12).child("브라우저에서 허용해 주세요…"), button("tasks-login-cancel", "취소", () => { this.waiting = null; })]
          : [noClient ? button("tasks-recheck", "다시 확인", cx => this.requestRefresh(cx)) : button("tasks-login", "로그인", cx => this.login(cx))])
        .child(button("tasks-to-local", "로컬로 돌아가기", cx => this.switchMode("local", cx))));
```

- [ ] **Step 9: Check and test**

PowerShell (mod.json first):

```powershell
$to = "$env:USERPROFILE\.config\herdr-app\mods\my-tasks"
Copy-Item mods\my-tasks\mod.json $to -Force
Copy-Item mods\my-tasks\* $to -Recurse -Force
herdr-app check "$env:USERPROFILE\.config\herdr-app\mods\my-tasks"
```

Expected: exit 0. Git Bash: `node --test tests/*.test.mjs` → PASS.

- [ ] **Step 10: Commit**

```bash
git add mods/my-tasks/main.js
git commit -m "my-tasks: local mode by default, Google Tasks as an opt-in mode"
```

---

### Task 4: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Edits**

1. "## 기능 한눈에" Task bullet → `- **Task 패널**: 할 일 목록(이 PC에 저장, 원하면 Google Tasks 연동) 보기·추가·완료·편집·삭제, 하위 할 일과 순서 바꾸기`
2. mod table `my-tasks` row → `| \`my-tasks\` | 할 일 패널. 기본은 이 PC에 저장, 원하면 Google Tasks 연동 (Node.js 사용) |`
3. In "### Task 패널 (`my-tasks`)", replace the first bullet (`- 탭 바의 **Task** 버튼으로 엽니다. Google Tasks의 목록과 할 일을 보여 주고, 패널에서 바로 고칩니다.`) with:

```markdown
- 탭 바의 **Task** 버튼으로 엽니다. 할 일 목록을 보여 주고, 패널에서 바로 고칩니다.
- **모드가 두 가지**이고, 헤더의 `Task` 옆에 지금 모드가 보입니다.
  - **로컬**(기본): 설정 없이 바로 씁니다. 할 일은 이 PC의 `~\.config\herdr-app\my-tasks\local.json` 에 저장됩니다.
  - **Google**: `[⋯]` → **Google Tasks 연동**. 휴대폰 등에서 쓰는 Google Tasks와 같은 목록을 봅니다. 아래 "Google 모드 준비"가 한 번 필요합니다. `[⋯]` → **로컬로 전환**으로 돌아옵니다(로그인은 남습니다).
  - 두 모드의 할 일은 따로 보관되고 서로 옮겨지지 않습니다. 이미 Google에 로그인한 PC는 처음부터 Google 모드로 열립니다.
```

4. Same section, second bullet: `` `[⋯]` 에서 목록 이름 바꾸기·삭제와 로그아웃을 합니다`` → `` `[⋯]` 에서 목록 이름 바꾸기·삭제, 모드 바꾸기, (Google 모드) 로그아웃을 합니다``. And `마지막으로 고른 목록을 기억합니다.` → `마지막으로 고른 목록을 모드별로 기억합니다.`
5. Same section: `- 패널이 보이는 동안 2분마다 다시 읽고, ⟳ 로 바로 새로고침합니다.` → `- Google 모드에서는 패널이 보이는 동안 2분마다 다시 읽고, ⟳ 로 바로 새로고침합니다.`
6. `**처음 한 번: Google 계정 연결**` → `**Google 모드 준비 (처음 한 번)**`
7. Step 4 of that list: `4. 패널의 **[로그인]** 을 누르면` → `4. 패널의 \`[⋯]\` → **Google Tasks 연동** 후 **[로그인]** 을 누르면`
8. "## 요구 사항" Task bullet → `- Task 패널: Node.js 18 이상(\`node\` 명령). Google 모드에는 직접 만든 Google Cloud OAuth 클라이언트도 필요합니다([Task 패널](#task-패널-my-tasks) 참고).`
9. "## 제거": step 1 `Task 패널을 썼다면 먼저` → `Task 패널을 Google 모드로 썼다면 먼저`; step 5 → `5. Task 패널의 로컬 할 일·설정·토큰 폴더 \`~\.config\herdr-app\my-tasks\\\` 를 지웁니다(로컬 할 일을 남기려면 \`local.json\` 을 먼저 복사해 두세요).` (the path ends with a single backslash inside backticks: `` `~\.config\herdr-app\my-tasks\` ``)
10. "## 알려진 한계" Task bullet → `- Task 패널은 Google Keep을 다루지 않습니다. 마감 시각, 반복, 하위의 하위는 없습니다(Google Tasks와 맞춤). 할 일을 완료해도 그 하위 할 일은 완료되지 않습니다. 남은 하위는 맨 위 단계로 보이고 ⇤ 로 정리할 수 있습니다. 순서는 끌기 대신 버튼으로 바꿉니다. 로컬 할 일은 이 PC에만 있고(\`local.json\` 을 복사하면 백업), 두 모드의 할 일은 서로 옮겨지지 않습니다. Google 모드에서 할 일이 많은 목록은 읽을 때 100개마다 요청이 하나씩 늘어납니다.`

- [ ] **Step 2: Verify**

`grep -n "Google Tasks의 목록과 할 일을 보여" README.md` prints nothing; `grep -n "local.json" README.md` shows the new lines.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: Task panel local mode and Google mode"
```
