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
