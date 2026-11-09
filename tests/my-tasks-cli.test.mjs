import test from "node:test";
import assert from "node:assert/strict";
const C = await import(new URL("../mods/my-tasks/tasks.mjs", import.meta.url).href);

const usage = e => e?.kind === "usage";

test("parseCommand: flags before --, free text after", () => {
  assert.deepEqual(C.parseCommand(["add", "--parent", "p", "--", "L", "제목"]), { name: "add", args: { parent: "p", list: "L", title: "제목" } });
  assert.deepEqual(C.parseCommand(["add", "--", "L", "--weird"]), { name: "add", args: { list: "L", title: "--weird" } });
  assert.deepEqual(C.parseCommand(["move", "--previous", "q", "--", "L", "T"]), { name: "move", args: { previous: "q", list: "L", id: "T" } });
  assert.deepEqual(C.parseCommand(["lists", "--"]), { name: "lists", args: {} });
  assert.deepEqual(C.parseCommand(["lists"]), { name: "lists", args: {} });
});

test("parseCommand: update reads its JSON", () => {
  assert.deepEqual(C.parseCommand(["update", "--", "L", "T", '{"title":"a","due":null}']), { name: "update", args: { list: "L", id: "T", fields: { title: "a", due: null } } });
  assert.deepEqual(C.parseCommand(["update", "--", "L", "T", '{"due":"2026-11-12"}']).args.fields, { due: "2026-11-12" });
});

test("parseCommand: refuses what it doesn't know", () => {
  assert.throws(() => C.parseCommand(["nope"]), usage);
  assert.throws(() => C.parseCommand([]), usage);
  assert.throws(() => C.parseCommand(["tasks", "--"]), usage); // missing list
  assert.throws(() => C.parseCommand(["tasks", "--parent", "x", "--", "L"]), usage); // flag not allowed
  assert.throws(() => C.parseCommand(["add", "--parent"]), usage); // flag without value
  assert.throws(() => C.parseCommand(["update", "--", "L", "T", "{bad"]), usage);
  assert.throws(() => C.parseCommand(["update", "--", "L", "T", '{"due":"11/12"}']), usage);
  assert.throws(() => C.parseCommand(["update", "--", "L", "T", "[1]"]), usage);
});

function memEnv(files = {}, responses = []) {
  const map = new Map(Object.entries(files));
  return {
    clientPath: "/c.json", tokenPath: "/t.json", now: () => 0,
    readFile: p => map.get(p) ?? null, writeFile: (p, s) => map.set(p, s), removeFile: p => map.delete(p),
    fetch: async () => { const j = responses.shift() ?? {}; return { status: 200, ok: true, text: async () => JSON.stringify(j), json: async () => j }; },
  };
}
const capture = () => { const lines = []; return { lines, out: s => { lines.push(s); } }; };

test("main prints one JSON line for errors", async () => {
  const a = capture();
  await C.main(["status"], memEnv(), a.out);
  assert.equal(a.lines.length, 1);
  const r = JSON.parse(a.lines[0]);
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, "no-client");
  const b = capture();
  await C.main(["nope"], memEnv(), b.out);
  assert.equal(JSON.parse(b.lines[0]).error.kind, "usage");
});

test("main prints data on success", async () => {
  const files = { "/c.json": JSON.stringify({ installed: { client_id: "c", client_secret: "s" } }), "/t.json": JSON.stringify({ access_token: "a", refresh_token: "r", expiry: 9e15 }) };
  const a = capture();
  await C.main(["lists", "--"], memEnv(files, [{ items: [{ id: "L", title: "내 할 일" }] }]), a.out);
  assert.deepEqual(JSON.parse(a.lines[0]), { ok: true, data: [{ id: "L", title: "내 할 일" }] });
});

test("makeEnv keeps its files in <app>/my-tasks", () => {
  const env = C.makeEnv("/app/my-tasks");
  assert.equal(env.clientPath.replaceAll("\\", "/"), "/app/my-tasks/client.json");
  assert.equal(env.tokenPath.replaceAll("\\", "/"), "/app/my-tasks/token.json");
  assert.equal(typeof env.fetch, "function");
});
