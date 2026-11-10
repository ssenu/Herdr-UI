// "Open with" popup for my-files rows: default program, VS Code, reveal in the file manager, copy path.
// Opened as a popup with props { path, dir }. ↑/↓ move, Enter runs, Esc closes.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, exec, notify, theme, window } from "herdr";
import { ITEMS, openCommand, codeExeFrom } from "./logic.js";

export default class MyFilesOpen extends View {
  init(_props, cx) {
    this.at = 0; this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    // Where VS Code's Code.exe is (Windows only; other systems run `code`).
    this.codeExe = window()?.platform === "windows"
      ? exec("where.exe", ["code.cmd"]).then(r => (r.code === 0 ? codeExeFrom(r.stdout) : null)).catch(() => null)
      : Promise.resolve(null);
  }

  choose(i, cx) {
    const item = ITEMS[i], { path, overlay } = props() ?? {};
    if (!item || !path || this.busy) return;
    const close = () => { if (overlay) closeOverlay(overlay); };
    if (item.action === "copy") { cx.write_to_clipboard(path); close(); return; }
    this.busy = true;
    // Close only after the program started: closing an overlay cancels its pending tasks.
    cx.spawn(async () => {
      try {
        const spec = openCommand(item.action, path, window()?.platform, { codeExe: await this.codeExe });
        if (!spec) throw new Error(item.action === "code" ? "VS Code를 찾지 못했어요" : "지원하지 않는 동작이에요");
        const r = await exec(spec.command, spec.args);
        if (!spec.ignoreCode && r.code !== 0) throw new Error(r.stderr || `exit ${r.code}`);
      } catch (e) {
        notify({ title: "열지 못했어요", body: `${item.label}: ${String(e?.message ?? e)}`, level: "error", timeout: 5000 });
      } finally { close(); }
    });
  }

  render() {
    const t = theme();
    return v_flex().id("my-files-open").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % ITEMS.length;
        else if (e.key === "up") this.at = (this.at + ITEMS.length - 1) % ITEMS.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props()?.overlay);
        else return;
        cx.notify();
      })
      .children(ITEMS.map((item, i) => h_flex().id(`open-${item.action}`).h(31).px(8).rounded(7).items_center()
        .text_color(t.foreground).cursor_pointer()
        .when(i === this.at, el => el.bg(t.selected))
        .hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.choose(i, cx))
        .child(div().flex_1().child(item.label))));
  }
}
