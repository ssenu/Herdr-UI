import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// Tests the repository copy of the mods (mods/ next to tests/).
const file = p => new URL(`../mods/${p}`, import.meta.url);
const O = await import(file("my-viewer/viewer-open.js").href);
const L = await import(file("my-viewer/logic.js").href);

test("copies stay identical: mods cannot import outside their own folder", () => {
  const open = readFileSync(file("my-viewer/viewer-open.js"), "utf8");
  assert.equal(readFileSync(file("my-files-drag/viewer-open.js"), "utf8"), open);
  assert.equal(readFileSync(file("my-new-menu/viewer-open.js"), "utf8"), open);
  assert.equal(readFileSync(file("my-viewer/files-logic.js"), "utf8"), readFileSync(file("my-files/logic.js"), "utf8"));
});

const panel = { x: 900, y: 40, width: 300, height: 700 };
const tabs = { x: 240, y: 0, width: 960, height: 40 };

test("dropAction: panel cancels, tab bar opens, elsewhere pastes", () => {
  const at = (x, y, dir = false, t = tabs) => O.dropAction({ position: { x, y }, panel, tabs: t, dir });
  assert.equal(at(1000, 300), "cancel");
  assert.equal(at(500, 20), "open");
  assert.equal(at(500, 20, true), "folder");
  assert.equal(at(500, 300), "paste");
  assert.equal(at(500, 300, true), "paste");
  assert.equal(at(100, 20), "paste"); // beside the tab bar: the sidebar
  assert.equal(at(240, 0), "open"); // edges count
  assert.equal(at(1200, 40), "cancel"); // the panel wins where they touch
});

test("dropAction: no position cancels; no measured bar falls back to the top 40 px", () => {
  assert.equal(O.dropAction({ position: null, panel, tabs, dir: false }), "cancel");
  assert.equal(O.dropAction({ position: { x: 100, y: 20 }, panel: null, tabs: null, dir: false }), "open");
  assert.equal(O.dropAction({ position: { x: 100, y: 41 }, panel: null, tabs: undefined, dir: false }), "paste");
});

test("normKey and openKey: Windows drive paths ignore case and slash style", () => {
  assert.equal(O.normKey("C:\\My\\A.txt"), "c:/my/a.txt");
  assert.equal(O.normKey("/home/Me/A.txt"), "/home/Me/A.txt");
  assert.equal(O.openKey(null, "C:\\My\\A.txt"), O.openKey(undefined, "c:/my/a.txt"));
  assert.notEqual(O.openKey("box", "/a"), O.openKey(null, "/a"));
});

const spaces = [
  { id: "s1", active: true, tabs: [{ id: "t1", name: "a" }, { id: "t2", name: "b" }] },
  { id: "s2", active: false, tabs: [{ id: "t3", name: "c" }] },
];

test("liveTab finds a tab that still exists, in any space", () => {
  const open = { k1: "t3", k2: "gone" };
  assert.deepEqual(O.liveTab(open, "k1", spaces), { space: "s2", tab: "t3" });
  assert.equal(O.liveTab(open, "k2", spaces), null);
  assert.equal(O.liveTab(open, "k3", spaces), null);
  assert.equal(O.liveTab(null, "k1", spaces), null);
});

test("newToken and tabArgs: a unique temporary name the viewer can find its tab by", () => {
  const token = O.newToken(1700000000000, 0.5);
  assert.match(token, /^[a-z0-9]+$/);
  assert.notEqual(token, O.newToken(1700000000000, 0.25));
  const args = O.tabArgs({ path: "C:\\a\\b.txt", on: null, root: null, space: "s1" }, "tok");
  assert.equal(args.mod, "my-viewer");
  assert.equal(args.space, "s1");
  assert.ok(args.name.includes("tok"));
  assert.deepEqual(args.props, { path: "C:\\a\\b.txt", on: null, root: null, token: "tok", tabName: args.name });
});

test("openCommands: a new tab, or the tab already showing the file", () => {
  const where = { path: "C:\\a\\b.txt", on: null, root: null, space: "s1" };
  const [[name, args]] = O.openCommands(where, {}, spaces, "tok");
  assert.equal(name, "tab.new");
  assert.equal(args.props.token, "tok");
  const key = O.openKey(null, where.path);
  assert.deepEqual(O.openCommands(where, { [key]: "t2" }, spaces, "tok"), [["tab.select", { id: "t2" }]]);
  assert.deepEqual(O.openCommands(where, { [key]: "t3" }, spaces, "tok"), [["space.select", { id: "s2" }], ["tab.select", { id: "t3" }]]);
  assert.equal(O.openCommands(where, { [key]: "gone" }, spaces, "tok")[0][0], "tab.new");
});

