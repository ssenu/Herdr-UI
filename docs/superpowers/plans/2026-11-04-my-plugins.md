# Plugins 패널 (MCP · Skills 목록) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 탭 바의 Plugin 버튼으로 여는 읽기 전용 패널. 포커스된 칸의 폴더 기준으로 Claude Code 또는 Codex가 보는 MCP 서버와 스킬 목록을 출처(프로젝트/로컬/전역/플러그인)별로 보여 준다.

**Architecture:** 새 mod `mods/my-plugins`. 순수 로직(경로, 목록 명령, JSON/TOML/frontmatter 해석, 비밀 가리기, 정렬, 드래그 문구)은 `logic.js`에, herdr 호출과 화면은 `main.js`에. 구조는 `mods/my-github/main.js`(위치 찾기, `visible()`, `loading`/`again` 새로고침, 드래그 → `my-files-drag`)를 따른다. `⋯`는 기존 `my-files-open` 팝업을 다시 쓴다.

**Tech Stack:** Herdr mod API (`gpui-kit`, `gpui-base`, `herdr`), Node 22+ `node --test`, PowerShell 5.1+ / POSIX sh.

**Spec:** `docs/superpowers/specs/2026-11-04-my-plugins-design.md`

## Global Constraints

- 읽기 전용. 설정 파일·스킬 폴더에 쓰지 않는다.
- `logic.js`는 `herdr`/`gpui-*`를 import하지 않는다(`node --test`가 불러올 수 있어야 함).
- 화면 문구는 한국어. 출처 이름은 정확히 `프로젝트`, `로컬`, `전역`, `플러그인:<이름>`.
- 비밀 가림 표시는 정확히 `••••`.
- 드래그 문구: Claude 스킬 `/이름 `, Claude 플러그인 스킬 `/플러그인:이름 `, Codex 스킬 `$이름 `, MCP `이름 MCP ` (끝에 공백 하나, Enter 없음).
- 경로는 셸 스크립트 문자열에 그대로 끼우지 않는다: sh는 인자로, PowerShell은 작은따옴표 리터럴(`'` → `''`)로.
- render 중에 `cx.notify()`를 부르지 않는다(예외 발생).
- Windows에서 Ctrl 단축키는 `"ctrl-…"`로 온다(이 기능은 단축키 없음).
- 테스트는 파일을 명시해서 실행한다: `node --test tests/<file>` (디렉터리 형태는 Node 24에서 실패).
- 이 저장소(`C:\MyCode\herdr-UI`)가 원본. 실제 앱에는 `~/.config/herdr-app/mods/`로 복사해 확인한다.

## File Structure

- Create `mods/my-plugins/logic.js` — 순수 함수 전부.
- Create `mods/my-plugins/main.js` — 데이터 모으기(`collect`), 패널 View.
- Create `mods/my-plugins/mod.json` — `{ "place": "none" }`.
- Create `mods/my-plugins/plugins.svg` — 탭 바 아이콘.
- Create `tests/my-plugins-logic.test.mjs`.
- Modify `mods/my-tabs/main.js:80,99` — Plugin 버튼.
- Modify `install.ps1` — mod 목록, `plugins` 칸.
- Modify `package.json`, `README.md`.

---

### Task 1: 경로 · 목록 명령 · frontmatter · 정렬 · 드래그 문구 (logic.js 1부)

**Files:**
- Create: `mods/my-plugins/logic.js`
- Test: `tests/my-plugins-logic.test.mjs`

**Interfaces:**
- Produces (모두 `logic.js` export):
  - `psQuote(s: string): string`
  - `join(...parts: string[]): string` — 첫 조각의 구분자는 그대로, 나머지는 `/`로 잇는다.
  - `nativePath(p: string, windows: boolean): string` — windows면 `/` → `\`.
  - `normPath(p): string`, `samePath(a, b): boolean` — `\`/`/`, 끝 구분자, 드라이브 문자 경로의 대소문자 무시.
  - `ancestors(cwd: string, repo: string): string[]` — cwd부터 repo까지(둘 다 포함). repo 밖이면 `[cwd]`.
  - `listingCommand(dirs: string[], windows: boolean): { command, args }`
  - `listingLines(stdout: string): { home: string|null, dirs: Map<string, string[]> }`
  - `frontmatter(md: string, fallback: string): { name, description, body }`
  - `agentKind(name: string|null): "claude"|"codex"`
  - `dragText(item: { kind: "mcp"|"skill", name, plugin? }, agent): string`
  - `sortItems(items): items[]`, `groupBySource(sorted): { source, items }[]`
  - `emptyText(tab: "mcp"|"skills"): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/my-plugins-logic.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/my-plugins-logic.test.mjs`
Expected: FAIL — `Cannot find module …/mods/my-plugins/logic.js`.

- [ ] **Step 3: Implement**

Create `mods/my-plugins/logic.js`:

```js
// Pure helpers for my-plugins. No herdr or gpui imports, so `node --test` can load this file.

/** A PowerShell single-quoted string literal (only ' is special inside). */
export function psQuote(s) {
  return "'" + String(s).replaceAll("'", "''") + "'";
}

/** Joins path pieces with "/" (Windows accepts it); the first piece keeps its own separators. */
export function join(...parts) {
  return parts.filter(p => p !== undefined && p !== null && p !== "")
    .map((p, i) => (i === 0 ? String(p).replace(/[\\/]+$/, "") : String(p).replace(/^[\\/]+|[\\/]+$/g, "")))
    .join("/");
}

/** The path as the OS writes it: backslashes on Windows (explorer /select needs them). */
export function nativePath(p, windows) {
  return windows ? String(p).replaceAll("/", "\\") : String(p);
}

/** For comparing paths: "/" separators, no trailing one; Windows drive paths ignore case. */
export function normPath(p) {
  let s = String(p ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:/.test(s)) s = s.toLowerCase();
  return s;
}

