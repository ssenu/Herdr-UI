# 탭 바에 분할 칸 칩 남기기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 탭을 끌어 분할한 뒤에도 그 칸이 탭 바에 칩으로 남고, 칩에서 포커스, 탭으로 빼기, 닫기를 할 수 있다.

**Architecture:** `my-tab-drag`가 옮긴 칸을 공유 값 `my-tabs.split`에 칸 ID로 기록하고, `my-tabs`가 `panes()`와 맞춰 칩을 그린다. 판단은 순수 함수(`logic.js`), 명령 실행은 `main.js`에 둔다.

**Tech Stack:** Herdr mod API (`gpui-kit`, `gpui-base`, `herdr`), `node --test`.

## Global Constraints

- 사양: `docs/superpowers/specs/2026-11-07-tab-split-design.md`의 "탭 바의 칩" 절.
- 터미널에 `pane.close`를 쓰지 않는다. 실행 중인 프로세스를 확인 없이 닫는다.
- mod는 자기 폴더 밖을 import할 수 없다. `viewer-open.js`는 복사본을 두고 테스트로 같은지 확인한다.
- 사용자에게 보이는 글은 한국어.
- 테스트는 Git Bash에서 `node --test tests/*.test.mjs`.
- 라이브 앱에 mod를 손으로 복사하지 않는다.

---

### Task 1: 칩 기록과 표시, 탭으로 빼기

**Files:**
- Create: `mods/my-tabs/logic.js`, `mods/my-tabs/split.svg`, `mods/my-tabs/detach.svg`, `mods/my-tabs/viewer-open.js` (`mods/my-viewer/viewer-open.js`의 복사본), `tests/my-tabs-logic.test.mjs`
- Modify: `mods/my-tab-drag/logic.js`, `mods/my-tab-drag/main.js`, `mods/my-tabs/main.js`, `tests/my-tab-drag-logic.test.mjs`, `tests/my-viewer-logic.test.mjs:12`, `package.json:7`, `README.md`

**Interfaces:**
- Produces: 공유 값 `my-tabs.split` = `{ [paneId]: { name, kind: "terminal" | "viewer", path?, on? } }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/my-tabs-logic.test.mjs` 새 파일:

```js
import test from "node:test";
import assert from "node:assert/strict";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-tabs/logic.js", import.meta.url).href);

const panes = [
  { pane: "p1", tab: "a", terminal: "t1", status: "done", focused: false, program: { name: "shell" } },
  { pane: "p2", tab: "a", terminal: "t2", status: "working", focused: true, program: { name: "Claude" } },
  { pane: "p3", tab: "a", terminal: null, mod: "my-viewer", status: null, focused: false },
  { pane: "p4", tab: "b", terminal: "t4", status: null, focused: false },
];
const split = { p2: { name: "에이전트", kind: "terminal" }, p3: { name: "a.txt", kind: "viewer", path: "C:\\a.txt", on: null }, p4: { name: "혼자", kind: "terminal" } };

test("chipsFor: only recorded panes in this tab, carrying what the bar shows", () => {
  assert.deepEqual(L.chipsFor("a", panes, split), [
    { pane: "p2", terminal: "t2", status: "working", focused: true, name: "에이전트", kind: "terminal" },
    { pane: "p3", terminal: null, status: null, focused: false, name: "a.txt", kind: "viewer", path: "C:\\a.txt", on: null },
  ]);
});

test("chipsFor: a recorded pane alone in its tab is that tab", () => {
  assert.deepEqual(L.chipsFor("b", panes, split), []);
});

test("chipsFor: when every pane is recorded, the first stands for the tab", () => {
  const all = { ...split, p1: { name: "하나", kind: "terminal" } };
  assert.deepEqual(L.chipsFor("a", panes, all).map(c => c.pane), ["p2", "p3"]);
});

test("chipsFor: no record, no chips", () => {
  assert.deepEqual(L.chipsFor("a", panes, undefined), []);
});

test("hostPanes: the tab's panes without its chips", () => {
  assert.deepEqual(L.hostPanes("a", panes, L.chipsFor("a", panes, split)).map(p => p.pane), ["p1"]);
});

test("hostStatus: the most urgent one", () => {
  assert.equal(L.hostStatus([{ status: "done" }, { status: "blocked" }, { status: "working" }]), "blocked");
  assert.equal(L.hostStatus([{ status: "done" }, { status: "working" }]), "working");
  assert.equal(L.hostStatus([{ status: "done" }, { status: null }]), "done");
  assert.equal(L.hostStatus([{ status: null }]), null);
});

test("dropSplit: removes the pane and any that are gone", () => {
  const live = [{ pane: "p1" }, { pane: "p2" }];
  assert.deepEqual(L.dropSplit({ p1: { name: "x" }, p2: { name: "y" }, gone: { name: "z" } }, live, "p2"), { p1: { name: "x" } });
  assert.deepEqual(L.dropSplit(undefined, live, "p2"), {});
});
```

