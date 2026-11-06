import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-sessions/logic.js", import.meta.url).href);

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

test("encodeProject: everything but letters and digits becomes a dash", () => {
  assert.equal(L.encodeProject("C:\\MyCode\\herdr-UI"), "C--MyCode-herdr-UI");
  assert.equal(L.encodeProject("C:/Users/me/바탕 화면/x"), "C--Users-me-------x");
  assert.equal(L.encodeProject("/home/me/a.b_c"), "-home-me-a-b-c");
  assert.equal(L.encodeProject("C:\\MyCode\\app\\"), "C--MyCode-app");
  assert.equal(L.encodeProject("C:\\"), "C--");
});

test("samePath and isUnder", () => {
  assert.ok(L.samePath("C:\\MyCode\\App", "c:/mycode/app/"));
  assert.ok(!L.samePath("/home/A", "/home/a"));
  assert.ok(L.isUnder("C:\\MyCode\\app\\sub", "c:/mycode/app"));
  assert.ok(L.isUnder("/r/app", "/r/app"));
  assert.ok(!L.isUnder("/r/app-old", "/r/app"));
  assert.ok(!L.isUnder("/r", "/r/app"));
});

test("startFolder: the folder the session's storage name stands for", () => {
  assert.equal(L.startFolder("C--MyCode-app", "C:\\MyCode\\app"), "C:\\MyCode\\app");
  assert.equal(L.startFolder("C--MyCode-app", "C:\\MyCode\\app\\mods\\x"), "C:\\MyCode\\app");
  assert.equal(L.startFolder("c--mycode-app", "C:\\MyCode\\App\\x"), "C:\\MyCode\\App");
  assert.equal(L.startFolder("C--", "C:\\Users"), "C:\\");
  assert.equal(L.startFolder("-r-app", "/r/app/sub"), "/r/app");
  assert.equal(L.startFolder("-other", "/r/app/sub"), "/r/app/sub"); // not found: cwd itself
});

test("worktreePaths", () => {
  const out = "worktree C:/r/app\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/r/app-wt\nHEAD def\ndetached\n\n";
  assert.deepEqual(L.worktreePaths(out, "C:\\r\\app"), ["C:\\r\\app", "C:/r/app-wt"]);
  assert.deepEqual(L.worktreePaths("", "/r"), ["/r"]);
});

test("sessionLines: tab-separated rows with JSON tokens", () => {
  const line = ["FILE", "C--r-app", U1, "1700000000", '"C:\\\\r\\\\app"', "", '"제목 \\"하나\\""', '"main"'].join("\t");
  assert.deepEqual(L.sessionLines(`${line}\r\n\r\n`), [
    { dir: "C--r-app", id: U1, mtime: 1700000000, cwd: "C:\\r\\app", customTitle: "", aiTitle: '제목 "하나"', branch: "main" },
  ]);
  const badToken = ["FILE", "d", U1, "1", '"/r"', '"broken', '"ok"', ""].join("\t");
  assert.equal(L.sessionLines(badToken)[0].customTitle, "");
  assert.equal(L.sessionLines(badToken)[0].aiTitle, "ok");
  assert.deepEqual(L.sessionLines(["FILE", "d", U1, "1", "", "", "", ""].join("\t")), []); // no cwd
  assert.deepEqual(L.sessionLines(["FILE", "d", U1, "x", '"/r"', "", "", ""].join("\t")), []); // bad time
  assert.deepEqual(L.sessionLines("something else\n"), []);
});

test("toSessions: title order, start folder, UUID ids only", () => {
  const base = { dir: "-r-app", id: U1, mtime: 5, cwd: "/r/app/sub", branch: "main" };
  const [a] = L.toSessions([{ ...base, customTitle: "내 이름", aiTitle: "자동" }]);
  assert.deepEqual(a, { id: U1, title: "내 이름", mtime: 5, branch: "main", folder: "/r/app" });
  assert.equal(L.toSessions([{ ...base, customTitle: "", aiTitle: "자동\n제목" }])[0].title, "자동 제목");
  assert.equal(L.toSessions([{ ...base, customTitle: "", aiTitle: "" }])[0].title, "(제목 없음)");
  assert.deepEqual(L.toSessions([{ ...base, id: "../evil", customTitle: "", aiTitle: "" }]), []);
  assert.deepEqual(L.toSessions([{ ...base, id: "--dangerous", customTitle: "", aiTitle: "" }]), []);
});