export const samePath = (a, b) => normPath(a) === normPath(b);

/** cwd, its parent, … up to and including repo. [cwd] when cwd is not inside repo. */
export function ancestors(cwd, repo) {
  const start = String(cwd).replace(/[\\/]+$/, "") || String(cwd), out = [];
  let cur = start;
  for (let n = 0; n < 64; n++) {
    out.push(cur);
    if (samePath(cur, repo)) return out;
    const i = Math.max(cur.lastIndexOf("/"), cur.lastIndexOf("\\"));
    if (i <= 0) break;
    const up = cur.slice(0, i);
    if (/^[A-Za-z]:$/.test(up)) break;
    cur = up;
  }
  return [start];
}

/**
 * One command that prints the home folder and, for each folder in dirs, its subfolders holding a SKILL.md:
 *   HOME<TAB><home>
 *   DIR<TAB><folder exactly as given><TAB><subfolder name>
 * Missing folders print nothing.
 */
export function listingCommand(dirs, windows) {
  if (windows) {
    const list = dirs.map(psQuote).join(", ");
    return {
      command: "powershell",
      args: ["-NoProfile", "-Command",
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
        "\"HOME`t$env:USERPROFILE\"; " +
        `foreach ($d in @(${list})) { if (Test-Path -LiteralPath $d -PathType Container) { ` +
        "Get-ChildItem -LiteralPath $d -Directory -Force -ErrorAction SilentlyContinue | " +
        "Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') -PathType Leaf } | " +
        "ForEach-Object { \"DIR`t$d`t$($_.Name)\" } } }"],
    };
  }
  const script = "printf 'HOME\\t%s\\n' \"$HOME\"; for d in \"$@\"; do for p in \"$d\"/*/SKILL.md; do " +
    "[ -f \"$p\" ] || continue; n=${p%/SKILL.md}; printf 'DIR\\t%s\\t%s\\n' \"$d\" \"${n##*/}\"; done; done";
  return { command: "sh", args: ["-c", script, "plugins", ...dirs] };
}

export function listingLines(stdout) {
  let home = null;
  const dirs = new Map();
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const f = line.split("\t");
    if (f[0] === "HOME" && f.length >= 2 && f[1]) home = f.slice(1).join("\t");
    else if (f[0] === "DIR" && f.length >= 3) {
      if (!dirs.has(f[1])) dirs.set(f[1], []);
      dirs.get(f[1]).push(f.slice(2).join("\t"));
    }
  }
  return { home, dirs };
}

function unquote(v) {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replaceAll("''", "'");
  return null;
}

/** name / description from a SKILL.md YAML front matter (simple subset), and the body after it. */
export function frontmatter(md, fallback) {
  const text = String(md ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { name: fallback, description: "", body: text };
  const fields = {}, lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][+-]?$/.test(v)) {
      const parts = [];
      while (i + 1 < lines.length && (/^[ \t]/.test(lines[i + 1]) || lines[i + 1] === "")) parts.push(lines[++i].trim());
      v = parts.filter(Boolean).join(v.startsWith(">") ? " " : "\n");
    } else {
      const q = unquote(v);
      if (q !== null) v = q;
      else while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) v += " " + lines[++i].trim();
    }
    fields[kv[1]] = v;
  }
  return { name: fields.name || fallback, description: fields.description ?? "", body: text.slice(m[0].length) };
}

/** Which agent's settings to show for an agent name (Codex if the name says so). */
export function agentKind(name) {
  return /codex/i.test(String(name ?? "")) ? "codex" : "claude";
}

/** What a dragged row types into the prompt. */
export function dragText(item, agent) {
  if (item.kind === "mcp") return `${item.name} MCP `;
  if (agent === "codex") return `$${item.name} `;
  return item.plugin ? `/${item.plugin}:${item.name} ` : `/${item.name} `;
}

const RANK = { "프로젝트": 0, "로컬": 1, "전역": 2 };

/** 프로젝트 → 로컬 → 전역 → 플러그인:* (by name), then by item name. */
export function sortItems(items) {
  return [...items].sort((a, b) =>
    (RANK[a.source] ?? 3) - (RANK[b.source] ?? 3)
    || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Consecutive runs of the same source (input already sorted). */
export function groupBySource(sorted) {
  const groups = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.source === item.source) last.items.push(item);
    else groups.push({ source: item.source, items: [item] });
  }
  return groups;
}

