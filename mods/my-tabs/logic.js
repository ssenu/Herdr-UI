// Pure helpers for my-tabs. No herdr or gpui imports, so `node --test` can load this file.

export const SPLIT_KEY = "my-tabs.split";

/** Panes moved here by dragging a tab, in pane order. Alone in its tab, a moved pane is that tab; if every pane was moved, the first stands for the tab. */
export function chipsFor(tabId, panes, split) {
  const list = panes.filter(p => p.tab === tabId), moved = list.filter(p => split?.[p.pane]);
  return (moved.length === list.length ? moved.slice(1) : moved)
    .map(p => ({ pane: p.pane, terminal: p.terminal, status: p.status, focused: p.focused, ...split[p.pane] }));
}

/** The tab's own panes: those without a chip. */
export function hostPanes(tabId, panes, chips) {
  const taken = new Set(chips.map(c => c.pane));
  return panes.filter(p => p.tab === tabId && !taken.has(p.pane));
}

const RANK = ["blocked", "working", "done"];

/** The most urgent status among these panes. */
export function hostStatus(panes) {
  return RANK.find(s => panes.some(p => p.status === s)) ?? null;
}

/** The record without this pane, and without panes that no longer exist. */
export function dropSplit(split, panes, pane) {
  const live = new Set(panes.map(p => p.pane));
  return Object.fromEntries(Object.entries(split ?? {}).filter(([id]) => id !== pane && live.has(id)));
}
