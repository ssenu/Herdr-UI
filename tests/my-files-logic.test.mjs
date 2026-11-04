import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
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

test("fuzzyMatch: letters in order, case-insensitive, file name first", () => {
  assert.deepEqual(L.fuzzyMatch("mainjs", "mods/my-files/main.js").hits, [14, 15, 16, 17, 19, 20]);
  assert.ok(L.fuzzyMatch("MAIN", "mods/my-files/main.js"));
  assert.equal(L.fuzzyMatch("xyz", "mods/my-files/main.js"), null);
  assert.equal(L.fuzzyMatch("nm", "main.js"), null); // order matters
  assert.equal(L.fuzzyMatch("   ", "main.js"), null);
});

test("fuzzyMatch: every space-separated part must match", () => {
  assert.deepEqual(L.fuzzyMatch("files main", "mods/my-files/main.js").hits, [8, 9, 10, 11, 12, 14, 15, 16, 17]);
  assert.equal(L.fuzzyMatch("files zzz", "mods/my-files/main.js"), null);
});

test("fuzzyMatch scores: file name, consecutive letters, word starts", () => {
  const s = (q, p) => L.fuzzyMatch(q, p).score;
  assert.ok(s("main", "src/main.js") > s("main", "main/src/x.js"));
  assert.ok(s("abc", "abc.txt") > s("abc", "axbxc.txt"));
  assert.ok(s("fb", "FooBar.js") > s("fb", "fxxb.js"));
});

test("searchPaths: best first, limit and more", () => {
  const paths = ["main/src/x.js", "src/main.js", "docs/readme.md", "a/main.js"];
  const r = L.searchPaths(paths, "main", 2);
  assert.deepEqual(r.results.map(x => x.path), ["a/main.js", "src/main.js"]);
  assert.equal(r.more, true);
  assert.deepEqual(L.searchPaths(paths, "readme", 200), { results: [{ path: "docs/readme.md", ...L.fuzzyMatch("readme", "docs/readme.md") }], more: false });
  assert.deepEqual(L.searchPaths(paths, "zzz", 200), { results: [], more: false });
});

test("splitPath and segments", () => {
  assert.deepEqual(L.splitPath("mods/my-files/main.js"), { dir: "mods/my-files", name: "main.js" });
  assert.deepEqual(L.splitPath("README.md"), { dir: "", name: "README.md" });
  assert.deepEqual(L.segments("main.js", [0, 1, 5]), [{ text: "ma", hit: true }, { text: "in.", hit: false }, { text: "j", hit: true }, { text: "s", hit: false }]);
  assert.deepEqual(L.segments("ab", []), [{ text: "ab", hit: false }]);
  assert.deepEqual(L.segments("", []), []);
});

test("fuzzyMatch: length-changing lowercase keeps hit positions aligned", () => {
  assert.deepEqual(L.fuzzyMatch("b", "İb.txt").hits, [1]);
  assert.deepEqual(L.fuzzyMatch("i", "İx").hits, [0]);
});

test("fuzzyMatch and segments: astral characters highlight both code units", () => {
  assert.deepEqual(L.fuzzyMatch("😀", "a😀.txt").hits, [1, 2]);
  assert.deepEqual(L.segments("a😀.txt", [1, 2]), [{ text: "a", hit: false }, { text: "😀", hit: true }, { text: ".txt", hit: false }]);
});

test("fuzzyMatch: full-path fallback and repeated-part dedupe", () => {
  assert.deepEqual(L.fuzzyMatch("main", "main/src/x.js").hits, [0, 1, 2, 3]);
  assert.deepEqual(L.fuzzyMatch("main main", "src/main.js").hits, [4, 5, 6, 7]);
});

test("searchPaths: more is false at exactly limit; empty query is empty", () => {
  const paths = ["main/src/x.js", "src/main.js", "a/main.js", "docs/readme.md"];
  assert.equal(L.searchPaths(paths, "main", 3).more, false);
  assert.equal(L.searchPaths(paths, "main", 3).results.length, 3);
  assert.deepEqual(L.searchPaths(paths, null, 5), { results: [], more: false });
});

test("psQuote doubles straight and typographic single quotes", () => {
  assert.equal(L.psQuote("it's"), "'it''s'");
  assert.equal(L.psQuote("it’s ‘a‚b‛"), "'it’’s ‘‘a‚‚b‛‛'");
});

test("indexCommand: the root goes in as an argument or a quoted literal", () => {
  const sh = L.indexCommand("/r/it's", false);
  assert.equal(sh.command, "sh");
  assert.deepEqual(sh.args.slice(2), ["index", "/r/it's"]);
  assert.ok(sh.args[1].includes("head -n 50001"));
  const ps = L.indexCommand("C:\\a&b\\it's", true);
  assert.equal(ps.command, "powershell");
  assert.ok(ps.args[2].includes("'C:\\a&b\\it''s'"));
});

test("indexLines", () => {
  assert.deepEqual(L.indexLines("./a.txt\n./sub/b.md\n\n", false), { paths: ["a.txt", "sub/b.md"], truncated: false });
  assert.deepEqual(L.indexLines("a.txt\r\nsub\\b.md\r\n", true), { paths: ["a.txt", "sub/b.md"], truncated: false });
  assert.deepEqual(L.indexLines("./we\\ird.txt\n", false).paths, ["we\\ird.txt"]); // a backslash is a name character on Unix
  const many = Array.from({ length: L.INDEX_LIMIT + 1 }, (_, i) => `f${i}`).join("\n");
  const r = L.indexLines(many, false);
  assert.equal(r.paths.length, L.INDEX_LIMIT);
  assert.equal(r.truncated, true);
});

// The real scripts, on a folder whose name needs quoting.
function indexFixture() {
  const root = pjoin(mkdtempSync(pjoin(tmpdir(), "files-index-")), "a&b it's it’s 스킬");
  mkdirSync(pjoin(root, "sub"), { recursive: true });
  mkdirSync(pjoin(root, ".git"));
  mkdirSync(pjoin(root, ".hidden"));
  writeFileSync(pjoin(root, "top.txt"), "x");
  writeFileSync(pjoin(root, "sub", "inner.md"), "x");
  writeFileSync(pjoin(root, ".git", "HEAD"), "x");
  writeFileSync(pjoin(root, ".hidden", "x.txt"), "x");
  return root;
}
for (const windows of [true, false]) {
  const shell = windows ? "powershell" : "sh";
  const runs = !spawnSync(shell, windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"]).error;
  test(`indexCommand runs (${shell})`, { skip: !runs || (windows && process.platform !== "win32") }, () => {
    const native = indexFixture(), root = windows ? native : native.replaceAll("\\", "/");
    const c = L.indexCommand(root, windows);
    const r = spawnSync(c.command, c.args, { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(L.indexLines(r.stdout, windows).paths.sort(), [".hidden/x.txt", "sub/inner.md", "top.txt"]);
    const missing = L.indexCommand(root + "-missing", windows);
    assert.notEqual(spawnSync(missing.command, missing.args, { encoding: "utf8" }).status, 0);
  });
}