export function emptyText(tab) {
  return tab === "mcp" ? "이 폴더와 전역에 MCP 서버가 없어요" : "이 폴더와 전역에 스킬이 없어요";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/my-plugins-logic.test.mjs`
Expected: PASS. On Windows the `sh` case runs if Git's `sh` is on PATH, otherwise it is skipped; the `powershell` case must run and pass.

- [ ] **Step 5: Commit**

```bash
git add mods/my-plugins/logic.js tests/my-plugins-logic.test.mjs
git commit -m "my-plugins: path, listing, front matter and sorting helpers"
```

---

### Task 2: 설정 해석 · 비밀 가리기 (logic.js 2부)

**Files:**
- Modify: `mods/my-plugins/logic.js` (append)
- Test: `tests/my-plugins-logic.test.mjs` (append)

**Interfaces:**
- Consumes: `samePath` (Task 1).
- Produces:
  - `servers(map): { name, config }[]` — `{ 이름: 설정 }` 객체를 목록으로. 객체가 아니면 `[]`.
  - `claudeMcp(obj, cwd, repo): { global: {name, config}[], local: {name, config}[] }` — `~/.claude.json` 객체에서.
  - `pluginRoots(obj, repo): { plugin, path }[]` — `installed_plugins.json` 객체에서.
  - `parseToml(text): { data: object, errors: { path: string[], message: string }[] }`
  - `codexMcp(text): { name, config, enabled: boolean, error: string|null }[]`
  - `MASK = "••••"`, `redact(config): config` (깊은 복사)
  - `serverSummary(config): string` (80자 이하)
  - `configLines(config): { depth: number, text: string }[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/my-plugins-logic.test.mjs`:

```js
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
    { depth: 1, text: "K: v" },
    { depth: 0, text: "enabled: false" },
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/my-plugins-logic.test.mjs`
Expected: the new tests FAIL (`L.claudeMcp is not a function` etc.); Task 1 tests still PASS.

- [ ] **Step 3: Implement**

Append to `mods/my-plugins/logic.js`:

```js
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** { name: config } → [{ name, config }]. */
export function servers(map) {
  return isObject(map) ? Object.entries(map).map(([name, config]) => ({ name, config })) : [];
}

/** Claude Code's ~/.claude.json: user servers, and the local servers stored for this folder (or its repository). */
export function claudeMcp(obj, cwd, repo) {
  const projects = isObject(obj?.projects) ? Object.entries(obj.projects) : [];
  const entry = (projects.find(([p]) => samePath(p, cwd)) ?? projects.find(([p]) => samePath(p, repo)))?.[1];
  return { global: servers(obj?.mcpServers), local: servers(entry?.mcpServers) };
}

/** installed_plugins.json: each plugin's folder (user scope, or project scope for this repository). */
export function pluginRoots(obj, repo) {
  const out = [];
  for (const [id, list] of Object.entries(isObject(obj?.plugins) ? obj.plugins : {})) {
    const entries = Array.isArray(list) ? list : [list];
    const pick = entries.find(e => e?.installPath && (!e.projectPath || samePath(e.projectPath, repo)));
    if (pick) out.push({ plugin: id.split("@")[0], path: pick.installPath });
  }
  return out;
}

// A small TOML reader: enough for Codex's [mcp_servers.*] tables.
class Toml {
  constructor(s) { this.s = s; this.i = 0; }
  peek() { return this.s[this.i]; }
  ws() { while (this.i < this.s.length && (this.s[this.i] === " " || this.s[this.i] === "\t")) this.i++; }
  skipLine() { while (this.i < this.s.length && this.s[this.i] !== "\n") this.i++; }
  // Spaces, newlines and comments.
  wsnl() {
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === "#") this.skipLine();
      else if (c === "\n" || c === "\r") this.i++;
      else return;
    }
  }
  endOfLine() {
    this.ws();
    if (this.peek() === "#") this.skipLine();
    const c = this.peek();
    if (c !== undefined && c !== "\n" && c !== "\r") throw new Error("줄 끝에 알 수 없는 내용");
  }
  key() {
    this.ws();
    const c = this.peek();
    if (c === '"') return this.basic();
    if (c === "'") return this.literal();
    const m = /^[A-Za-z0-9_-]+/.exec(this.s.slice(this.i));
    if (!m) throw new Error("키를 읽지 못함");
    this.i += m[0].length;
    return m[0];
  }
  keyPath() {
    const path = [this.key()];
    for (;;) {
      this.ws();
      if (this.peek() !== ".") return path;
      this.i++;
      path.push(this.key());
    }
  }
  basic() {
    this.i++;
    let out = "";
    for (;;) {
      const c = this.s[this.i++];
      if (c === undefined || c === "\n") throw new Error("닫히지 않은 문자열");
      if (c === '"') return out;
      if (c !== "\\") { out += c; continue; }
      const e = this.s[this.i++];
      const simple = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\" };
      if (e in simple) out += simple[e];
      else if (e === "u" || e === "U") {
        const n = e === "u" ? 4 : 8, hex = this.s.slice(this.i, this.i + n);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== n) throw new Error("잘못된 이스케이프");
        out += String.fromCodePoint(parseInt(hex, 16));
        this.i += n;
      } else throw new Error("잘못된 이스케이프");
    }
  }
  literal() {
    this.i++;
    const end = this.s.indexOf("'", this.i), nl = this.s.indexOf("\n", this.i);
    if (end < 0 || (nl >= 0 && nl < end)) throw new Error("닫히지 않은 문자열");
    const out = this.s.slice(this.i, end);
    this.i = end + 1;
    return out;
  }
  value() {
    this.ws();
    const c = this.peek(), rest = this.s.slice(this.i);
    if (rest.startsWith('"""') || rest.startsWith("'''")) throw new Error("여러 줄 문자열은 지원하지 않음");
    if (c === '"') return this.basic();
    if (c === "'") return this.literal();
    if (c === "[") {
      this.i++;
      const arr = [];
      for (;;) {
        this.wsnl();
        if (this.peek() === "]") { this.i++; return arr; }
        arr.push(this.value());
        this.wsnl();
        if (this.peek() === ",") { this.i++; continue; }
        if (this.peek() === "]") { this.i++; return arr; }
        throw new Error("배열을 읽지 못함");
      }
    }
    if (c === "{") {
      this.i++;
      const obj = {};
      this.ws();
      if (this.peek() === "}") { this.i++; return obj; }
      for (;;) {
        const path = this.keyPath();
        this.ws();
        if (this.peek() !== "=") throw new Error("= 가 없음");
        this.i++;
        setPath(obj, path, this.value());
        this.ws();
        if (this.peek() === ",") { this.i++; continue; }
        if (this.peek() === "}") { this.i++; return obj; }
        throw new Error("인라인 표를 읽지 못함");
      }
    }
    const m = /^(true|false|[+-]?\d[\d_]*(?:\.\d+)?)(?=[\s,\]}#]|$)/.exec(rest);
    if (!m) throw new Error("지원하지 않는 값");
    this.i += m[0].length;
    return m[1] === "true" ? true : m[1] === "false" ? false : Number(m[1].replaceAll("_", ""));
  }
}

