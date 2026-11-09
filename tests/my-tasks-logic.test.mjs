import test from "node:test";
import assert from "node:assert/strict";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-tasks/logic.js", import.meta.url).href);

const T = (id, position, extra = {}) => ({ id, title: id, position, status: "needsAction", parent: null, ...extra });

test("constants", () => {
  assert.equal(L.REFRESH_MS, 120000);
  assert.equal(L.LOGIN_TIMEOUT_MS, 310000);
});

test("helperPath joins the app folder and the helper", () => {
  assert.equal(L.helperPath("/home/a/.config/herdr-app"), "/home/a/.config/herdr-app/mods/my-tasks/tasks.mjs");
  assert.equal(L.helperPath("C:\\Users\\a\\.config\\herdr-app\\"), "C:\\Users\\a\\.config\\herdr-app/mods/my-tasks/tasks.mjs");
});

test("command puts flags before -- and free text after", () => {
  assert.deepEqual(L.command("add", ["L1", "제목"], { parent: "p" }), ["add", "--parent", "p", "--", "L1", "제목"]);
  assert.deepEqual(L.command("move", ["L", "t"], { parent: null, previous: "q" }), ["move", "--previous", "q", "--", "L", "t"]);
  assert.deepEqual(L.command("lists"), ["lists", "--"]);
});

test("parseOutput reads the last JSON line", () => {
  assert.deepEqual(L.parseOutput('noise\n{"ok":true,"data":[1]}\n'), { ok: true, data: [1] });
  assert.deepEqual(L.parseOutput('{"ok":false,"error":{"kind":"api","message":"x"}}'), { ok: false, error: { kind: "api", message: "x" } });
  assert.deepEqual(L.parseOutput("", "Error: Cannot find module 'x'\n  at y"), { ok: false, error: { kind: "bad-output", message: "Error: Cannot find module 'x'" } });
  assert.deepEqual(L.parseOutput("not json"), { ok: false, error: { kind: "bad-output", message: "not json" } });
  assert.deepEqual(L.parseOutput(""), { ok: false, error: { kind: "bad-output", message: "출력 없음" } });
});

test("execError tells a time limit from a missing program", () => {
  assert.equal(L.execError(new Error("timed out after 30000ms")).kind, "timeout");
  assert.equal(L.execError(new Error("program not found")).kind, "no-node");
  assert.equal(L.execError(new Error("Command timed out")).kind, "timeout");
  assert.equal(L.execError(new Error("runtime error")).kind, "no-node");
});

test("buildTree orders by position, nests children, splits completed (newest first)", () => {
  const tree = L.buildTree([
    T("b", "00002"), T("a", "00001"), T("a2", "00002", { parent: "a" }), T("a1", "00001", { parent: "a" }),
    T("x", "00003", { status: "completed", completed: "2026-11-01T00:00:00.000Z" }),
    T("y", "00004", { status: "completed", completed: "2026-11-05T00:00:00.000Z" }),
  ]);
  assert.deepEqual(tree.roots.map(r => r.id), ["a", "b"]);
  assert.deepEqual(tree.roots[0].children.map(c => c.id), ["a1", "a2"]);
  assert.deepEqual(tree.roots[1].children, []);
  assert.deepEqual(tree.done.map(d => d.id), ["y", "x"]);
});

test("buildTree: a child whose parent is not open, or a grandchild, shows at the top level", () => {
  const tree = L.buildTree([
    T("c", "00001", { parent: "gone" }), T("p", "00002", { status: "completed" }), T("d", "00003", { parent: "p" }), T("e", "00000"),
    T("f", "00004"), T("f1", "00001", { parent: "f" }), T("g", "00005", { parent: "f1" }),
  ]);
  assert.deepEqual(tree.roots.map(r => r.id), ["e", "c", "d", "f", "g"]);
  assert.deepEqual(tree.roots[3].children.map(c => c.id), ["f1"]);
});

test("buildTree tolerates no input", () => {
  assert.deepEqual(L.buildTree(undefined), { roots: [], done: [] });
});

