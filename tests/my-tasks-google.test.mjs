import test from "node:test";
import assert from "node:assert/strict";
const G = await import(new URL("../mods/my-tasks/google.mjs", import.meta.url).href);

function respond({ status = 200, json } = {}) {
  const text = json === undefined ? "" : JSON.stringify(json);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text || "{}") };
}

function fakeEnv({ client = { installed: { client_id: "cid", client_secret: "sec" } }, token = { access_token: "at", refresh_token: "rt", expiry: 10_000_000 }, now = 1_000_000, responses = [] } = {}) {
  const files = new Map(), calls = [];
  if (client) files.set("/c.json", typeof client === "string" ? client : JSON.stringify(client));
  if (token) files.set("/t.json", JSON.stringify(token));
  return {
    clientPath: "/c.json", tokenPath: "/t.json", files, calls, now: () => now,
    readFile: p => files.get(p) ?? null, writeFile: (p, s) => { files.set(p, s); }, removeFile: p => { files.delete(p); },
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return respond(next ?? { json: {} });
    },
  };
}
const kindIs = kind => e => e instanceof G.TasksError && e.kind === kind;

test("lists with a fresh token: no refresh, bearer header, only id and title", async () => {
  const env = fakeEnv({ responses: [{ json: { items: [{ id: "L1", title: "내 할 일", etag: "x" }] } }] });
  assert.deepEqual(await G.lists(env), [{ id: "L1", title: "내 할 일" }]);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].url, `${G.API}/users/@me/lists?maxResults=100`);
  assert.equal(env.calls[0].headers.Authorization, "Bearer at");
});

test("a token expiring within 60 s is refreshed first and saved", async () => {
  const env = fakeEnv({ token: { access_token: "old", refresh_token: "rt", expiry: 1_000_000 + 30_000 }, responses: [{ json: { access_token: "new", expires_in: 3600 } }, { json: { items: [] } }] });
  await G.lists(env);
  assert.equal(env.calls[0].url, G.TOKEN_URL);
  assert.equal(env.calls[0].method, "POST");
  const form = new URLSearchParams(env.calls[0].body);
  assert.equal(form.get("grant_type"), "refresh_token");
  assert.equal(form.get("refresh_token"), "rt");
  assert.equal(form.get("client_id"), "cid");
  assert.equal(form.get("client_secret"), "sec");
  assert.deepEqual(JSON.parse(env.files.get("/t.json")), { access_token: "new", refresh_token: "rt", expiry: 1_000_000 + 3_600_000 });
  assert.equal(env.calls[1].headers.Authorization, "Bearer new");
});

test("refresh refused with invalid_grant means expired", async () => {
  const env = fakeEnv({ token: { access_token: "old", refresh_token: "rt", expiry: 0 }, responses: [{ status: 400, json: { error: "invalid_grant" } }] });
  await assert.rejects(G.lists(env), kindIs("expired"));
});

test("missing token, missing or broken client file", async () => {
  await assert.rejects(G.lists(fakeEnv({ token: null })), kindIs("no-login"));
  await assert.rejects(G.lists(fakeEnv({ client: null })), kindIs("no-client"));
  await assert.rejects(G.lists(fakeEnv({ client: "{nope" })), kindIs("no-client"));
  await assert.rejects(G.lists(fakeEnv({ client: { installed: {} } })), kindIs("no-client"));
  await assert.rejects(G.status(fakeEnv({ client: null })), kindIs("no-client"));
  assert.deepEqual(await G.status(fakeEnv()), { loggedIn: true });
});

test("network failure and HTTP errors", async () => {
  await assert.rejects(G.lists(fakeEnv({ responses: [new TypeError("fetch failed")] })), kindIs("network"));
  await assert.rejects(G.lists(fakeEnv({ responses: [{ status: 404, json: { error: { message: "Not Found" } } }] })),
    e => e.kind === "api" && e.message === "Not Found");
  await assert.rejects(G.lists(fakeEnv({ responses: [{ status: 401, json: {} }] })), kindIs("expired"));
});

test("tasks reads every page and fills missing fields with null", async () => {
  const env = fakeEnv({ responses: [
    { json: { items: [{ id: "a", title: "A", status: "needsAction", position: "1", etag: "e" }], nextPageToken: "p2" } },
    { json: { items: [{ id: "b", title: "B", status: "completed", completed: "2026-11-01T00:00:00.000Z", position: "2", parent: "a" }] } },
  ] });
  const result = await G.tasks(env, "L/1");
  assert.equal(env.calls[0].url, `${G.API}/lists/L%2F1/tasks?showCompleted=true&showHidden=true&maxResults=100`);
  assert.equal(env.calls[1].url, `${G.API}/lists/L%2F1/tasks?showCompleted=true&showHidden=true&maxResults=100&pageToken=p2`);
  assert.deepEqual(result[0], { id: "a", title: "A", notes: null, due: null, status: "needsAction", completed: null, parent: null, position: "1" });
  assert.equal(result[1].parent, "a");
});

test("add, with and without a parent", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "n", title: "x" } }, { json: { id: "m", title: "y" } }] });
  await G.add(env, "L", "x");
  await G.add(env, "L", "y", "P");
  assert.equal(env.calls[0].url, `${G.API}/lists/L/tasks`);
  assert.equal(env.calls[0].method, "POST");
  assert.deepEqual(JSON.parse(env.calls[0].body), { title: "x" });
  assert.equal(env.calls[1].url, `${G.API}/lists/L/tasks?parent=P`);
});

