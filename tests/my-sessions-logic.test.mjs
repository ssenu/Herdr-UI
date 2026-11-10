import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
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
    { dir: "C--r-app", id: U1, mtime: 1700000000, cwd: "C:\\r\\app", customTitle: "", aiTitle: '제목 "하나"', branch: "main", agentColor: "" },
  ]);
  const badToken = ["FILE", "d", U1, "1", '"/r"', '"broken', '"ok"', ""].join("\t");
  assert.equal(L.sessionLines(badToken)[0].customTitle, "");
  assert.equal(L.sessionLines(badToken)[0].aiTitle, "ok");
  assert.deepEqual(L.sessionLines(["FILE", "d", U1, "1", "", "", "", ""].join("\t")), []); // no cwd
  assert.deepEqual(L.sessionLines(["FILE", "d", U1, "x", '"/r"', "", "", ""].join("\t")), []); // bad time
  assert.deepEqual(L.sessionLines("something else\n"), []);
});

test("sessionLines: the ninth field is the agent color", () => {
  const f = ["FILE", "d", U1, "1", '"/r"', "", "", '"main"'];
  assert.equal(L.sessionLines([...f, '"purple"'].join("\t"))[0].agentColor, "purple");
  assert.equal(L.sessionLines(f.join("\t"))[0].agentColor, "");
});

test("toSessions color: only the eight colors count", () => {
  const base = { dir: "-r-app", id: U1, mtime: 5, cwd: "/r/app", branch: "", customTitle: "", aiTitle: "" };
  const color = c => L.toSessions([{ ...base, agentColor: c }])[0].color;
  assert.equal(color("purple"), "purple");
  for (const c of ["default", "", "weird", undefined]) assert.equal(color(c), null);
});

