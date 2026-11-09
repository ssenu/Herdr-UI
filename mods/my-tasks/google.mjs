// Google OAuth (installed app, PKCE) and the Tasks REST API. Everything outside this file
// (fetch, files, the clock) comes in through `env`, so tests can replace it.

export const SCOPE = "https://www.googleapis.com/auth/tasks";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const API = "https://tasks.googleapis.com/tasks/v1";

export class TasksError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

export function readClient(env) {
  const raw = env.readFile(env.clientPath);
  if (raw == null) throw new TasksError("no-client", `OAuth 클라이언트 파일이 없어요: ${env.clientPath}`);
  let json;
  try { json = JSON.parse(raw); } catch { throw new TasksError("no-client", `클라이언트 파일을 읽지 못했어요: ${env.clientPath}`); }
  const c = json?.installed ?? json?.web ?? json ?? {};
  if (!c.client_id || !c.client_secret) throw new TasksError("no-client", `클라이언트 파일에 client_id가 없어요: ${env.clientPath}`);
  return { id: c.client_id, secret: c.client_secret };
}

export function readToken(env) {
  const raw = env.readFile(env.tokenPath);
  if (raw != null) {
    try { const t = JSON.parse(raw); if (t?.refresh_token) return t; } catch {}
  }
  throw new TasksError("no-login", "로그인이 필요해요");
}

export function authUrl(client, { redirect, challenge, state }) {
  const q = new URLSearchParams({
    client_id: client.id, redirect_uri: redirect, response_type: "code", scope: SCOPE,
    code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent",
  });
  return `${AUTH_URL}?${q}`;
}

async function postForm(env, url, form) {
  let r;
  try {
    r = await env.fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  } catch (e) { throw new TasksError("network", String(e?.message ?? e)); }
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: body ?? {} };
}

const oauthMessage = r => r.body.error_description || r.body.error || `HTTP ${r.status}`;

export async function exchangeCode(env, client, { code, verifier, redirect }) {
  const r = await postForm(env, TOKEN_URL, {
    code, client_id: client.id, client_secret: client.secret, redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier,
  });
  if (!r.ok) throw new TasksError("api", oauthMessage(r));
  const token = { access_token: r.body.access_token, refresh_token: r.body.refresh_token, expiry: env.now() + (r.body.expires_in ?? 3600) * 1000 };
  env.writeFile(env.tokenPath, JSON.stringify(token));
  return token;
}

/** A usable access token, refreshed (and saved) when it expires within 60 seconds. */
export async function accessToken(env) {
  const client = readClient(env), token = readToken(env);
  if (token.access_token && token.expiry - 60000 > env.now()) return token.access_token;
  const r = await postForm(env, TOKEN_URL, { client_id: client.id, client_secret: client.secret, refresh_token: token.refresh_token, grant_type: "refresh_token" });
  if (!r.ok) {
    if (r.body.error === "invalid_grant") throw new TasksError("expired", "로그인이 만료됐어요");
    throw new TasksError("api", oauthMessage(r));
  }
  const next = { ...token, access_token: r.body.access_token, expiry: env.now() + (r.body.expires_in ?? 3600) * 1000 };
  env.writeFile(env.tokenPath, JSON.stringify(next));
  return next.access_token;
}

async function api(env, method, path, { query, body } = {}) {
  const token = await accessToken(env);
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
  let r;
  try {
    r = await env.fetch(`${API}${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new TasksError("network", String(e?.message ?? e)); }
  if (r.status === 204) return null;
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    if (r.status === 401) throw new TasksError("expired", "로그인이 만료됐어요");
    throw new TasksError("api", json?.error?.message || `HTTP ${r.status}`);
  }
  return json;
}

const enc = encodeURIComponent;
const TASK_FIELDS = ["id", "title", "notes", "due", "status", "completed", "parent", "position"];
const pickTask = t => Object.fromEntries(TASK_FIELDS.map(k => [k, t?.[k] ?? null]));
const pickList = l => ({ id: l.id, title: l.title });

async function allPages(env, path, query) {
  const out = [];
  let pageToken;
  do {
    const r = await api(env, "GET", path, { query: { ...query, ...(pageToken ? { pageToken } : {}) } });
    out.push(...(r?.items ?? []));
    pageToken = r?.nextPageToken;
  } while (pageToken);
  return out;
}

export async function status(env) {
  readClient(env);
  readToken(env);
  return { loggedIn: true };
}

export async function lists(env) {
  return (await allPages(env, "/users/@me/lists", { maxResults: "100" })).map(pickList);
}
export const listAdd = async (env, title) => pickList(await api(env, "POST", "/users/@me/lists", { body: { title } }));
export const listRename = async (env, id, title) => pickList(await api(env, "PATCH", `/users/@me/lists/${enc(id)}`, { body: { title } }));
export const listDelete = async (env, id) => { await api(env, "DELETE", `/users/@me/lists/${enc(id)}`); return null; };

export async function tasks(env, list) {
  return (await allPages(env, `/lists/${enc(list)}/tasks`, { showCompleted: "true", showHidden: "true", maxResults: "100" })).map(pickTask);
}
export const add = async (env, list, title, parent) =>
  pickTask(await api(env, "POST", `/lists/${enc(list)}/tasks`, { query: parent ? { parent } : undefined, body: { title } }));

export async function update(env, list, id, fields) {
  const body = {};
  if ("title" in fields) body.title = fields.title;
  if ("notes" in fields) body.notes = fields.notes;
  if ("due" in fields) body.due = fields.due == null ? null : `${fields.due}T00:00:00.000Z`;
  return pickTask(await api(env, "PATCH", `/lists/${enc(list)}/tasks/${enc(id)}`, { body }));
}
export const done = async (env, list, id) => pickTask(await api(env, "PATCH", `/lists/${enc(list)}/tasks/${enc(id)}`, { body: { status: "completed" } }));
export const undone = async (env, list, id) =>
  pickTask(await api(env, "PATCH", `/lists/${enc(list)}/tasks/${enc(id)}`, { body: { status: "needsAction", completed: null } }));
export const remove = async (env, list, id) => { await api(env, "DELETE", `/lists/${enc(list)}/tasks/${enc(id)}`); return null; };

export async function move(env, list, id, { parent, previous } = {}) {
  const query = {};
  if (parent) query.parent = parent;
  if (previous) query.previous = previous;
  return pickTask(await api(env, "POST", `/lists/${enc(list)}/tasks/${enc(id)}/move`, { query }));
}

/** Revokes the refresh token at Google (best effort) and forgets it. */
export async function logout(env) {
  let token = null;
  try { token = readToken(env); } catch {}
  if (token) {
    try {
      await env.fetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: token.refresh_token }).toString() });
    } catch {}
  }
  env.removeFile(env.tokenPath);
  return null;
}
