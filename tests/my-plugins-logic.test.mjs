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
  assert.equal(L.psQuote("it’s"), "'it’’s'");
  assert.equal(L.psQuote("‘a‚b‛c"), "'‘‘a‚‚b‛‛c'");
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
  const d = pjoin(root, "a&b it's it’s 스킬");
  mkdirSync(pjoin(d, "one"), { recursive: true });
  writeFileSync(pjoin(d, "one", "SKILL.md"), "---\nname: one\n---\n");
  mkdirSync(pjoin(d, ".hidden"));
  writeFileSync(pjoin(d, ".hidden", "SKILL.md"), "---\nname: hidden\n---\n");
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
    assert.deepEqual([...out.dirs.get(d)].sort(), [".hidden", "one"]);
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

test("claudeMcp: global and local (path spelling may differ)", () => {
  const obj = {
    mcpServers: { a: { type: "stdio", command: "npx" } },
    projects: { "C:\\MyCode\\app": { mcpServers: { l: { command: "x" } } }, "C:/Other": { mcpServers: { o: {} } } },
  };
  const r = L.claudeMcp(obj, "c:/mycode/app", "c:/mycode/app");
  assert.deepEqual(r.global, [{ name: "a", config: { type: "stdio", command: "npx" } }]);
  assert.deepEqual(r.local, [{ name: "l", config: { command: "x" } }]);
  // A subfolder has no entry of its own: the repository root's is used.
  assert.deepEqual(L.claudeMcp(obj, "C:/MyCode/app/sub", "C:/MyCode/app").local.map(s => s.name), ["l"]);
  assert.deepEqual(L.claudeMcp({}, "/x", "/x"), { global: [], local: [] });
  assert.deepEqual(L.servers(null), []);
  assert.deepEqual(L.servers({ s: { url: "u" } }), [{ name: "s", config: { url: "u" } }]);
});

test("pluginRoots: user plugins, and project plugins of this repository", () => {
  const obj = { version: 2, plugins: {
    "superpowers@m": [{ scope: "user", installPath: "C:\\p\\sp" }, { scope: "user", installPath: "C:\\p\\old" }],
    "local@m": [{ scope: "project", projectPath: "C:\\MyCode\\app", installPath: "C:\\p\\local" }],
    "other@m": [{ scope: "project", projectPath: "C:\\Else", installPath: "C:\\p\\else" }],
  } };
  assert.deepEqual(L.pluginRoots(obj, "c:/mycode/app"), [{ plugin: "superpowers", path: "C:\\p\\sp" }, { plugin: "local", path: "C:\\p\\local" }]);
  assert.deepEqual(L.pluginRoots(null, "/x"), []);
});

const TOML = `
model = "o3"   # top-level keys are kept but unused

[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env = { MY_KEY = "secret", "QUOTED.KEY" = 'lit\\eral' }

[mcp_servers."my.server"]
url = "https://example.com/mcp?a=1"
enabled = false
startup_timeout_sec = 20

[mcp_servers.multi]
command = "node"
args = [
  "server.js",   # comment inside
  "--port", "8080",
]
[mcp_servers.multi.env]
TOKEN = "abc\\n\\"x\\""

[mcp_servers.broken]
command = """multi"""
`;

test("parseToml: the values mcp_servers uses", () => {
  const { data, errors } = L.parseToml(TOML);
  assert.equal(data.model, "o3");
  assert.deepEqual(data.mcp_servers.context7, { command: "npx", args: ["-y", "@upstash/context7-mcp"], env: { MY_KEY: "secret", "QUOTED.KEY": "lit\\eral" } });
  assert.deepEqual(data.mcp_servers["my.server"], { url: "https://example.com/mcp?a=1", enabled: false, startup_timeout_sec: 20 });
  assert.deepEqual(data.mcp_servers.multi, { command: "node", args: ["server.js", "--port", "8080"], env: { TOKEN: "abc\n\"x\"" } });
  assert.deepEqual(errors.map(e => e.path), [["mcp_servers", "broken"]]);
});

test("parseToml: other tables and arrays of tables don't disturb it", () => {
  const { data, errors } = L.parseToml(`[profiles.fast]\nmodel = "x"\n[[hooks]]\nrun = "y"\n[mcp_servers.a]\ncommand = "z"\n`);
  assert.deepEqual(data.mcp_servers.a, { command: "z" });
  assert.equal(data.hooks, undefined);
  assert.deepEqual(errors, []);
});

test("codexMcp", () => {
  assert.deepEqual(L.codexMcp(TOML).map(s => [s.name, s.enabled, s.error !== null]),
    [["context7", true, false], ["my.server", false, false], ["multi", true, false], ["broken", true, true]]);
  assert.deepEqual(L.codexMcp(""), []);
  assert.deepEqual(L.codexMcp("[mcp_servers]\n"), []);
});