`tests/my-tab-drag-logic.test.mjs` 끝에 추가:

```js
test("addSplit: adds the pane and forgets panes that are gone", () => {
  const live = [{ pane: "p1" }, { pane: "p2" }];
  assert.deepEqual(L.addSplit({ p1: { name: "x" }, gone: { name: "z" } }, live, "p2", { name: "y", kind: "terminal" }), { p1: { name: "x" }, p2: { name: "y", kind: "terminal" } });
  assert.deepEqual(L.addSplit(undefined, live, "p2", { name: "y", kind: "terminal" }), { p2: { name: "y", kind: "terminal" } });
});

test("plainName: drops the unsaved mark", () => {
  assert.equal(L.plainName("● a.txt"), "a.txt");
  assert.equal(L.plainName("a.txt"), "a.txt");
  assert.equal(L.plainName(null), "");
});
```

`tests/my-viewer-logic.test.mjs` 12번 줄 뒤에 추가:

```js
  assert.equal(readFileSync(file("my-tabs/viewer-open.js"), "utf8"), open);
```

`package.json`의 `test` 명령 끝에 ` tests/my-tabs-logic.test.mjs`를 더한다.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/my-tabs-logic.test.mjs tests/my-tab-drag-logic.test.mjs tests/my-viewer-logic.test.mjs`
Expected: `my-tabs/logic.js`를 못 찾아 실패, `L.addSplit is not a function`, 복사본 없음 실패.

- [ ] **Step 3: 순수 함수 구현**

`mods/my-tabs/logic.js` 새 파일:

```js
// Pure helpers for my-tabs. No herdr or gpui imports, so `node --test` can load this file.

export const SPLIT_KEY = "my-tabs.split";

/** Panes moved here by dragging a tab, in pane order. Alone in its tab, a moved pane is that tab; if every pane was moved, the first stands for the tab. */
export function chipsFor(tabId, panes, split) {
  const list = panes.filter(p => p.tab === tabId), moved = list.filter(p => split?.[p.pane]);
  return (moved.length === list.length ? moved.slice(1) : moved)
    .map(p => ({ pane: p.pane, terminal: p.terminal, status: p.status, focused: p.focused, ...split[p.pane] }));
}

/** The tab's own panes: those without a chip. */
export function hostPanes(tabId, panes, chips) {
  const taken = new Set(chips.map(c => c.pane));
  return panes.filter(p => p.tab === tabId && !taken.has(p.pane));
}

const RANK = ["blocked", "working", "done"];

/** The most urgent status among these panes. */
export function hostStatus(panes) {
  return RANK.find(s => panes.some(p => p.status === s)) ?? null;
}

/** The record without this pane, and without panes that no longer exist. */
export function dropSplit(split, panes, pane) {
  const live = new Set(panes.map(p => p.pane));
  return Object.fromEntries(Object.entries(split ?? {}).filter(([id]) => id !== pane && live.has(id)));
}
```

`mods/my-tab-drag/logic.js` 끝에 추가:

```js

export const SPLIT_KEY = "my-tabs.split";

/** The record with this pane added, without panes that no longer exist. */
export function addSplit(split, panes, pane, entry) {
  const live = new Set(panes.map(p => p.pane));
  return { ...Object.fromEntries(Object.entries(split ?? {}).filter(([id]) => live.has(id))), [pane]: entry };
}

/** A tab's name without the viewer's unsaved mark. */
export function plainName(name) {
  return String(name ?? "").replace(/^● /, "");
}
```

복사: `cp mods/my-viewer/viewer-open.js mods/my-tabs/viewer-open.js`

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/my-tabs-logic.test.mjs tests/my-tab-drag-logic.test.mjs tests/my-viewer-logic.test.mjs`
Expected: 모두 통과.

- [ ] **Step 5: 옮긴 칸 기록 (`mods/my-tab-drag/main.js`)**

