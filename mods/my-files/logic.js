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
