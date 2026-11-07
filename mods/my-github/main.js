// GitHub issues and pull requests for the focused pane's repository (gh CLI), with a detail view
// and a hand-off to an agent: into the focused agent's prompt (no Enter), or a new Claude tab.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { spaces, panes, focused, agents, exec, run, notify, theme, layout, openOverlay } from "herdr";
import { listArgs, viewArgs, sortByUpdated, ciSummary, reviewLabel, stateLabel, relativeTime, agentPrompt, tabName, ghError, emptyText, dragText } from "./logic.js";

import { followedCwd } from "./where.js";

const lastCwd = new Map(); // space id → its last terminal folder
function location() {
  const space = spaces().find(s => s.active), f = focused();
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: followedCwd(lastCwd, space, f, panes()), on, space: space?.id };
}
const key = () => JSON.stringify(location());
const REFRESH_MS = 120000;
const bare = a => (typeof a === "string" ? a.slice(a.lastIndexOf("/") + 1) : a);
const sameAddress = (a, b) => a === b || (!a?.includes("/") !== !b?.includes("/") && bare(a) === bare(b));
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Runs gh where the panel looks. Never throws: { ok: true, data } or { ok: false, error }.
async function gh(args, { cwd, on }) {
  let r;
  try { r = await exec("gh", args, { cwd, on }); }
  catch { return { ok: false, error: ghError("", true) }; }
  if (r.code !== 0) return { ok: false, error: ghError(r.stderr || r.stdout || "", false) };
  try { return { ok: true, data: JSON.parse(r.stdout) }; }
  catch { return { ok: false, error: ghError(r.stdout || "", false) }; }
}

export default class GitHub extends View {
  init(_props, cx) {
    this.saved = new Map(); // location key -> { kind, filter }
    this.kind = "issue"; this.filter = "open";
    this.items = []; this.repo = null; this.error = null; this.loading = false; this.again = false;
    this.detail = null; // { kind, item, data, error }
    this.carry = null; this.wasShown = false;
    if (this.visible()) this.refresh(cx);
    cx.timer.every(REFRESH_MS, cx => { if (this.visible()) this.refresh(cx); });
  }

