import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-status/logic.js", import.meta.url).href);

const KB = 1048576; // KB in a GB
const line = (...f) => ["METRICS", ...f].join("\t");

test("parseMetrics: a full line, with CRLF and other lines around it", () => {
  assert.deepEqual(L.parseMetrics(`noise\r\n${line(13, 10 * KB, 32 * KB, 8)}\r\n`), { cpu: 13, ramUsed: 10, ramTotal: 32, gpu: 8 });
});

test("parseMetrics: missing values stay null", () => {
  assert.deepEqual(L.parseMetrics(line(13, 10 * KB, 32 * KB, "")), { cpu: 13, ramUsed: 10, ramTotal: 32, gpu: null });
  assert.deepEqual(L.parseMetrics(line(13, "", "", "")), { cpu: 13, ramUsed: null, ramTotal: null, gpu: null });
  assert.deepEqual(L.parseMetrics(line("", 1 * KB, 2 * KB, "")), { cpu: null, ramUsed: 1, ramTotal: 2, gpu: null });
});

test("parseMetrics: no CPU and no RAM, or no METRICS line, is a failure", () => {
  assert.equal(L.parseMetrics(line("", "", "", "5")), null);
  assert.equal(L.parseMetrics("something else"), null);
  assert.equal(L.parseMetrics(""), null);
  assert.equal(L.parseMetrics(undefined), null);
});

test("parseMetrics: out-of-range values", () => {
  assert.equal(L.parseMetrics(line(250, 1 * KB, 2 * KB, 300)).cpu, 100);
  assert.equal(L.parseMetrics(line(250, 1 * KB, 2 * KB, 300)).gpu, 100);
  assert.equal(L.parseMetrics(line(-1, 1 * KB, 2 * KB, "x")).cpu, null);
  assert.equal(L.parseMetrics(line(-1, 1 * KB, 2 * KB, "x")).gpu, null);
  assert.equal(L.parseMetrics(line(5, 3 * KB, 2 * KB, "")).ramUsed, null); // used above total
  assert.equal(L.parseMetrics(line(5, 1 * KB, 0, "")).ramUsed, null);
});

test("isHot and ramPercent", () => {
  assert.ok(L.isHot(90));
  assert.ok(!L.isHot(89.9));
  assert.ok(!L.isHot(null));
  assert.equal(L.ramPercent({ ramUsed: 8, ramTotal: 32 }), 25);
  assert.equal(L.ramPercent({ ramUsed: null, ramTotal: null }), null);
});

test("pushHistory: adds percentages, keeps the limit, leaves its input alone", () => {
  const m = { cpu: 10, ramUsed: 8, ramTotal: 32, gpu: null };
  const first = L.emptyHistory();
  const one = L.pushHistory(first, m);
  assert.deepEqual(one, { cpu: [10], ram: [25], gpu: [null] });
  assert.deepEqual(first, { cpu: [], ram: [], gpu: [] });
  assert.deepEqual(L.pushHistory(one, null), { cpu: [10, null], ram: [25, null], gpu: [null, null] });
  let h = L.emptyHistory();
  for (let i = 0; i < 65; i++) h = L.pushHistory(h, { ...m, cpu: i });
  assert.equal(h.cpu.length, 60);
  assert.equal(h.cpu[0], 5);
  assert.equal(h.cpu[59], 64);
  assert.equal(L.pushHistory(one, m, 1).cpu.length, 1);
});

test("failStep: hidden from the third failure in a row, back on success", () => {
  let s = { fails: 0, hidden: false };
  s = L.failStep(s, false); assert.deepEqual(s, { fails: 1, hidden: false });
  s = L.failStep(s, false); assert.deepEqual(s, { fails: 2, hidden: false });
  s = L.failStep(s, false); assert.deepEqual(s, { fails: 3, hidden: true });
  s = L.failStep(s, false); assert.deepEqual(s, { fails: 4, hidden: true });
  s = L.failStep(s, true); assert.deepEqual(s, { fails: 0, hidden: false });
});

test("summaryParts: labels, rounding, hot items, the remote label", () => {
  const m = { cpu: 12.6, ramUsed: 19.74, ramTotal: 31.4, gpu: 90 };
  assert.deepEqual(L.summaryParts(m, false), [
    { label: "CPU", value: "13%", hot: false },
    { label: "RAM", value: "19.7/31.4GB", hot: false },
    { label: "GPU", value: "90%", hot: true },
  ]);
  assert.equal(L.summaryParts(m, true)[0].label, "이 PC");
  assert.equal(L.summaryParts(m, true)[0].value, "");
  assert.equal(L.summaryParts({ ...m, ramUsed: 30 }, false)[1].hot, true);
  assert.deepEqual(L.summaryParts({ cpu: 5, ramUsed: null, ramTotal: null, gpu: null }, false), [{ label: "CPU", value: "5%", hot: false }]);
  assert.deepEqual(L.summaryParts(null, false), []);
  assert.deepEqual(L.summaryParts(null, true), []);
});

test("barHeights: a minimum of 1 for any value, 0 for no value", () => {
  assert.deepEqual(L.barHeights([0, 50, 100, null], 28), [1, 14, 28, 0]);
  assert.deepEqual(L.barHeights([], 28), []);
});

test("dashRows: current values and bars, GPU only when it has been read", () => {
  const m = { cpu: 95, ramUsed: 8, ramTotal: 32, gpu: null };
  const history = { cpu: [95, null], ram: [25, 25], gpu: [null, null] };
  const rows = L.dashRows(m, history, 28);
  assert.deepEqual(rows.map(r => r.key), ["cpu", "ram"]);
  assert.deepEqual(rows[0], {
    key: "cpu", label: "CPU", value: "95%", hot: true,
    bars: [{ h: 27, hot: true }, { h: 0, hot: false }],
  });
  assert.equal(rows[1].value, "8.0 / 32.0 GB");
  assert.equal(L.dashRows({ ...m, gpu: 3 }, { ...history, gpu: [3, 3] }, 28).length, 3);
  assert.equal(L.dashRows({ ...m, gpu: null }, { ...history, gpu: [3, null] }, 28).length, 3); // read earlier
  assert.equal(L.dashRows(null, L.emptyHistory(), 28)[0].value, "—");
});

test("dashHeight grows with the rows", () => {
  assert.ok(L.dashHeight(3) > L.dashHeight(2));
});

test("dashAnchor: right-aligned above the bar, kept on screen, null without a measurement", () => {
  const bounds = { x: 240, y: 900, width: 1000, height: 28 };
  assert.deepEqual(L.dashAnchor(bounds, { width: 300, height: 200 }), { x: 926, y: 694 });
  assert.deepEqual(L.dashAnchor({ x: 0, y: 50, width: 100, height: 28 }, { width: 300, height: 200 }), { x: 8, y: 8 });
  assert.equal(L.dashAnchor(null, { width: 300, height: 200 }), null);
});

test("metricsCommand runs (powershell)", { skip: process.platform !== "win32" }, () => {
  const c = L.metricsCommand();
  assert.equal(c.command, "powershell");
  const r = spawnSync(c.command, c.args, { encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  const m = L.parseMetrics(r.stdout);
  assert.ok(m, r.stdout);
  assert.ok(typeof m.cpu === "number" && m.cpu >= 0 && m.cpu <= 100);
  assert.ok(m.ramTotal > 0 && m.ramUsed > 0 && m.ramUsed <= m.ramTotal);
  assert.ok(m.gpu === null || (m.gpu >= 0 && m.gpu <= 100));
});
