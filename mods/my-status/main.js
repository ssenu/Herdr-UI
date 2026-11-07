// Herdr's status bar plus this PC's CPU, RAM and GPU beside the commands hint, read every 5 s. Windows only.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, openOverlay, closeOverlay, setShared } from "herdr";
import { metricsCommand, parseMetrics, emptyHistory, pushHistory, failStep, summaryParts, dashRows, dashHeight, dashAnchor } from "./logic.js";

const READ_MS = 5000, HOVER_MS = 300, BAR_AREA = 28, DASH_WIDTH = 300, DASH_KEY = "my-status.dash";

export default class MyStatus extends View {
  init(_props, cx) {
    this.metrics = null; this.history = emptyHistory(); this.fails = { fails: 0, hidden: false }; this.reading = false;
    this.dash = null; this.hovered = false; this.ripe = false; this.hoverSeq = 0; this.origin = null; this.size = null;
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
      if (this.fails.hidden && this.hovered) { this.hovered = false; this.ripe = false; this.hoverSeq++; this.closeDash(); }
      if (this.dash) setShared(DASH_KEY, this.rows());
      this.reading = false;
      cx.notify();
    });
  }

  rows() {
    return dashRows(this.fails.hidden ? null : this.metrics, this.history, BAR_AREA);
  }

  openDash() {
    if (!this.hovered || !this.ripe || this.dash || !this.origin || !this.size) return;
    const rows = this.rows(), size = { width: DASH_WIDTH, height: dashHeight(rows.length) };
    const at = dashAnchor({ ...this.origin, ...this.size }, size);
    if (!at) return;
    setShared(DASH_KEY, rows);
    this.dash = openOverlay({ mod: "my-status-dash", kind: "window", frame: "none", ...size, at, props: { rows } });
  }

  closeDash() {
    const id = this.dash;
    this.dash = null;
    if (!id) return;
    setShared(DASH_KEY, null);
    try { closeOverlay(id); } catch {} // a layout switch may already have closed it
  }

  hover(on, cx) {
    this.hovered = on; this.ripe = false;
    const seq = ++this.hoverSeq;
    if (!on) { this.closeDash(); return; }
    cx.timer.after(HOVER_MS, () => {
      if (seq !== this.hoverSeq) return;
      this.ripe = true;
      this.openDash();
    });
  }

  // A reload must not leave the dashboard behind.
  async close() { this.hovered = false; this.hoverSeq++; this.closeDash(); }

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
      .on_mouse_move(e => {
        if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y };
        this.openDash();
      })
      .on_size_change(size => { this.size = size; })
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .when(parts.length > 0, el => el.child(h_flex().id("status-metrics").flex_none().gap(10).items_center()
        .on_hover((on, cx) => this.hover(on, cx))
        .children(parts.map(p => div().flex_none().when(p.hot, d => d.text_color(t.blocked)).child(p.value ? `${p.label} ${p.value}` : p.label)))))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
