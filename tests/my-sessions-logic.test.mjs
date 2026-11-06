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
