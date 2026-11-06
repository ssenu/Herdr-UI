// Pure helpers for my-sessions. No herdr or gpui imports, so `node --test` can load this file.

// Keeps "C:\" and "/" whole; drops a trailing separator otherwise.
function trimSep(p) {
  const s = String(p ?? "");
  if (s === "/" || /^[A-Za-z]:[\\/]$/.test(s)) return s;
  return s.replace(/[\\/]+$/, "") || s;
}

/** Claude Code's folder name under ~/.claude/projects for a working folder. */
export function encodeProject(path) {
  return trimSep(path).replace(/[^A-Za-z0-9]/g, "-");
}

/** For comparing paths: "/" separators, no trailing one; Windows drive paths ignore case. */
export function normPath(p) {
  let s = String(p ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:/.test(s)) s = s.toLowerCase();
  return s;
}

export const samePath = (a, b) => normPath(a) === normPath(b);

/** path is base or inside it. */
export function isUnder(path, base) {
  const p = normPath(path), b = normPath(base);
  return p === b || p.startsWith(b + "/");
}

function parentPath(p) {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return null;
  if (i === 0) return p.length > 1 ? p[0] : null;
  const up = p.slice(0, i);
  if (/^[A-Za-z]:$/.test(up)) return p.length > 3 ? up + p[i] : null;
  return up;
}

/**
 * The folder a session was stored for: cwd or the nearest parent whose encoded name is `dir`
 * (the first recorded cwd can be a subfolder). `claude -r` must run there. Falls back to cwd.
 */
export function startFolder(dir, cwd) {
  const start = trimSep(cwd), drive = /^[A-Za-z]:/.test(start);
  const same = x => (drive ? encodeProject(x).toLowerCase() === String(dir).toLowerCase() : encodeProject(x) === dir);
  let cur = start;
  for (let n = 0; cur !== null && n < 64; n++) {
    if (same(cur)) return cur;
    cur = parentPath(cur);
  }
  return start;
}

/** `git worktree list --porcelain` → the worktree folders, root first, no duplicates. */
export function worktreePaths(porcelain, root) {
  const out = [root];
  for (const line of String(porcelain ?? "").split(/\r?\n/)) {
    if (!line.startsWith("worktree ")) continue;
    const path = line.slice("worktree ".length);
    if (path && !out.some(p => samePath(p, path))) out.push(path);
  }
  return out;
}

function jsonToken(token) {
  if (!token) return "";
  try {
    const v = JSON.parse(token);
    return typeof v === "string" ? v : "";
  } catch { return ""; }
}

/** sessionsCommand's output → rows. Lines without a usable cwd or time are dropped. */
export function sessionLines(stdout) {
  const rows = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const f = line.split("\t");
    if (f[0] !== "FILE" || f.length < 8) continue;
    const cwd = jsonToken(f[4]), mtime = Number(f[3]);
    if (!cwd || f[3].trim() === "" || !Number.isFinite(mtime)) continue;
    rows.push({ dir: f[1], id: f[2], mtime, cwd, customTitle: jsonToken(f[5]), aiTitle: jsonToken(f[6]), branch: jsonToken(f[7]) });
  }
  return rows;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clean = t => String(t ?? "").replace(/\s+/g, " ").trim();

/** Rows → sessions to show. The id goes into a command line, so only real UUIDs pass. */
export function toSessions(rows) {
  return rows.filter(r => UUID.test(r.id)).map(r => ({
    id: r.id,
    title: clean(r.customTitle) || clean(r.aiTitle) || "(제목 없음)",
    mtime: r.mtime,
    branch: r.branch,
    folder: startFolder(r.dir, r.cwd),
  })).filter(s => usableFolder(s.folder));
}

/** The folder goes to tab.new: it must be absolute and free of ".." segments. */
function usableFolder(p) {
  return /^([A-Za-z]:[\\/]|\/|\\\\)/.test(p) && !p.split(/[\\/]+/).includes("..");
}

/** "all": started in a worktree of this repository or below. "here": started in the focused folder. */
export function inScope(session, scope, { worktrees, cwd }) {
  return scope === "here" ? samePath(session.folder, cwd) : worktrees.some(w => isUnder(session.folder, w));
}

/**
 * Session ids a live agent is probably using, so a row can say so before it is opened.
 *
 * There is no session id in the mod API, so this goes by folder: `claude -c` continues the
 * newest session of its folder and keeps writing to that same file, so the newest N sessions
 * of a folder with N live agents are the ones in use. Wrong when a live session sits idle
 * while a newer session in the same folder ends: then the ended one is marked instead.
 *
 * liveFolders: one entry per live agent (`panes()` cwd), so duplicates mean two agents there.
 */
export function runningSessionIds(sessions, liveFolders) {
  const need = new Map();
  for (const f of liveFolders ?? []) {
    if (!f) continue;
    const k = normPath(f);
    need.set(k, (need.get(k) ?? 0) + 1);
  }
  const ids = new Set();
  if (need.size === 0) return ids;
  // Same order as pickSessions, so the row marked is the one listed first.
  for (const s of [...sessions].sort((a, b) => b.mtime - a.mtime || (a.id < b.id ? -1 : 1))) {
    const k = normPath(s.folder), left = need.get(k) ?? 0;
    if (left > 0) { ids.add(s.id); need.set(k, left - 1); }
  }
  return ids;
}

/** Sessions in scope, newest first, at most `limit`. */
export function pickSessions(sessions, scope, ctx, limit) {
  const all = sessions.filter(s => inScope(s, scope, ctx)).sort((a, b) => b.mtime - a.mtime || (a.id < b.id ? -1 : 1));
  return { items: all.slice(0, limit), more: all.length > limit };
}

