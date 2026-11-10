# UI 통일과 UX 개선 — 설계·계획

- 날짜: 2026-11-11
- 근거: 같은 날의 UI 감사(패널 8개, 팝업, 대시보드 비교)
- 범위: 1단계(겉모양 통일) + 2단계(동작 통일), 패널 이름은 복수형(a)
- 동작 자체(무엇을 읽고 쓰는지)는 바꾸지 않는다. 화면 모양, 문구, 키보드, 피드백만.

## 공통 부품 `ui.js`

mod는 자기 폴더 밖을 import할 수 없다. 원본은 `mods/my-files/ui.js`, 같은 파일을 `my-viewer`, `my-github`, `my-plugins`, `my-sessions`, `my-tasks`에 복사한다. `tests/ui-copies.test.mjs`가 복사본이 원본과 같은지 본다. `logic.js`는 계속 `ui.js`를 import하지 않는다(테스트가 plain Node로 읽으므로).

```js
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
```

## 표준

- 헤더 42 (px14 gap8), 둘째 줄 38 (px10 gap4), 검색 줄도 38. 뷰어 헤더 36→42, 피커 40→38.
- 글자 11 / 12 / 13만. 12.5·12.8 → 13, 11.8 → 12.
- 목록 행: px8 py6 rounded7 hover `t.hover`(트리·검색 결과처럼 높이 28 고정인 행은 그대로).
- 팝업(`my-files-open`, `my-new-menu`) 행: 마우스 올림 `t.hover`, 고른 줄 `t.selected`, 글자 13.
- 오류: `errorLine`을 헤더/둘째 줄 아래, 목록 위에. 다시 읽을 수 있으면 [다시 시도]. 오류를 흐린 글씨로만 보여 주는 곳 없앰.
- 빈 화면·불러오는 중: `note`. "불러오는 중…".
- 확인: `confirmBox`, 대상 바로 아래(또는 그 행 자리). 순서 [실행] [취소]. 삭제·머지·이슈 닫기·목록 삭제는 `danger`.
- "취소" = 하던 일 그만두기(폼, 확인), "닫기" = 메시지·메뉴 치우기.
- Esc: 입력칸이 있는 모든 폼(Tasks 추가·편집·목록 이름, Sessions 이름, 뷰어 검색은 검색어 지우기)에서 `onEscape`. 포커스가 없는 메뉴·확인창은 Esc 대상이 아니다(포커스를 잡을 수 없음).
- 완료 알림: GitHub 이슈 닫기·PR 머지, Sessions 삭제 성공 시 `notify({ title, level: "info", timeout: 3000 })`. 문구: `#N 이슈를 닫았어요` / `#N PR을 머지했어요`(실패: `#N 이슈를 닫지 못했어요` / `#N PR을 머지하지 못했어요`) / `세션을 휴지통으로 보냈어요`(원격·비Windows: `세션을 지웠어요`).
- 패널 이름(탭 바 버튼 = 헤더 제목): Files · Changes · GitHub · Plugins · Sessions · Tasks.
- 영어 화면 문구는 해요체 한국어로(키 이름 Ctrl/Alt/Shift, 고유명사, 명령어는 그대로): 예 "Loading files…"→"파일을 불러오는 중…", "Loading file…"→"파일을 여는 중…", "No files"→"파일이 없어요", "No folder"→"폴더가 없어요", "Cannot list this folder"→"폴더를 읽지 못했어요", "This file is no longer available"→"이 파일은 더 이상 없어요", "File list limited to …"→ 같은 뜻의 한국어, "Start an agent"→"에이전트 시작", "Checking installed agents…"→"설치된 에이전트를 확인하는 중…", "Could not load agents"→"에이전트 목록을 읽지 못했어요", "New space"→"새 스페이스", "New worktree…"→"새 워크트리…", "Open worktree…"→"워크트리 열기…", "This computer"→"이 PC", "N agents"/"N needs you" 류 → "에이전트 N개"/"N개가 기다려요", "not installed"→"설치 안 됨", "Terminal"(탭 기본 이름)은 그대로.

## 패널별 작업

### G0: `ui.js`와 복사본 시험
`mods/my-files/ui.js`(위 코드 그대로), 다섯 복사본, `tests/ui-copies.test.mjs`(다섯 복사본 == 원본), `package.json` test 목록에 추가.