test("update sends only the given fields, due as a UTC midnight timestamp", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "T" } }, { json: { id: "T" } }, { json: { id: "T" } }] });
  await G.update(env, "L", "T", { title: "새", notes: "메모", due: "2026-11-12" });
  await G.update(env, "L", "T", { due: null });
  await G.update(env, "L", "T", { title: "only" });
  assert.equal(env.calls[0].url, `${G.API}/lists/L/tasks/T`);
  assert.equal(env.calls[0].method, "PATCH");
  assert.deepEqual(JSON.parse(env.calls[0].body), { title: "새", notes: "메모", due: "2026-11-12T00:00:00.000Z" });
  assert.deepEqual(JSON.parse(env.calls[1].body), { due: null });
  assert.deepEqual(JSON.parse(env.calls[2].body), { title: "only" });
});

test("done and undone", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "T" } }, { json: { id: "T" } }] });
  await G.done(env, "L", "T");
  await G.undone(env, "L", "T");
  assert.deepEqual(JSON.parse(env.calls[0].body), { status: "completed" });
  assert.deepEqual(JSON.parse(env.calls[1].body), { status: "needsAction", completed: null });
  assert.equal(env.calls[1].method, "PATCH");
});

test("remove answers null on 204", async () => {
  const env = fakeEnv({ responses: [{ status: 204 }] });
  assert.equal(await G.remove(env, "L", "T"), null);
  assert.equal(env.calls[0].method, "DELETE");
  assert.equal(env.calls[0].url, `${G.API}/lists/L/tasks/T`);
});

test("move passes parent and previous only when given", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "T" } }, { json: { id: "T" } }] });
  await G.move(env, "L", "T", { parent: "P", previous: "Q" });
  await G.move(env, "L", "T", { parent: null, previous: null });
  assert.equal(env.calls[0].url, `${G.API}/lists/L/tasks/T/move?parent=P&previous=Q`);
  assert.equal(env.calls[0].method, "POST");
  assert.equal(env.calls[1].url, `${G.API}/lists/L/tasks/T/move`);
});

test("list add, rename, delete", async () => {
  const env = fakeEnv({ responses: [{ json: { id: "N", title: "새 목록", etag: "e" } }, { json: { id: "N", title: "이름" } }, { status: 204 }] });
  assert.deepEqual(await G.listAdd(env, "새 목록"), { id: "N", title: "새 목록" });
  assert.deepEqual(await G.listRename(env, "N", "이름"), { id: "N", title: "이름" });
  assert.equal(await G.listDelete(env, "N"), null);
  assert.equal(env.calls[0].url, `${G.API}/users/@me/lists`);
  assert.equal(env.calls[0].method, "POST");
  assert.deepEqual(JSON.parse(env.calls[0].body), { title: "새 목록" });
  assert.equal(env.calls[1].method, "PATCH");
  assert.equal(env.calls[1].url, `${G.API}/users/@me/lists/N`);
  assert.equal(env.calls[2].method, "DELETE");
});

test("logout revokes the refresh token and removes the file, even when revoking fails", async () => {
  const env = fakeEnv({ responses: [{ json: {} }] });
  assert.equal(await G.logout(env), null);
  assert.equal(env.calls[0].url, G.REVOKE_URL);
  assert.equal(new URLSearchParams(env.calls[0].body).get("token"), "rt");
  assert.equal(env.files.has("/t.json"), false);
  const failing = fakeEnv({ responses: [new TypeError("fetch failed")] });
  assert.equal(await G.logout(failing), null);
  assert.equal(failing.files.has("/t.json"), false);
  const none = fakeEnv({ token: null });
  assert.equal(await G.logout(none), null);
  assert.equal(none.calls.length, 0);
});

test("authUrl asks for offline access with PKCE", () => {
  const url = new URL(G.authUrl({ id: "cid", secret: "sec" }, { redirect: "http://127.0.0.1:5555", challenge: "ch", state: "st" }));
  assert.equal(url.origin + url.pathname, G.AUTH_URL);
  const q = url.searchParams;
  assert.equal(q.get("client_id"), "cid");
  assert.equal(q.get("redirect_uri"), "http://127.0.0.1:5555");
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("scope"), "https://www.googleapis.com/auth/tasks");
  assert.equal(q.get("code_challenge"), "ch");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("state"), "st");
  assert.equal(q.get("access_type"), "offline");
  assert.equal(q.get("prompt"), "consent");
});

test("exchangeCode saves the tokens", async () => {
  const env = fakeEnv({ token: null, responses: [{ json: { access_token: "a2", refresh_token: "r2", expires_in: 100 } }] });
  await G.exchangeCode(env, { id: "cid", secret: "sec" }, { code: "c", verifier: "v", redirect: "http://127.0.0.1:1" });
  const form = new URLSearchParams(env.calls[0].body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "c");
  assert.equal(form.get("code_verifier"), "v");
  assert.equal(form.get("redirect_uri"), "http://127.0.0.1:1");
  assert.deepEqual(JSON.parse(env.files.get("/t.json")), { access_token: "a2", refresh_token: "r2", expiry: 1_000_000 + 100_000 });
});