  // Whether the panel is open on this tab; true when the layout has no such panel.
  visible() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !body) return true;
    return !panel.hidden && body.active === "github";
  }

  refresh(cx) {
    const loc = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { kind: this.kind, filter: this.filter });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd: loc.cwd, on: loc.on };
      this.kind = saved?.kind ?? "issue"; this.filter = saved?.filter ?? "open";
      this.carry = this.detail && this.repo ? { detail: this.detail, repo: this.repo.nameWithOwner } : null;
      this.items = []; this.repo = null; this.error = null; this.detail = null; this.loading = false; this.again = false;
    }
    if (!this.context.cwd) return;
    if (this.loading) { this.again = true; return; }
    const context = this.context, kind = this.kind, filter = this.filter;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        if (!this.repo) {
          const r = await gh(["repo", "view", "--json", "nameWithOwner,url"], context);
          if (this.context !== context) return;
          if (!r.ok) { this.error = r.error; this.items = []; this.carry = null; return; }
          this.repo = r.data;
          if (this.carry && this.carry.repo === this.repo.nameWithOwner && !this.detail) this.detail = this.carry.detail;
          this.carry = null;
        }
        const r = await gh(listArgs(kind, filter), context);
        if (this.context !== context || this.kind !== kind || this.filter !== filter) return;
        if (r.ok) { this.items = sortByUpdated(r.data); this.error = null; }
        else this.error = r.error;
      } finally {
        if (this.context === context) {
          this.loading = false;
          if (this.again) { this.again = false; this.refresh(cx); }
        }
        cx.notify();
      }
    });
  }

  setKind(kind, cx) {
    if (this.kind === kind) return;
    this.kind = kind; this.items = []; this.error = null; this.refresh(cx);
  }

  setFilter(filter, cx) {
    if (this.filter === filter) return;
    this.filter = filter; this.items = []; this.error = null; this.refresh(cx);
  }

  openDetail(item, cx) {
    const context = this.context, detail = { kind: this.kind, item, data: null, error: null };
    this.detail = detail;
    cx.spawn(async cx => {
      const r = await gh(viewArgs(detail.kind, item.number), context);
      if (this.detail !== detail) return;
      if (r.ok) detail.data = r.data; else detail.error = r.error;
      cx.notify();
    });
  }

  // The pointer left the panel with a row held: my-files-drag takes over and types the row on release.
  dropOut() {
    const drag = this.drag; this.drag = null;
    if (!drag) return;
    const panel = this.origin && this.size ? { ...this.origin, width: this.size.width, height: this.size.height } : null;
    openOverlay({ mod: "my-files-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { ...drag, panel } });
  }

  // The agent in the focused terminal (what terminal.paste targets), if it runs one.
  target() {
    const f = focused(), address = f?.shown ?? f?.terminal;
    if (!address) return null;
    const agent = agents().find(a => sameAddress(a.address, address));
    if (agent) return { name: agent.program?.name || "에이전트" };
    const pane = f.pane ? panes().find(p => p.pane === f.pane) : null;
    return pane?.program?.agent ? { name: pane.program.name || "에이전트" } : null;
  }

  handOff(cx) {
    const d = this.detail;
    if (!d) return;
    const item = d.data ?? d.item, text = agentPrompt(d.kind, item);
    try {
      if (this.target()) { cx.write_to_clipboard(text); run("terminal.paste", {}); }
      else run("tab.new", { name: tabName(item), folder: this.context.cwd, argv: ["claude"], task: text });
    } catch (e) {
      notify({ title: "에이전트에게 넘기지 못했어요", body: String(e), level: "error", timeout: 5000 });
    }
  }

  row(item, t) {
    const pr = this.kind === "pr";
    const ci = pr ? ciSummary(item.statusCheckRollup) : null, review = pr ? reviewLabel(item.reviewDecision) : null;
    const comments = Array.isArray(item.comments) ? item.comments.length : 0;
    const meta = [item.author?.login, relativeTime(item.updatedAt, Date.now()), comments ? `💬 ${comments}` : null,
      this.filter === "closed" ? stateLabel(item.state) : null].filter(Boolean).join(" · ");
    return v_flex().id(`gh-${item.number}`).flex_none().px(8).py(6).gap(3).rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
      .on_mouse_down("left", () => { this.drag = { text: dragText(this.kind, item), name: `#${item.number} ${item.title}`, icon: "🔗" }; })
      .on_click((_e, cx) => { this.openDetail(item, cx); cx.notify(); })
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(div().flex_none().text_size(12).text_color(t.dim).child(`#${item.number}`))
        .child(div().flex_1().min_w(0).truncate().child(item.title))
        .when(ci !== null, el => el.child(div().flex_none().text_size(12)
          .text_color(ci === "pass" ? t.ansi2 : ci === "fail" ? t.ansi1 : t.ansi3)
          .child(ci === "pass" ? "✓" : ci === "fail" ? "✗" : "●"))))
      .child(h_flex().gap(6).items_center().min_w(0).text_size(11).text_color(t.dim)
        .when(Boolean(item.isDraft), el => el.child(div().flex_none().child("초안")))
        .when(Boolean(review), el => el.child(div().flex_none()
          .text_color(review === "변경 요청" ? t.ansi1 : review === "승인" ? t.ansi2 : t.dim).child(review)))
        .children((item.labels ?? []).slice(0, 3).map(l => div().flex_none().px(5).rounded(4).border_1().border_color(t.border).child(l.name)))
        .child(div().flex_1().min_w(0).truncate().child(meta)));
  }

  listView(t, chip) {
    const message = !this.context?.cwd ? "폴더가 없어요"
      : this.error ? this.error.message
      : this.loading ? "불러오는 중…" : emptyText(this.kind, this.filter);
    return [
      h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("GitHub"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(!this.loading && this.error && this.items.length ? t.ansi1 : t.dim)
          .child(this.loading ? "불러오는 중…" : this.error && this.items.length ? "⚠ " + this.error.message : this.repo?.nameWithOwner ?? ""))
        .child(div().id("github-refresh").w(20).cursor_pointer().text_color(t.muted)
          .on_click((_e, cx) => { this.refresh(cx); cx.notify(); }).child("⟳")),
      h_flex().h(38).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
        .child(chip("gh-kind-issue", "이슈", this.kind === "issue", cx => this.setKind("issue", cx)))
        .child(chip("gh-kind-pr", "PR", this.kind === "pr", cx => this.setKind("pr", cx)))
        .child(div().w(8))
        .child(chip("gh-filter-open", "전체", this.filter === "open", cx => this.setFilter("open", cx)))
        .child(chip("gh-filter-mine", "내 것", this.filter === "mine", cx => this.setFilter("mine", cx)))
        .child(chip("gh-filter-closed", "닫힘", this.filter === "closed", cx => this.setFilter("closed", cx))),
      v_flex().id("github-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .children(this.items.map(item => this.row(item, t)))
        .when(this.items.length === 0, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(message))),
    ];
  }

  detailView(t, button) {
    const d = this.detail, item = d.data ?? d.item, target = this.target(), data = d.data;
    const content = v_flex().id("github-detail").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(12);
    return [
      h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().id("github-back").w(20).cursor_pointer().text_color(t.muted)
          .on_click((_e, cx) => { this.detail = null; cx.notify(); }).child("←"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(`#${item.number} ${item.title}`)),
      h_flex().h(38).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(button("github-open", "브라우저로 열기", cx => cx.open_url(item.url)))
        .child(button("github-agent", target ? `→ ${target.name} 입력창에 넣기` : "새 탭에서 Claude 시작", cx => this.handOff(cx))),
      d.error ? content.child(div().text_color(t.dim).child(d.error.message))
      : !data ? content.child(div().text_color(t.dim).child("불러오는 중…"))
      : content
        .child(div().text_size(12).text_color(t.dim)
          .child([`#${data.number}`, stateLabel(data.state), data.author?.login, relativeTime(data.createdAt, Date.now())].filter(Boolean).join(" · ")))
        .child(data.body?.trim() ? TextView.markdown(`gh-body-${data.number}`, data.body).selectable(true) : div().text_color(t.dim).child("본문 없음"))
        .children((data.comments ?? []).map((c, i) => v_flex().gap(4).pt(10).border_t(1).border_color(t.border)
          .child(div().text_size(12).text_color(t.dim).child(`${c.author?.login ?? "?"} · ${relativeTime(c.createdAt, Date.now())}`))
          .child(TextView.markdown(`gh-comment-${data.number}-${i}`, c.body ?? "").selectable(true)))),
    ];
  }

  render(cx) {
    const shown = this.visible();
    if (shown && !this.wasShown) this.refresh(cx);
    this.wasShown = shown;
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    const chip = (id, label, on, onClick) => h_flex().id(id).h(24).px(9).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const button = (id, label, onClick) => h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).cursor_pointer()
      .text_size(12).text_color(t.foreground).border_1().border_color(t.border).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    return v_flex().id("github").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .on_mouse_up("left", () => { this.drag = null; })
      // Window-relative panel box (pointer minus its in-panel offset): a drop back on it cancels.
      .on_mouse_move(e => { if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; })
      .on_size_change(size => { this.size = size; })
      .on_hover(hovered => { if (!hovered) this.dropOut(); })
      .children(this.detail ? this.detailView(t, button) : this.listView(t, chip));
  }
}
