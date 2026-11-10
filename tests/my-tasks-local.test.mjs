import test from "node:test";
import assert from "node:assert/strict";
const LO = await import(new URL("../mods/my-tasks/local.mjs", import.meta.url).href);

function memEnv(initial) {
  const files = new Map();
  if (initial !== undefined) files.set("/l.json", initial);
  let n = 0, writes = 0;
  return {
    localPath: "/l.json", files, get writes() { return writes; },
    readFile: p => files.get(p) ?? null,
    writeFile: (p, s) => { writes++; files.set(p, s); },
    newId: () => `id${++n}`,
    now: () => Date.UTC(2026, 10, 10, 1, 2, 3),
  };
}
const kind = k => e => e?.kind === k;
const titles = async (env, list) => (await LO.tasks(env, list)).map(t => t.title);

test("first use creates 내 할 일 and saves it", async () => {
  const env = memEnv();
  assert.deepEqual(await LO.lists(env), [{ id: "id1", title: "내 할 일" }]);
  assert.deepEqual(JSON.parse(env.files.get("/l.json")), { lists: [{ id: "id1", title: "내 할 일" }], tasks: { id1: [] } });
  assert.deepEqual(await LO.lists(env), [{ id: "id1", title: "내 할 일" }]);
  assert.deepEqual(await LO.status(env), { loggedIn: true });
});

test("a broken file is refused and left alone", async () => {
  for (const raw of ["{nope", "[]", JSON.stringify({ lists: {}, tasks: {} }), JSON.stringify({ lists: [], tasks: [] }), JSON.stringify({ lists: [{ id: "a" }], tasks: { a: {} } })]) {
    const env = memEnv(raw);
    await assert.rejects(LO.lists(env), e => e?.kind === "local" && e.message === "로컬 저장 파일을 읽지 못했어요: /l.json");
    await assert.rejects(LO.add(env, "a", "t"), kind("local"));
    assert.equal(env.files.get("/l.json"), raw);
    assert.equal(env.writes, 0);
  }
});

test("lists: add, rename, delete with their tasks", async () => {
  const env = memEnv();
  await LO.lists(env);
  assert.deepEqual(await LO.listAdd(env, "업무"), { id: "id2", title: "업무" });
  await LO.add(env, "id2", "보고서");
  assert.deepEqual(await LO.listRename(env, "id2", "회사"), { id: "id2", title: "회사" });
  assert.equal(await LO.listDelete(env, "id2"), null);
  assert.deepEqual(await LO.lists(env), [{ id: "id1", title: "내 할 일" }]);
  assert.equal(JSON.parse(env.files.get("/l.json")).tasks.id2, undefined);
  await assert.rejects(LO.listRename(env, "nope", "x"), e => e?.kind === "api" && e.message === "목록을 찾을 수 없어요");
  await assert.rejects(LO.listDelete(env, "nope"), kind("api"));
  await assert.rejects(LO.tasks(env, "nope"), kind("api"));
});

test("add puts new tasks first, subtasks right after their parent", async () => {
  const env = memEnv();
  const [{ id: L }] = await LO.lists(env);
  const a = await LO.add(env, L, "A");
  await LO.add(env, L, "B");
  const a1 = await LO.add(env, L, "A1", a.id);
  await LO.add(env, L, "A0", a.id);
  assert.deepEqual(await titles(env, L), ["B", "A", "A0", "A1"]);
  assert.deepEqual(a, { id: "id2", title: "A", notes: null, due: null, status: "needsAction", completed: null, parent: null, position: "00000000" });
  assert.equal(a1.parent, a.id);
  assert.deepEqual((await LO.tasks(env, L)).map(t => t.position), ["00000000", "00000001", "00000002", "00000003"]);
  await assert.rejects(LO.add(env, L, "x", "nope"), e => e?.kind === "api" && e.message === "할 일을 찾을 수 없어요");
});

test("move: after previous, first under a parent, out to the top level, first", async () => {
  const env = memEnv();
  const [{ id: L }] = await LO.lists(env);
  const c = await LO.add(env, L, "C"), b = await LO.add(env, L, "B"), a = await LO.add(env, L, "A"); // [A, B, C]
  await LO.move(env, L, a.id, { previous: c.id });
  assert.deepEqual(await titles(env, L), ["B", "C", "A"]);
  await LO.move(env, L, a.id, { parent: b.id });
  let all = await LO.tasks(env, L);
  assert.deepEqual(all.map(t => t.title), ["B", "A", "C"]);
  assert.equal(all[1].parent, b.id);
  await LO.move(env, L, a.id, { parent: null, previous: b.id });
  all = await LO.tasks(env, L);
  assert.deepEqual(all.map(t => t.title), ["B", "A", "C"]);
  assert.equal(all[1].parent, null);
  await LO.move(env, L, c.id, {});
  assert.deepEqual(await titles(env, L), ["C", "B", "A"]);
  await assert.rejects(LO.move(env, L, c.id, { previous: "nope" }), kind("api"));
  await assert.rejects(LO.move(env, L, "nope", {}), kind("api"));
  assert.deepEqual(await titles(env, L), ["C", "B", "A"]); // a failed move changes nothing
});

test("update, done, undone", async () => {
  const env = memEnv();
  const [{ id: L }] = await LO.lists(env);
  const t = await LO.add(env, L, "T");
  assert.deepEqual(await LO.update(env, L, t.id, { title: "새", notes: "메모", due: "2026-11-12" }),
    { ...t, title: "새", notes: "메모", due: "2026-11-12T00:00:00.000Z" });
  assert.equal((await LO.update(env, L, t.id, { due: null })).due, null);
  assert.equal((await LO.update(env, L, t.id, { title: "only" })).notes, "메모");
  const d = await LO.done(env, L, t.id);
  assert.equal(d.status, "completed");
  assert.equal(d.completed, "2026-11-10T01:02:03.000Z");
  const u = await LO.undone(env, L, t.id);
  assert.equal(u.status, "needsAction");
  assert.equal(u.completed, null);
  await assert.rejects(LO.done(env, L, "nope"), kind("api"));
});

test("remove takes the task's subtasks with it", async () => {
  const env = memEnv();
  const [{ id: L }] = await LO.lists(env);
  const p = await LO.add(env, L, "P");
  await LO.add(env, L, "P1", p.id);
  await LO.add(env, L, "Q");
  assert.equal(await LO.remove(env, L, p.id), null);
  assert.deepEqual(await titles(env, L), ["Q"]);
  await assert.rejects(LO.remove(env, L, p.id), kind("api"));
});