function ensure(root, path) {
  let cur = root;
  for (const k of path) {
    if (cur[k] === undefined) cur[k] = {};
    if (!isObject(cur[k])) throw new Error("이미 값이 있는 키");
    cur = cur[k];
  }
  return cur;
}

function setPath(obj, path, value) {
  ensure(obj, path.slice(0, -1))[path[path.length - 1]] = value;
}

/**
 * Reads TOML tables, keys and the values above. A line it can't read is skipped and noted in errors
 * under the table it belongs to; arrays of tables ([[x]]) are skipped.
 */
export function parseToml(text) {
  const p = new Toml(String(text ?? "").replace(/^\uFEFF/, "")), data = {}, errors = [];
  let table = data, at = [];
  for (;;) {
    p.wsnl();
    if (p.i >= p.s.length) break;
    const start = p.i;
    let header = false;
    try {
      if (p.peek() === "[") {
        header = true;
        if (p.s[p.i + 1] === "[") { table = null; at = null; p.skipLine(); continue; }
        p.i++;
        const path = p.keyPath();
        p.ws();
        if (p.peek() !== "]") throw new Error("표 이름을 읽지 못함");
        p.i++;
        p.endOfLine();
        table = ensure(data, path); at = path;
        continue;
      }
      const path = p.keyPath();
      p.ws();
      if (p.peek() !== "=") throw new Error("= 가 없음");
      p.i++;
      const value = p.value();
      p.endOfLine();
      if (table) setPath(table, path, value);
    } catch (e) {
      if (at) errors.push({ path: at, message: e.message });
      if (header) { table = null; at = null; }
      p.i = start;
      p.skipLine();
    }
  }
  return { data, errors };
}

/** Codex's [mcp_servers.<name>] tables. enabled is false only when it says enabled = false. */
export function codexMcp(text) {
  const { data, errors } = parseToml(text);
  const table = isObject(data.mcp_servers) ? data.mcp_servers : {};
  const names = [...Object.keys(table)];
  for (const e of errors) if (e.path[0] === "mcp_servers" && e.path[1] && !names.includes(e.path[1])) names.push(e.path[1]);
  return names.map(name => {
    const config = isObject(table[name]) ? table[name] : {};
    const error = errors.find(e => e.path[0] === "mcp_servers" && e.path[1] === name)?.message ?? null;
    return { name, config, enabled: config.enabled !== false, error };
  });
}