const tree = L.buildTree([T("a", "1"), T("a1", "1", { parent: "a" }), T("a2", "2", { parent: "a" }), T("b", "2"), T("c", "3"), T("c1", "1", { parent: "c" })]);

test("moveArgs up/down stay inside the same parent", () => {
  assert.equal(L.moveArgs(tree, "a", "up"), null);
  assert.deepEqual(L.moveArgs(tree, "b", "up"), { parent: null, previous: null });
  assert.deepEqual(L.moveArgs(tree, "c", "up"), { parent: null, previous: "a" });
  assert.deepEqual(L.moveArgs(tree, "a2", "up"), { parent: "a", previous: null });
  assert.equal(L.moveArgs(tree, "a1", "up"), null);
  assert.deepEqual(L.moveArgs(tree, "a", "down"), { parent: null, previous: "b" });
  assert.equal(L.moveArgs(tree, "c", "down"), null);
  assert.deepEqual(L.moveArgs(tree, "a1", "down"), { parent: "a", previous: "a2" });
  assert.equal(L.moveArgs(tree, "a2", "down"), null);
});

test("moveArgs indent goes under the sibling above, at the end of its children", () => {
  assert.equal(L.moveArgs(tree, "a", "indent"), null); // first row
  assert.deepEqual(L.moveArgs(tree, "b", "indent"), { parent: "a", previous: "a2" });
  assert.equal(L.moveArgs(tree, "c", "indent"), null); // has children
  assert.equal(L.moveArgs(tree, "a2", "indent"), null); // already a child
  const flat = L.buildTree([T("x", "1"), T("y", "2")]);
  assert.deepEqual(L.moveArgs(flat, "y", "indent"), { parent: "x", previous: null });
});

test("moveArgs outdent puts a child right after its parent", () => {
  assert.equal(L.moveArgs(tree, "a", "outdent"), null);
  assert.deepEqual(L.moveArgs(tree, "a1", "outdent"), { parent: null, previous: "a" });
});

test("moveArgs and canMove: unknown id or direction", () => {
  assert.equal(L.moveArgs(tree, "zz", "up"), null);
  assert.equal(L.moveArgs(tree, "b", "sideways"), null);
  assert.equal(L.canMove(tree, "b", "up"), true);
  assert.equal(L.canMove(tree, "a", "up"), false);
});

