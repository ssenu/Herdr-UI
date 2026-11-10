// Sessions panel: Claude Code sessions started in the focused pane's repository (or just its folder),
// newest first. A row reopens the session in a new tab with `claude -r <id>`. Local or remote.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, run, notify, theme, layout, window } from "herdr";
import { encodeProject, worktreePaths, sessionLines, liveIds, toSessions, pickSessions, isUnder, sessionMeta, tabTitle, emptyText, sessionsCommand, renameCommand, deleteCommand, actionError, deleteConfirmText } from "./logic.js";

const REFRESH_MS = 30000, SHOW_LIMIT = 100;

import { followedCwd } from "./where.js";

const lastCwd = new Map(); // space id → its last terminal folder
function location() {
  const space = spaces().find(s => s.active), f = focused();
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: followedCwd(lastCwd, space, f, panes()), on };
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
  return { root, worktrees, sessions: toSessions(sessionLines(r.stdout)), live: liveIds(r.stdout) };
}

export default class Sessions extends View {
  init(_props, cx) {
    this.scope = "all"; this.context = null; this.data = null; this.error = null;
    this.loading = false; this.again = false; this.wasShown = this.visible();
    this.act = null; // the ⋯ box: { id, dir, title, step: "menu" | "rename" | "confirm" | "running" | "failed", kind, error }
    this.nameInput = InputState.new({ placeholder: "세션 이름" });
    this.nameInput.on("submit", (_e, cx) => { this.runAct("rename", cx); cx.notify(); });
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
      if (this.act?.step !== "running") this.act = null;
      const loc = location();
      // Same machine and still inside a known worktree: keep the list instead of blanking it.
      const keep = Boolean(this.data && this.context && this.context.on === loc.on && loc.cwd
        && this.data.worktrees.some(w => isUnder(loc.cwd, w)));
      this.context = { key: next, cwd: loc.cwd, on: loc.on };
      if (!keep) this.data = null;
      this.error = null; this.loading = false; this.again = false;
    }
    if (!this.context.cwd) return;
    if (this.loading) { this.again = true; return; }
    const context = this.context;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const data = await collect(context);
        if (this.context === context) {
          this.data = data; this.error = null;
          if (this.act && this.act.step !== "running" && !data.sessions.some(x => x.id === this.act.id)) this.act = null;
        }
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

  toggleMenu(s) {
    if (this.act?.step === "running") return;
    this.act = this.act?.id === s.id ? null : { id: s.id, dir: s.dir, title: s.title, step: "menu", kind: null, error: null };
  }

  startRename() {
    const a = this.act;
    if (!a) return;
    a.step = "rename";
    this.nameInput.set_value(a.title === "(제목 없음)" ? "" : a.title);
    this.nameInput.focus();
  }

  // Runs the rename or delete where the list was read; then reads the list again either way.
  runAct(kind, cx) {
    const a = this.act, context = this.context;
    if (!a || !context || a.step === "running") return;
    if (kind === "rename" && (a.step !== "rename" || !this.nameInput.value().trim())) return;
    const windows = !context.on && window()?.platform === "windows";
    let c;
    try { c = kind === "rename" ? renameCommand(a.dir, a.id, this.nameInput.value(), windows) : deleteCommand(a.dir, a.id, windows); }
    catch (e) { a.step = "failed"; a.error = String(e?.message ?? e); return; }
    a.step = "running"; a.kind = kind;
    cx.spawn(async cx => {
      let r = null;
      try { r = await exec(c.command, c.args, { on: context.on }); } catch {}
      const error = !r ? "명령을 실행하지 못했어요" : r.code === 0 ? null : actionError(r.code, r.stderr);
      if (this.act === a) {
        if (error) { a.step = "failed"; a.error = error; } else this.act = null;
      } else if (error) {
        notify({ title: kind === "rename" ? "세션 이름을 바꾸지 못했어요" : "세션을 지우지 못했어요", body: error, level: "error", timeout: 5000 });
      }
      if (this.context === context) this.refresh(cx);
      cx.notify();
    });
  }

  // The box under a row: menu, rename field, delete question, progress or error.
  actBox(s, live, t, button) {
    const a = this.act;
    if (!a || a.id !== s.id) return [];
    const box = h_flex().id(`session-act-${s.id}`).flex_none().mx(8).mb(4).px(8).py(6).gap(6).items_center().flex_wrap()
      .rounded(7).bg(t.hover).text_size(12);
    const close = button("session-act-close", a.step === "menu" ? "닫기" : "취소", () => { this.act = null; });
    if (a.step === "menu") return [box
      .child(button("session-rename", "이름 수정", () => this.startRename()))
      .child(live ? div().text_color(t.dim).child("열려 있는 세션은 지울 수 없어요") : button("session-delete", "삭제", () => { a.step = "confirm"; }))
      .child(close)];
    if (a.step === "rename") return [box
      .child(Input.new(this.nameInput).flex_1().min_w(120).h(26).text_size(12.5))
      .child(button("session-rename-ok", "저장", cx => this.runAct("rename", cx)))
      .child(close)];
    if (a.step === "confirm") return [box
      .child(div().child(deleteConfirmText(a.title, Boolean(this.context?.on))))
      .child(button("session-delete-ok", "삭제", cx => this.runAct("delete", cx)))
      .child(close)];
    if (a.step === "running") return [box.child(div().text_color(t.dim).child(a.kind === "rename" ? "이름 바꾸는 중…" : "지우는 중…"))];
    return [box.child(div().flex_1().min_w(0).text_color(t.ansi1).child(`⚠ ${a.error}`)).child(button("session-act-close", "닫기", () => { this.act = null; }))];
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
    const button = (id, label, onClick) => h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).cursor_pointer()
      .text_size(12).text_color(t.foreground).border_1().border_color(t.border).bg(t.background).hover(s => s.bg(t.selected))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
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
        .children(picked.items.flatMap(s => {
          const live = d.live.has(s.id.toLowerCase());
          return [v_flex().id(`session-${s.id}`).flex_none().px(8).py(6).gap(3).rounded(7).cursor_pointer().hover(st => st.bg(t.hover))
            .on_click(e => { if (e.click_count === 1) this.open(s); })
            .child(h_flex().min_w(0).gap(6).items_center()
              .when(live, el => el.child(div().flex_none().w(8).h(8).rounded(4).bg(t.ansi2)))
              .child(div().flex_1().min_w(0).truncate().child(s.title))
              // ⋯: its press and click stop here, so the row doesn't open the session.
              .child(div().id(`session-more-${s.id}`).w(20).h(20).flex_none().flex().items_center().justify_center().rounded(5)
                .text_color(t.dim).hover(st => st.bg(t.selected).text_color(t.foreground))
                .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                .on_click((_e, cx) => { cx.stop_propagation(); this.toggleMenu(s); cx.notify(); })
                .child("⋯")))
            .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(sessionMeta(s, d.root, now))),
          ...this.actBox(s, live, t, button)];
        }))
        .when(picked.more, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("최근 100개만 보여 줘요")))
        .when(picked.items.length === 0, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(message))));
  }
}
