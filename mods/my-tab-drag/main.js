// Drag layer for tabs: a transparent full-window overlay opened when a tab is dragged off the tab bar.
// It shows the half the tab would take. Releasing near an edge of the work area moves the tab beside
// the focused pane: a terminal keeps running (park, then keep), a viewer reopens there from its draft.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, notify, shared, setShared, spaces, panes, layout, focused, terminals } from "herdr";
import { tabMove, workArea, dropZone, previewBox, placement, dropLabel, addSplit, plainName, SPLIT_KEY } from "./logic.js";

const WAIT_MS = 2000, POLL_MS = 100, DRAFT_MS = 800; // the closed viewer writes its last draft in its final call, which the host caps at 250 ms

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

async function until(cx, test) {
  for (let t = 0; t < WAIT_MS; t += POLL_MS) {
    if (test()) return true;
    await cx.sleep(POLL_MS);
  }
  return test();
}

export default class MyTabDrag extends View {
  init(_props, cx) {
    this.pos = null; this.size = null; this.done = false; this.moving = false;
    const space = spaces().find(s => s.active), tabId = props()?.tab?.id;
    this.move = tabMove(tabId, { activeTab: space?.tabs.find(t => t.active)?.id, panes: panes(), machine: space?.machine ?? null, own: shared("my-viewer.own"), parents: terminals().map(t => t.parent).filter(Boolean) });
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  area() {
    const root = layout(), panel = find(root, "panel"), status = find(root, "status");
    return workArea({ bar: shared("my-tabs.bounds"), window: this.size, panelWidth: panel && !panel.hidden ? panel.size?.px ?? 0 : 0, statusHeight: status && !status.hidden ? status.size?.px ?? 0 : 0 });
  }

  zone() {
    return this.move.blocked ? null : dropZone(this.pos, this.area());
  }

  // Remembered before any swap: the tab bar keeps a chip for this pane. A pane's id survives a swap.
  remember(pane, entry) {
    setShared(SPLIT_KEY, addSplit(shared(SPLIT_KEY), panes(), pane, { name: plainName(props()?.tab?.name), ...entry }));
  }

  dismiss() {
    try {
      const id = props()?.overlay;
      if (id) closeOverlay(id);
      // Closing the layer drops keyboard focus; read the pane now so a finished move's focus is kept.
      const pane = focused()?.pane;
      if (pane) run("pane.focus", { pane });
    } catch { /* nothing more to do */ }
  }

  finish(position, cx) {
    if (this.done) return;
    this.done = true;
    if (position) this.pos = position;
    let zone = null;
    try { zone = position ? this.zone() : null; } catch { this.dismiss(); return; }
    if (zone) this.moving = true;
    cx.notify(); // hides the preview at once; the label shows the move is running
    if (!zone) { this.dismiss(); return; }
    cx.spawn(async cx => {
      try {
        if (this.move.kind === "terminal") await this.moveTerminal(zone, cx);
        else await this.moveViewer(zone, cx);
      } catch (e) {
        // Where the thing is, so it can be found: a terminal by `hc ls`, a file by its path.
        const where = this.move.kind === "terminal" ? `터미널 ${this.move.terminal} (hc ls 로 찾을 수 있어요)` : `파일 ${this.move.path}`;
        notify({ title: "탭을 옮기지 못했어요", body: `${e}\n${where}`, level: "error", timeout: 5000 });
      } finally { this.dismiss(); }
    });
  }

  async moveTerminal(zone, cx) {
    const { terminal } = this.move, { place, swap } = placement(zone);
    const shown = () => panes().find(p => p.terminal === terminal);
    if (!focused()?.pane) throw new Error("분할할 칸을 먼저 눌러 주세요");
    run("terminal.park", { terminal });
    try {
      if (!await until(cx, () => !shown())) throw new Error("터미널을 탭에서 떼지 못했어요");
      run("terminal.keep", { terminal, place });
      if (!await until(cx, () => Boolean(shown()))) throw new Error("터미널이 새 칸에 나타나지 않았어요");
    } catch (e) {
      // Parked but not placed: bring it back as a tab so the running terminal is not orphaned.
      if (!shown()) { try { run("terminal.keep", { terminal, place: "tab" }); } catch { /* best effort */ } }
      throw e;
    }
    this.remember(shown().pane, { kind: "terminal" });
    if (swap) { run("pane.focus", { terminal }); run("pane.swap", { direction: swap }); }
  }

  async moveViewer(zone, cx) {
    const { path, on } = this.move, { place, swap } = placement(zone), tabId = props().tab.id;
    if (!focused()?.pane) throw new Error("분할할 칸을 먼저 눌러 주세요");
    run("tab.close", { id: tabId, confirmed: true });
    if (!await until(cx, () => !panes().some(p => p.tab === tabId))) throw new Error("뷰어 탭을 닫지 못했어요");
    await cx.sleep(DRAFT_MS); // the closed viewer writes its last draft
    const before = new Set(panes().map(p => p.pane));
    const fresh = () => panes().find(p => p.mod === "my-viewer" && !before.has(p.pane));
    try {
      run("pane.split", { direction: place, mod: "my-viewer", props: { path, on, root: null } });
      if (!await until(cx, () => Boolean(fresh()))) throw new Error("새 칸이 나타나지 않았어요");
    } catch (e) {
      // The tab is already closed: reopen the file as a tab so it is not lost from view.
      try { run("tab.new", { name: path.split(/[\\/]/).pop(), mod: "my-viewer", props: { path, on, root: null } }); } catch { /* best effort */ }
      throw e;
    }
    this.remember(fresh().pane, { kind: "viewer", path, on });
    if (swap) { run("pane.focus", { pane: fresh().pane }); run("pane.swap", { direction: swap }); }
  }

  render() {
    const t = theme(), { tab } = props() ?? {}, zone = this.done ? null : this.zone(), area = zone ? this.area() : null;
    const box = zone ? previewBox(zone, area) : null;
    return div().id("my-tab-drag").track_focus(this.handle).size_full().bg("#00000001")
      .on_size_change(size => { this.size = size; })
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.finish(null, cx); } })
      .on_mouse_move((e, cx) => { if (!this.done) { this.pos = e.position; cx.notify(); } })
      .on_mouse_up("left", (e, cx) => this.finish(e.position, cx))
      // Released before this layer opened: the next press just closes it.
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.finish(null, cx); })
      .when(Boolean(box), el => el.child(div().absolute().left(box.x).top(box.y).w(box.width).h(box.height)
        .rounded(10).bg(t.accent).opacity(0.18).border_1().border_color(t.accent)))
      .when(Boolean(this.pos) && (!this.done || this.moving), el => el.child(
        h_flex().absolute().left(this.pos.x + 14).top(this.pos.y + 12).h(26).px(10).gap(6).items_center()
          .rounded(7).bg(t.popover).border_1().border_color(this.move.blocked ? t.blocked : t.accent).text_color(t.foreground).text_size(12)
          .child(this.moving ? "옮기는 중…" : tab?.name ?? "")
          .when(!this.moving, l => l.child(div().text_color(t.dim).child(`· ${dropLabel(zone, this.move)}`)))));
  }
}