export function relativeTime(ms, now) {
  const minutes = Math.floor((now - ms) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return `${Math.floor(days / 30)}개월 전`;
}

const slashes = p => String(p).replaceAll("\\", "/").replace(/\/+$/, "");

/** The row's second line: time · branch · folder (left out when it is the repository root). */
export function sessionMeta(session, root, now) {
  let folder = null;
  if (!samePath(session.folder, root)) {
    folder = isUnder(session.folder, root)
      ? slashes(session.folder).slice(slashes(root).length + 1)
      : slashes(session.folder).split("/").pop();
  }
  return [relativeTime(session.mtime * 1000, now), session.branch || null, folder].filter(Boolean).join(" · ");
}

/** A session title as a tab name. */
export function tabTitle(title) {
  return title.length > 40 ? title.slice(0, 39) + "…" : title;
}

export function emptyText(scope) {
  return scope === "here" ? "이 폴더에서 시작한 세션이 없어요" : "이 저장소에 세션이 없어요";
}

/** A PowerShell single-quoted literal. PowerShell also reads typographic single quotes as quotes. */
export function psQuote(s) {
  return "'" + String(s).replace(/['‘’‚‛]/g, m => m + m) + "'";
}

const HEAD_BYTES = 262144, TAIL_BYTES = 65536, MAX_FILES = 300;

/**
 * One command printing a FILE line per session under ~/.claude/projects/<prefix or prefix-*>:
 * only the first cwd, the last titles and the last branch, read from the file's two ends.
 * Files without a cwd in the first part are skipped. See sessionLines for the format.
 */
export function sessionsCommand(prefixes, windows) {
  if (windows) {
    const token = key => `'"${key}":("(?:[^"\\\\]|\\\\.)*")'`;
    const script = [
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$base = Join-Path $env:USERPROFILE '.claude\\projects'",
      "if (-not [IO.Directory]::Exists($base)) { exit 0 }",
      `$prefixes = @(${prefixes.map(psQuote).join(", ")})`,
      "$files = @(foreach ($d in [IO.Directory]::GetDirectories($base)) { $n = [IO.Path]::GetFileName($d); foreach ($p in $prefixes) { " +
        "if ($n -ieq $p -or $n.StartsWith($p + '-', [StringComparison]::OrdinalIgnoreCase)) { ([IO.DirectoryInfo]$d).GetFiles('*.jsonl'); break } } })",
      `$files = @($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First ${MAX_FILES})`,
      "$utf8 = [Text.UTF8Encoding]::new($false)",
      "function Last($text, $pattern) { $m = [regex]::Matches($text, $pattern); if ($m.Count) { $m[$m.Count - 1].Groups[1].Value } else { '' } }",
      "foreach ($f in $files) { try { " +
        "$s = [IO.File]::Open($f.FullName, 'Open', 'Read', 'ReadWrite, Delete'); " +
        "try { $len = $s.Length; " +
        `$b = New-Object byte[] ([Math]::Min($len, ${HEAD_BYTES})); [void]$s.Read($b, 0, $b.Length); $head = $utf8.GetString($b); ` +
        `$n = [Math]::Min($len, ${TAIL_BYTES}); [void]$s.Seek(-$n, 'End'); $b = New-Object byte[] $n; [void]$s.Read($b, 0, $n); $tail = $utf8.GetString($b) ` +
        "} finally { $s.Close() }; " +
        `$m = [regex]::Match($head, ${token("cwd")}); if (-not $m.Success) { continue }; ` +
        "$t = [DateTimeOffset]::new($f.LastWriteTimeUtc).ToUnixTimeSeconds(); " +
        `$custom = Last $tail ${token("customTitle")}; $ai = Last $tail ${token("aiTitle")}; $branch = Last $tail ${token("gitBranch")}; ` +
        "\"FILE`t$($f.Directory.Name)`t$($f.BaseName)`t$t`t$($m.Groups[1].Value)`t$custom`t$ai`t$branch\" " +
        "} catch {} }",
    ].join("; ");
    return { command: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  // Single backslashes only (one inside a bracket is literal): Git's sh on Windows halves doubled backslashes in arguments.
  const grab = (key, pick) => `grep -a -o -E '"${key}":"([^"\\]|[\\].)*"' | ${pick} -n 1 | sed 's/^"[A-Za-z]*"://'`;
  const script =
    'LC_ALL=C; export LC_ALL; base="$HOME/.claude/projects"; [ -d "$base" ] || exit 0; cd "$base" || exit 1; ' +
    // "./" first: on Unix every storage name starts with "-", which head, tail and stat would read as an option.
    'for p in "$@"; do for f in "./$p"/*.jsonl "./$p"-*/*.jsonl; do [ -f "$f" ] || continue; ' +
    'm=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f"); printf "%s\\t%s\\n" "$m" "$f"; done; done | ' +
    `sort -u | sort -rn | head -n ${MAX_FILES} | while IFS="$(printf "\\t")" read -r m f; do ` +
    `cwd=$(head -c ${HEAD_BYTES} "$f" | ${grab("cwd", "head")}); [ -n "$cwd" ] || continue; ` +
    `custom=$(tail -c ${TAIL_BYTES} "$f" | ${grab("customTitle", "tail")}); ` +
    `ai=$(tail -c ${TAIL_BYTES} "$f" | ${grab("aiTitle", "tail")}); ` +
    `branch=$(tail -c ${TAIL_BYTES} "$f" | ${grab("gitBranch", "tail")}); ` +
    'rest=${f#./}; dir=${rest%%/*}; id=${f##*/}; id=${id%.jsonl}; ' +
    'printf "FILE\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$dir" "$id" "$m" "$cwd" "$custom" "$ai" "$branch"; done';
  return { command: "sh", args: ["-c", script, "sessions", ...prefixes] };
}