test("toSessions: title order, start folder, UUID ids only", () => {
  const base = { dir: "-r-app", id: U1, mtime: 5, cwd: "/r/app/sub", branch: "main" };
  const [a] = L.toSessions([{ ...base, customTitle: "내 이름", aiTitle: "자동" }]);
  assert.deepEqual(a, { id: U1, title: "내 이름", mtime: 5, branch: "main", folder: "/r/app", dir: "-r-app", color: null });
  assert.equal(L.toSessions([{ ...base, customTitle: "", aiTitle: "자동\n제목" }])[0].title, "자동 제목");
  assert.equal(L.toSessions([{ ...base, customTitle: "", aiTitle: "" }])[0].title, "(제목 없음)");
  assert.deepEqual(L.toSessions([{ ...base, id: "../evil", customTitle: "", aiTitle: "" }]), []);
  assert.deepEqual(L.toSessions([{ ...base, id: "--dangerous", customTitle: "", aiTitle: "" }]), []);
  assert.deepEqual(L.toSessions([{ ...base, dir: "../x", customTitle: "", aiTitle: "" }]), []);
  assert.deepEqual(L.toSessions([{ ...base, dir: "a/b", customTitle: "", aiTitle: "" }]), []);
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

test("liveIds: LIVE lines with a real id, lowercased, nothing else", () => {
  const out = [`LIVE\t${U1}`, `LIVE\t${U2.toUpperCase()}\r`, "LIVE\t--evil", "LIVE", ["FILE", "d", U1].join("\t")].join("\n");
  assert.deepEqual([...L.liveIds(out)], [U1, U2]);
  assert.equal(L.liveIds("").size, 0);
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
  const sessions = pjoin(home, ".claude", "sessions");
  mkdirSync(sessions, { recursive: true });
  const record = (name, pid, sid, startedAt) => writeFileSync(pjoin(sessions, name), JSON.stringify({ pid, sessionId: sid, startedAt, peerToken: "SECRET-TOKEN" }));
  record("1.json", process.pid, id(1), Date.now()); // this test's own process: running
  record("2.json", 4194300, id(2), Date.now()); // no such process
  record("3.123abc.key", process.pid, id(5), Date.now()); // not a session record
  writeFileSync(pjoin(sessions, "4.json"), "not json");
  return { home, id, sessions, record };
}
for (const windows of [true, false]) {
  const shell = windows ? "powershell" : "sh";
  const runs = !spawnSync(shell, windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"]).error;
  test(`sessionsCommand runs (${shell})`, { skip: !runs || (windows && process.platform !== "win32") }, t => {
    const { home, id, record } = sessionsFixture();
    if (windows) record("5.json", process.pid, id(6), 1000); // the pid now belongs to a newer process
    // sh only sees its own kind of pid (Git's sh on Windows numbers processes itself), so start one with sh.
    const sleeper = windows ? null : spawnSync("sh", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" }).stdout.trim();
    if (sleeper) {
      record("1.json", Number(sleeper), id(1), Date.now());
      t.after(() => spawnSync("sh", ["-c", `kill ${sleeper}`]));
    }
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
    assert.ok(!r.stdout.includes("SECRET-TOKEN"));
    assert.deepEqual([...L.liveIds(r.stdout)], [id(1)]);
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

const U3 = "33333333-3333-4333-8333-333333333333";

test("renameCommand: checked inputs, the record line, both shells", () => {
  const sh = L.renameCommand("-r-app", U1, "  새   이름 ", false);
  assert.equal(sh.command, "sh");
  assert.equal(sh.args[0], "-c");
  assert.deepEqual(sh.args.slice(2), ["rename", "-r-app", U1, JSON.stringify({ type: "custom-title", customTitle: "새 이름", sessionId: U1 })]);
  const ps = L.renameCommand("C--r-app", U1, "it's 이름", true);
  assert.equal(ps.command, "powershell");
  assert.deepEqual(ps.args.slice(0, 2), ["-NoProfile", "-Command"]);
  assert.ok(ps.args[2].includes(L.psQuote("C--r-app")));
  assert.ok(ps.args[2].includes(L.psQuote(JSON.stringify({ type: "custom-title", customTitle: "it's 이름", sessionId: U1 }))));
  assert.throws(() => L.renameCommand("../x", U1, "a", false), /세션을 가리키지 못했어요/);
  assert.throws(() => L.renameCommand("a/b", U1, "a", true), /세션을 가리키지 못했어요/);
  assert.throws(() => L.renameCommand("-r-app", "nope", "a", false), /세션을 가리키지 못했어요/);
  assert.throws(() => L.renameCommand("-r-app", U1, " \n ", false), /이름이 비어 있어요/);
});

test("colorCommand: checked inputs, the record line, both shells", () => {
  const rec = c => JSON.stringify({ type: "agent-color", agentColor: c, sessionId: U1 });
  const sh = L.colorCommand("-r-app", U1, "purple", false);
  assert.equal(sh.command, "sh");
  assert.deepEqual(sh.args.slice(2), ["color", "-r-app", U1, rec("purple")]);
  assert.deepEqual(L.colorCommand("-r-app", U1, "default", false).args.slice(2), ["color", "-r-app", U1, rec("default")]);
  const ps = L.colorCommand("C--r-app", U1, "cyan", true);
  assert.equal(ps.command, "powershell");
  assert.ok(ps.args[2].includes(L.psQuote(rec("cyan"))));
  assert.throws(() => L.colorCommand("-r-app", U1, "magenta", false), /알 수 없는 색이에요/);
  assert.throws(() => L.colorCommand("-r-app", U1, "", false), /알 수 없는 색이에요/);
  assert.throws(() => L.colorCommand("../x", U1, "red", false), /세션을 가리키지 못했어요/);
  assert.throws(() => L.colorCommand("-r-app", "nope", "red", true), /세션을 가리키지 못했어요/);
});

test("deleteCommand: checked inputs, both shells", () => {
  const sh = L.deleteCommand("-r-app", U1, false);
  assert.equal(sh.command, "sh");
  assert.deepEqual(sh.args.slice(2), ["delete", "-r-app", U1]);
  const ps = L.deleteCommand("C--r-app", U1, true);
  assert.equal(ps.command, "powershell");
  assert.ok(ps.args[2].includes("SendToRecycleBin"));
  assert.throws(() => L.deleteCommand("..", U1, true), /세션을 가리키지 못했어요/);
  assert.throws(() => L.deleteCommand("-r-app", "x", false), /세션을 가리키지 못했어요/);
});

test("actionError and deleteConfirmText", () => {
  assert.equal(L.actionError(2, ""), "세션 파일이 없어요");
  assert.equal(L.actionError(3, ""), "열려 있는 세션은 지울 수 없어요");
  assert.equal(L.actionError(1, "\n  Access denied\nmore"), "Access denied");
  assert.equal(L.actionError(1, ""), "실패했어요");
  assert.equal(L.deleteConfirmText("작업", false), '"작업" 세션을 휴지통으로 보낼까요?');
  assert.equal(L.deleteConfirmText("작업", true), '"작업" 세션을 완전히 지울까요? 되돌릴 수 없어요.');
});

for (const windows of [true, false]) {
  const shell = windows ? "powershell" : "sh";
  const runs = !spawnSync(shell, windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"]).error;
  test(`renameCommand and deleteCommand run (${shell})`, { skip: !runs || (windows && process.platform !== "win32") }, t => {
    const home = pjoin(mkdtempSync(pjoin(tmpdir(), "session-acts-")), "it's 홈");
    const store = pjoin(home, ".claude", "projects", "C--r-app");
    mkdirSync(store, { recursive: true });
    const env = { ...process.env, USERPROFILE: home, HOME: windows ? home : home.replaceAll("\\", "/") };
    const run = c => spawnSync(c.command, c.args, { encoding: "utf8", env });
    const file = u => pjoin(store, `${u}.jsonl`);
    writeFileSync(file(U1), JSON.stringify({ cwd: "C:\\r\\app" })); // no final newline
    writeFileSync(file(U2), JSON.stringify({ cwd: "C:\\r\\app" }) + "\n");
    const title = 'it\'s "$HOME" `x` 이름';
    for (const u of [U1, U2]) {
      const r = run(L.renameCommand("C--r-app", u, title, windows));
      assert.equal(r.status, 0, r.stderr);
      const lines = readFileSync(file(u), "utf8").split("\n");
      assert.equal(lines.length, 3);
      assert.deepEqual(JSON.parse(lines[1]), { type: "custom-title", customTitle: title, sessionId: u });
      assert.equal(lines[2], "");
    }
    const listed = L.sessionLines(run(L.sessionsCommand(["C--r-app"], windows)).stdout);
    assert.equal(listed.find(x => x.id === U1).customTitle, title);
    assert.equal(run(L.renameCommand("C--r-app", U3, "x", windows)).status, 2);

    // U1 is open: its record points at a running process.
    const sessions = pjoin(home, ".claude", "sessions");
    mkdirSync(sessions, { recursive: true });
    const sleeper = windows ? null : spawnSync("sh", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" }).stdout.trim();
    if (sleeper) t.after(() => spawnSync("sh", ["-c", `kill ${sleeper}`]));
    writeFileSync(pjoin(sessions, "1.json"), JSON.stringify({ pid: sleeper ? Number(sleeper) : process.pid, sessionId: U1, startedAt: Date.now() }));
    assert.equal(run(L.deleteCommand("C--r-app", U1, windows)).status, 3);
    assert.ok(existsSync(file(U1)));

    mkdirSync(pjoin(store, U2, "subagents"), { recursive: true });
    writeFileSync(pjoin(store, U2, "subagents", "a.jsonl"), "{}\n");
    const del = run(L.deleteCommand("C--r-app", U2, windows));
    assert.equal(del.status, 0, del.stderr);
    assert.ok(!existsSync(file(U2)));
    assert.ok(!existsSync(pjoin(store, U2)));
    assert.equal(run(L.deleteCommand("C--r-app", U2, windows)).status, 2);
  });
}

for (const windows of [true, false]) {
  const shell = windows ? "powershell" : "sh";
  const runs = !spawnSync(shell, windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"]).error;
  test(`colorCommand runs and sessionsCommand reads the color back (${shell})`, { skip: !runs || (windows && process.platform !== "win32") }, () => {
    const home = pjoin(mkdtempSync(pjoin(tmpdir(), "session-color-")), "it's 홈");
    const store = pjoin(home, ".claude", "projects", "C--r-app");
    mkdirSync(store, { recursive: true });
    const env = { ...process.env, USERPROFILE: home, HOME: windows ? home : home.replaceAll("\\", "/") };
    const run = c => spawnSync(c.command, c.args, { encoding: "utf8", env });
    writeFileSync(pjoin(store, `${U1}.jsonl`), JSON.stringify({ cwd: "C:\\r\\app" })); // no final newline
    const read = () => {
      const rows = L.sessionLines(run(L.sessionsCommand(["C--r-app"], windows)).stdout);
      return [rows[0].agentColor, L.toSessions(rows)[0].color];
    };
    assert.deepEqual(read(), ["", null]);
    const r1 = run(L.colorCommand("C--r-app", U1, "purple", windows));
    assert.equal(r1.status, 0, r1.stderr);
    assert.deepEqual(read(), ["purple", "purple"]);
    const r2 = run(L.colorCommand("C--r-app", U1, "default", windows));
    assert.equal(r2.status, 0, r2.stderr);
    assert.deepEqual(read(), ["default", null]);
    const lines = readFileSync(pjoin(store, `${U1}.jsonl`), "utf8").split("\n");
    assert.equal(lines.length, 4);
    assert.deepEqual(JSON.parse(lines[1]), { type: "agent-color", agentColor: "purple", sessionId: U1 });
    assert.equal(run(L.colorCommand("C--r-app", U3, "red", windows)).status, 2);
  });
}

test("deleteCommand run (powershell): a file that cannot be removed leaves its folder alone", { skip: process.platform !== "win32" }, async t => {
  const home = pjoin(mkdtempSync(pjoin(tmpdir(), "session-acts-")), "it's 홈");
  const store = pjoin(home, ".claude", "projects", "C--r-app");
  mkdirSync(pjoin(store, U1, "subagents"), { recursive: true });
  const file = pjoin(store, `${U1}.jsonl`);
  writeFileSync(file, "{}\n");
  // Another process holds the file open exclusively, so deleting it fails.
  const holder = spawn("powershell", ["-NoProfile", "-Command",
    `$s = [IO.File]::Open(${L.psQuote(file)}, 'Open', 'Read', 'None'); [Console]::Out.WriteLine('ready'); Start-Sleep -Seconds 60`], { stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => holder.kill());
  await new Promise(res => holder.stdout.once("data", res));
  const c = L.deleteCommand("C--r-app", U1, true);
  const r = spawnSync(c.command, c.args, { encoding: "utf8", env: { ...process.env, USERPROFILE: home } });
  assert.equal(r.status, 1, r.stderr);
  assert.ok(existsSync(file));
  assert.ok(existsSync(pjoin(store, U1, "subagents")));
});

test("deleteCommand sh script: the folder goes only after the file, exit 1 and 4", () => {
  const { args } = L.deleteCommand("C--r-app", U1, false);
  assert.ok(args[1].includes('rm -f "$d/$2.jsonl" || exit 1; rm -rf "$d/$2" || exit 4'));
});
