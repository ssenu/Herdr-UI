// Sessions panel: Claude Code sessions started in the focused pane's repository (or just its folder),
// newest first. A row reopens the session in a new tab with `claude -r <id>`. Local or remote.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, run, notify, theme, layout, window } from "herdr";
import { encodeProject, worktreePaths, sessionLines, liveIds, toSessions, pickSessions, isUnder, sessionMeta, tabTitle, emptyText, sessionsCommand } from "./logic.js";

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
  return { root, worktrees, sessions: toSessions(sessionLines(r.stdout)), live: liveIds(r.stdout) };
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
          .on_click(e => { if (e.click_count === 1) this.open(s); })
          .child(h_flex().min_w(0).gap(6).items_center()
            .when(d.live.has(s.id.toLowerCase()), el => el.child(div().flex_none().w(8).h(8).rounded(4).bg(t.ansi2)))
            .child(div().flex_1().min_w(0).truncate().child(s.title)))
          .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(sessionMeta(s, d.root, now)))))
        .when(picked.more, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("최근 100개만 보여 줘요")))
        .when(picked.items.length === 0, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(message))));
  }
}
