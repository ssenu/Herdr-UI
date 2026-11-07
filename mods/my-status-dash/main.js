// The status bar's dashboard: draws the rows my-status computes (kept in shared while open). Reads nothing itself.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, shared, theme } from "herdr";

const BAR_AREA = 28;

export default class MyStatusDash extends View {
  render() {
    const t = theme(), rows = shared("my-status.dash") ?? props()?.rows ?? [];
    return v_flex().size_full().p(12).gap(8).rounded(10).overflow_hidden().bg(t.popover).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(12)
      .child(div().font_semibold().child("시스템 · 이 PC"))
      .children(rows.map(r => v_flex().flex_none().gap(4)
        .child(h_flex().justify_between().items_center()
          .child(div().text_color(t.muted).child(r.label))
          .child(div().when(r.hot, d => d.text_color(t.blocked)).child(r.value)))
        .child(h_flex().h(BAR_AREA).gap(1).items_end().justify_end()
          .children(r.bars.map(b => div().flex_none().w(3).h(b.h).bg(b.hot ? t.blocked : t.accent))))))
      .child(div().text_size(11).text_color(t.dim).child("최근 5분"));
  }
}
