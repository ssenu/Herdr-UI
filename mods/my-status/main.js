// Herdr's status bar plus this PC's CPU, RAM and GPU beside the commands hint, read every 5 s. Windows only.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, openOverlay, closeOverlay, setShared } from "herdr";
import { metricsCommand, parseMetrics, emptyHistory, pushHistory, failStep, summaryParts, dashRows, dashHeight, dashAnchor } from "./logic.js";
import { usageCommands, parseDaily, parseBlock, usageSummary, usageDash } from "./usage.js";

const READ_MS = 5000, HOVER_MS = 300, BAR_AREA = 28, DASH_WIDTH = 300, DASH_KEY = "my-status.dash";
const USAGE_READ_MS = 300000, USAGE_TICK_MS = 60000, USAGE_DASH = { width: 300, height: 244 }, USAGE_KEY = "my-usage.dash";

export default class MyStatus extends View {
  init(_props, cx) {
    this.metrics = null; this.history = emptyHistory(); this.fails = { fails: 0, hidden: false }; this.reading = false;
    this.dash = null; this.hovered = false; this.ripe = false; this.hoverSeq = 0; this.origin = null; this.size = null;
    this.usage = {}; this.usageReading = false; this.refreshed = null;
    this.usageOverlay = null; this.usageHovered = false; this.usageRipe = false; this.usageSeq = 0; this.usageBox = null;
    if (window()?.platform !== "windows") return;
    this.read(cx);
    cx.timer.every(READ_MS, cx => this.read(cx));
    this.readUsage(cx);
    cx.timer.every(USAGE_READ_MS, cx => this.readUsage(cx));
    cx.timer.every(USAGE_TICK_MS, cx => { this.syncUsage(); cx.notify(); }); // the time left and the age move on between reads
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

  // Reads both reports; a failed one keeps its last value. Only a full read counts as refreshed.
  readUsage(cx) {
    if (this.usageReading) return;
    this.usageReading = true;
    cx.spawn(async cx => {
      const one = async (c, parse) => {
        try {
          const r = await exec(c.command, c.args);
          return r.code === 0 ? parse(r.stdout) : null;
        } catch { return null; }
      };
      try {
        const c = usageCommands(Date.now());
        const daily = await one(c.daily, parseDaily), block = await one(c.blocks, parseBlock);
        if (daily) this.usage = { ...this.usage, days: daily.days };
        if (block) this.usage = { ...this.usage, block };
        if (daily && block) this.refreshed = Date.now();
        this.syncUsage();
      } catch {} finally { this.usageReading = false; } // never stuck: the next tick reads again
      cx.notify();
    });
  }

  syncUsage() {
    if (this.usageOverlay) setShared(USAGE_KEY, usageDash(this.usage, Date.now(), this.refreshed));
  }

  openUsage() {
    if (!this.usageHovered || !this.usageRipe || this.usageOverlay || !this.origin || !this.usageBox?.width || this.usageBox.x === undefined) return;
    const at = dashAnchor({ x: this.usageBox.x, y: this.origin.y, width: this.usageBox.width }, USAGE_DASH);
    if (!at) return;
    this.hovered = false; this.hoverSeq++; this.closeDash(); // one dashboard at a time, even if a leave event was missed
    const dash = usageDash(this.usage, Date.now(), this.refreshed);
    setShared(USAGE_KEY, dash);
    this.usageOverlay = openOverlay({ mod: "my-usage-dash", kind: "window", frame: "none", ...USAGE_DASH, at, props: { dash } });
  }

  closeUsage() {
    const id = this.usageOverlay;
    this.usageOverlay = null;
    if (!id) return;
    setShared(USAGE_KEY, null);
    try { closeOverlay(id); } catch {} // a layout switch may already have closed it
  }

  hoverUsage(on, cx) {
    this.usageHovered = on; this.usageRipe = false;
    const seq = ++this.usageSeq;
    if (!on) { this.closeUsage(); return; }
    cx.timer.after(HOVER_MS, () => {
      if (seq !== this.usageSeq) return;
      this.usageRipe = true;
      this.openUsage();
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
    this.usageHovered = false; this.usageSeq++; this.closeUsage();
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
  async close() { this.hovered = false; this.hoverSeq++; this.closeDash(); this.usageHovered = false; this.usageSeq++; this.closeUsage(); }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("명령") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  명령` : "명령";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const parts = this.fails.hidden ? [] : summaryParts(this.metrics, Boolean(space?.machine));
    const usage = usageSummary(this.usage, Date.now());
    return h_flex().id("my-status").size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(12).text_color(t.muted)
      .on_mouse_move(e => {
        if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y };
        this.openDash();
        this.openUsage();
      })
      .on_size_change(size => { this.size = size; })
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "이 PC"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`에이전트 ${list.length}개`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs}개가 기다려요`))))
      .child(div().flex_1())
      .when(Boolean(usage), el => el.child(div().id("status-usage").flex_none()
        .on_hover((on, cx) => this.hoverUsage(on, cx))
        .on_mouse_move(e => { if (e.local_position) this.usageBox = { ...this.usageBox, x: e.position.x - e.local_position.x }; })
        .on_size_change(size => { this.usageBox = { ...this.usageBox, width: size.width }; })
        .child(usage)))
      .when(parts.length > 0, el => el.child(h_flex().id("status-metrics").flex_none().gap(10).items_center()
        .on_hover((on, cx) => this.hover(on, cx))
        .children(parts.map(p => div().flex_none().when(p.hot, d => d.text_color(t.blocked)).child(p.value ? `${p.label} ${p.value}` : p.label)))))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
