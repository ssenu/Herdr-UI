// Pure helpers for my-plugins. No herdr or gpui imports, so `node --test` can load this file.

/** A PowerShell single-quoted string literal. PowerShell also reads the typographic single quotes as quotes, so double those too. */
export function psQuote(s) {
  return "'" + String(s).replace(/['‘’‚‛]/g, m => m + m) + "'";
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
  const script = "printf 'HOME\\t%s\\n' \"$HOME\"; for d in \"$@\"; do for p in \"$d\"/*/SKILL.md \"$d\"/.[!.]*/SKILL.md; do " +
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

const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** { name: config } → [{ name, config }]. */
export function servers(map) {
  return isObject(map) ? Object.entries(map).map(([name, config]) => ({ name, config })) : [];
}

/** Claude Code's ~/.claude.json: user servers, and the local servers stored for this folder (or its repository). */
export function claudeMcp(obj, cwd, repo) {
  const projects = isObject(obj?.projects) ? Object.entries(obj.projects) : [];
  const own = projects.find(([p]) => samePath(p, cwd))?.[1];
  const entry = servers(own?.mcpServers).length ? own : projects.find(([p]) => samePath(p, repo))?.[1];
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

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function ensure(root, path) {
  let cur = root;
  for (const k of path) {
    if (UNSAFE_KEYS.has(k)) throw new Error("허용하지 않는 키");
    if (!Object.hasOwn(cur, k)) cur[k] = {};
    if (!isObject(cur[k])) throw new Error("이미 값이 있는 키");
    cur = cur[k];
  }
  return cur;
}

function setPath(obj, path, value) {
  const last = path[path.length - 1];
  if (UNSAFE_KEYS.has(last)) throw new Error("허용하지 않는 키");
  ensure(obj, path.slice(0, -1))[last] = value;
}

/**
 * Reads TOML tables, keys and the values above. A line it can't read is skipped and noted in errors
 * under the table it belongs to; arrays of tables ([[x]]) are skipped.
 */
export function parseToml(text) {
  const p = new Toml(String(text ?? "").replace(/^﻿/, "")), data = {}, errors = [];
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
      if (header) {
        const m = /^\[\s*mcp_servers\s*\.\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_-]+))/.exec(p.s.slice(start));
        const name = m && (m[1] ?? m[2] ?? m[3]);
        errors.push({ path: name !== undefined && !UNSAFE_KEYS.has(name) ? ["mcp_servers", name] : [], message: e.message });
        table = null; at = null;
      } else if (at) errors.push({ path: at, message: e.message });
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
const USERINFO = /\/\/[^/@\s]*@/;
const ENV_ARG = /^([A-Za-z_][\w.-]*)=/;
const QUERY = /([?&][^=&#]*(?:token|secret|key|password|auth)[^=&#]*=)[^&#]*/gi;

function redactArgs(args) {
  return args.map((a, i) => {
    if (typeof a !== "string") return a;
    if (i > 0 && typeof args[i - 1] === "string" && FLAG.test(args[i - 1])) return MASK;
    if (/^authorization:/i.test(a)) return `Authorization: ${MASK}`;
    const e = ENV_ARG.exec(a);
    if (e && SECRET.test(e[1])) return `${e[1]}=${MASK}`;
    return a.replace(FLAG_VALUE, `$1${MASK}`);
  });
}

/** A copy with env/header values, secret-named strings, secret flags in args and secret URL parameters masked. */
export function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (!isObject(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (SECRET_MAPS.has(k)) out[k] = isObject(x) ? Object.fromEntries(Object.keys(x).map(n => [n, MASK])) : MASK;
    else if (k === "args" && Array.isArray(x)) out[k] = redactArgs(x);
    else if (k === "url" && typeof x === "string") out[k] = x.replace(USERINFO, `//${MASK}@`).replace(QUERY, `$1${MASK}`);
    else if (SECRET.test(k) && k !== "args" && k !== "url") out[k] = MASK;
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

/** key: value lines for the detail view; nested tables one level deeper. Redacts its input. */
export function configLines(v, depth = 0) {
  const out = [];
  if (depth === 0) v = redact(v);
  for (const [k, x] of Object.entries(isObject(v) ? v : {})) {
    if (isObject(x)) { out.push({ depth, text: `${k}:` }); out.push(...configLines(x, depth + 1)); }
    else if (Array.isArray(x)) out.push({ depth, text: `${k}: ${x.map(show).join(" ")}` });
    else out.push({ depth, text: `${k}: ${String(x)}` });
  }
  return out;
}
