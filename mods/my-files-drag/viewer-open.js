// Shared by my-viewer, my-files-drag and my-new-menu. Mods cannot import outside their own folder,
// so each keeps a copy; tests/my-viewer-logic.test.mjs checks that the copies are identical.

export const BOUNDS_KEY = "my-tabs.bounds", OPEN_KEY = "my-viewer.open", OWN_KEY = "my-viewer.own";

const TOP_STRIP = { x: 0, y: 0, width: Infinity, height: 40 };
const inside = (b, p) => Boolean(b) && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** What releasing a dragged row does. Until the tab bar has been measured, it is taken as the window's top strip. */
export function dropAction({ position, panel, tabs, dir }) {
  if (!position || inside(panel, position)) return "cancel";
  if (inside(tabs ?? TOP_STRIP, position)) return dir ? "folder" : "open";
  return "paste";
}

/** For comparing paths: "/" separators; Windows drive paths ignore case. */
export function normKey(path) {
  const s = String(path ?? "").replaceAll("\\", "/");
  return /^[A-Za-z]:/.test(s) ? s.toLowerCase() : s;
}

export const openKey = (on, path) => `${on ?? ""}|${normKey(path)}`;

/** The tab registered for key, if it still exists. */
export function liveTab(open, key, spaces) {
  const id = open?.[key];
  if (!id) return null;
  for (const s of spaces) if (s.tabs.some(t => t.id === id)) return { space: s.id, tab: id };
  return null;
}

export const newToken = (now, random) => `${now.toString(36)}${Math.floor(random * 1e9).toString(36)}`;

/** tab.new's arguments. The viewer finds its own tab by the unique tabName, then renames it. */
export function tabArgs({ path, on, root, space }, token) {
  const tabName = `파일 뷰어 ${token}`;
  return { name: tabName, space, mod: "my-viewer", props: { path, on, root, token, tabName } };
}

/** The commands opening this file: the tab already showing it, or a new one. */
export function openCommands(where, open, spaces, token) {
  const live = where.path ? liveTab(open, openKey(where.on, where.path), spaces) : null;
  if (!live) return [["tab.new", tabArgs(where, token)]];
  const shown = spaces.find(s => s.active)?.id === live.space;
  return [...(shown ? [] : [["space.select", { id: live.space }]]), ["tab.select", { id: live.tab }]];
}