test("viewKind: known binary extensions, NUL bytes, markdown, plain text", () => {
  assert.equal(L.viewKind("a.js", "x"), "text");
  assert.equal(L.viewKind("noext", "x"), "text");
  assert.equal(L.viewKind("a.md", "x"), "markdown");
  assert.equal(L.viewKind("A.MARKDOWN", "x"), "markdown");
  assert.equal(L.viewKind("a.PNG", null), "binary");
  assert.equal(L.viewKind("a.pdf", null), "binary");
  assert.equal(L.viewKind("a.zip", "x"), "binary");
  assert.equal(L.viewKind("a.txt", "x\0y"), "binary");
  assert.equal(L.viewKind("a.txt", null), "text");
});

test("textHash and draftName: stable, distinct, safe as a file name", () => {
  assert.equal(L.textHash("abc"), L.textHash("abc"));
  assert.notEqual(L.textHash("abc"), L.textHash("abd"));
  assert.match(L.textHash("한글 text"), /^[0-9a-f]{16}$/);
  assert.equal(L.draftName("C:\\My\\A.txt"), L.draftName("c:/my/a.txt"));
  assert.notEqual(L.draftName("/a/b"), L.draftName("/a/c"));
  assert.match(L.draftName("C:\\바탕 화면\\a&b.txt"), /^[0-9a-f]{16}$/);
});

test("parseDraft: only a complete draft counts", () => {
  assert.deepEqual(L.parseDraft('{"path":"/a","text":"t","base":"h"}'), { path: "/a", text: "t", base: "h" });
  assert.equal(L.parseDraft(null), null);
  assert.equal(L.parseDraft("not json"), null);
  assert.equal(L.parseDraft('{"path":"/a"}'), null);
  assert.equal(L.parseDraft('{"path":"/a","text":1,"base":"h"}'), null);
  assert.equal(L.parseDraft("[]"), null);
});

test("restoreState: no draft, same disk, changed disk, stale or foreign draft", () => {
  const draft = (text, base, path = "/a") => ({ path, text, base });
  assert.deepEqual(L.restoreState(null, "/a", "disk"), { text: "disk", dirty: false, conflict: false, discard: false });
  assert.deepEqual(L.restoreState(draft("mine", L.textHash("disk")), "/a", "disk"), { text: "mine", dirty: true, conflict: false, discard: false });
  assert.deepEqual(L.restoreState(draft("mine", L.textHash("old")), "/a", "disk"), { text: "mine", dirty: true, conflict: true, discard: false });
  // Already the same text, line endings aside: nothing to restore.
  assert.deepEqual(L.restoreState(draft("a\nb", L.textHash("x")), "/a", "a\r\nb"), { text: "a\r\nb", dirty: false, conflict: false, discard: true });
  // A hash collision of names must not load another file's draft.
  assert.deepEqual(L.restoreState(draft("mine", "h", "/other"), "/a", "disk"), { text: "disk", dirty: false, conflict: false, discard: false });
  // The file is gone but the draft isn't.
  assert.deepEqual(L.restoreState(draft("mine", "h"), "/a", null), { text: "mine", dirty: true, conflict: true, discard: false });
  assert.deepEqual(L.restoreState(draft("mine", "h", "C:/A"), "c:\\a", null).text, "mine");
});

test("where.js copies stay identical", () => {
  const where = readFileSync(file("my-files/where.js"), "utf8");
  for (const m of ["my-github", "my-plugins", "my-sessions", "my-new-menu"]) assert.equal(readFileSync(file(`${m}/where.js`), "utf8"), where, m);
});

test("followedCwd: a viewer tab keeps the space's last terminal folder", async () => {
  const { followedCwd } = await import(file("my-files/where.js").href);
  const space = { id: "s1", folder: "C:\\Users\\me", tabs: [{ id: "t1" }, { id: "t2" }] };
  const panes = [
    { pane: "p1", tab: "t1", cwd: "C:\\repo" },
    { pane: "p2", tab: "t2", mod: "my-viewer", cwd: null },
    { pane: "p3", tab: "t9", cwd: "C:\\other-space" },
  ];
  const memory = new Map();
  assert.equal(followedCwd(memory, space, { pane: "p1", cwd: "C:\\repo" }, panes), "C:\\repo");
  assert.equal(followedCwd(memory, space, { pane: "p2", cwd: "C:\\Users\\me" }, panes), "C:\\repo"); // remembered
  // Nothing remembered: a terminal of this space, not of another one.
  assert.equal(followedCwd(new Map(), space, { pane: "p2", cwd: null }, panes), "C:\\repo");
  assert.equal(followedCwd(new Map(), space, { pane: "p2", cwd: null }, panes.slice(1)), "C:\\Users\\me");
  // Layout terminal blocks report no pane, only a folder.
  assert.equal(followedCwd(memory, space, { pane: null, cwd: "C:\\block" }, panes), "C:\\block");
  assert.equal(followedCwd(new Map(), null, null, []), null);
});

