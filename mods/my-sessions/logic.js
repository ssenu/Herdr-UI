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
    if (!cwd || !Number.isFinite(mtime)) continue;
    rows.push({ dir: f[1], id: f[2], mtime, cwd, customTitle: jsonToken(f[5]), aiTitle: jsonToken(f[6]), branch: jsonToken(f[7]) });
  }
  return rows;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows → sessions to show. The id goes into a command line, so only real UUIDs pass. */
export function toSessions(rows) {
  return rows.filter(r => UUID.test(r.id)).map(r => ({
    id: r.id,
    title: (r.customTitle || r.aiTitle || "(제목 없음)").replace(/\s+/g, " ").trim(),
    mtime: r.mtime,
    branch: r.branch,
    folder: startFolder(r.dir, r.cwd),
  }));
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