test("inScope and pickSessions", () => {
  const ctx = { worktrees: ["C:\\r\\app", "C:/r/wt"], cwd: "C:\\r\\app\\sub" };
  const s = (id, folder, mtime) => ({ id, title: id, mtime, branch: "", folder });
  const list = [s("root", "C:\\r\\app", 3), s("sub", "C:\\r\\app\\sub", 5), s("wt", "C:\\r\\wt", 4), s("old", "C:\\r\\app-old", 9)];
  assert.ok(L.inScope(list[0], "all", ctx));
  assert.ok(L.inScope(list[2], "all", ctx));
  assert.ok(!L.inScope(list[3], "all", ctx));
  assert.ok(!L.inScope(list[0], "here", ctx));
  assert.ok(L.inScope(list[1], "here", ctx));
  assert.deepEqual(L.pickSessions(list, "all", ctx, 2), { items: [list[1], list[2]], more: true });
  assert.deepEqual(L.pickSessions(list, "here", ctx, 2), { items: [list[1]], more: false });
  assert.deepEqual(L.pickSessions(list, "all", ctx, 3).more, false);
});

test("relativeTime", () => {
  const now = 1000 * 60 * 60 * 24 * 400;
  assert.equal(L.relativeTime(now - 30 * 1000, now), "방금");
  assert.equal(L.relativeTime(now - 5 * 60 * 1000, now), "5분 전");
  assert.equal(L.relativeTime(now - 3 * 3600 * 1000, now), "3시간 전");
  assert.equal(L.relativeTime(now - 2 * 86400 * 1000, now), "2일 전");
  assert.equal(L.relativeTime(now - 65 * 86400 * 1000, now), "2개월 전");
  assert.equal(L.relativeTime(now + 5000, now), "방금");
});

test("sessionMeta: time, branch, and the folder unless it is the root", () => {
  const now = 10 * 3600 * 1000;
  const at = 7 * 3600; // seconds: three hours before now
  const s = (folder, branch) => ({ id: U2, title: "t", mtime: at, branch, folder });
  assert.equal(L.sessionMeta(s("C:\\r\\app", "main"), "C:/r/app", now), "3시간 전 · main");
  assert.equal(L.sessionMeta(s("C:\\r\\app\\mods\\x", "main"), "C:/r/app", now), "3시간 전 · main · mods/x");
  assert.equal(L.sessionMeta(s("C:\\r\\wt", ""), "C:/r/app", now), "3시간 전 · wt");
});

test("tabTitle and emptyText", () => {
  assert.equal(L.tabTitle("짧은 제목"), "짧은 제목");
  const long = L.tabTitle("가".repeat(60));
  assert.equal(long.length, 40);
  assert.ok(long.endsWith("…"));
  assert.equal(L.emptyText("all"), "이 저장소에 세션이 없어요");
  assert.equal(L.emptyText("here"), "이 폴더에서 시작한 세션이 없어요");
});

test("toSessions: a blank customTitle falls through to aiTitle, then the placeholder", () => {
  const base = { dir: "-r-app", id: U1, mtime: 5, cwd: "/r/app", branch: "" };
  assert.equal(L.toSessions([{ ...base, customTitle: "  \n ", aiTitle: "자동" }])[0].title, "자동");
  assert.equal(L.toSessions([{ ...base, customTitle: " ", aiTitle: " \t" }])[0].title, "(제목 없음)");
});

test("toSessions drops a session whose start folder is relative or has a .. segment", () => {
  const base = { dir: "-other", id: U1, mtime: 5, branch: "" };
  assert.deepEqual(L.toSessions([{ ...base, cwd: "/r/app/../x" }, { ...base, cwd: "relative/x" }]), []);
});

