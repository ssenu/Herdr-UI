import test from "node:test";
import assert from "node:assert/strict";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-files/logic.js", import.meta.url).href);

test("absolutePath: local Windows uses backslashes and trims the root's trailing separator", () => {
  assert.equal(L.absolutePath("C:/MyCode/x", "src/a.js", { remote: false, windows: true }), "C:\\MyCode\\x\\src\\a.js");
  assert.equal(L.absolutePath("C:\\MyCode\\x\\", "src/a.js", { remote: false, windows: true }), "C:\\MyCode\\x\\src\\a.js");
});

test("absolutePath: empty rel returns the root itself", () => {
  assert.equal(L.absolutePath("C:/x", "", { remote: false, windows: true }), "C:\\x");
  assert.equal(L.absolutePath("/", "", { remote: true, windows: true }), "/");
});

test("absolutePath: remote keeps forward slashes even from a Windows client", () => {
  assert.equal(L.absolutePath("/home/u/p", "a b.txt", { remote: true, windows: true }), "/home/u/p/a b.txt");
});

test("absolutePath: local non-Windows keeps forward slashes", () => {
  assert.equal(L.absolutePath("/Users/u/p/", "a.txt", { remote: false, windows: false }), "/Users/u/p/a.txt");
});

test("quoteForPrompt: plain path gets only a trailing space", () => {
  assert.equal(L.quoteForPrompt("C:\\a\\b.js"), "C:\\a\\b.js ");
});

test("quoteForPrompt: spaces and shell specials are double-quoted", () => {
  assert.equal(L.quoteForPrompt("C:\\바탕 화면\\a.js"), "\"C:\\바탕 화면\\a.js\" ");
  assert.equal(L.quoteForPrompt("/p/a&b"), "\"/p/a&b\" ");
  assert.equal(L.quoteForPrompt("/p/(x)"), "\"/p/(x)\" ");
});

test("editability: remote wins over everything", () => {
  assert.deepEqual(L.editability({ remote: true, text: "x" }), { editable: false, reason: "remote" });
});

test("editability: text over PREVIEW_LIMIT is truncated and read-only", () => {
  assert.equal(L.PREVIEW_LIMIT, 400000);
  assert.deepEqual(L.editability({ remote: false, text: "a".repeat(400001) }), { editable: false, reason: "truncated" });
  assert.deepEqual(L.editability({ remote: false, text: "a".repeat(400000) }), { editable: true, reason: null });
});

test("previewText: cuts at PREVIEW_LIMIT with a marker", () => {
  assert.equal(L.previewText("abc"), "abc");
  const long = "a".repeat(400005);
  assert.equal(L.previewText(long), "a".repeat(400000) + "\n… (file truncated)");
});

test("REASONS: Korean labels", () => {
  assert.equal(L.REASONS.remote, "원격 파일 · 읽기 전용");
  assert.equal(L.REASONS.truncated, "큰 파일 · 일부만 표시");
});

test("syncDecision", () => {
  assert.equal(L.syncDecision({ base: "a", dirty: false, value: "a" }, "a"), "none");
  assert.equal(L.syncDecision({ base: "a", dirty: true, value: "b" }, "a"), "none");
  assert.equal(L.syncDecision({ base: "a", dirty: false, value: "a" }, "c"), "reload");
  assert.equal(L.syncDecision({ base: "a", dirty: true, value: "b" }, "c"), "conflict");
  assert.equal(L.syncDecision({ base: "a", dirty: true, value: "c" }, "c"), "adopt");
  assert.equal(L.syncDecision({ base: "a", dirty: false, value: "a" }, null), "drop");
  assert.equal(L.syncDecision({ base: "a", dirty: true, value: "b" }, null), "conflict");
});

test("saveFailure: unchanged disk is a plain error, changed disk is a conflict", () => {
  assert.equal(L.saveFailure("a", "a"), "error");
  assert.equal(L.saveFailure("a", "b"), "conflict");
  assert.equal(L.saveFailure("a", null), "conflict");
  assert.equal(L.saveFailure(null, null), "error");
});

test("sameText", () => {
  assert.equal(L.sameText("a\r\nb", "a\nb"), true);
  assert.equal(L.sameText("a\nb", "a\r\nb"), true);
  assert.equal(L.sameText("a", "b"), false);
  assert.equal(L.sameText(null, null), true);
  assert.equal(L.sameText(null, ""), false);
  assert.equal(L.sameText("", null), false);
});

test("restoreEol", () => {
  assert.equal(L.restoreEol("a\nb\n", "x\r\ny"), "a\r\nb\r\n");
  assert.equal(L.restoreEol("a\r\nb", "x\r\ny"), "a\r\nb");
  assert.equal(L.restoreEol("a\nb", "x\ny"), "a\nb");
  assert.equal(L.restoreEol("a\nb", null), "a\nb");
});

test("syncDecision is CRLF-insensitive", () => {
  assert.equal(L.syncDecision({ base: "a\r\nb", dirty: false, value: "a\nb" }, "a\nb"), "none");
  assert.equal(L.syncDecision({ base: "a", dirty: true, value: "c\nd" }, "c\r\nd"), "adopt");
});

test("isSaveKey: Ctrl+S as Windows reports it, Cmd+S on macOS, nothing else", () => {
  assert.equal(L.isSaveKey("ctrl-s"), true);
  assert.equal(L.isSaveKey("cmd-s"), true);
  assert.equal(L.isSaveKey("s"), false);
  assert.equal(L.isSaveKey("ctrl-shift-s"), false);
  assert.equal(L.isSaveKey(undefined), false);
});

test("isMarkdown: .md and .markdown, any case", () => {
  assert.equal(L.isMarkdown("README.md"), true);
  assert.equal(L.isMarkdown("docs/Guide.MD"), true);
  assert.equal(L.isMarkdown("notes.markdown"), true);
  assert.equal(L.isMarkdown("a.mdx"), false);
  assert.equal(L.isMarkdown("md"), false);
  assert.equal(L.isMarkdown(null), false);
});
