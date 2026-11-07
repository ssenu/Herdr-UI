// The status bar's usage dashboard: draws what my-status computes (kept in shared while open). Reads nothing itself.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, shared, theme } from "herdr";

const BAR_AREA = 28; // USAGE_BAR in my-status/usage.js

export default class MyUsageDash extends View {
  render() {
    const t = theme(), d = shared("my-usage.dash") ?? props()?.dash;
    if (!d) return div().size_full().rounded(10).bg(t.popover).border_1().border_color(t.border);
    const line = (left, right) => h_flex().flex_none().justify_between().items_center().gap(8)
      .child(div().text_color(t.muted).child(left)).child(div().truncate().child(right));
    return v_flex().size_full().p(12).gap(8).rounded(10).overflow_hidden().bg(t.popover).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(12)
      .child(h_flex().flex_none().justify_between().items_center()
        .child(div().font_semibold().child("사용량 · 이 PC"))
        .child(div().text_size(11).text_color(t.dim).child(d.age)))
      .child(v_flex().flex_none().gap(4)
        .when(Boolean(d.block), el => el
          .child(line("현재 블록", d.block.projected ? `${d.block.cost} → 예상 ${d.block.projected}` : d.block.cost))
          .child(h_flex().items_center().gap(8)
            .child(div().flex_1().h(6).rounded(3).overflow_hidden().bg(t.hover)
              .child(div().h_full().w(`${d.block.percent}%`).bg(t.accent)))
            .child(div().flex_none().text_size(11).text_color(t.muted).child(d.block.left))))
        .when(!d.block, el => el.child(line("현재 블록", "활성 블록 없음"))))
      .child(v_flex().flex_none().gap(4)
        .child(line("최근 7일", `오늘 ${d.today}`))
        .child(h_flex().h(BAR_AREA).gap(3).items_end()
          .children(d.week.map(b => div().flex_1().h(b.h).rounded(1).bg(b.today ? t.accent : t.dim)))))
      .when(Boolean(d.models), el => el.child(v_flex().flex_none().gap(4)
        .child(div().text_color(t.muted).child("오늘 모델별"))
        .child(div().truncate().child(d.models))))
      .child(h_flex().flex_none().justify_between().items_center()
        .child(div().child(`이번 달 ${d.month}`))
        .child(div().text_size(11).text_color(t.dim).child("API 가격 기준 추정치")));
  }
}
