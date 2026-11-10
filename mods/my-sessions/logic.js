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
    rows.push({ dir: f[1], id: f[2], mtime, cwd, customTitle: jsonToken(f[5]), aiTitle: jsonToken(f[6]), branch: jsonToken(f[7]), agentColor: jsonToken(f[8] ?? "") });
  }
  return rows;
}

export const COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** sessionsCommand's output → the ids of sessions a running Claude Code has open. */
export function liveIds(stdout) {
  const ids = new Set();
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const f = line.split("\t");
    if (f[0] === "LIVE" && UUID.test(f[1] ?? "")) ids.add(f[1].toLowerCase());
  }
  return ids;
}

const clean = t => String(t ?? "").replace(/\s+/g, " ").trim();

/** Storage folder names under ~/.claude/projects: encodeProject's output. */
const STORE = /^[A-Za-z0-9-]+$/;

/** Rows → sessions to show. The id goes into a command line, so only real UUIDs pass. */
export function toSessions(rows) {
  return rows.filter(r => UUID.test(r.id) && STORE.test(r.dir ?? "")).map(r => ({
    id: r.id,
    title: clean(r.customTitle) || clean(r.aiTitle) || "(제목 없음)",
    mtime: r.mtime,
    branch: r.branch,
    folder: startFolder(r.dir, r.cwd),
    dir: r.dir,
    color: COLORS.includes(r.agentColor) ? r.agentColor : null,
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

// The loop over ~/.claude/sessions/*.json that finds sessions a running Claude Code has open.
// `found` runs for each one, with the session id in $i.Groups[1].Value. Needs $live set first.
function psLiveLoop(found) {
  return "if ([IO.Directory]::Exists($live)) { foreach ($f in [IO.Directory]::GetFiles($live, '*.json')) { try { " +
    "$t = [IO.File]::ReadAllText($f); " +
    "$p = [regex]::Match($t, '\"pid\"\\s*:\\s*(\\d+)'); $i = [regex]::Match($t, '\"sessionId\"\\s*:\\s*\"([0-9a-fA-F-]{36})\"'); $s = [regex]::Match($t, '\"startedAt\"\\s*:\\s*(\\d+)'); " +
    "if (-not $p.Success -or -not $i.Success) { continue }; " +
    "$proc = Get-Process -Id ([int]$p.Groups[1].Value) -ErrorAction Stop; " +
    "if ($s.Success -and [DateTimeOffset]::new($proc.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() -gt [long]$s.Groups[1].Value + 5000) { continue }; " +
    found +
    "} catch {} } }";
}

// The same for sh; `found` runs with the id in $id.
function shLiveLoop(found) {
  return 'for f in "$HOME/.claude/sessions"/*.json; do [ -f "$f" ] || continue; ' +
    `pid=$(grep -a -o -E '"pid": *[0-9]+' "$f" | head -n 1 | sed 's/.*[^0-9]//'); ` +
    `id=$(grep -a -o -E '"sessionId": *"[0-9a-fA-F-]{36}"' "$f" | head -n 1 | sed 's/.*: *"//; s/"$//'); ` +
    `[ -n "$pid" ] && [ -n "$id" ] && kill -0 "$pid" 2>/dev/null && ${found}; done; `;
}

/**
 * One command printing a FILE line per session under ~/.claude/projects/<prefix or prefix-*>:
 * only the first cwd, the last titles and the last branch, read from the file's two ends.
 * Files without a cwd in the first part are skipped. See sessionLines for the format.
 * Before those, a LIVE line per running session in ~/.claude/sessions/<pid>.json: only the id
 * leaves the command, because those files also hold tokens. See liveIds.
 */
export function sessionsCommand(prefixes, windows) {
  if (windows) {
    const token = key => `'"${key}":("(?:[^"\\\\]|\\\\.)*")'`;
    const script = [
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$live = Join-Path $env:USERPROFILE '.claude\\sessions'",
      // A process that started after the session did has only inherited the pid of a dead one.
      psLiveLoop("\"LIVE`t$($i.Groups[1].Value)\" "),
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
        `$custom = Last $tail ${token("customTitle")}; $ai = Last $tail ${token("aiTitle")}; $branch = Last $tail ${token("gitBranch")}; $color = Last $tail ${token("agentColor")}; ` +
        "\"FILE`t$($f.Directory.Name)`t$($f.BaseName)`t$t`t$($m.Groups[1].Value)`t$custom`t$ai`t$branch`t$color\" " +
        "} catch {} }",
    ].join("; ");
    return { command: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  // Single backslashes only (one inside a bracket is literal): Git's sh on Windows halves doubled backslashes in arguments.
  const grab = (key, pick) => `grep -a -o -E '"${key}":"([^"\\]|[\\].)*"' | ${pick} -n 1 | sed 's/^"[A-Za-z]*"://'`;
  const script =
    'LC_ALL=C; export LC_ALL; ' +
    shLiveLoop('printf "LIVE\\t%s\\n" "$id"') +
    'base="$HOME/.claude/projects"; [ -d "$base" ] || exit 0; cd "$base" || exit 1; ' +
    // "./" first: on Unix every storage name starts with "-", which head, tail and stat would read as an option.
    'for p in "$@"; do for f in "./$p"/*.jsonl "./$p"-*/*.jsonl; do [ -f "$f" ] || continue; ' +
    'm=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f"); printf "%s\\t%s\\n" "$m" "$f"; done; done | ' +
    `sort -u | sort -rn | head -n ${MAX_FILES} | while IFS="$(printf "\\t")" read -r m f; do ` +
    `cwd=$(head -c ${HEAD_BYTES} "$f" | ${grab("cwd", "head")}); [ -n "$cwd" ] || continue; ` +
    `custom=$(tail -c ${TAIL_BYTES} "$f" | ${grab("customTitle", "tail")}); ` +
    `ai=$(tail -c ${TAIL_BYTES} "$f" | ${grab("aiTitle", "tail")}); ` +
    `branch=$(tail -c ${TAIL_BYTES} "$f" | ${grab("gitBranch", "tail")}); ` +
    `color=$(tail -c ${TAIL_BYTES} "$f" | ${grab("agentColor", "tail")}); ` +
    'rest=${f#./}; dir=${rest%%/*}; id=${f##*/}; id=${id%.jsonl}; ' +
    'printf "FILE\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$dir" "$id" "$m" "$cwd" "$custom" "$ai" "$branch" "$color"; done';
  return { command: "sh", args: ["-c", script, "sessions", ...prefixes] };
}

function checkTarget(dir, id) {
  if (!STORE.test(String(dir ?? "")) || !UUID.test(String(id ?? ""))) throw new Error("세션을 가리키지 못했어요");
}

// Appends one JSON record line to a session file (Claude Code's own way of changing a title or color).
// A file not ending in a newline gets one first. Exit 2: no such session file.
function appendRecordCommand(dir, id, record, windows, verb) {
  checkTarget(dir, id);
  const line = JSON.stringify(record);
  if (windows) {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$f = [IO.Path]::Combine($env:USERPROFILE, '.claude', 'projects', ${psQuote(dir)}, ${psQuote(`${id}.jsonl`)})`,
      "if (-not [IO.File]::Exists($f)) { exit 2 }",
      "try { $nl = $true; " +
        "$r = [IO.File]::Open($f, 'Open', 'Read', 'ReadWrite, Delete'); " +
        "try { if ($r.Length -gt 0) { [void]$r.Seek(-1, 'End'); $nl = $r.ReadByte() -eq 10 } } finally { $r.Close() }; " +
        `$text = $(if ($nl) { '' } else { [string][char]10 }) + ${psQuote(line)} + [char]10; ` +
        "$b = [Text.UTF8Encoding]::new($false).GetBytes($text); " +
        "$w = [IO.File]::Open($f, [IO.FileMode]::Append, [IO.FileAccess]::Write, 'ReadWrite, Delete'); " +
        "try { $w.Write($b, 0, $b.Length) } finally { $w.Close() } " +
        "} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
    ].join("; ");
    return { command: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  const script = 'f="$HOME/.claude/projects/$1/$2.jsonl"; [ -f "$f" ] || exit 2; ' +
    '[ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ] && printf "\\n" >> "$f"; printf "%s\\n" "$3" >> "$f"';
  return { command: "sh", args: ["-c", script, verb, dir, id, line] };
}

/** Renames a session the way Claude Code's /rename does: one custom-title record appended to its file. */
export function renameCommand(dir, id, title, windows) {
  checkTarget(dir, id);
  const name = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("이름이 비어 있어요");
  return appendRecordCommand(dir, id, { type: "custom-title", customTitle: name, sessionId: id }, windows, "rename");
}

/** Colors a session the way Claude Code's /color does: one agent-color record. "default" clears the color. */
export function colorCommand(dir, id, color, windows) {
  checkTarget(dir, id);
  if (color !== "default" && !COLORS.includes(color)) throw new Error("알 수 없는 색이에요");
  return appendRecordCommand(dir, id, { type: "agent-color", agentColor: color, sessionId: id }, windows, "color");
}

/**
 * Deletes a session file and its same-named folder: to the Recycle Bin on Windows, for good elsewhere.
 * Exit 3: the session is open (nothing deleted). Exit 2: no such session file. Exit 1: the file could not be
 * removed (the folder is left alone). Exit 4: the file is gone but its folder could not be removed.
 */
export function deleteCommand(dir, id, windows) {
  checkTarget(dir, id);
  if (windows) {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$id = ${psQuote(id)}`,
      "$live = Join-Path $env:USERPROFILE '.claude\\sessions'",
      psLiveLoop("if ($i.Groups[1].Value -eq $id) { exit 3 } "),
      `$d = [IO.Path]::Combine($env:USERPROFILE, '.claude', 'projects', ${psQuote(dir)})`,
      "$file = Join-Path $d ($id + '.jsonl'); $sub = Join-Path $d $id",
      "if (-not [IO.File]::Exists($file)) { exit 2 }",
      "try { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($file, 'OnlyErrorDialogs', 'SendToRecycleBin') } " +
        "catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
      "if ([IO.Directory]::Exists($sub)) { try { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($sub, 'OnlyErrorDialogs', 'SendToRecycleBin') } " +
        "catch { [Console]::Error.WriteLine($_.Exception.Message); exit 4 } }",
    ].join("; ");
    return { command: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  const script = shLiveLoop(`[ "$(printf %s "$id" | tr 'A-F' 'a-f')" = "$(printf %s "$2" | tr 'A-F' 'a-f')" ] && exit 3`) +
    'd="$HOME/.claude/projects/$1"; [ -f "$d/$2.jsonl" ] || exit 2; rm -f "$d/$2.jsonl" || exit 1; rm -rf "$d/$2" || exit 4';
  return { command: "sh", args: ["-c", script, "delete", dir, id] };
}

export function actionError(code, stderr) {
  if (code === 2) return "세션 파일이 없어요";
  if (code === 3) return "열려 있는 세션은 지울 수 없어요";
  if (code === 4) return "세션은 지웠지만 함께 있던 폴더는 지우지 못했어요";
  return String(stderr ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean) || "실패했어요";
}

export function deleteConfirmText(title, permanent) {
  return permanent ? `"${title}" 세션을 완전히 지울까요? 되돌릴 수 없어요.` : `"${title}" 세션을 휴지통으로 보낼까요?`;
}