7번 줄의 import를 바꾸고 6번 줄에 `setShared`를 더한다:

```js
import { props, closeOverlay, run, theme, notify, shared, setShared, spaces, panes, layout, focused, terminals } from "herdr";
import { tabMove, workArea, dropZone, previewBox, placement, dropLabel, addSplit, plainName, SPLIT_KEY } from "./logic.js";
```

`dismiss()` 앞에 메서드를 추가한다:

```js
  // Remembered before any swap: the tab bar keeps a chip for this pane. A pane's id survives a swap.
  remember(pane, entry) {
    setShared(SPLIT_KEY, addSplit(shared(SPLIT_KEY), panes(), pane, { name: plainName(props()?.tab?.name), ...entry }));
  }

```

`moveTerminal`의 `if (swap) { run("pane.focus", { terminal }); ...` 줄 바로 앞에 추가:

```js
    this.remember(shown().pane, { kind: "terminal" });
```

`moveViewer`의 `if (swap) { run("pane.focus", { pane: fresh().pane }); ...` 줄 바로 앞에 추가:

```js
    this.remember(fresh().pane, { kind: "viewer", path, on });
```

- [ ] **Step 6: 아이콘 추가**

`mods/my-tabs/split.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M8 3v10"/></svg>
```

`mods/my-tabs/detach.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M7 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 2.5h4v4M13.5 2.5 8 8"/></svg>
```

- [ ] **Step 7: 칩 그리기 (`mods/my-tabs/main.js`)**

3번 줄을 바꾸고 그 아래에 import와 상수를 추가한다:

```js
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings, notify } from "herdr";
import { chipsFor, hostPanes, hostStatus, dropSplit, SPLIT_KEY } from "./logic.js";
import { tabArgs, newToken } from "./viewer-open.js";

const WAIT_MS = 2000, POLL_MS = 100, DRAFT_MS = 800; // a closed viewer writes its last draft in its final call, which the host caps at 250 ms
```

`find` 함수 뒤, 클래스 앞에 추가:

```js

async function until(cx, test) {
  for (let t = 0; t < WAIT_MS; t += POLL_MS) {
    if (test()) return true;
    await cx.sleep(POLL_MS);
  }
  return test();
}
```

`init`에 `this.busy = new Set();`를 더한다.

`measure()` 앞에 메서드를 추가한다:

```js
  // Back to its own tab, same process. Parked but not placed is recovered as a tab, so it is never orphaned.
  async toTab(chip, cx) {
    const { terminal } = chip, shown = () => panes().find(p => p.terminal === terminal);
    run("terminal.park", { terminal });
    try {
      if (!await until(cx, () => !shown())) throw new Error("터미널을 칸에서 떼지 못했어요");
      run("terminal.keep", { terminal, place: "tab" });
      if (!await until(cx, () => Boolean(shown()))) throw new Error("터미널이 새 탭에 나타나지 않았어요");
    } catch (e) {
      if (!shown()) { try { run("terminal.keep", { terminal, place: "tab" }); } catch { /* best effort */ } }
      throw e;
    }
    const tab = shown().tab;
    run("tab.rename", { id: tab, name: chip.name });
    return tab;
  }

  // A viewer closes and reopens as a tab; its unsaved text comes back from the draft.
  async viewerToTab(chip, cx, space) {
    run("pane.close", { pane: chip.pane });
    if (!await until(cx, () => !panes().some(p => p.pane === chip.pane))) throw new Error("칸을 닫지 못했어요");
    await cx.sleep(DRAFT_MS);
    run("tab.new", tabArgs({ path: chip.path, on: chip.on ?? null, root: null, space }, newToken(Date.now(), Math.random())));
  }

  // close: a terminal goes through its own tab so closing asks like any other tab. pane.close would kill it without asking.
  chipAction(chip, close, space, cx) {
    if (this.busy.has(chip.pane)) return;
    this.busy.add(chip.pane);
    cx.spawn(async cx => {
      try {
        if (chip.kind === "viewer") {
          if (close) run("pane.close", { pane: chip.pane });
          else await this.viewerToTab(chip, cx, space);
        } else {
          const tab = await this.toTab(chip, cx);
          if (close) run("tab.close", { id: tab });
        }
        setShared(SPLIT_KEY, dropSplit(shared(SPLIT_KEY), panes(), chip.pane));
      } catch (e) {
        const where = chip.kind === "viewer" ? `파일 ${chip.path}` : `터미널 ${chip.terminal} (hc ls 로 찾을 수 있어요)`;
        notify({ title: "칸을 옮기지 못했어요", body: `${e}\n${where}`, level: "error", timeout: 5000 });
      } finally { this.busy.delete(chip.pane); cx.notify(); }
    });
  }

```

