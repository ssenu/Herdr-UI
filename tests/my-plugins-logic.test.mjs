import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-plugins/logic.js", import.meta.url).href);

test("join, nativePath, samePath", () => {
  assert.equal(L.join("C:\\Users\\me", ".claude", "skills"), "C:\\Users\\me/.claude/skills");
  assert.equal(L.join("/home/me/", ".agents", "skills"), "/home/me/.agents/skills");
  assert.equal(L.nativePath("C:\\Users\\me/.claude/x/SKILL.md", true), "C:\\Users\\me\\.claude\\x\\SKILL.md");
  assert.equal(L.nativePath("/home/me/x", false), "/home/me/x");
  assert.ok(L.samePath("C:\\MyCode\\App", "c:/mycode/app/"));
  assert.ok(!L.samePath("/home/A", "/home/a"));
});

test("ancestors: cwd up to the repository root", () => {
  assert.deepEqual(L.ancestors("/r/a/b", "/r"), ["/r/a/b", "/r/a", "/r"]);
  assert.deepEqual(L.ancestors("C:\\r\\a", "C:/r"), ["C:\\r\\a", "C:\\r"]);
  assert.deepEqual(L.ancestors("/r", "/r"), ["/r"]);
  assert.deepEqual(L.ancestors("/x/y", "/r"), ["/x/y"]);
});

test("psQuote", () => {
  assert.equal(L.psQuote("it's"), "'it''s'");
});

test("listingCommand: sh gets the folders as arguments", () => {
  const c = L.listingCommand(["/h/.claude/skills", "/r/it's"], false);
  assert.equal(c.command, "sh");
  assert.equal(c.args[0], "-c");
  assert.deepEqual(c.args.slice(2), ["plugins", "/h/.claude/skills", "/r/it's"]);
});

test("listingCommand: PowerShell quotes each folder", () => {
  const c = L.listingCommand(["C:\\a&b", "C:\\it's"], true);
  assert.equal(c.command, "powershell");
  assert.deepEqual(c.args.slice(0, 2), ["-NoProfile", "-Command"]);
  assert.ok(c.args[2].includes("@('C:\\a&b', 'C:\\it''s')"));
  assert.ok(L.listingCommand([], true).args[2].includes("@()"));
});

test("listingLines", () => {
  const r = L.listingLines("HOME\tC:\\Users\\me\r\nDIR\tC:\\Users\\me/.claude/skills\thwpx\r\nDIR\tC:\\Users\\me/.claude/skills\tnotebooklm\r\n\r\n");
  assert.equal(r.home, "C:\\Users\\me");
  assert.deepEqual(r.dirs.get("C:\\Users\\me/.claude/skills"), ["hwpx", "notebooklm"]);
  assert.equal(L.listingLines("").home, null);
});

// The real scripts, on a folder whose name needs quoting.
function fixture() {
  const root = mkdtempSync(pjoin(tmpdir(), "plugins-"));
  const d = pjoin(root, "a&b it's 스킬");
  mkdirSync(pjoin(d, "one"), { recursive: true });
  writeFileSync(pjoin(d, "one", "SKILL.md"), "---\nname: one\n---\n");
  mkdirSync(pjoin(d, "no-skill-md"));
  return d;
}
for (const windows of [true, false]) {
  const shell = windows ? "powershell" : "sh";
  const runs = !spawnSync(shell, windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"]).error;
  test(`listingCommand runs (${shell})`, { skip: !runs || (windows && process.platform !== "win32") }, () => {
    const native = fixture(), d = windows ? native : native.replaceAll("\\", "/"), missing = d + "-missing";
    const c = L.listingCommand([d, missing], windows);
    const r = spawnSync(c.command, c.args, { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const out = L.listingLines(r.stdout);
    assert.ok(out.home);
    assert.deepEqual(out.dirs.get(d), ["one"]);
    assert.equal(out.dirs.get(missing), undefined);
  });
}

test("frontmatter", () => {
  assert.deepEqual(L.frontmatter("---\nname: hwpx\ndescription: \"한글 \\\"문서\\\"\"\n---\n\n# 제목\n", "dir"),
    { name: "hwpx", description: "한글 \"문서\"", body: "\n# 제목\n" });
  assert.deepEqual(L.frontmatter("\uFEFF---\r\nname: 'it''s'\r\ndescription: >\r\n  첫 줄\r\n  둘째 줄\r\n---\r\nbody", "dir"),
    { name: "it's", description: "첫 줄 둘째 줄", body: "body" });
  assert.deepEqual(L.frontmatter("---\ndescription: plain\n  continued\n---\n", "folder"),
    { name: "folder", description: "plain continued", body: "" });
  assert.deepEqual(L.frontmatter("# no front", "folder"), { name: "folder", description: "", body: "# no front" });
});

test("agentKind", () => {
  assert.equal(L.agentKind("Codex"), "codex");
  assert.equal(L.agentKind("codex cli"), "codex");
  assert.equal(L.agentKind("Claude Code"), "claude");
  assert.equal(L.agentKind(null), "claude");
});

test("dragText", () => {
  assert.equal(L.dragText({ kind: "skill", name: "hwpx", plugin: null }, "claude"), "/hwpx ");
  assert.equal(L.dragText({ kind: "skill", name: "brainstorming", plugin: "superpowers" }, "claude"), "/superpowers:brainstorming ");
  assert.equal(L.dragText({ kind: "skill", name: "hwpx", plugin: null }, "codex"), "$hwpx ");
  assert.equal(L.dragText({ kind: "mcp", name: "context7" }, "codex"), "context7 MCP ");
});

test("sortItems and groupBySource", () => {
  const items = [
    { name: "b", source: "전역" }, { name: "z", source: "플러그인:b" }, { name: "a", source: "플러그인:a" },
    { name: "c", source: "프로젝트" }, { name: "a", source: "전역" }, { name: "l", source: "로컬" },
  ];
  const sorted = L.sortItems(items);
  assert.deepEqual(sorted.map(i => `${i.source}/${i.name}`), ["프로젝트/c", "로컬/l", "전역/a", "전역/b", "플러그인:a/a", "플러그인:b/z"]);
  assert.deepEqual(L.groupBySource(sorted).map(g => [g.source, g.items.length]),
    [["프로젝트", 1], ["로컬", 1], ["전역", 2], ["플러그인:a", 1], ["플러그인:b", 1]]);
});

test("emptyText", () => {
  assert.equal(L.emptyText("mcp"), "이 폴더와 전역에 MCP 서버가 없어요");
  assert.equal(L.emptyText("skills"), "이 폴더와 전역에 스킬이 없어요");
});
