// Drag layer for my-files: a transparent full-window overlay opened when a row is dragged out of
// the Files panel. The name follows the pointer. Releasing back over the panel cancels; over the tab
// bar, a file opens in a viewer tab; anywhere else, props.text is typed into the focused terminal
// (clipboard + terminal.paste).
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, notify, shared, spaces } from "herdr";
import { BOUNDS_KEY, OPEN_KEY, dropAction, openCommands, newToken } from "./viewer-open.js";

export default class MyFilesDrag extends View {
  init() { this.pos = null; this.done = false; }

  action(position) {
    const { panel, dir, path } = props() ?? {}, bar = shared(BOUNDS_KEY);
    // The bar runs to the window's right edge; its stored width can be stale after a resize.
    const action = dropAction({ position, panel, tabs: bar ? { ...bar, width: Infinity } : null, dir });
    // GitHub and Plugins rows use this layer too: they carry text to type, not a file to open.
    return action === "open" && !path ? "paste" : action;
  }

  finish(position, cx) {
    if (this.done) return;
    this.done = true; cx.notify(); // hides the label at once
    const { text, path, on, overlay } = props() ?? {};
    try {
      const action = this.action(position);
      // ponytail: lands in the focused terminal, not the one under the pointer (panes() has no bounds),
      // and replaces the clipboard.
      if (action === "paste" && text) {
        cx.write_to_clipboard(text);
        run("terminal.paste", {});
      } else if (action === "open" && path) {
        const list = spaces(), space = list.find(s => s.active)?.id;
        for (const [name, args] of openCommands({ path, on: on ?? null, root: null, space }, shared(OPEN_KEY), list, newToken(Date.now(), Math.random()))) run(name, args);
      } else if (action === "folder") {
        notify({ title: "폴더는 열 수 없어요", level: "info", timeout: 3000 });
      }
    } catch (e) {
      notify({ title: "놓은 곳에 넣지 못했어요", body: String(e), level: "error", timeout: 3000 });
    } finally {
      if (overlay) closeOverlay(overlay);
    }
  }

  hint() {
    const action = this.action(this.pos);
    return action === "open" ? "· 놓으면 새 탭으로 열기" : action === "folder" ? "· 폴더는 열 수 없어요" : action === "cancel" ? "· 놓으면 취소" : "· 놓으면 입력";
  }

  render() {
    const t = theme(), { name = "", dir = false, icon } = props() ?? {};
    return div().id("my-files-drag").size_full().bg("#00000001")
      .on_mouse_move((e, cx) => { if (!this.done) { this.pos = e.position; cx.notify(); } })
      .on_mouse_up("left", (e, cx) => this.finish(e.position, cx))
      // Released before this layer opened: the next press just closes it.
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.finish(null, cx); })
      .when(Boolean(this.pos) && !this.done, el => el.child(
        h_flex().absolute().left(this.pos.x + 14).top(this.pos.y + 12).h(26).px(10).gap(6).items_center()
          .rounded(7).bg(t.popover).border_1().border_color(t.accent).text_color(t.foreground).text_size(12)
          .child(icon ?? (dir ? "📁" : "📄")).child(name)
          .child(div().text_color(t.dim).child(this.hint()))));
  }
}