`item`을 다음으로 바꾼다. 달라진 곳은 `split`/`chips`/`own`/`lit`/`status`와 칩을 덧붙이는 반환값이다:

```js
    const split = shared(SPLIT_KEY), all = panes();
    const chipEl = chip => {
      const icon = (id, file, close) => div().id(`${id}-${chip.pane}`).flex_none().text_color(t.dim).hover(s => s.text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); this.chipAction(chip, close, space.id, cx); }).child(svg(file).size(12));
      return h_flex().id(`chip-${chip.pane}`).h(29).px(8).gap(6).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(chip.focused ? t.border : t.chrome).bg(chip.focused ? t.raised : t.chrome).text_color(chip.focused ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => run("pane.focus", { pane: chip.pane }))
        .child(svg("mods/my-tabs/split.svg").size(12).flex_none().text_color(t.dim))
        .child(div().max_w(170).truncate().child(chip.name))
        .when(chip.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(chip.status === "blocked" || chip.status === "done", el => el.child(div().size(6).rounded(3).bg(t[chip.status])))
        .when(chip.focused, el => el.child(icon("chip-out", "mods/my-tabs/detach.svg", false)).child(icon("chip-close", "mods/pane/close.svg", true)));
    };
    const item = (c, i) => {
      const chips = chipsFor(c.id, all, split), own = chips.length ? hostPanes(c.id, all, chips) : all.filter(p => p.tab === c.id);
      const program = own.find(p => p.program?.agent)?.program ?? own[0]?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      const lit = c.active && !chips.some(x => x.focused), status = chips.length ? hostStatus(own) : c.status;
      const tab = h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(lit ? t.border : t.chrome).bg(lit ? t.raised : t.chrome).text_color(lit ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          if (e.click_count === 2) { this.pressed = null; this.pressedTab = null; run("tab.rename", { id: c.id }); }
          else { this.pressed = i; this.pressedTab = { id: c.id, name }; }
        })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null; this.pressedTab = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else if (chips.length) run("pane.focus", { pane: own[0]?.pane ?? chips[0].pane });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(status === "blocked" || status === "done", el => el.child(div().size(6).rounded(3).bg(t[status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
      return [tab, ...chips.map(chipEl)];
    };
```

`tab-scroll`의 `.children(shown.map(item))`을 `.children(shown.flatMap(item))`으로 바꾼다.

- [ ] **Step 8: README**

`### 탭을 끌어 분할하기` 절의 마지막 항목 뒤에 추가:

```markdown
- 옮긴 칸은 탭 바에 **칩**으로 남습니다. 칩은 그 칸이 있는 탭 바로 뒤에 놓입니다. 누르면 그 칸으로 가고, 포커스된 칩의 버튼으로 **다시 독립 탭으로 빼거나** 닫을 수 있습니다. 터미널과 에이전트는 빼도 프로세스가 그대로입니다. 닫을 때는 일반 탭을 닫을 때와 같은 경로를 거칩니다.
```

알려진 한계 문단에서 `분할을 다시 탭으로 빼는 기능은 없습니다. `를 지우고, 그 자리에 다음을 넣는다:

```markdown
같은 터미널을 탭과 분할 칸에 동시에 띄울 수는 없어서, 탭 대신 칩이 남습니다. 칩은 끌 수 없고 우클릭 메뉴가 없으며, 탭으로 빼면 탭 바 끝에 생깁니다. 탭의 `×` 는 칩의 칸까지 탭 전체를 닫습니다. 
```

- [ ] **Step 9: 전체 테스트와 로드 확인**

Run: `node --test tests/*.test.mjs`
Expected: 전부 통과.

Run: `git status --short` 로 의도한 파일만 바뀌었는지 확인. 앱에 설치하지 않는다(제어자가 한다).

- [ ] **Step 10: 커밋**

```bash
git add mods/my-tabs mods/my-tab-drag tests package.json README.md
git commit -m "my-tabs: keep a chip in the tab bar for each pane moved by dragging a tab"
```
