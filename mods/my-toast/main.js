// Notifications in Herdr-UI's look, set as the layout root's "toast". Herdr draws the frame (rounded
// border, shadow and the layout's translucent "popover" color); the card fills it with no background of
// its own so the glass shows. Each level has its own shape:
//   success: a colored stripe on the left · warning: a tinted icon circle
//   error: a faint wash of red, red title · info: one quiet line
// Gets props() = { title, body, level, icon, action, timeout, overlay }. Click runs the action and closes.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme } from "herdr";

const COLOR = { error: "blocked", warning: "working", success: "done", info: "accent" };
const GLYPH = { error: "✕", warning: "!", success: "✓", info: "i" };
// "#rrggbb" + alpha (0..1) → "#rrggbbaa"; other colors pass through.
const tint = (c, a) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c + Math.round(a * 255).toString(16).padStart(2, "0") : c);

export default class Toast extends View {
  render() {
    const t = theme(), p = props() ?? {};
    const level = COLOR[p.level] ? p.level : "info", color = t[COLOR[level]] ?? t.accent;
    // Herdr's "needs login" notice: show the command with a copy button (as the shipped toast does).
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    const title = login ? `${login[1]}에 로그인이 필요해요` : p.title ?? "";

    const close = div().id("toast-close").w(18).h(18).flex_none().flex().items_center().justify_center().rounded(5)
      .text_size(11).text_color(t.dim).hover(s => s.bg("#ffffff14").text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); closeOverlay(p.overlay); }).child("✕");
    const body = login
      ? h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(command))
        .child(div().id("toast-login-copy").flex_none().px(6).py(2).rounded(4).bg("#ffffff14").text_size(12).text_color(t.foreground)
          .cursor_pointer().hover(s => s.bg("#ffffff24"))
          .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
          .child(this.copied ? "복사됨" : "복사"))
      : p.body ? div().max_h(32).overflow_hidden().text_size(12).text_color(t.muted).child(p.body) : null;
    const text = (titleColor = t.foreground) => v_flex().flex_1().min_w(0).gap(2)
      .child(div().truncate().font_semibold().text_size(13).text_color(titleColor).child(title))
      .when(Boolean(body), el => el.child(body));
    const icon = size => (p.icon ? image(p.icon).w(size).h(size).flex_none() : null);

    const card = h_flex().id("toast").size_full().items_center().cursor_pointer().hover(s => s.bg("#ffffff0d"))
      .on_click(() => { if (p.action?.name) run(p.action.name, p.action.args ?? {}); closeOverlay(p.overlay); });

    if (level === "warning" || login)
      return card.px(14).gap(12)
        .child(icon(20) ?? div().w(24).h(24).flex_none().flex().items_center().justify_center().rounded(12).bg(tint(color, 0.18))
          .text_size(12).font_semibold().text_color(color).child(GLYPH.warning))
        .child(text()).child(close);
    if (level === "error")
      return card.px(16).gap(10).bg(tint(color, 0.08)).child(text(color)).child(close);
    if (level === "info")
      return card.px(16).gap(10)
        .child(icon(16) ?? div().size(7).rounded(4).flex_none().bg(color))
        .child(h_flex().flex_1().min_w(0).gap(8).items_center().text_size(13)
          .child(div().flex_none().max_w(200).truncate().font_semibold().child(title))
          .when(Boolean(p.body), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`· ${p.body}`))))
        .child(close);
    return card.pr(12).gap(12) // success
      .child(div().w(3).h_full().flex_none().bg(color))
      .child(icon(18) ?? div().w(0))
      .child(text()).child(close);
  }
}
