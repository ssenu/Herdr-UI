// Google Tasks helper for the my-tasks mod: `node tasks.mjs <command> [--flag value]... -- [args]...`
// Prints exactly one JSON line: {"ok":true,"data":...} or {"ok":false,"error":{"kind":"...","message":"..."}}.
// Its files live in <Herdr app folder>/my-tasks/ (two folders up from this file, then my-tasks).
import { readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import * as G from "./google.mjs";

const SPEC = {
  status: [], login: [], logout: [], lists: [],
  "list-add": ["title"], "list-rename": ["id", "title"], "list-delete": ["id"],
  tasks: ["list"], add: ["list", "title"], update: ["list", "id", "json"],
  done: ["list", "id"], undone: ["list", "id"], delete: ["list", "id"], move: ["list", "id"],
};
const FLAGS = { add: ["parent"], move: ["parent", "previous"] };
const LOGIN_WAIT_MS = 300000;
const usage = message => new G.TasksError("usage", message);

export function parseCommand(argv) {
  const [name, ...rest] = argv;
  if (!name || !Object.hasOwn(SPEC, name)) throw usage(`알 수 없는 명령: ${name ?? ""}`);
  const allowed = FLAGS[name] ?? [], args = {}, positional = [];
  let i = 0;
  for (; i < rest.length && rest[i] !== "--"; i++) {
    const m = /^--([a-z]+)$/.exec(rest[i]);
    if (!m || !allowed.includes(m[1]) || i + 1 >= rest.length || rest[i + 1] === "--") throw usage(`${name}: 잘못된 인자 ${rest[i]}`);
    args[m[1]] = rest[++i];
  }
  positional.push(...rest.slice(i + 1));
  if (positional.length !== SPEC[name].length) throw usage(`${name}: 인자 ${SPEC[name].length}개가 필요해요`);
  SPEC[name].forEach((k, j) => { args[k] = positional[j]; });
  if (name === "update") {
    let fields;
    try { fields = JSON.parse(args.json); } catch { throw usage("update: JSON을 읽지 못했어요"); }
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw usage("update: JSON 객체가 필요해요");
    if ("due" in fields && fields.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fields.due)) throw usage("update: due는 YYYY-MM-DD 또는 null");
    delete args.json;
    args.fields = fields;
  }
  return { name, args };
}

export function makeEnv(dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "my-tasks")) {
  return {
    fetch: (...a) => globalThis.fetch(...a),
    readFile: p => { try { return readFileSync(p, "utf8"); } catch { return null; } },
    // Atomic: write a temp file, then rename over the target. On Windows the mode is ignored and the
    // file relies on the permissions of the user-profile folder.
    writeFile: (p, s) => {
      mkdirSync(dirname(p), { recursive: true });
      const tmp = `${p}.tmp`;
      writeFileSync(tmp, s, { mode: 0o600 });
      renameSync(tmp, p);
    },
    removeFile: p => rmSync(p, { force: true }),
    now: () => Date.now(),
    clientPath: join(dir, "client.json"),
    tokenPath: join(dir, "token.json"),
  };
}

function openBrowser(url) {
  const [cmd, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref(); } catch {}
}

const b64url = buf => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const html = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Waits on 127.0.0.1 for Google's redirect, then saves the tokens. Gives up after LOGIN_WAIT_MS.
function login(env) {
  const client = G.readClient(env);
  const verifier = b64url(randomBytes(32)), challenge = b64url(createHash("sha256").update(verifier).digest()), state = b64url(randomBytes(16));
  return new Promise((resolve, reject) => {
    let redirect = "", finished = false, handling = false;
    // Sends a page; `then` runs once the response has been flushed.
    const page = (res, message, then) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><meta charset="utf-8"><title>Herdr Task</title><p style="font:16px sans-serif;margin:40px">${html(message)}</p>`, then);
    };
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      if (error) reject(error); else resolve({ loggedIn: true });
    };
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/") { res.writeHead(404).end(); return; }
        // Once a valid callback is being handled, every later request just gets a neutral page.
        if (handling) { page(res, "이미 처리 중이에요. 이 창을 닫아도 돼요."); return; }
        if (url.searchParams.get("state") !== state) { page(res, "요청이 맞지 않아요. Herdr에서 다시 로그인해 주세요."); return; }
        handling = true;
        const denied = url.searchParams.get("error");
        if (denied) {
          page(res, `연결하지 못했어요: ${denied}`, () => finish(new G.TasksError("api", `로그인을 거부했어요: ${denied}`)));
          return;
        }
        try {
          await G.exchangeCode(env, client, { code: url.searchParams.get("code") ?? "", verifier, redirect });
        } catch (e) {
          page(res, `연결하지 못했어요: ${e?.message ?? e}`, () => finish(e));
          return;
        }
        page(res, "연결됐어요. 이 창을 닫아도 돼요.", () => finish(null));
      } catch (e) {
        const err = new G.TasksError("internal", String(e?.message ?? e));
        try { page(res, "연결하지 못했어요.", () => finish(err)); } catch { finish(err); }
      }
    });
    const timer = setTimeout(() => finish(new G.TasksError("api", "로그인 시간이 지났어요. 다시 시도해 주세요")), LOGIN_WAIT_MS);
    server.on("error", e => finish(new G.TasksError("internal", String(e?.message ?? e))));
    server.listen(0, "127.0.0.1", () => {
      redirect = `http://127.0.0.1:${server.address().port}`;
      openBrowser(G.authUrl(client, { redirect, challenge, state }));
    });
  });
}

async function run(env, { name, args: a }) {
  switch (name) {
    case "status": return G.status(env);
    case "login": return login(env);
    case "logout": return G.logout(env);
    case "lists": return G.lists(env);
    case "list-add": return G.listAdd(env, a.title);
    case "list-rename": return G.listRename(env, a.id, a.title);
    case "list-delete": return G.listDelete(env, a.id);
    case "tasks": return G.tasks(env, a.list);
    case "add": return G.add(env, a.list, a.title, a.parent);
    case "update": return G.update(env, a.list, a.id, a.fields);
    case "done": return G.done(env, a.list, a.id);
    case "undone": return G.undone(env, a.list, a.id);
    case "delete": return G.remove(env, a.list, a.id);
    case "move": return G.move(env, a.list, a.id, { parent: a.parent, previous: a.previous });
  }
  throw usage(`알 수 없는 명령: ${name}`);
}

export async function main(argv, env = makeEnv(), out = s => process.stdout.write(s + "\n")) {
  let line;
  try {
    const data = await run(env, parseCommand(argv));
    line = JSON.stringify({ ok: true, data: data ?? null });
  } catch (e) {
    line = JSON.stringify({ ok: false, error: { kind: e instanceof G.TasksError ? e.kind : "internal", message: String(e?.message ?? e) } });
  }
  await out(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = s => new Promise(r => process.stdout.write(s + "\n", r));
  if (typeof globalThis.fetch !== "function" || typeof AbortSignal?.timeout !== "function") {
    write(JSON.stringify({ ok: false, error: { kind: "internal", message: "Node.js 18 이상이 필요해요" } })).then(() => process.exit(0));
  } else {
    main(process.argv.slice(2), makeEnv(), write).then(() => process.exit(0));
  }
}