### G1: Files, 뷰어, `my-files-open`
- Files: `panel`/`header`(제목 "Files", 상태 = 지금 폴더/파일, `right` = [바탕화면] 칩, `refresh` = 목록 다시 읽기 — 새로 추가, `back` = 파일 보기에서 목록으로), 검색 줄 38, 편집/nano/충돌 바는 그대로 높이 34 유지 가능하나 버튼·칩은 `ui.js`. 오류 → `errorLine`(+[다시 시도]). 영어 문구 번역. 입력 글자 13.
- 뷰어: 헤더 42, 피커 38, 버튼·칩 `ui.js`, 검색 입력 Esc → 검색어 지우기, 영어 문구가 있으면 번역.
- `my-files-open`: 행 마우스 올림 `t.hover`, 글자 13(창 높이는 그대로 맞는지 확인).

### G2: GitHub, Plugins
- `panel`/`header`/`toolbar`/`chip`/`button`/`iconButton`로 교체(복사된 헬퍼 삭제). 상세 화면 `back`은 ←(Plugins의 "← 목록"도 ←).
- 오류: 헤더 상태칸의 ⚠ 대신 `errorLine`(+[다시 시도] = 다시 읽기), 목록이 비었을 때도 오류면 `errorLine`.
- GitHub 확인(머지·닫기): 도구 줄 안 → 도구 줄 아래 `confirmBox`(mx10 my6), `danger`. 실패 줄 [다시 시도] [닫기]. 성공 알림.
- Plugins 행 `⋯`: 복사된 코드 → `iconButton(..., { stop: true })`(같은 팝업을 연다).

### G3: Sessions, Tasks
- Sessions: `panel`/`header`/`toolbar`/`chip`/`button`/`iconButton`; `⋯` 메뉴 → `menu`(열려 있는 세션은 세 항목 비활성 + note), 색상 줄은 그대로(스와치) 단 [기본]은 `button`; 삭제 확인 → `confirmBox`(danger); 오류 → 목록 위 `errorLine` 또는 행 아래 상자는 `errorLine` 대신 그대로 두되 [닫기]; 이름 수정 중 표시 `${name} …` → `${name}…`; 삭제 성공 알림.
- Tasks: 제목 "Tasks"; `panel`/`header`(right = 로컬/Google 칩, status = 동기화 중…)/`chip`/`button`/`iconButton`; 둘째 줄의 `+`·`⋯` → `iconButton`; `[⋯]` 목록 메뉴(버튼 줄) → `menu`(오른쪽 정렬, 목록 이름 바꾸기 / 목록 삭제(danger) / 로그아웃(Google)); 오류 바 → `errorLine`; 할 일 삭제 확인(행 자리)·목록 삭제 확인 → `confirmBox`(danger); 추가 폼 [닫기] → [취소]; 추가·편집·목록 이름 폼에 `onEscape`; 행 도구 → `iconButton`(↑ ↓ ⇥ ⇤, 삭제는 🗑 대신 `✕`), 마우스를 올려도 마감일은 계속 보인다(도구는 마감일 앞에 나타남); 행 py5 → py6.

### G4: 탭 바, `+` 메뉴, 하단 바, README
- `my-tabs` 패널 버튼 이름 Plugins / Sessions / Tasks. 탭 글자 12.8 → 13.
- `my-new-menu`: 영어 → 한국어, 행 마우스 올림 `t.hover`, 글자 13.
- `my-status`(+ `my-status-dash`, `my-usage-dash`): 영어 문구 → 한국어("This computer" → "이 PC" 등), 11.8 → 12. 사용량 막대의 영어(`Today`, `5h`, `left`)는 사용자가 정한 것이라 그대로.
- README: 패널 이름(Plugins/Sessions/Tasks), Files의 ⟳, 바뀐 문구가 README에 인용돼 있으면 맞추기.

## 시험

- `tests/ui-copies.test.mjs`.
- 기존 시험이 문구를 확인하는 곳은 새 문구로(로직 문구를 바꾼 경우만).
- 각 그룹: `node --test tests/*.test.mjs`, 바꾼 mod마다 설치본에 복사(mod.json 먼저) 후 `herdr-app check`.
- 마지막에 브랜치 전체 리뷰.
