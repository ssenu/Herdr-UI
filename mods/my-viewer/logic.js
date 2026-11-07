// Pure helpers for my-viewer. No herdr or gpui imports, so `node --test` can load this file.
import { normKey } from "./viewer-open.js";
import { isMarkdown, sameText } from "./files-logic.js";

const BINARY = /\.(png|jpe?g|gif|bmp|webp|ico|tiff?|heic|avif|pdf|zip|7z|rar|gz|tgz|bz2|xz|tar|exe|dll|so|dylib|bin|msi|dmg|iso|class|jar|woff2?|ttf|otf|eot|mp3|wav|flac|ogg|mp4|mov|avi|mkv|webm|docx?|xlsx?|pptx?|hwpx?|sqlite|db)$/i;

/** How to show a file. text: null means it hasn't been read, so only the name decides. */
export function viewKind(path, text) {
  if (BINARY.test(path ?? "") || (typeof text === "string" && text.includes("\0"))) return "binary";
  return isMarkdown(path) ? "markdown" : "text";
}

/** A short stable hash (cyrb53 variant) as 16 hex digits. */
export function textHash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** The draft file's name for a path, without its extension. */
export const draftName = path => textHash(normKey(path));

/** A draft file's text → { path, text, base }, or null unless complete. */
export function parseDraft(text) {
  if (typeof text !== "string") return null;
  try {
    const d = JSON.parse(text);
    return typeof d?.path === "string" && typeof d.text === "string" && typeof d.base === "string" ? { path: d.path, text: d.text, base: d.base } : null;
  } catch { return null; }
}

/**
 * What the editor starts with. disk: the file's text, null when it's gone.
 * dirty: differs from the disk. conflict: the disk changed since the draft began. discard: the draft is useless.
 */
export function restoreState(draft, path, disk) {
  const clean = { text: disk, dirty: false, conflict: false, discard: false };
  if (!draft || normKey(draft.path) !== normKey(path)) return clean;
  if (disk === null) return { text: draft.text, dirty: true, conflict: true, discard: false };
  if (sameText(draft.text, disk)) return { ...clean, discard: true };
  return { text: draft.text, dirty: true, conflict: draft.base !== textHash(disk), discard: false };
}

const MARK = "● ";

export function dirtyName(name, dirty) {
  const plain = String(name ?? "").startsWith(MARK) ? name.slice(MARK.length) : String(name ?? "");
  return dirty ? MARK + plain : plain;
}

export const baseName = path => String(path ?? "").split(/[\\/]/).pop();

export function parentDir(path) {
  const m = /^(.*)[\\/][^\\/]*$/.exec(String(path ?? ""));
  return m ? m[1] : "";
}

/** The id of the tab with this exact name. */
export function findTab(spaces, name) {
  if (!name) return null;
  for (const s of spaces) for (const t of s.tabs) if (t.name === name) return t.id;
  return null;
}

export function tabInfo(spaces, id) {
  for (const s of spaces) for (const t of s.tabs) if (t.id === id) return t;
  return null;
}

/** The entries of map whose tab still exists. */
export function keepLive(map, spaces, tabOf) {
  const out = {};
  for (const [k, v] of Object.entries(map ?? {})) if (tabInfo(spaces, tabOf(v))) out[k] = v;
  return out;
}
