// Pure helpers for my-plugins. No herdr or gpui imports, so `node --test` can load this file.

/** A PowerShell single-quoted string literal (only ' is special inside). */
export function psQuote(s) {
  return "'" + String(s).replaceAll("'", "''") + "'";
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
  const script = "printf 'HOME\\t%s\\n' \"$HOME\"; for d in \"$@\"; do for p in \"$d\"/*/SKILL.md; do " +
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