export const MASK = "••••";
const SECRET_MAPS = new Set(["env", "headers", "http_headers", "env_http_headers"]);
const SECRET = /token|secret|key|password|auth/i;
const FLAG = /^--?[\w.-]*(?:token|secret|key|password|auth)[\w.-]*$/i;
const FLAG_VALUE = /^(--?[\w.-]*(?:token|secret|key|password|auth)[\w.-]*=).*$/i;
const QUERY = /([?&][^=&#]*(?:token|secret|key|password|auth)[^=&#]*=)[^&#]*/gi;

function redactArgs(args) {
  return args.map((a, i) => {
    if (typeof a !== "string") return a;
    if (i > 0 && typeof args[i - 1] === "string" && FLAG.test(args[i - 1])) return MASK;
    return a.replace(FLAG_VALUE, `$1${MASK}`);
  });
}

/** A copy with env/header values, secret-named strings, secret flags in args and secret URL parameters masked. */
export function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (!isObject(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (SECRET_MAPS.has(k) && isObject(x)) out[k] = Object.fromEntries(Object.keys(x).map(n => [n, MASK]));
    else if (k === "args" && Array.isArray(x)) out[k] = redactArgs(x);
    else if (k === "url" && typeof x === "string") out[k] = x.replace(QUERY, `$1${MASK}`);
    else if (typeof x === "string" && SECRET.test(k)) out[k] = MASK;
    else out[k] = redact(x);
  }
  return out;
}

/** One line for a server row: "stdio <command> <args>" or "http|sse <url>", at most 80 characters. */
export function serverSummary(config) {
  const c = redact(isObject(config) ? config : {});
  const s = c.url
    ? `${c.type === "sse" ? "sse" : "http"} ${c.url}`
    : `stdio ${[c.command, ...(Array.isArray(c.args) ? c.args : [])].filter(x => x !== undefined && x !== null).join(" ")}`;
  return s.length > 80 ? s.slice(0, 79) + "…" : s;
}

const show = x => (typeof x === "string" ? (/\s/.test(x) ? JSON.stringify(x) : x) : JSON.stringify(x));

/** key: value lines for the detail view; nested tables one level deeper. Pass a redacted config. */
export function configLines(v, depth = 0) {
  const out = [];
  for (const [k, x] of Object.entries(isObject(v) ? v : {})) {
    if (isObject(x)) { out.push({ depth, text: `${k}:` }); out.push(...configLines(x, depth + 1)); }
    else if (Array.isArray(x)) out.push({ depth, text: `${k}: ${x.map(show).join(" ")}` });
    else out.push({ depth, text: `${k}: ${String(x)}` });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/my-plugins-logic.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add mods/my-plugins/logic.js tests/my-plugins-logic.test.mjs
git commit -m "my-plugins: read Claude and Codex MCP settings, mask secrets"
```

---

### Task 3: 패널 mod (`main.js`, `mod.json`, 아이콘)

**Files:**
- Create: `mods/my-plugins/main.js`, `mods/my-plugins/mod.json`, `mods/my-plugins/plugins.svg`

**Interfaces:**
- Consumes (logic.js): `join, nativePath, samePath, ancestors, listingCommand, listingLines, frontmatter, agentKind, dragText, sortItems, groupBySource, emptyText, servers, claudeMcp, pluginRoots, codexMcp, redact, serverSummary, configLines`.
- Consumes (other mods): `my-files-drag` overlay props `{ text, name, icon, panel }`; `my-files-open` popup props `{ path, dir }` (herdr adds `overlay`).
- Produces: block mod `my-plugins`; layout block id `plugins` (Task 4 wires it). Panel visible when `panel-body.active === "plugins"`.

Item shape used in main.js:
- MCP: `{ kind: "mcp", name, source, file, config, enabled?, error? }` (`error` string or null/undefined)
- Skill: `{ kind: "skill", name, source, plugin: string|null, file, description, body, error?: true }`

- [ ] **Step 1: Create `mods/my-plugins/mod.json`**

```json
{ "place": "none" }
```

- [ ] **Step 2: Create `mods/my-plugins/plugins.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6V4.8a2 2 0 1 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.2a2 2 0 1 0 0 4H18v4a1 1 0 0 1-1 1h-4v-1.2a2 2 0 1 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.2a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1z"/></svg>
```

- [ ] **Step 3: Create `mods/my-plugins/main.js`**

```js
// Plugins panel: the MCP servers and skills Claude Code or Codex sees from the focused pane's folder.
// Read only. Local or remote (the pane's machine), like the Files and GitHub panels.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { spaces, panes, focused, agents, exec, readTextFile, theme, layout, openOverlay, window } from "herdr";
import {
  join, nativePath, samePath, ancestors, listingCommand, listingLines, frontmatter, agentKind, dragText,
  sortItems, groupBySource, emptyText, servers, claudeMcp, pluginRoots, codexMcp, redact, serverSummary, configLines,
} from "./logic.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const bare = a => (typeof a === "string" ? a.slice(a.lastIndexOf("/") + 1) : a);
const sameAddress = (a, b) => a === b || (!a?.includes("/") !== !b?.includes("/") && bare(a) === bare(b));
const base = p => String(p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(p ?? "");
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The focused terminal and the name of the agent running in it (null when none).
function focusedAgent() {
  const f = focused(), address = f?.shown ?? f?.terminal ?? null;
  if (!address) return { address: null, name: null };
  const agent = agents().find(a => sameAddress(a.address, address));
  if (agent) return { address, name: [agent.program?.name, agent.program?.agent, agent.name].filter(x => typeof x === "string").join(" ") };
  const pane = f.pane ? panes().find(p => p.pane === f.pane) : null;
  const program = pane?.program;
  return { address, name: program?.agent ? [program.name, program.agent].filter(x => typeof x === "string").join(" ") : null };
}

// Everything the panel shows for one place and agent. Throws when the machine can't be reached.
async function collect({ cwd, on }, agent) {
  const windows = !on && window()?.platform === "windows";
  const list = async dirs => {
    const c = listingCommand(dirs, windows);
    const r = await exec(c.command, c.args, { on });
    if (r.code !== 0) throw new Error((r.stderr || "").trim() || "목록을 읽지 못했어요");
    return listingLines(r.stdout);
  };
  const { home } = await list([]);
  if (!home) throw new Error("홈 폴더를 찾지 못했어요");
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
  const repo = top?.code === 0 && top.stdout.trim() ? top.stdout.trim() : cwd;

  // A missing or unreadable file counts as empty.
  const read = path => readTextFile(path, { on }).then(text => text, () => null);
  const problems = [], mcp = [], skillDirs = [], seen = new Set();
  const json = async (file, tab) => {
    const text = await read(file);
    if (text === null) return null;
    try { return JSON.parse(text); } catch { problems.push({ tab, file }); return null; }
  };
  // Same folder twice (e.g. cwd is the home folder): keep the first, which is 전역.
  const addDir = (dir, source, plugin = null) => {
    const k = dir.replaceAll("\\", "/").toLowerCase();
    if (!seen.has(k)) { seen.add(k); skillDirs.push({ dir, source, plugin }); }
  };

  if (agent === "claude") {
    const userFile = join(home, ".claude.json"), projectFile = join(repo, ".mcp.json");
    const pluginsFile = join(home, ".claude", "plugins", "installed_plugins.json");
    const [user, project, plugins] = await Promise.all([json(userFile, "mcp"), json(projectFile, "mcp"), json(pluginsFile, "skills")]);
    if (user) {
      const { global, local } = claudeMcp(user, cwd, repo);
      for (const s of global) mcp.push({ ...s, kind: "mcp", source: "전역", file: userFile });
      for (const s of local) mcp.push({ ...s, kind: "mcp", source: "로컬", file: userFile });
    }
    if (project && !samePath(projectFile, userFile)) {
      for (const s of servers(project.mcpServers)) mcp.push({ ...s, kind: "mcp", source: "프로젝트", file: projectFile });
    }
    addDir(join(home, ".claude", "skills"), "전역");
    addDir(join(repo, ".claude", "skills"), "프로젝트");
    for (const p of pluginRoots(plugins, repo)) addDir(join(p.path, "skills"), `플러그인:${p.plugin}`, p.plugin);
  } else {
    const userFile = join(home, ".codex", "config.toml"), projectFile = join(repo, ".codex", "config.toml");
    const files = [[userFile, "전역"], ...(samePath(projectFile, userFile) ? [] : [[projectFile, "프로젝트"]])];
    const texts = await Promise.all(files.map(([file]) => read(file)));
    files.forEach(([file, source], i) => {
      if (texts[i] !== null) for (const s of codexMcp(texts[i])) mcp.push({ ...s, kind: "mcp", source, file });
    });
    addDir(join(home, ".agents", "skills"), "전역");
    for (const d of ancestors(cwd, repo)) addDir(join(d, ".agents", "skills"), "프로젝트");
  }

  const found = await list(skillDirs.map(d => d.dir));
  const skills = await Promise.all(skillDirs.flatMap(d => (found.dirs.get(d.dir) ?? []).map(async name => {
    const file = join(d.dir, name, "SKILL.md"), text = await read(file);
    const common = { kind: "skill", source: d.source, plugin: d.plugin, file };
    if (text === null) return { ...common, name, description: "읽지 못했어요", body: "", error: true };
    const fm = frontmatter(text, name);
    return { ...common, name: fm.name, description: fm.description, body: fm.body };
  })));
  return { mcp: sortItems(mcp), skills: sortItems(skills), problems };
}

export default class Plugins extends View {
  init(_props, cx) {
    this.tab = "mcp"; this.pick = null; // pick: { address, agent } chosen with the chips
    this.data = null; this.error = null; this.loading = false; this.again = false;
    this.detail = null; this.context = null; this.wasShown = false;
    if (this.visible()) this.refresh(cx);
  }

  // Whether the panel is open on this tab; true when the layout has no such panel.
  visible() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !body) return true;
    return !panel.hidden && body.active === "plugins";
  }

  // The chips' choice while the same terminal stays focused; otherwise what that terminal runs.
  agent() {
    const f = focusedAgent();
    if (this.pick && this.pick.address === f.address) return this.pick.agent;
    return agentKind(f.name);
  }

  key() {
    const loc = location();
    return JSON.stringify({ cwd: loc.cwd ?? null, on: loc.on ?? null, agent: this.agent() });
  }

  refresh(cx) {
    const next = this.key();
    if (next !== this.context?.key) {
      const loc = location();
      this.context = { key: next, cwd: loc.cwd, on: loc.on, agent: this.agent() };
      this.data = null; this.error = null; this.detail = null; this.loading = false; this.again = false;
    }
    if (!this.context.cwd) return;
    if (this.loading) { this.again = true; return; }
    const context = this.context;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const data = await collect(context, context.agent);
        if (this.context === context) { this.data = data; this.error = null; }
      } catch (e) {
        if (this.context === context) this.error = String(e?.message ?? e);
      } finally {
        if (this.context === context) {
          this.loading = false;
          if (this.again) { this.again = false; this.refresh(cx); }
        }
        cx.notify();
      }
    });
  }

  choose(agent, cx) {
    this.pick = { address: focusedAgent().address, agent };
    this.refresh(cx);
  }

  // The pointer left the panel with a row held: my-files-drag takes over and types the row on release.
  dropOut() {
    const drag = this.drag; this.drag = null;
    if (!drag) return;
    const panel = this.origin && this.size ? { ...this.origin, width: this.size.width, height: this.size.height } : null;
    openOverlay({ mod: "my-files-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { ...drag, panel } });
  }

  row(item, t, badge) {
    const off = item.kind === "mcp" && item.enabled === false;
    const failed = item.kind === "mcp" && Boolean(item.error);
    const sub = item.kind === "mcp" ? serverSummary(item.config) : (item.description.split("\n")[0] ?? "");
    const id = `${item.kind}-${item.source}-${item.name}-${item.file}`;
    return h_flex().id(`pl-${id}`).flex_none().px(8).py(6).gap(6).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
      .on_mouse_down("left", () => { this.drag = { text: dragText(item, this.context.agent), name: item.name, icon: "🧩" }; })
      .on_click((_e, cx) => { this.detail = item; cx.notify(); })
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().flex_1().min_w(0).truncate().text_color(off ? t.dim : t.foreground).child(item.name))
          .when(off, el => el.child(badge("꺼짐", t.dim)))
          .when(failed, el => el.child(badge("읽지 못함", t.ansi1))))
        .when(Boolean(sub), el => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(sub))))
      .when(!this.context.on, el => el.child(div().id(`pl-open-${id}`).w(20).h(20).flex_none().flex().items_center().justify_center().rounded(5)
        .text_color(t.dim).hover(s => s.bg(t.selected).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          const windows = window()?.platform === "windows";
          openOverlay({ mod: "my-files-open", kind: "popup", width: 200, height: 136, props: { path: nativePath(item.file, windows), dir: false } });
        })
        .child("⋯")));
  }

  listView(t, chip, badge) {
    const c = this.context, agent = c?.agent ?? this.agent();
    const items = this.data ? (this.tab === "mcp" ? this.data.mcp : this.data.skills) : [];
    const problems = (this.data?.problems ?? []).filter(p => p.tab === this.tab);
    const message = !c?.cwd ? "폴더가 없어요" : this.error ? this.error : !this.data ? "불러오는 중…" : emptyText(this.tab);
    const where = c?.cwd ? (c.on ? `${c.on}:${base(c.cwd)}` : base(c.cwd)) : "";
    return [
      h_flex().h(42).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Plugins"))
        .child(div().flex_1())
        .child(chip("pl-agent-claude", "Claude", agent === "claude", cx => this.choose("claude", cx)))
        .child(chip("pl-agent-codex", "Codex", agent === "codex", cx => this.choose("codex", cx)))
        .child(div().id("plugins-refresh").w(20).cursor_pointer().text_color(t.muted)
          .on_click((_e, cx) => { this.refresh(cx); cx.notify(); }).child(this.loading ? "…" : "⟳")),
      h_flex().h(38).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
        .child(chip("pl-tab-mcp", "MCP", this.tab === "mcp", () => { this.tab = "mcp"; }))
        .child(chip("pl-tab-skills", "Skills", this.tab === "skills", () => { this.tab = "skills"; }))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(where)),
      v_flex().id("plugins-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .when(Boolean(this.error && this.data), el => el.child(div().px(8).py(4).text_size(12).text_color(t.ansi1).child(`⚠ ${this.error}`)))
        .children(problems.map(p => div().px(8).py(4).text_size(12).text_color(t.ansi1).child(`⚠ 읽지 못했어요: ${p.file}`)))
        .children(groupBySource(items).flatMap(g => [
          div().px(8).pt(8).pb(2).text_size(11).text_color(t.muted).child(g.source),
          ...g.items.map(item => this.row(item, t, badge)),
        ]))
        .when(items.length === 0, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(message))),
    ];
  }

  detailView(t, badge) {
    const d = this.detail;
    const content = v_flex().id("plugins-detail").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(8)
      .child(div().text_size(12).text_color(t.dim).child(`${d.source} · ${d.file}`));
    const body = d.kind === "skill"
      ? content
        .when(Boolean(d.description), el => el.child(div().text_size(12).text_color(t.muted).child(d.description)))
        .child(d.body.trim() ? TextView.markdown(`pl-md-${d.source}-${d.name}`, d.body).selectable(true) : div().text_color(t.dim).child("본문 없음"))
      : content
        .when(d.enabled === false, el => el.child(h_flex().child(badge("꺼짐", t.dim))))
        .when(Boolean(d.error), el => el.child(div().text_size(12).text_color(t.ansi1).child(`읽지 못함: ${d.error}`)))
        .children(configLines(redact(d.config)).map(line => div().pl(line.depth * 14).text_size(12).child(line.text)));
    return [
      h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().id("plugins-back").w(20).cursor_pointer().text_color(t.muted)
          .on_click((_e, cx) => { this.detail = null; cx.notify(); }).child("←"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(d.name)),
      body,
    ];
  }

  render(cx) {
    const shown = this.visible();
    if (shown && (!this.wasShown || this.key() !== this.context?.key)) this.refresh(cx);
    this.wasShown = shown;
    const t = theme();
    const chip = (id, label, on, onClick) => h_flex().id(id).h(24).px(9).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const badge = (label, color) => div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(11).text_color(color).child(label);
    return v_flex().id("plugins").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .on_mouse_up("left", () => { this.drag = null; })
      // Window-relative panel box (pointer minus its in-panel offset): a drop back on it cancels.
      .on_mouse_move(e => { if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; })
      .on_size_change(size => { this.size = size; })
      .on_hover(hovered => { if (!hovered) this.dropOut(); })
      .children(this.detail ? this.detailView(t, badge) : this.listView(t, chip, badge));
  }
}
```

- [ ] **Step 4: Deploy and load-check**

Run (Git Bash):
```bash
rm -rf ~/.config/herdr-app/mods/my-plugins && cp -r mods/my-plugins ~/.config/herdr-app/mods/my-plugins
herdr-app check "$USERPROFILE/.config/herdr-app/mods/my-plugins"
```
Expected: check reports no errors. If it reports an error, fix `main.js` (repository copy), redeploy, re-run.

- [ ] **Step 5: Run unit tests again**

Run: `node --test tests/my-plugins-logic.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mods/my-plugins/main.js mods/my-plugins/mod.json mods/my-plugins/plugins.svg
git commit -m "my-plugins: panel listing MCP servers and skills for Claude and Codex"
```

---

### Task 4: 탭 바 버튼 · 설치 · 문서 · 실제 확인

**Files:**
- Modify: `mods/my-tabs/main.js:80` and `:99`
- Modify: `install.ps1`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: block mod `my-plugins` and its `plugins.svg` (Task 3); layout block id `plugins`.

- [ ] **Step 1: my-tabs — Plugin 버튼**

In `mods/my-tabs/main.js` line 80 replace:
```js
    const enabled = [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "github"])];