test("redact hides secrets but keeps their names", () => {
  const c = {
    command: "npx", args: ["-y", "pkg", "--api-key", "sk-1", "--token=abc", "--port", "1"],
    env: { A: "1", B: "2" }, headers: { Authorization: "Bearer x" }, bearer_token_env_var: "FIGMA",
    url: "https://h/mcp?api_key=s3&x=1",
  };
  assert.deepEqual(L.redact(c), {
    command: "npx", args: ["-y", "pkg", "--api-key", "••••", "--token=••••", "--port", "1"],
    env: { A: "••••", B: "••••" }, headers: { Authorization: "••••" }, bearer_token_env_var: "••••",
    url: "https://h/mcp?api_key=••••&x=1",
  });
  assert.equal(c.env.A, "1"); // the original is untouched
  assert.deepEqual(L.redact({ http_headers: { X: "1" }, env_http_headers: { Y: "ENV" } }), { http_headers: { X: "••••" }, env_http_headers: { Y: "••••" } });
});

test("serverSummary", () => {
  assert.equal(L.serverSummary({ type: "stdio", command: "npx", args: ["-y", "@upstash/context7-mcp"] }), "stdio npx -y @upstash/context7-mcp");
  assert.equal(L.serverSummary({ type: "http", url: "https://mcp.figma.com/mcp" }), "http https://mcp.figma.com/mcp");
  assert.equal(L.serverSummary({ url: "https://x/sse", type: "sse" }), "sse https://x/sse");
  assert.equal(L.serverSummary({ url: "https://x/mcp" }), "http https://x/mcp");
  assert.equal(L.serverSummary({ command: "node", args: ["--token", "t"] }), "stdio node --token ••••");
  const long = L.serverSummary({ command: "x".repeat(100) });
  assert.equal(long.length, 80);
  assert.ok(long.endsWith("…"));
});

test("configLines: nested values as indented lines", () => {
  assert.deepEqual(L.configLines({ command: "npx", args: ["-y", "a b"], env: { K: "v" }, enabled: false }), [
    { depth: 0, text: "command: npx" },
    { depth: 0, text: "args: -y \"a b\"" },
    { depth: 0, text: "env:" },
    { depth: 1, text: "K: ••••" },
    { depth: 0, text: "enabled: false" },
  ]);
});

test("parseToml: __proto__ / constructor / prototype keys are rejected", () => {
  const { errors } = L.parseToml("[__proto__.polluted]\nx = 1\n");
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);
  assert.equal(errors.length, 1);
  const r = L.codexMcp("[mcp_servers.a]\n__proto__ = 1\n");
  assert.equal(r[0].name, "a");
  assert.notEqual(r[0].error, null);
  const inl = L.parseToml("[mcp_servers.a]\nenv = { __proto__ = { z = 1 } }\n");
  assert.equal(({}).z, undefined);
  assert.equal(inl.errors.length, 1);
});

test("codexMcp: a malformed header is blamed on its own server", () => {
  assert.deepEqual(L.codexMcp("[mcp_servers.a]\ncommand='x'\n[mcp_servers.b\ncommand='y'\n").map(s => [s.name, s.enabled, s.error !== null]),
    [["a", true, false], ["b", true, true]]);
});

test("redact: more secret shapes", () => {
  assert.deepEqual(L.redact({ auth: { value: "abc" } }), { auth: "••••" });
  assert.deepEqual(L.redact({ token: ["a"] }), { token: "••••" });
  assert.deepEqual(L.redact({ password: 123 }), { password: "••••" });
  assert.deepEqual(L.redact({ env: ["K=v"] }), { env: "••••" });
  assert.deepEqual(L.redact({ headers: "x" }), { headers: "••••" });
  assert.deepEqual(L.redact({ url: "https://u:p@h/x?token=1" }), { url: "https://••••@h/x?token=••••" });
  assert.deepEqual(L.redact({ args: ["-e", "API_KEY=abc", "--header", "Authorization: Bearer x"] }),
    { args: ["-e", "API_KEY=••••", "--header", "Authorization: ••••"] });
});

test("configLines redacts its input", () => {
  assert.deepEqual(L.configLines({ env: { K: "v" }, token: "t" }), [
    { depth: 0, text: "env:" }, { depth: 1, text: "K: ••••" }, { depth: 0, text: "token: ••••" },
  ]);
});

test("claudeMcp: an empty cwd entry falls back to the repository entry", () => {
  const obj = { projects: { "/a/b": { mcpServers: {} }, "/a": { mcpServers: { s: {} } } } };
  assert.deepEqual(L.claudeMcp(obj, "/a/b", "/a").local.map(s => s.name), ["s"]);
});
