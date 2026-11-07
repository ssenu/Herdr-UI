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
  assert.equal(U.usageSummary({ days: [day("2026-11-07", 104.3)], block: LEFT_2H15 }, NOW), "Today $104 · 5h $33 · 2h15m left");
});

test("usageSummary: no active block or a finished one shows today only", () => {
  const days = [day("2026-11-07", 104.3)];
  assert.equal(U.usageSummary({ days, block: { none: true } }, NOW), "Today $104");
  assert.equal(U.usageSummary({ days, block: { ...LEFT_2H15, end: NOW - 1 } }, NOW), "Today $104");
});

test("usageSummary: no record today is zero, an unread half is left out", () => {
  assert.equal(U.usageSummary({ days: [day("2026-11-06", 5)], block: { none: true } }, NOW), "Today $0");
  assert.equal(U.usageSummary({ block: LEFT_2H15 }, NOW), "5h $33 · 2h15m left");
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
  const old = [{ name: "claude-3-5-sonnet-20241022", cost: 2 }, { name: "claude-3-haiku-20240307", cost: 1 }];
  assert.equal(U.usageDash({ days: [day("2026-11-07", 3, old)] }, NOW, NOW).models, "Sonnet $2.00 · Haiku $1.00");
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
  assert.equal(left(45 * 60000), "5h $1 · 45m left");
  assert.equal(left(3600000), "5h $1 · 1h0m left");
  assert.equal(left(1000), "5h $1 · 1m left");
});