```
with:
```js
    const enabled = [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "github", "plugins"])];
```
After line 99 (the GitHub button) add:
```js
      .when(enabled.includes("plugins"), el => el.child(panelButton("plugins", "Plugin", "mods/my-plugins/plugins.svg")))
```

- [ ] **Step 2: install.ps1 — mod 목록과 plugins 칸**

Replace:
```powershell
$mods = @("my-files", "my-files-drag", "my-files-open", "my-github", "my-tabs")
```
with:
```powershell
$mods = @("my-files", "my-files-drag", "my-files-open", "my-github", "my-plugins", "my-tabs")
```
After the `if (-not (@($panelBody.children) | Where-Object { $_.id -eq "github" })) { … }` block add:
```powershell
if (-not (@($panelBody.children) | Where-Object { $_.id -eq "plugins" })) {
  $plugins = [pscustomobject]@{ id = "plugins"; type = "block"; content = [pscustomobject]@{ mod = "my-plugins" } }
  $panelBody.children = @($panelBody.children) + $plugins
}
```
Replace the last line's message with:
```powershell
Write-Host "완료. 탭 바에 Files · Changes · GitHub · Plugin 버튼이 보이면 성공이에요."
```
Keep the file UTF-8 **with BOM** (Windows PowerShell 5.1 needs it for the Korean text). Check: `head -c 3 install.ps1 | od -An -tx1` → ` ef bb bf`.

- [ ] **Step 3: package.json — test script**

```json
    "test": "node --test tests/my-files-logic.test.mjs tests/my-github-logic.test.mjs tests/my-files-open-logic.test.mjs tests/my-plugins-logic.test.mjs"
