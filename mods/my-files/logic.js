// Pure helpers for my-files. No herdr or gpui imports, so `node --test` can load this file.

/** Longest text shown (and the longest that stays editable). */
export const PREVIEW_LIMIT = 400000;

/** Why a file is read-only, as shown in the header. */
export const REASONS = { remote: "원격 파일 · 읽기 전용", truncated: "큰 파일 · 일부만 표시" };

/** The absolute path a terminal should see. Local Windows paths use backslashes. */
export function absolutePath(root, rel, { remote, windows }) {
  const p = rel ? `${root.replace(/[\\/]+$/, "")}/${rel}` : root;
  return !remote && windows ? p.replace(/\//g, "\\") : p;
}

/** What gets typed into the prompt: quoted when the shell would split or interpret it, plus a space. */
export function quoteForPrompt(path) {
  return (/[\s'"&()^%!,;=]/.test(path) ? `"${path}"` : path) + " ";
}

/** Whether the panel may edit this text. Remote files can't be written; truncated ones would lose their tail. */
export function editability({ remote, text }) {
  if (remote) return { editable: false, reason: "remote" };
  if (text.length > PREVIEW_LIMIT) return { editable: false, reason: "truncated" };
  return { editable: true, reason: null };
}

/** The text put in the editor. */
export function previewText(text) {
  return text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) + "\n… (file truncated)" : text;
}

/** Equal ignoring CRLF vs LF (the editor may normalise line endings). */
export function sameText(a, b) {
  if (typeof a === "string" && typeof b === "string") return a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");
  return a === b;
}

/** Re-apply CRLF to an editor value when the file on disk used CRLF. */
export function restoreEol(value, base) {
  return typeof base === "string" && base.includes("\r\n") ? value.replace(/\r?\n/g, "\r\n") : value;
}

/**
 * What to do with an open buffer after reading the file again.
 * none: disk still matches base. adopt: disk now equals the unsaved edits.
 * reload: no edits, take the disk. conflict: edits and a different disk. drop: no edits, file gone.
 */
export function syncDecision({ base, dirty, value }, disk) {
  if (sameText(disk, base)) return "none";
  if (disk === null) return dirty ? "conflict" : "drop";
  if (dirty && sameText(value, disk)) return "adopt";
  return dirty ? "conflict" : "reload";
}

/** A rejected save: the disk moved away from base (conflict) or it didn't (some other error). */
export function saveFailure(base, disk) {
  return disk === base ? "error" : "conflict";
}

/** The save chord. gpui reports Ctrl+S on Windows as "ctrl-s" (not the documented "cmd-s"), so accept both. */
export function isSaveKey(keystroke) {
  return keystroke === "ctrl-s" || keystroke === "cmd-s";
}

/** Markdown files open in the rendered view first. */
export function isMarkdown(path) {
  return /\.(md|markdown)$/i.test(path ?? "");
}

// Letters of `part` in order inside `lower` from index `from`: their positions, or null.
function subsequence(lower, part, from) {
  const out = [];
  let j = from;
  for (const ch of part) {
    const i = lower.indexOf(ch, j);
    if (i < 0) return null;
    out.push(i);
    j = i + ch.length;
  }
  return out;
}

const wordStart = (path, i) => i === 0 || "/.-_ ".includes(path[i - 1]) || (/[a-z]/.test(path[i - 1]) && /[A-Z]/.test(path[i]));

// Lowercase per code point so every index maps 1:1 to the original string: when the lowercase form
// changes the length (e.g. "İ" -> "i" + combining dot), use its first code point if that keeps the
// length, otherwise keep the original character.
function lowerAligned(s) {
  let out = "";
  for (const ch of s) {
    const l = ch.toLowerCase();
    if (l.length === ch.length) out += l;
    else {
      const first = String.fromCodePoint(l.codePointAt(0));
      out += first.length === ch.length ? first : ch;
    }
  }
  return out;
}

// Score (and, with wantHits, matched code-unit positions) of every query part against path, or null.
function matchParts(parts, path, wantHits) {
  const lower = lowerAligned(path), nameStart = path.lastIndexOf("/") + 1, hits = wantHits ? new Set() : null;
  let score = -path.length;
  for (const part of parts) {
    let found = subsequence(lower, part, nameStart), inName = true;
    if (!found) { found = subsequence(lower, part, 0); inName = false; }
    if (!found) return null;
    if (inName) score += 100;
    let prev = -2;
    for (const i of found) {
      score += 10;
      if (i === prev + 1) score += 15;
      if (wordStart(path, i)) score += 20;
      prev = i;
      if (hits) {
        hits.add(i);
        if (path.codePointAt(i) > 0xffff) hits.add(i + 1);
      }
    }
  }
  return wantHits ? { score, hits: [...hits].sort((x, y) => x - y) } : { score };
}

const queryParts = query => lowerAligned(String(query ?? "")).split(/\s+/).filter(Boolean);

/**
 * Fuzzy file-path match: every space-separated part of the query must appear in order (ignoring case),
 * tried in the file name first, then the whole path. Higher score is better; hits are matched positions.
 */
export function fuzzyMatch(query, path) {
  const parts = queryParts(query);
  return parts.length ? matchParts(parts, path, true) : null;
}

/** Matching paths, best first (then shorter, then alphabetical); at most `limit`, `more` if cut. */
export function searchPaths(paths, query, limit) {
  const parts = queryParts(query), all = [];
  if (!parts.length) return { results: [], more: false };
  for (const path of paths) {
    const m = matchParts(parts, path, false);
    if (m) all.push({ path, score: m.score });
  }
  all.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const results = all.slice(0, limit).map(r => ({ path: r.path, ...matchParts(parts, r.path, true) }));
  return { results, more: all.length > limit };
}

/** "a/b/c.txt" → { dir: "a/b", name: "c.txt" }. */
export function splitPath(path) {
  const i = path.lastIndexOf("/");
  return { dir: i < 0 ? "" : path.slice(0, i), name: path.slice(i + 1) };
}

/** Runs of matched / unmatched characters, for highlighting. */
export function segments(text, hits) {
  const set = new Set(hits), out = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i), last = out[out.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else out.push({ text: text[i], hit });
  }
  return out;
}