test("switchQuery: each space keeps its own search", async () => {
  const { switchQuery } = await import(file("my-files/logic.js").href);
  const queries = new Map();
  assert.equal(switchQuery(queries, undefined, "s1", ""), ""); // first look: empty
  assert.equal(switchQuery(queries, "s1", "s2", "main"), ""); // a new space starts empty
  assert.equal(switchQuery(queries, "s2", "s1", "other"), "main"); // back: its own search
  assert.equal(switchQuery(queries, "s1", "s2", "main"), "other");
  assert.equal(switchQuery(queries, "s2", null, ""), "");
});

test("dirtyName adds and removes one marker", () => {
  assert.equal(L.dirtyName("a.txt", true), "● a.txt");
  assert.equal(L.dirtyName("● a.txt", true), "● a.txt");
  assert.equal(L.dirtyName("● a.txt", false), "a.txt");
  assert.equal(L.dirtyName("a.txt", false), "a.txt");
});

test("baseName and parentDir handle both separators", () => {
  assert.equal(L.baseName("C:\\a\\b.txt"), "b.txt");
  assert.equal(L.baseName("/a/b.txt"), "b.txt");
  assert.equal(L.parentDir("C:\\a\\b.txt"), "C:\\a");
  assert.equal(L.parentDir("/a/b.txt"), "/a");
  assert.equal(L.parentDir("b.txt"), "");
});

test("parentDir keeps the root of a file directly under it", () => {
  assert.equal(L.parentDir("C:\\x.txt"), "C:\\");
  assert.equal(L.parentDir("C:/x.txt"), "C:/");
  assert.equal(L.parentDir("/x"), "/");
});

test("pickDraft: main, then backup; absent is not broken", () => {
  const good = JSON.stringify({ path: "/a", text: "t", base: "h" });
  const older = JSON.stringify({ path: "/a", text: "older", base: "h" });
  assert.deepEqual(L.pickDraft(good, older), { draft: { path: "/a", text: "t", base: "h" }, broken: false });
  assert.equal(L.pickDraft('{"path":"/a","te', older).draft.text, "older");
  assert.equal(L.pickDraft('{"path":"/a","te', older).broken, false);
  assert.deepEqual(L.pickDraft(null, null), { draft: null, broken: false });
  assert.deepEqual(L.pickDraft(undefined, null), { draft: null, broken: true });
  assert.deepEqual(L.pickDraft("{oops", "{oops"), { draft: null, broken: true });
  assert.deepEqual(L.pickDraft(null, "{oops"), { draft: null, broken: true });
});

test("watchMatters: only changes to the file or its folder, or an unusable list", () => {
  assert.equal(L.watchMatters(undefined, "C:\\A\\b.txt", "C:\\A"), true);
  assert.equal(L.watchMatters("x", "C:\\A\\b.txt", "C:\\A"), true);
  assert.equal(L.watchMatters(["c:/a/B.TXT"], "C:\\A\\b.txt", "C:\\A"), true);
  assert.equal(L.watchMatters(["x", "C:/A"], "C:\\A\\b.txt", "C:\\A"), true);
  assert.equal(L.watchMatters(["/p/other.txt", "/p/sub"], "/p/a.txt", "/p"), false);
  assert.equal(L.watchMatters([], "/p/a.txt", "/p"), false);
});

test("findTab, tabInfo and keepLive", () => {
  assert.equal(L.findTab(spaces, "c"), "t3");
  assert.equal(L.findTab(spaces, "none"), null);
  assert.equal(L.findTab(spaces, null), null);
  assert.equal(L.tabInfo(spaces, "t2").name, "b");
  assert.equal(L.tabInfo(spaces, "gone"), null);
  assert.deepEqual(L.keepLive({ a: "t1", b: "gone" }, spaces, v => v), { a: "t1" });
  assert.deepEqual(L.keepLive({ a: { tab: "t3" }, b: { tab: "x" } }, spaces, v => v.tab), { a: { tab: "t3" } });
  assert.deepEqual(L.keepLive(null, spaces, v => v), {});
});
