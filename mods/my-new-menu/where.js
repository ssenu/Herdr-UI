// Which folder a panel follows. Kept as identical copies in my-files, my-github, my-plugins, my-sessions
// and my-new-menu, because mods cannot import outside their own folder; a test checks the copies match.

/**
 * The focused terminal's folder. A focused mod pane (a viewer tab) has no folder of its own, so the
 * space's last terminal folder stays, then any terminal in the space, then where the space starts.
 * memory: Map of space id → last terminal folder, updated here.
 */
export function followedCwd(memory, space, focused, panes) {
  const pane = focused?.pane ? panes.find(p => p.pane === focused.pane) : null;
  const live = pane?.mod ? null : pane?.cwd || focused?.cwd || null;
  if (live) {
    if (space) memory.set(space.id, live);
    return live;
  }
  const remembered = space ? memory.get(space.id) : null;
  if (remembered) return remembered;
  const tabs = new Set((space?.tabs ?? []).map(t => t.id));
  return panes.find(p => !p.mod && p.cwd && tabs.has(p.tab))?.cwd || space?.folder || null;
}
