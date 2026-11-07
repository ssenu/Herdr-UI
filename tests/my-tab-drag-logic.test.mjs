import test from "node:test";
import assert from "node:assert/strict";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-tab-drag/logic.js", import.meta.url).href);

const panes = [
  { pane: "p1", tab: "active", terminal: "t1" },
  { pane: "p2", tab: "term", terminal: "t2" },
  { pane: "p3", tab: "two", terminal: "t3" },
  { pane: "p4", tab: "two", terminal: "t4" },
  { pane: "p5", tab: "viewer", terminal: null, mod: "my-viewer" },
  { pane: "p6", tab: "picker", terminal: null, mod: "my-viewer" },
  { pane: "p7", tab: "other", terminal: null, mod: "something" },
  { pane: "p8", tab: "remote", terminal: "box/t9" },
];
const own = { a: { tab: "viewer", path: "C:\\a.txt", on: null }, b: { tab: "picker", path: null, on: null } };
const move = (id, extra = {}) => L.tabMove(id, { activeTab: "active", panes, machine: null, own, ...extra });

test("tabMove: a one-pane terminal moves as itself", () => {
  assert.deepEqual(move("term"), { kind: "terminal", terminal: "t2" });
});

test("tabMove: a viewer with a file moves by its path", () => {
  assert.deepEqual(move("viewer"), { kind: "viewer", path: "C:\\a.txt", on: null });
});

test("tabMove: everything else says why not", () => {
  assert.deepEqual(move("active"), { blocked: "지금 보고 있는 탭은 옮길 수 없어요" });
  assert.deepEqual(move("two"), { blocked: "여러 칸으로 나뉜 탭은 옮길 수 없어요" });
  assert.deepEqual(move("remote"), { blocked: "원격 탭은 옮길 수 없어요" });
  assert.deepEqual(move("term", { machine: "box" }), { blocked: "원격 탭은 옮길 수 없어요" });
  assert.deepEqual(move("picker"), { blocked: "이 탭은 옮길 수 없어요" });
  assert.deepEqual(move("other"), { blocked: "이 탭은 옮길 수 없어요" });
  assert.deepEqual(move("gone"), { blocked: "이 탭은 옮길 수 없어요" });
  assert.deepEqual(move("viewer", { own: null }), { blocked: "이 탭은 옮길 수 없어요" });
});

test("tabMove: an agent with sub-agents stays, its child and a plain terminal move", () => {
  assert.deepEqual(move("term", { parents: ["t2"] }), { blocked: "하위 에이전트가 있는 탭은 옮길 수 없어요" });
  assert.deepEqual(move("term"), { kind: "terminal", terminal: "t2" });
  assert.deepEqual(move("term", { parents: ["t1"] }), { kind: "terminal", terminal: "t2" });
  assert.deepEqual(move("term", { parents: ["t1", "t2"], machine: "box" }), { blocked: "원격 탭은 옮길 수 없어요" });
});

const bar = { x: 274, y: 0, width: 2286, height: 42 };

test("workArea: below the bar, above the status bar, beside the open panel", () => {
  assert.deepEqual(L.workArea({ bar, window: { width: 2560, height: 1440 }, panelWidth: 368, statusHeight: 28 }), { x: 282, y: 50, width: 1894, height: 1354 });
  assert.deepEqual(L.workArea({ bar, window: { width: 2560, height: 1440 }, panelWidth: 0, statusHeight: 28 }), { x: 282, y: 50, width: 2270, height: 1354 });
  assert.equal(L.workArea({ bar: null, window: { width: 1, height: 1 }, panelWidth: 0, statusHeight: 0 }), null);
  assert.equal(L.workArea({ bar, window: null, panelWidth: 0, statusHeight: 0 }), null);
  assert.equal(L.workArea({ bar, window: { width: 100, height: 100 }, panelWidth: 0, statusHeight: 0 }), null); // no room
});

const area = { x: 100, y: 100, width: 1000, height: 400 };

test("dropZone: the outer quarter of each side, the nearest edge in a corner", () => {
  assert.equal(L.dropZone({ x: 150, y: 300 }, area), "left");
  assert.equal(L.dropZone({ x: 1050, y: 300 }, area), "right");
  assert.equal(L.dropZone({ x: 600, y: 120 }, area), "up");
  assert.equal(L.dropZone({ x: 600, y: 480 }, area), "down");
  assert.equal(L.dropZone({ x: 110, y: 190 }, area), "left"); // 1% from the left, 22.5% from the top
  assert.equal(L.dropZone({ x: 340, y: 105 }, area), "up"); // 24% from the left, 1.25% from the top
});

test("dropZone: the middle and outside cancel", () => {
  assert.equal(L.dropZone({ x: 600, y: 300 }, area), null);
  assert.equal(L.dropZone({ x: 350, y: 300 }, area), null); // exactly 25% in
  assert.equal(L.dropZone({ x: 99, y: 300 }, area), null);
  assert.equal(L.dropZone({ x: 600, y: 501 }, area), null);
  assert.equal(L.dropZone(null, area), null);
  assert.equal(L.dropZone({ x: 600, y: 300 }, null), null);
});

test("previewBox: the half that the moved tab takes", () => {
  assert.deepEqual(L.previewBox("left", area), { x: 100, y: 100, width: 500, height: 400 });
  assert.deepEqual(L.previewBox("right", area), { x: 600, y: 100, width: 500, height: 400 });
  assert.deepEqual(L.previewBox("up", area), { x: 100, y: 100, width: 1000, height: 200 });
  assert.deepEqual(L.previewBox("down", area), { x: 100, y: 300, width: 1000, height: 200 });
});

test("placement: left and up are a split followed by a swap", () => {
  assert.deepEqual(L.placement("right"), { place: "right", swap: null });
  assert.deepEqual(L.placement("down"), { place: "down", swap: null });
  assert.deepEqual(L.placement("left"), { place: "right", swap: "left" });
  assert.deepEqual(L.placement("up"), { place: "down", swap: "up" });
});

test("dropLabel: the direction, cancelling, or why not", () => {
  const ok = { kind: "terminal", terminal: "t" };
  assert.equal(L.dropLabel("left", ok), "놓으면 왼쪽으로 분할");
  assert.equal(L.dropLabel("right", ok), "놓으면 오른쪽으로 분할");
  assert.equal(L.dropLabel("up", ok), "놓으면 위쪽으로 분할");
  assert.equal(L.dropLabel("down", ok), "놓으면 아래쪽으로 분할");
  assert.equal(L.dropLabel(null, ok), "놓으면 취소");
  assert.equal(L.dropLabel("left", { blocked: "안 돼요" }), "안 돼요");
});
