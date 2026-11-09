import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings, notify } from "herdr";
import { chipsFor, hostPanes, hostStatus, dropSplit, SPLIT_KEY } from "./logic.js";
import { tabArgs, newToken } from "./viewer-open.js";

const WAIT_MS = 2000, POLL_MS = 100, DRAFT_MS = 800; // a closed viewer writes its last draft in its final call, which the host caps at 250 ms

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

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.busy = new Set();
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  // The pointer left the bar with a tab held: a full-window layer takes over the drag.
  dragOut() {
    const tab = this.pressedTab;
    this.pressed = null; this.pressedTab = null;
    if (tab) openOverlay({ mod: "my-tab-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { tab } });
  }

  // Back to its own tab, same process. Parked but not placed is recovered as a tab, so it is never orphaned.
  async toTab(chip, cx) {
    const { terminal } = chip, shown = () => panes().find(p => p.terminal === terminal);
    run("terminal.park", { terminal });
    try {
      if (!await until(cx, () => !shown())) throw new Error("터미널을 칸에서 떼지 못했어요");
      run("terminal.keep", { terminal, place: "tab" });
      if (!await until(cx, () => Boolean(shown()))) throw new Error("터미널이 새 탭에 나타나지 않았어요");
    } catch (e) {
      if (!shown()) { try { run("terminal.keep", { terminal, place: "tab" }); } catch { /* best effort */ } }
      throw e;
    }
    const tab = shown().tab;
    try { run("tab.rename", { id: tab, name: chip.name }); } catch { /* moved; only the name is off */ }
    return tab;
  }

  // A viewer closes and reopens as a tab; its unsaved text comes back from the draft.
  async viewerToTab(chip, cx, space) {
    run("pane.close", { pane: chip.pane });
    if (!await until(cx, () => !panes().some(p => p.pane === chip.pane))) throw new Error("칸을 닫지 못했어요");
    await cx.sleep(DRAFT_MS);
    run("tab.new", tabArgs({ path: chip.path, on: chip.on ?? null, root: null, space }, newToken(Date.now(), Math.random())));
  }

  // close: a terminal goes through its own tab so closing asks like any other tab. pane.close would kill it without asking.
  chipAction(chip, close, space, cx) {
    if (this.busy.has(chip.pane)) return;
    this.busy.add(chip.pane);
    cx.spawn(async cx => {
      try {
        if (chip.kind === "viewer") {
          if (close) run("pane.close", { pane: chip.pane });
          else await this.viewerToTab(chip, cx, space);
        } else {
          const tab = await this.toTab(chip, cx);
          if (close) run("tab.close", { id: tab });
        }
        setShared(SPLIT_KEY, dropSplit(shared(SPLIT_KEY), panes(), chip.pane));
      } catch (e) {
        const where = chip.kind === "viewer" ? `파일 ${chip.path}` : `터미널 ${chip.terminal} (hc ls 로 찾을 수 있어요)`;
        notify({ title: "칸을 옮기지 못했어요", body: `${e}\n${where}`, level: "error", timeout: 5000 });
      } finally { this.busy.delete(chip.pane); cx.notify(); }
    });
  }

  // The bar's box in window coordinates, for a file dropped on it. Sent only when it changes:
  // a shared value re-renders every mod.
  measure() {
    if (!this.origin || !this.size) return;
    const bounds = { x: Math.round(this.origin.x), y: Math.round(this.origin.y), width: Math.round(this.size.width), height: Math.round(this.size.height) };
    if (JSON.stringify(bounds) === JSON.stringify(shared("my-tabs.bounds"))) return;
    setShared("my-tabs.bounds", bounds);
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const split = shared(SPLIT_KEY), all = panes();
    const chipEl = (chip, active) => {
      const on = active && chip.focused; // a tab that is not showing keeps its last focused pane
      const icon = (id, file, close) => div().id(`${id}-${chip.pane}`).flex_none().text_color(t.dim).hover(s => s.text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.chipAction(chip, close, space.id, cx); }).child(svg(file).size(12));
      return h_flex().id(`chip-${chip.pane}`).h(29).px(8).gap(6).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(on ? t.border : t.chrome).bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => run("pane.focus", { pane: chip.pane }))
        .child(svg("mods/my-tabs/split.svg").size(12).flex_none().text_color(t.dim))
        .child(div().max_w(170).truncate().child(chip.name))
        .when(chip.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(chip.status === "blocked" || chip.status === "done", el => el.child(div().size(6).rounded(3).bg(t[chip.status])))
        .when(on, el => el.child(icon("chip-out", "mods/my-tabs/detach.svg", false)).child(icon("chip-close", "mods/pane/close.svg", true)));
    };
    const item = (c, i) => {
      const chips = chipsFor(c.id, all, split), own = chips.length ? hostPanes(c.id, all, chips) : all.filter(p => p.tab === c.id);
      const program = own.find(p => p.program?.agent)?.program ?? own[0]?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      const lit = c.active && !chips.some(x => x.focused), status = chips.length ? hostStatus(own) : c.status;
      const tab = h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(lit ? t.border : t.chrome).bg(lit ? t.raised : t.chrome).text_color(lit ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          if (e.click_count === 2) { this.pressed = null; this.pressedTab = null; run("tab.rename", { id: c.id }); }
          else { this.pressed = i; this.pressedTab = { id: c.id, name }; }
        })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null; this.pressedTab = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else if (chips.length) run("pane.focus", { pane: own[0]?.pane ?? chips[0].pane });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(status === "blocked" || status === "done", el => el.child(div().size(6).rounded(3).bg(t[status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
      return [tab, ...chips.map(chip => chipEl(chip, c.active))];
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "github", "plugins", "sessions", "tasks"])];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().id("my-tabs-bar").size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; this.pressedTab = null; })
      .on_hover(hovered => { if (!hovered) this.dragOut(); })
      .on_mouse_move(e => { if (e.local_position) { this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; this.measure(); } })
      .on_size_change(size => { this.size = size; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.flatMap(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "my-new-menu", kind: "popup", width: 250, height: 543 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .when(enabled.includes("github"), el => el.child(panelButton("github", "GitHub", "mods/my-github/github.svg")))
      .when(enabled.includes("plugins"), el => el.child(panelButton("plugins", "Plugin", "mods/my-plugins/plugins.svg")))
      .when(enabled.includes("sessions"), el => el.child(panelButton("sessions", "Session", "mods/my-sessions/sessions.svg")))
      .when(enabled.includes("tasks"), el => el.child(panelButton("tasks", "Task", "mods/my-tasks/tasks.svg")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/my-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/my-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/my-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