```
And description: `"Herdr mods: editable Files panel, drag paths into terminals, GitHub issues/PR panel, MCP and skills panel"`.

Run: `npm test` → Expected: all PASS.

- [ ] **Step 4: Installer test in a temporary Herdr home**

Run (PowerShell):
```powershell
$tmp = Join-Path $env:TEMP "herdr-plugins-test"; Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$tmp\layouts" | Out-Null
Copy-Item "$env:USERPROFILE\.config\herdr-app\layouts\my-layout.json" "$tmp\layouts\my-layout.json"
$env:HERDR_APP_HOME = $tmp; .\install.ps1; .\install.ps1; Remove-Item Env:HERDR_APP_HOME
(Select-String -Path "$tmp\layouts\my-layout.json" -Pattern '"id":\s*"plugins"').Count
Test-Path "$tmp\mods\my-plugins\main.js"
```
Expected: both runs succeed; the count is `1` (second run added nothing); `True`. (The layout switch step runs `herdr-app`; with `HERDR_APP_HOME` set to the temp folder `shared.json` is missing, so it may switch the real app's layout to `my-layout`, which it already uses — harmless.)

- [ ] **Step 5: README**

In the mod table, after the `my-github` row add:
```markdown
| `my-plugins` | 지금 폴더에서 Claude Code·Codex가 보는 MCP 서버와 스킬 목록 (읽기 전용) |
```
Change the first description line to:
```markdown
오른쪽 패널의 Files를 편집 가능한 패널로 바꾸고, GitHub 이슈·PR 패널과 MCP·스킬 목록 패널을 추가합니다.
```
Change `my-tabs` row to `기본 탭 바의 복제본. Files · Changes 옆에 GitHub · Plugin 버튼 추가`.

After the `### GitHub 패널` section add:
```markdown
### Plugins 패널 (`my-plugins`)

- 탭 바의 **Plugin** 버튼으로 엽니다. 포커스된 칸의 폴더에서 에이전트가 쓰는 **MCP 서버**와 **스킬**을 보여 줍니다. 읽기만 하고 아무것도 바꾸지 않습니다.
- 헤더의 **[Claude] [Codex]**: 포커스된 칸이 Codex면 Codex, 아니면 Claude가 자동으로 골라집니다. 직접 눌러 바꿀 수 있습니다(다른 칸으로 가면 다시 자동).
- **[MCP] [Skills]** 탭. 출처별로 묶어 보여 줍니다.

  | | MCP | Skills |
  |---|---|---|
  | Claude | `~/.claude.json`(전역, 이 폴더의 로컬), 저장소의 `.mcp.json`(프로젝트) | `~/.claude/skills`(전역), 저장소의 `.claude/skills`(프로젝트), 설치된 플러그인의 `skills/`(플러그인:이름) |
  | Codex | `~/.codex/config.toml`(전역), 저장소의 `.codex/config.toml`(프로젝트) | `~/.agents/skills`(전역), 지금 폴더부터 저장소 루트까지의 `.agents/skills`(프로젝트) |

- MCP 행에는 실행 명령이나 URL이, 스킬 행에는 설명이 보입니다. Codex에서 `enabled = false` 인 서버는 `꺼짐`.
- 행을 누르면 상세: 스킬은 SKILL.md 본문(마크다운), MCP는 설정. **env·헤더·토큰 같은 비밀 값은 `••••` 로 가립니다.**
- **드래그**: 스킬 행을 터미널에 놓으면 Claude는 `/이름 `(플러그인은 `/플러그인:이름 `), Codex는 `$이름 ` 이 입력됩니다. MCP 행은 `이름 MCP `.
- 각 행의 **`⋯`**: SKILL.md 또는 설정 파일을 기본 프로그램 / VS Code / 탐색기로 엽니다(로컬만).
- 원격 스페이스에서는 그 머신의 설정을 읽습니다.
- 패널이 보일 때와 폴더·에이전트가 바뀔 때 다시 읽습니다. ⟳ 로 바로 새로고침.
```
In 설치 step 1 change "다섯 mod" → "여섯 mod"; in step 2 add the bullet `- 오른쪽 패널(`panel-body`)에 `plugins` 칸(`my-plugins`) 추가` after the github one. In 수동 설치 change "다섯 폴더" → "여섯 폴더" and add the block line:
```json
     { "id": "plugins", "type": "block", "content": { "mod": "my-plugins" } }
```
In 제거 add `my-plugins` to the folder list and change "위 세 가지" → "위 네 가지" with "github·plugins 칸 삭제". In 알려진 한계 add:
```markdown
- Plugins 패널은 읽기 전용입니다(켜기/끄기·삭제는 각 에이전트에서: Claude는 `/mcp`, `claude mcp remove`). Codex 시스템 스킬과 `/etc/codex/skills` 는 보이지 않습니다. 설정을 바꾼 뒤 열린 세션에 반영되는지는 에이전트에 달려 있습니다.
```

