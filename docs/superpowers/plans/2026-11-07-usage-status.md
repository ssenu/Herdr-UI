# 하단 바 사용량 요약 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ccusage` 요약을 하단 바의 시스템 수치 왼쪽에 표시하고, 마우스를 올리면 작은 대시보드를 띄운다.

**Architecture:** 해석과 글 만들기는 순수 함수 파일 `mods/my-status/usage.js`에 둔다. `my-status`가 5분마다 읽어 바에 그리고, 새 mod `my-usage-dash`는 `my-status`가 공유 값에 넣어 주는 내용만 그린다. 기존 `my-status-dash`와 같은 구조다.

**Tech Stack:** Herdr mod API (`gpui-kit`, `gpui-base`, `herdr`), `node --test`, `ccusage@latest`.

## Global Constraints

- 사양: `docs/superpowers/specs/2026-11-07-usage-status-design.md`.
- 실행 명령은 `cmd /c npx -y ccusage@latest ...`. Windows에서 `npx`를 바로 실행하면 ENOENT.
- 읽기 간격 5분, 대시보드는 마우스를 0.3초 올리면 뜬다.
- 시스템 수치 읽기와 독립적이다. 한쪽 실패가 다른 쪽을 숨기지 않는다.
- 사용자에게 보이는 글은 한국어.
- 테스트는 Git Bash에서 `node --test tests/*.test.mjs`.
- 라이브 앱에 mod를 손으로 복사하지 않는다. 설치는 제어자가 `install.ps1`로 한다.

확인한 `ccusage` 출력:

- `daily --json`: `{ "daily": [{ "period": "2026-11-07", "totalCost": 104.3, "modelBreakdowns": [{ "modelName": "claude-opus-5-5", "cost": 90.5 }] }], "totals": {...} }`. 기록이 없으면 `daily: []`, 종료 코드 0.
- `blocks --active --json`: `{ "blocks": [{ "costUSD": 33.07, "startTime": "2026-11-07T07:00:00.000Z", "endTime": "2026-11-07T12:00:00.000Z", "projection": { "totalCost": 95.27, "remainingMinutes": 195 } }] }`. 활성 블록이 없으면 `blocks: []`, 종료 코드 0.
- Claude 폴더가 없으면 종료 코드 1, 표준 출력에 JSON 없음.

---

### Task 1: 해석과 글 만들기 (`usage.js`)

**Files:**
- Create: `mods/my-status/usage.js`, `tests/my-usage-logic.test.mjs`
- Modify: `package.json:7`

**Interfaces:**
- Produces (`mods/my-status/usage.js`):
  - `usageCommands(now)` → `{ daily: { command, args }, blocks: { command, args } }`
  - `parseDaily(stdout)` → `{ days: [{ day, cost, models: [{ name, cost }] }] }` 또는 `null`
  - `parseBlock(stdout)` → `{ cost, start, end, projected }`, `{ none: true }` 또는 `null`
  - `usageSummary(usage, now)` → 문자열 또는 `null`. `usage` = `{ days?, block? }`
  - `usageDash(usage, now, refreshed)` → `{ age, block, week, today, models, month }`
  - `USAGE_BAR` = 막대 영역 높이(px)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/my-usage-logic.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
// Tests the repository copy of the mod (mods/ next to tests/).
const U = await import(new URL("../mods/my-status/usage.js", import.meta.url).href);

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 11, 7);
const day = (d, cost, models = []) => ({ day: d, cost, models });

test("usageCommands: both go through cmd, daily since the month's first day", () => {
  const c = U.usageCommands(NOW);
  assert.deepEqual(c.blocks, { command: "cmd", args: ["/c", "npx", "-y", "ccusage@latest", "blocks", "--active", "--json"] });
  assert.deepEqual(c.daily, { command: "cmd", args: ["/c", "npx", "-y", "ccusage@latest", "daily", "--json", "--since", "20261101"] });
});