test("todayString is the local date", () => {
  assert.equal(L.todayString(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("dueLabel: this year, another year, overdue, none", () => {
  assert.equal(L.dueLabel(null, "2026-11-09"), null);
  assert.deepEqual(L.dueLabel("2026-11-12T00:00:00.000Z", "2026-11-09"), { text: "11/12", overdue: false });
  assert.deepEqual(L.dueLabel("2027-01-03T00:00:00.000Z", "2026-11-09"), { text: "2027/1/3", overdue: false });
  assert.deepEqual(L.dueLabel("2026-11-08T00:00:00.000Z", "2026-11-09"), { text: "11/8", overdue: true });
  assert.deepEqual(L.dueLabel("2026-11-09T00:00:00.000Z", "2026-11-09"), { text: "11/9", overdue: false });
});

test("parseDue accepts YYYY-MM-DD or blank", () => {
  assert.equal(L.parseDue(""), null);
  assert.equal(L.parseDue("   "), null);
  assert.equal(L.parseDue("2026-11-12"), "2026-11-12");
  assert.equal(L.parseDue(" 2026-11-12 "), "2026-11-12");
  assert.equal(L.parseDue("2026-13-01"), undefined);
  assert.equal(L.parseDue("2026-02-30"), undefined);
  assert.equal(L.parseDue("11/12"), undefined);
});

test("errorText: login kinds go to the login screen", () => {
  assert.deepEqual(L.errorText({ kind: "no-client", message: "OAuth 클라이언트 파일이 없어요: C:/x/client.json" }),
    { screen: "login", kind: "no-client", text: "OAuth 클라이언트 파일이 필요해요", detail: "OAuth 클라이언트 파일이 없어요: C:/x/client.json" });
  assert.deepEqual(L.errorText({ kind: "no-login", message: "로그인이 필요해요" }),
    { screen: "login", kind: "no-login", text: "Google 계정 연결이 필요해요", detail: null });
  assert.deepEqual(L.errorText({ kind: "expired", message: "" }),
    { screen: "login", kind: "expired", text: "로그인이 만료됐어요. 다시 로그인해 주세요", detail: null });
});

test("errorText: the rest go to the error bar", () => {
  assert.equal(L.errorText({ kind: "network", message: "fetch failed" }).text, "인터넷 연결을 확인해 주세요");
  assert.equal(L.errorText({ kind: "timeout", message: "" }).text, "응답이 늦어 결과를 모르겠어요. 새로 읽어 확인해 주세요");
  assert.equal(L.errorText({ kind: "no-node", message: "" }).text, "Node.js가 필요해요");
  assert.equal(L.errorText({ kind: "api", message: "Invalid task list ID" }).text, "Invalid task list ID");
  assert.equal(L.errorText({ kind: "api", message: "" }).text, "Google Tasks 오류");
  assert.equal(L.errorText({ kind: "usage", message: "알 수 없는 명령: x" }).text, "내부 오류: 알 수 없는 명령: x");
  assert.equal(L.errorText({ kind: "bad-output", message: "boom" }).text, "내부 오류: boom");
  assert.deepEqual(L.errorText(undefined), { screen: "bar", kind: "internal", text: "내부 오류: 알 수 없는 오류", detail: null });
  assert.equal(L.errorText({ kind: "network" }).screen, "bar");
});

test("deleteText picks 을/를 and mentions children", () => {
  assert.equal(L.deleteText({ title: "README 정리" }, 0), '"README 정리"를 지울까요?');
  assert.equal(L.deleteText({ title: "회의록" }, 0), '"회의록"을 지울까요?');
  assert.equal(L.deleteText({ title: "로그인 버그" }, 2), '"로그인 버그"를 지울까요? 하위 2개도 함께 지워져요.');
  assert.equal(L.deleteText({ title: "fix bug" }, 0), '"fix bug"을(를) 지울까요?');
  assert.equal(L.deleteText({ title: "" }, 0), '"(제목 없음)"을 지울까요?');
});

test("listDeleteText mentions how many tasks go with it", () => {
  assert.equal(L.listDeleteText({ title: "업무" }, 3), '"업무" 목록과 할 일 3개를 지울까요?');
  assert.equal(L.listDeleteText({ title: "업무" }, 0), '"업무" 목록을 지울까요?');
});

test("notesPreview is the first non-blank line", () => {
  assert.equal(L.notesPreview("\n  첫 줄 \n둘째"), "첫 줄");
  assert.equal(L.notesPreview(null), null);
  assert.equal(L.notesPreview(""), null);
  assert.equal(L.notesPreview("  \n "), null);
});

test("moveArgs: a promoted orphan can only outdent; nothing moves around it", () => {
  const t = L.buildTree([T("a", "1"), T("o", "2", { parent: "gone" }), T("b", "3"), T("c", "4")]);
  for (const dir of ["up", "down", "indent"]) assert.equal(L.moveArgs(t, "o", dir), null);
  assert.deepEqual(L.moveArgs(t, "o", "outdent"), { parent: null, previous: null });
  assert.equal(L.canMove(t, "o", "outdent"), true);
  assert.equal(L.moveArgs(t, "o", "sideways"), null);
  assert.equal(L.moveArgs(t, "a", "down"), null); // would reference the orphan
  assert.equal(L.moveArgs(t, "b", "indent"), null); // orphan above is no indent target
  assert.equal(L.moveArgs(t, "c", "up"), null); // previous would be the orphan
  assert.deepEqual(L.moveArgs(t, "c", "down"), null);
  assert.deepEqual(L.moveArgs(t, "b", "up"), { parent: null, previous: "a" });
});
