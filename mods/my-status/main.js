// Herdr's status bar plus this PC's CPU, RAM and GPU beside the commands hint, read every 5 s. Windows only.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec } from "herdr";
import { metricsCommand, parseMetrics, emptyHistory, pushHistory, failStep, summaryParts } from "./logic.js";

const READ_MS = 5000;

export default class MyStatus extends View {
  init(_props, cx) {
    this.metrics = null; this.history = emptyHistory(); this.fails = { fails: 0, hidden: false }; this.reading = false;
    if (window()?.platform !== "windows") return;
    this.read(cx);
    cx.timer.every(READ_MS, cx => this.read(cx));
  }

  read(cx) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async cx => {
      let read = null;
      try {
        const c = metricsCommand(), r = await exec(c.command, c.args);
        if (r.code === 0) read = parseMetrics(r.stdout);
      } catch {}
      if (read) this.metrics = read;
      this.fails = failStep(this.fails, Boolean(read));
      this.history = pushHistory(this.history, this.fails.hidden ? null : this.metrics);
      this.reading = false;
      cx.notify();
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const parts = this.fails.hidden ? [] : summaryParts(this.metrics, Boolean(space?.machine));
    return h_flex().id("my-status").size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .when(parts.length > 0, el => el.child(h_flex().id("status-metrics").flex_none().gap(10).items_center()
        .children(parts.map(p => div().flex_none().when(p.hot, d => d.text_color(t.blocked)).child(p.value ? `${p.label} ${p.value}` : p.label)))))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