test("usageCommands: early in a month, since reaches back six days", () => {
  assert.equal(U.usageCommands(at(2026, 11, 3)).daily.args.at(-1), "20261028");
  assert.equal(U.usageCommands(at(2026, 1, 2)).daily.args.at(-1), "20251227");
});

test("parseDaily: days with their models", () => {
  const out = JSON.stringify({ daily: [{ period: "2026-11-07", totalCost: 104.3, modelBreakdowns: [{ modelName: "claude-opus-5-5", cost: 90.5 }] }], totals: { totalCost: 999 } });
  assert.deepEqual(U.parseDaily(out), { days: [day("2026-11-07", 104.3, [{ name: "claude-opus-5-5", cost: 90.5 }])] });
});

test("parseDaily: no usage is a valid empty list", () => {
  assert.deepEqual(U.parseDaily('{"daily":[],"totals":{}}'), { days: [] });
});

test("parseDaily: anything else is null", () => {
  assert.equal(U.parseDaily("Error: nope"), null);
  assert.equal(U.parseDaily('{"totals":{}}'), null);
  assert.equal(U.parseDaily('{"daily":[{"period":"x"}]}'), null);
  assert.equal(U.parseDaily(undefined), null);
});

test("parseBlock: the active block, with times in ms", () => {
  const out = JSON.stringify({ blocks: [{ costUSD: 33.07, startTime: "2026-11-07T07:00:00.000Z", endTime: "2026-11-07T12:00:00.000Z", projection: { totalCost: 95.27 } }] });
  assert.deepEqual(U.parseBlock(out), { cost: 33.07, start: Date.UTC(2026, 10, 7, 7), end: Date.UTC(2026, 10, 7, 12), projected: 95.27 });
});

test("parseBlock: a block without a projection", () => {
  const out = JSON.stringify({ blocks: [{ costUSD: 1, startTime: "2026-11-07T07:00:00.000Z", endTime: "2026-11-07T12:00:00.000Z" }] });
  assert.equal(U.parseBlock(out).projected, null);
});

test("parseBlock: no active block, and broken output", () => {
  assert.deepEqual(U.parseBlock('{"blocks":[]}'), { none: true });
  assert.equal(U.parseBlock("Error"), null);
  assert.equal(U.parseBlock('{"other":1}'), null);
  assert.equal(U.parseBlock('{"blocks":[{"costUSD":1,"startTime":"bad","endTime":"bad"}]}'), null);
});

const LEFT_2H15 = { cost: 33.2, start: NOW - 3600000, end: NOW + 8100000, projected: 95.27 };

test("usageSummary: today, block and time left", () => {
  assert.equal(U.usageSummary({ days: [day("2026-11-07", 104.3)], block: LEFT_2H15 }, NOW), "오늘 $104 · 블록 $33 · 2h15m 남음");
});

test("usageSummary: no active block or a finished one shows today only", () => {
  const days = [day("2026-11-07", 104.3)];
  assert.equal(U.usageSummary({ days, block: { none: true } }, NOW), "오늘 $104");
  assert.equal(U.usageSummary({ days, block: { ...LEFT_2H15, end: NOW - 1 } }, NOW), "오늘 $104");
});

test("usageSummary: no record today is zero, an unread half is left out", () => {
  assert.equal(U.usageSummary({ days: [day("2026-11-06", 5)], block: { none: true } }, NOW), "오늘 $0");
  assert.equal(U.usageSummary({ block: LEFT_2H15 }, NOW), "블록 $33 · 2h15m 남음");
  assert.equal(U.usageSummary({ block: { none: true } }, NOW), null);
  assert.equal(U.usageSummary({}, NOW), null);
  assert.equal(U.usageSummary(null, NOW), null);
});

test("usageDash: block figures", () => {
  const { block } = U.usageDash({ block: { cost: 33.076, start: NOW - 1000, end: NOW + 3000, projected: 95.27 } }, NOW, NOW);
  assert.deepEqual(block, { cost: "$33.08", projected: "$95", percent: 25, left: "1m 남음" });
});