test("sessionLines drops a line with an empty time", () => {
  assert.deepEqual(L.sessionLines(["FILE", "d", U1, "", '"/r"', "", "", ""].join("\t")), []);
});

test("psQuote doubles straight and typographic single quotes", () => {
  assert.equal(L.psQuote("it's"), "'it''s'");
  assert.equal(L.psQuote("‘a’b‚c‛"), "'‘‘a’’b‚‚c‛‛'");
});

test("sessionsCommand: prefixes go in as arguments or quoted literals", () => {
  const sh = L.sessionsCommand(["-r-app", "-r-wt"], false);
  assert.equal(sh.command, "sh");
  assert.equal(sh.args[0], "-c");
  assert.deepEqual(sh.args.slice(2), ["sessions", "-r-app", "-r-wt"]);
  assert.ok(sh.args[1].includes("head -n 300"));
  const ps = L.sessionsCommand(["C--r-app"], true);
  assert.equal(ps.command, "powershell");
  assert.ok(ps.args[2].includes("@('C--r-app')"));
  assert.ok(ps.args[2].includes("-First 300"));
});

// A fake home holding fake session files; nothing here touches the real ~/.claude.
function sessionsFixture() {
  const home = pjoin(mkdtempSync(pjoin(tmpdir(), "sessions-")), "a&b it's it’s 홈");
  const projects = pjoin(home, ".claude", "projects");
  const put = (dir, id, records) => {
    mkdirSync(pjoin(projects, dir), { recursive: true });
    writeFileSync(pjoin(projects, dir, `${id}.jsonl`), records.map(r => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n");
  };
  const pad = JSON.stringify({ type: "pad", text: "x".repeat(300000) });
  const id = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
  // Text quoting "cwd":"…" inside a message is escaped in the file, so it must not count as the cwd.
  put("C--r-app", id(1), [
    { type: "user", message: '"cwd":"C:\\fake" "aiTitle":"fake"' },
    { type: "user", cwd: "C:\\r\\app\\sub", gitBranch: "old" },
    { type: "ai-title", aiTitle: "첫 제목" },
    { type: "ai-title", aiTitle: '나중 "제목"' },
    { type: "user", cwd: "C:\\r\\app\\sub", gitBranch: "main" },
  ]);
  put("C--r-app", id(2), [{ cwd: "C:\\r\\app" }, { type: "custom-title", customTitle: "내 이름" }, { type: "ai-title", aiTitle: "자동" }]);
  put("C--r-app", id(3), [{ type: "mode", mode: "default" }]); // empty session: no cwd
  put("C--r-app", id(4), [pad, { cwd: "C:\\r\\app" }]); // cwd past the first 256 KB: treated as empty
  put("C--r-app", id(5), [{ cwd: "C:\\r\\app" }, { type: "ai-title", aiTitle: "오래된 제목" }, pad, { type: "x" }]); // title before the last 64 KB is not read
  mkdirSync(pjoin(projects, "C--r-app", id(1)), { recursive: true });
  writeFileSync(pjoin(projects, "C--r-app", id(1), `${id(9)}.jsonl`), JSON.stringify({ cwd: "C:\\r\\app" }) + "\n"); // a nested file is not a session
  put("C--r-app-old", id(6), [{ cwd: "C:\\r\\app-old" }]); // name matches; main.js filters it by path
  put("C--r-app2", id(7), [{ cwd: "C:\\r\\app2" }]); // no dash after the prefix: not a candidate
  put("C--other", id(8), [{ cwd: "C:\\other" }]);
  put("-r-unix", id(9), [{ cwd: "/r/unix" }]); // Unix storage names start with a dash
  return { home, id };
}
for (const windows of [true, false]) {
  const shell = windows ? "powershell" : "sh";
  const runs = !spawnSync(shell, windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"]).error;
  test(`sessionsCommand runs (${shell})`, { skip: !runs || (windows && process.platform !== "win32") }, () => {
    const { home, id } = sessionsFixture();
    const env = { ...process.env, USERPROFILE: home, HOME: windows ? home : home.replaceAll("\\", "/") };
    const c = L.sessionsCommand(["C--r-app"], windows);
    const r = spawnSync(c.command, c.args, { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    const rows = L.sessionLines(r.stdout);
    assert.deepEqual(rows.map(x => x.id).sort(), [id(1), id(2), id(5), id(6)]);
    const by = n => rows.find(x => x.id === id(n));
    assert.equal(by(1).dir, "C--r-app");
    assert.equal(by(1).cwd, "C:\\r\\app\\sub");
    assert.equal(by(1).aiTitle, '나중 "제목"');
    assert.equal(by(1).branch, "main");
    assert.ok(by(1).mtime > 1600000000);
    assert.equal(by(2).customTitle, "내 이름");
    assert.equal(by(2).aiTitle, "자동");
    assert.equal(by(5).aiTitle, "");
    assert.equal(by(6).dir, "C--r-app-old");
    const unix = L.sessionsCommand(["-r-unix"], windows);
    const dash = spawnSync(unix.command, unix.args, { encoding: "utf8", env });
    assert.equal(dash.status, 0, dash.stderr);
    assert.deepEqual(L.sessionLines(dash.stdout).map(x => [x.dir, x.id, x.cwd]), [["-r-unix", id(9), "/r/unix"]]);
    // No projects folder: nothing, and no failure.
    const empty = { ...env, USERPROFILE: pjoin(home, "none"), HOME: windows ? pjoin(home, "none") : pjoin(home, "none").replaceAll("\\", "/") };
    const none = spawnSync(c.command, c.args, { encoding: "utf8", env: empty });
    assert.equal(none.status, 0, none.stderr);
    assert.deepEqual(L.sessionLines(none.stdout), []);
  });
}

// ── runningSessionIds: 살아 있는 에이전트가 쓰고 있을 세션 표시 ─────────────

const S = (id, folder, mtime) => ({ id, folder, mtime });

test("runningSessionIds: 에이전트가 있는 폴더의 최신 세션을 표시한다", () => {
  const sessions = [S(U1, "/a", 200), S(U2, "/a", 100)];
  const ids = L.runningSessionIds(sessions, ["/a"]);
  assert.deepEqual([...ids], [U1]);
});

test("runningSessionIds: 같은 폴더에 에이전트가 둘이면 최신 둘을 표시한다", () => {
  const U3 = "33333333-3333-4333-8333-333333333333";
  const sessions = [S(U1, "/a", 300), S(U2, "/a", 200), S(U3, "/a", 100)];
  const ids = L.runningSessionIds(sessions, ["/a", "/a"]);
  assert.deepEqual([...ids].sort(), [U1, U2].sort());
});

test("runningSessionIds: 에이전트가 없는 폴더는 표시하지 않는다", () => {
  const sessions = [S(U1, "/a", 200), S(U2, "/b", 100)];
  assert.deepEqual([...L.runningSessionIds(sessions, ["/b"])], [U2]);
  assert.deepEqual([...L.runningSessionIds(sessions, [])], []);
});

test("runningSessionIds: 경로 표기가 달라도 같은 폴더로 본다", () => {
  const sessions = [S(U1, "/a/b", 100)];
  assert.deepEqual([...L.runningSessionIds(sessions, ["/a/b/"])], [U1]);
  assert.deepEqual([...L.runningSessionIds(sessions, ["\\a\\b"])], [U1]);
});

test("runningSessionIds: cwd 가 없는 칸은 세지 않는다", () => {
  const sessions = [S(U1, "/a", 100)];
  assert.deepEqual([...L.runningSessionIds(sessions, [null, undefined, ""])], []);
});

test("runningSessionIds: mtime 이 같으면 id 로 갈라 한 건만 고른다", () => {
  const sessions = [S(U2, "/a", 100), S(U1, "/a", 100)];
  assert.deepEqual([...L.runningSessionIds(sessions, ["/a"])], [U1]);
});