- [ ] **Step 6: Install for real and verify with the user**

Run: `.\install.cmd` (from the repository). Expected: mods copied (six), layout `my-layout` gets the `plugins` block, `herdr-app status` shows no new errors (the existing `myserver` ssh error is unrelated).

Codex fixture (this PC has no `~/.codex` or `~/.agents`; create, check, then delete exactly these):
```bash
mkdir -p ~/.codex ~/.agents/skills/test-skill
printf '[mcp_servers.demo]\ncommand = "npx"\nargs = ["-y", "demo-mcp", "--api-key", "sk-test"]\nenv = { DEMO_TOKEN = "x" }\n\n[mcp_servers.off]\nurl = "https://example.com/mcp"\nenabled = false\n' > ~/.codex/config.toml
printf -- '---\nname: test-skill\ndescription: 테스트용 스킬\n---\n\n# 테스트\n' > ~/.agents/skills/test-skill/SKILL.md
```
Ask the user to check:
1. Plugin 버튼 → MCP 탭: `전역` 아래 context7 등, `stdio npx …` 요약. 행 누르면 env 값이 `••••`.
2. Skills 탭: `전역`(hwpx 등), `플러그인:superpowers` 등. 스킬 누르면 본문 마크다운.
3. 스킬 행을 Claude 터미널로 드래그 → `/hwpx ` 입력. 플러그인 스킬 → `/superpowers:brainstorming `.
4. `⋯` → VS Code로 SKILL.md 열림.
5. [Codex] 칩: MCP `demo`(`--api-key ••••`), `off`(꺼짐), Skills `test-skill`; 드래그 → `$test-skill `.
6. 다른 칸으로 포커스 이동 → 자동 선택으로 돌아옴.

Then remove the fixture: `rm -rf ~/.codex ~/.agents` (only if they did not exist before Step 6 — verify with `ls -a ~` before creating them).

- [ ] **Step 7: Commit**

```bash
git add mods/my-tabs/main.js install.ps1 package.json README.md
git commit -m "my-plugins: Plugin button, installer and README"
```