test("usageDash: no projection, no block, finished block", () => {
  assert.equal(U.usageDash({ block: { ...LEFT_2H15, projected: null } }, NOW, NOW).block.projected, null);
  assert.equal(U.usageDash({ block: { none: true } }, NOW, NOW).block, null);
  assert.equal(U.usageDash({ block: { ...LEFT_2H15, end: NOW - 1 } }, NOW, NOW).block, null);
});

test("usageDash: seven days ending today, gaps at zero, tallest fills the area", () => {
  const { week, today } = U.usageDash({ days: [day("2026-10-31", 50), day("2026-11-01", 100), day("2026-11-07", 1)] }, NOW, NOW);
  assert.deepEqual(week.map(b => b.day), ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  assert.deepEqual(week.map(b => b.h), [U.USAGE_BAR, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(week.map(b => b.today), [false, false, false, false, false, false, true]);
  assert.equal(today, "$1");
});

test("usageDash: unread days give empty bars and dashes", () => {
  const d = U.usageDash({}, NOW, null);
  assert.equal(d.week.length, 7);
  assert.ok(d.week.every(b => b.h === 0));
  assert.equal(d.today, "—");
  assert.equal(d.month, "—");
  assert.equal(d.models, null);
});

test("usageDash: month adds this month's days only", () => {
  const { month } = U.usageDash({ days: [day("2026-10-31", 50), day("2026-11-01", 100.4), day("2026-11-07", 1)] }, NOW, NOW);
  assert.equal(month, "$101");
});

test("usageDash: today's models, biggest first, short names merged", () => {
  const models = [{ name: "claude-haiku-5-5", cost: 0.45 }, { name: "claude-opus-5-5", cost: 90 }, { name: "claude-opus-4-1", cost: 0.59 }, { name: "gpt-5", cost: 13.28 }];
  assert.equal(U.usageDash({ days: [day("2026-11-07", 104, models)] }, NOW, NOW).models, "Opus $90.59 · gpt-5 $13.28 · Haiku $0.45");
  assert.equal(U.usageDash({ days: [day("2026-11-06", 1, models)] }, NOW, NOW).models, null);
});

test("usageDash: how old the figures are", () => {
  const age = ago => U.usageDash({}, NOW, ago === null ? null : NOW - ago).age;
  assert.equal(age(null), "갱신 전");
  assert.equal(age(59000), "방금 갱신");
  assert.equal(age(300000), "5분 전 갱신");
  assert.equal(age(7200000), "2시간 전 갱신");
});

test("time left: hours and minutes, rounded up", () => {
  const left = ms => U.usageSummary({ block: { cost: 1, start: NOW - 1, end: NOW + ms, projected: null } }, NOW);
  assert.equal(left(45 * 60000), "블록 $1 · 45m 남음");
  assert.equal(left(3600000), "블록 $1 · 1h0m 남음");
  assert.equal(left(1000), "블록 $1 · 1m 남음");
});
```

`package.json`의 `test` 명령 끝에 ` tests/my-usage-logic.test.mjs`를 더한다.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/my-usage-logic.test.mjs`
Expected: `usage.js`를 찾지 못해 실패.

- [ ] **Step 3: 구현**

`mods/my-status/usage.js`:

```js
// Pure helpers for the status bar's usage summary. No herdr or gpui imports, so `node --test` can load this file.

export const USAGE_BAR = 28;

const WEEK = 7, MINUTE = 60000, HOUR = 3600000;
const pad = n => String(n).padStart(2, "0");
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysBack = (now, n) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n); };
const finite = v => typeof v === "number" && Number.isFinite(v);
const money = n => `$${n.toFixed(2)}`;
const dollars = n => `$${Math.round(n)}`;

const ccusage = args => ({ command: "cmd", args: ["/c", "npx", "-y", "ccusage@latest", ...args] });

/** The two reads. Daily reaches far enough for both this month's total and the last seven days. */
export function usageCommands(now) {
  const d = new Date(now), first = new Date(d.getFullYear(), d.getMonth(), 1), back = daysBack(now, WEEK - 1);
  const since = dayKey(first < back ? first : back).replaceAll("-", "");
  return { daily: ccusage(["daily", "--json", "--since", since]), blocks: ccusage(["blocks", "--active", "--json"]) };
}

const parse = stdout => { try { return JSON.parse(stdout); } catch { return null; } };

/** `daily --json` → the days, or null when the output isn't what's expected. */
export function parseDaily(stdout) {
  const list = parse(stdout)?.daily;
  if (!Array.isArray(list) || !list.every(r => typeof r?.period === "string" && finite(r.totalCost))) return null;
  return { days: list.map(r => ({
    day: r.period, cost: r.totalCost,
    models: (r.modelBreakdowns ?? []).filter(m => typeof m?.modelName === "string" && finite(m.cost)).map(m => ({ name: m.modelName, cost: m.cost })),
  })) };
}

/** `blocks --active --json` → the block, { none: true } when none is active, or null when the output isn't what's expected. */
export function parseBlock(stdout) {
  const list = parse(stdout)?.blocks;
  if (!Array.isArray(list)) return null;
  if (!list.length) return { none: true };
  const b = list[0], start = Date.parse(b?.startTime), end = Date.parse(b?.endTime);
  if (!finite(b?.costUSD) || !finite(start) || !finite(end)) return null;
  return { cost: b.costUSD, start, end, projected: finite(b.projection?.totalCost) ? b.projection.totalCost : null };
}

const activeBlock = (usage, now) => (finite(usage?.block?.end) && usage.block.end > now ? usage.block : null);

function leftText(ms) {
  const minutes = Math.ceil(ms / MINUTE), h = Math.floor(minutes / 60);
  return h ? `${h}h${minutes % 60}m` : `${minutes}m`;
}

function ageText(ms) {
  if (ms === null) return "갱신 전";
  if (ms < MINUTE) return "방금 갱신";
  return ms < HOUR ? `${Math.floor(ms / MINUTE)}분 전 갱신` : `${Math.floor(ms / HOUR)}시간 전 갱신`;
}

const shortModel = name => {
  const m = /^claude-(opus|sonnet|haiku|fable)/i.exec(name);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : name;
};

const findDay = (days, key) => days?.find(d => d.day === key) ?? null;

/** The status bar's text, or null while nothing worth showing has been read. */
export function usageSummary(usage, now) {
  const parts = [];
  if (usage?.days) parts.push(`오늘 ${dollars(findDay(usage.days, dayKey(new Date(now)))?.cost ?? 0)}`);
  const block = activeBlock(usage, now);
  if (block) parts.push(`블록 ${dollars(block.cost)}`, `${leftText(block.end - now)} 남음`);
  return parts.length ? parts.join(" · ") : null;
}

function modelsText(today) {
  const sums = new Map();
  for (const m of today?.models ?? []) sums.set(shortModel(m.name), (sums.get(shortModel(m.name)) ?? 0) + m.cost);
  if (!sums.size) return null;
  return [...sums].sort((a, b) => b[1] - a[1]).map(([name, cost]) => `${name} ${money(cost)}`).join(" · ");
}

/** Everything my-usage-dash draws. */
export function usageDash(usage, now, refreshed) {
  const key = dayKey(new Date(now)), days = usage?.days ?? null, today = findDay(days, key);
  const costs = Array.from({ length: WEEK }, (_, i) => {
    const day = dayKey(daysBack(now, WEEK - 1 - i));
    return { day, cost: findDay(days, day)?.cost ?? 0, today: day === key };
  });
  const top = Math.max(...costs.map(c => c.cost));
  const week = costs.map(c => ({ day: c.day, today: c.today, h: c.cost > 0 ? Math.max(1, Math.round((c.cost / top) * USAGE_BAR)) : 0 }));
  const b = activeBlock(usage, now);
  const block = b && {
    cost: money(b.cost), projected: b.projected === null ? null : dollars(b.projected),
    percent: Math.min(100, Math.max(0, ((now - b.start) / (b.end - b.start)) * 100)), left: `${leftText(b.end - now)} 남음`,
  };
  const month = days ? dollars(days.filter(d => d.day.startsWith(key.slice(0, 7))).reduce((sum, d) => sum + d.cost, 0)) : "—";
  return { age: ageText(refreshed === null ? null : now - refreshed), block, week, today: days ? dollars(today?.cost ?? 0) : "—", models: modelsText(today), month };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/my-usage-logic.test.mjs`
Expected: 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add mods/my-status/usage.js tests/my-usage-logic.test.mjs package.json
git commit -m "my-status: parse ccusage output and build the usage summary"
```

---

### Task 2: 바 표시, 대시보드, 설치와 문서

**Files:**
- Create: `mods/my-usage-dash/mod.json`, `mods/my-usage-dash/main.js`
- Modify: `mods/my-status/main.js`, `install.ps1:20`, `README.md`

**Interfaces:**
- Consumes: Task 1의 `usageCommands`, `parseDaily`, `parseBlock`, `usageSummary`, `usageDash`, `USAGE_BAR`.
- Produces: 공유 값 `my-usage.dash` = `usageDash`의 결과(대시보드가 열려 있는 동안), 열림 없으면 `null`.

- [ ] **Step 1: 대시보드 mod**

`mods/my-usage-dash/mod.json`:

```json
{ "place": "none" }
```

`mods/my-usage-dash/main.js`:

```js
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
```

- [ ] **Step 2: 바에서 읽고 그리기 (`mods/my-status/main.js`)**

5번 줄 아래에 import를 추가한다:

```js
import { usageCommands, parseDaily, parseBlock, usageSummary, usageDash } from "./usage.js";
```

7번 줄 아래에 상수를 추가한다:

```js
const USAGE_READ_MS = 300000, USAGE_TICK_MS = 60000, USAGE_DASH = { width: 300, height: 230 }, USAGE_KEY = "my-usage.dash";
```

`init`의 `this.dash = null; ...` 줄 아래에 추가:

```js
    this.usage = {}; this.usageReading = false; this.refreshed = null;
    this.usageOverlay = null; this.usageHovered = false; this.usageRipe = false; this.usageSeq = 0; this.usageBox = null;
```

`init`의 `cx.timer.every(READ_MS, cx => this.read(cx));` 줄 아래에 추가:

```js
    this.readUsage(cx);
    cx.timer.every(USAGE_READ_MS, cx => this.readUsage(cx));
    cx.timer.every(USAGE_TICK_MS, cx => { this.syncUsage(); cx.notify(); }); // the time left and the age move on between reads
```

`rows()` 앞에 메서드를 추가한다:

```js
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
      const c = usageCommands(Date.now());
      const daily = await one(c.daily, parseDaily), block = await one(c.blocks, parseBlock);
      if (daily) this.usage = { ...this.usage, days: daily.days };
      if (block) this.usage = { ...this.usage, block };
      if (daily && block) this.refreshed = Date.now();
      this.syncUsage();
      this.usageReading = false;
      cx.notify();
    });
  }

  syncUsage() {
    if (this.usageOverlay) setShared(USAGE_KEY, usageDash(this.usage, Date.now(), this.refreshed));
  }

  openUsage() {
    if (!this.usageHovered || !this.usageRipe || this.usageOverlay || !this.origin || !this.usageBox) return;
    const at = dashAnchor({ x: this.usageBox.x, y: this.origin.y, width: this.usageBox.width }, USAGE_DASH);
    if (!at) return;
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

```

`close()`를 다음으로 바꾼다:

```js
  async close() { this.hovered = false; this.hoverSeq++; this.closeDash(); this.usageHovered = false; this.usageSeq++; this.closeUsage(); }
```

`render()`의 `const parts = ...` 줄 아래에 추가:

```js
    const usage = usageSummary(this.usage, Date.now());
```

바깥 `.on_mouse_move`의 `this.openDash();` 줄 아래에 추가:

```js
        this.openUsage();
```

`.child(div().flex_1())` 줄과 `.when(parts.length > 0, ...` 줄 사이에 추가:

```js
      .when(Boolean(usage), el => el.child(div().id("status-usage").flex_none()
        .on_hover((on, cx) => this.hoverUsage(on, cx))
        .on_mouse_move(e => { if (e.local_position) this.usageBox = { ...this.usageBox, x: e.position.x - e.local_position.x }; })
        .on_size_change(size => { this.usageBox = { ...this.usageBox, width: size.width }; })
        .child(usage)))
```

`usageBox`는 `x`와 `width`가 모두 있어야 쓰므로, `openUsage`의 조건 `!this.usageBox`를 `!this.usageBox?.width || this.usageBox.x === undefined`로 쓴다.

- [ ] **Step 3: 설치 목록**

`install.ps1` 20번 줄의 목록에서 `"my-tabs",` 뒤에 `"my-usage-dash",`를 넣는다. 파일의 UTF-8 BOM을 유지한다(Edit 도구로 고친 뒤 `head -c3 install.ps1 | xxd`로 `efbbbf` 확인).

- [ ] **Step 4: README**

mod 표의 `my-status-dash` 줄 아래에 추가:

```markdown
| `my-usage-dash` | 하단 바 사용량에 마우스를 올리면 뜨는 사용량 대시보드 |
```

`my-status` 줄의 설명 `이 PC의 CPU·RAM·GPU 표시`를 `이 PC의 CPU·RAM·GPU와 ccusage 사용량 표시`로 바꾼다.

제거 안내의 폴더 목록에서 `` `my-tabs`, `` 뒤에 `` `my-usage-dash`, ``를 넣는다.

`## 요구 사항` 바로 앞에 절을 추가:

```markdown
### 사용량 요약 (`my-status`)

- 하단 바의 시스템 수치 왼쪽에 `오늘 $104 · 블록 $33 · 2h15m 남음` 을 보여 줍니다. 활성 블록이 없으면 오늘 비용만 나옵니다. Windows에서만 표시합니다.
- [ccusage](https://github.com/ryoppippi/ccusage)를 앱을 켤 때와 그 뒤 5분마다 실행해 읽습니다. Node.js(`npx`)가 필요합니다.
- 마우스를 올리면 현재 블록의 진행 막대와 예상 비용, 최근 7일 막대그래프, 오늘 모델별 비용, 이번 달 합계가 뜹니다.
- 금액은 API 가격으로 계산한 **추정치**이며 구독 요금과 다릅니다. 일별 값은 ccusage가 찾은 모든 CLI의 합이고, 블록은 Claude Code만 있습니다. 원격 스페이스에서도 **이 PC**의 기록입니다.
- `ccusage@latest`로 실행하므로 실행할 때마다 npm을 확인하고 새 버전이 자동으로 실행됩니다. 출력 형식이 바뀌면 마지막 값이 그대로 남거나, 앱을 새로 켠 뒤에는 표시가 사라질 수 있습니다.

```

- [ ] **Step 5: 확인**

Run: `node --test tests/*.test.mjs`
Expected: 전부 통과.

Run: `node --check mods/my-status/main.js` 는 `gpui-kit` import를 풀지 않으므로 문법만 본다. `.js` ESM으로 인식되지 않으면 `node --input-type=module --check < mods/my-usage-dash/main.js`를 쓴다. 앱에 설치하지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add mods/my-usage-dash mods/my-status/main.js install.ps1 README.md
git commit -m "my-status: usage summary in the status bar with a hover dashboard"
```
