// Tasks in a side panel, kept in a local file or in Google Tasks: lists, tasks with one level of subtasks,
// add / complete / edit / delete / reorder. Every call goes through tasks.mjs (node) with --backend local|google,
// which prints one JSON line. Jobs run one at a time, in order.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, theme, layout, appHome } from "herdr";
import {
  REFRESH_MS, LOGIN_TIMEOUT_MS, helperPath, command, parseOutput, execError, buildTree, moveArgs, canMove,
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
    this.mode = localStorage.getItem("my-tasks.mode"); // "local" | "google"; null until the first read decides
    this.lists = []; this.listId = this.mode ? this.savedList(this.mode) : null;
    this.tasks = []; this.tree = buildTree([]); this.loadedList = null; // the list this.tasks belongs to
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
      const retryLoad = this.screen === "loading" && this.error;
      if (this.mode === "google" && this.visible() && (this.screen === "list" || retryLoad) && this.idle()) { this.requestRefresh(cx); cx.notify(); }
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

  // Runs the helper with this mode's backend (or the one given). Never throws: { ok: true, data } or { ok: false, error }.
  async call(args, timeout, mode = this.mode) {
    if (!this.script) this.script = helperPath(appHome());
    const [name, ...rest] = args;
    try {
      const r = await exec("node", [this.script, name, "--backend", mode ?? "local", ...rest], timeout ? { timeout } : {});
      return parseOutput(r.stdout, r.stderr);
    } catch (e) { return { ok: false, error: execError(e) }; }
  }

  refreshJob() {
    return { refresh: "all" };
  }

  // A refresh unless one is already running or waiting.
  requestRefresh(cx) {
    const only = j => j && !j.run && j.refresh === "all";
    if (only(this.running) || this.queue.some(only)) return;
    this.enqueue(this.refreshJob(), cx);
  }

  // A job: { run?() → result, before?(), reapply?(), list?, undo?(), done?(data), mark?: task id, refresh?: "all" | "tasks" }.
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
      if (error) this.fail(error, retry);
      else if (this.error && this.error.job === job) this.error = null; // a retry that worked
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
    if (!this.mode) {
      // First run: Google if this PC is already signed in, otherwise local.
      const s = await this.call(command("status"), undefined, "google");
      this.setMode(s.ok ? "google" : "local");
    }
    const l = await this.call(command("lists"));
    if (!l.ok) return l.error;
    this.lists = l.data;
    if (!this.lists.some(x => x.id === this.listId)) this.choose(this.lists[0]?.id ?? null);
    return this.fetchTasks();
  }

  async fetchTasks() {
    const listId = this.listId;
    if (!listId) { this.setTasks([]); this.loadedList = null; this.screen = "list"; return null; }
    const t = await this.call(command("tasks", [listId]));
    if (listId !== this.listId) return null;
    if (!t.ok) return t.error;
    this.setTasks(t.data);
    this.loadedList = listId;
    // Ticks still waiting or in flight were not in what Google just sent: put them back.
    for (const j of [this.running, ...this.queue]) if (j?.reapply && j.list === listId) j.reapply();
    this.screen = "list";
    return null;
  }

  choose(id) {
    this.listId = id;
    const key = `my-tasks.list.${this.mode}`;
    if (id) localStorage.setItem(key, id); else localStorage.removeItem(key);
    this.edit = null; this.confirm = null; this.showDone = false;
    this.loadedList = null;
    this.setTasks([]);
  }

  setTasks(list) {
    this.tasks = list;
    this.tree = buildTree(list);
    const has = id => list.some(t => t.id === id);
    const finished = id => list.some(t => t.id === id && t.status === "completed");
    if (this.edit && (!has(this.edit.id) || finished(this.edit.id))) this.edit = null;
    if (this.confirm?.kind === "task" && !has(this.confirm.id)) this.confirm = null;
  }

  // A delete question about a task that is no longer on screen would block refreshes unseen.
  dropDoneConfirm() {
    const c = this.confirm;
    if (c?.kind === "task" && this.tasks.some(t => t.id === c.id && t.status === "completed")) this.confirm = null;
  }

  login(cx) {
    if (this.waiting) return;
    const attempt = {};
    this.waiting = attempt;
    cx.spawn(async cx => {
      const r = await this.call(command("login"), LOGIN_TIMEOUT_MS);
      if (this.waiting !== attempt) return; // cancelled
      this.waiting = null;
      if (r.ok) { this.screen = "loading"; this.requestRefresh(cx); }
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
      done: () => {
        this.screen = "login"; this.loginInfo = errorText({ kind: "no-login" }); this.lists = []; this.setTasks([]);
        this.naming = null; this.confirm = null; this.edit = null; this.pickOpen = false; this.menuOpen = false; this.showDone = false; this.error = null;
      },
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
    const apply = () => set(finish ? { status: "completed", completed: new Date().toISOString() } : { status: "needsAction", completed: null });
    this.enqueue({
      mark: task.id, list,
      before: apply, reapply: apply,
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
        // After a list switch this.tasks is another list's: delete them all rather than filter.
        const ids = this.listId !== list ? c.ids : c.ids.filter(id => this.tasks.some(t => t.id === id));
        for (const id of ids) {
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
        if (this.listId !== list) return { ok: false, error: { kind: "api", message: "목록이 바뀌어서 옮기지 않았어요" } };
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
      .when(Boolean(this.mode), el => el.child(div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.dim)
        .child(this.mode === "google" ? "Google" : "로컬")))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
        .child(this.running || this.queue.length ? "동기화 중…" : ""))
      .child(div().id("tasks-refresh").w(20).cursor_pointer().text_color(t.muted)
        .on_click((_e, cx) => { this.error = null; if (!this.waiting) this.requestRefresh(cx); cx.notify(); }).child("⟳"));
  }

  loginView(t, button) {
    const info = this.loginInfo, noClient = info.kind === "no-client";
    return v_flex().flex_1().min_h(0).p(16).gap(10)
      .child(div().font_semibold().child(info.text))
      .when(Boolean(info.detail), el => el.child(div().text_size(12).text_color(t.dim).child(info.detail)))
      .children(SETUP.map(line => div().text_size(12).text_color(t.muted).child(line)))
      .child(div().text_size(12).text_color(t.dim).child("자세한 방법은 README의 Task 패널 절을 보세요."))
      .child(h_flex().gap(8).items_center()
        .children(this.waiting
          ? [div().text_size(12).child("브라우저에서 허용해 주세요…"), button("tasks-login-cancel", "취소", () => { this.waiting = null; })]
          : [noClient ? button("tasks-recheck", "다시 확인", cx => this.requestRefresh(cx)) : button("tasks-login", "로그인", cx => this.login(cx))])
        .child(button("tasks-to-local", "로컬로 돌아가기", cx => this.switchMode("local", cx))));
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
        .when(this.loadedList === this.listId, el => el.child(button("tasks-list-delete", "목록 삭제", () => this.askDeleteList()))))
      .when(this.mode === "local", el => el.child(button("tasks-to-google", "Google Tasks 연동", cx => this.switchMode("google", cx))))
      .when(this.mode === "google", el => el
        .child(button("tasks-to-local-menu", "로컬로 전환", cx => this.switchMode("local", cx)))
        .child(button("tasks-logout", "로그아웃", cx => this.logout(cx)))));
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
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => { this.showDone = !this.showDone; if (!this.showDone) this.dropDoneConfirm(); cx.notify(); })
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
      .when(Boolean(preview), el => el.child(div().id(`task-notes-${id}`).pl(24).text_size(11).text_color(t.dim).truncate().cursor_pointer()
        .on_click((_e, cx) => { this.openEdit(task); cx.notify(); }).child(preview)));
  }

  render(cx) {
    const shown = this.visible();
    if (shown && !this.wasShown && !this.waiting) this.requestRefresh(cx);
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
