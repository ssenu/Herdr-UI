// Shared look for the Herdr-UI panels. Mods can't import outside their own folder, so each mod that uses
// this keeps an identical copy; tests/ui-copies.test.mjs checks every copy matches mods/my-files/ui.js.
// Edit mods/my-files/ui.js, then copy it over the others.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

export const TEXT = { small: 11, body: 12, base: 13 };
export const HEADER_H = 42, TOOLBAR_H = 38, ROW_H = 28;

const fire = (fn, cx) => { fn?.(cx); cx.notify(); };

/** Root of a side panel. */
export function panel(t, id) {
  return v_flex().id(id).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
    .text_color(t.foreground).text_size(TEXT.base);
}

/** A toggle chip, filled when on. Clicking the chip that is on does nothing, unless `toggle` (it can switch itself off). */
export function chip(t, id, label, on, onClick, { toggle = false } = {}) {
  return h_flex().id(id).h(24).px(9).flex_none().items_center().rounded(6).cursor_pointer().text_size(TEXT.body)
    .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
    .hover(s => s.bg(t.hover)).on_click((_e, cx) => { if (!on || toggle) fire(onClick, cx); }).child(label);
}

/** A bordered text button. `danger` for delete / merge / close confirmations. */
export function button(t, id, label, onClick, { danger = false } = {}) {
  return h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).cursor_pointer().text_size(TEXT.body)
    .text_color(danger ? t.ansi1 : t.foreground).border_1().border_color(danger ? t.ansi1 : t.border)
    .hover(s => s.bg(t.hover)).on_click((_e, cx) => fire(onClick, cx)).child(label);
}

/** A 20×20 glyph button (⟳ ← ⋯ ✓ ✕ ↑ ↓ ⇥ ⇤ +). `stop`: its press and click don't reach a clickable row. */
export function iconButton(t, id, glyph, onClick, { stop = false } = {}) {
  let el = div().id(id).w(20).h(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
    .text_size(TEXT.body).text_color(t.muted).hover(s => s.bg(t.selected).text_color(t.foreground));
  if (stop) el = el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  return el.on_click((_e, cx) => { if (stop) cx.stop_propagation(); fire(onClick, cx); }).child(glyph);
}

/**
 * The panel's top line: [←] title, a dim right-aligned status that fills the middle, `right` elements
 * (chips…), then ⟳ — or "…" while `loading`. Pass `refresh: null` for no ⟳.
 */
export function header(t, { id, title, back = null, status = "", statusColor = null, right = [], refresh = null, loading = false }) {
  return h_flex().h(HEADER_H).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
    .when(Boolean(back), el => el.child(iconButton(t, `${id}-back`, "←", back)))
    .child(div().min_w(0).truncate().font_semibold().child(title))
    .child(div().flex_1().min_w(0).truncate().text_right().text_size(TEXT.body).text_color(statusColor ?? t.dim).child(status))
    .children(right)
    .when(Boolean(refresh) || loading, el => el.child(loading
      ? div().w(20).h(20).flex_none().flex().items_center().justify_center().text_color(t.dim).child("…")
      : iconButton(t, `${id}-refresh`, "⟳", refresh)));
}

/** The second line under a header (chips, filters, pickers). */
export function toolbar(t) {
  return h_flex().h(TOOLBAR_H).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border);
}

/** An error under the header/toolbar, above the list: ⚠ text, then [다시 시도] and/or [닫기]. */
export function errorLine(t, id, text, { retry = null, close = null } = {}) {
  return h_flex().id(id).flex_none().px(10).py(6).gap(6).items_center().flex_wrap().border_b(1).border_color(t.border).text_size(TEXT.body)
    .child(div().flex_1().min_w(0).text_color(t.ansi1).child(`⚠ ${text}`))
    .when(Boolean(retry), el => el.child(button(t, `${id}-retry`, "다시 시도", retry)))
    .when(Boolean(close), el => el.child(button(t, `${id}-close`, "닫기", close)));
}

/** A dim message in a list (empty, loading). */
export function note(t, text) {
  return div().p(8).text_size(TEXT.body).text_color(t.dim).child(text);
}

/** A confirmation right under (or in place of) the thing it acts on: text, [confirm], [취소]. */
export function confirmBox(t, id, text, { confirm, onConfirm, onCancel, danger = true }) {
  return h_flex().id(id).flex_none().px(8).py(6).gap(6).items_center().flex_wrap().rounded(7).bg(t.hover).text_size(TEXT.body)
    .child(div().min_w(0).child(text))
    .child(button(t, `${id}-ok`, confirm, onConfirm, { danger }))
    .child(button(t, `${id}-cancel`, "취소", onCancel));
}

/** A small menu: items { id, label, onClick, enabled = true, danger = false }, then an optional dim note. */
export function menu(t, id, items, note = null, { width = 148 } = {}) {
  return v_flex().id(id).w(width).p(4).gap(1).rounded(7).border_1().border_color(t.border).bg(t.background)
    .children(items.map(it => {
      const enabled = it.enabled !== false;
      const el = div().id(it.id).h(ROW_H).px(10).flex().items_center().rounded(5).text_size(TEXT.body)
        .text_color(!enabled ? t.dim : it.danger ? t.ansi1 : t.foreground);
      return enabled ? el.cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => fire(it.onClick, cx)).child(it.label) : el.child(it.label);
    }))
    .when(Boolean(note), el => el.child(div().px(10).py(4).text_size(TEXT.small).text_color(t.dim).child(note)));
}

/** on_key_down handler: Esc runs `cancel`. Put it on the element that wraps a form's inputs. */
export function onEscape(cancel) {
  return (e, cx) => { if (e.key === "escape") { cx.stop_propagation(); fire(cancel, cx); } };
}
