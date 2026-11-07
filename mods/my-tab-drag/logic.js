// Pure helpers for my-tab-drag. No herdr or gpui imports, so `node --test` can load this file.

const CHILDREN = "하위 에이전트가 있는 탭은 옮길 수 없어요";
const ACTIVE = "지금 보고 있는 탭은 옮길 수 없어요", MANY = "여러 칸으로 나뉜 탭은 옮길 수 없어요", REMOTE = "원격 탭은 옮길 수 없어요", OTHER = "이 탭은 옮길 수 없어요";
const GAP = 8, EDGE = 0.25;

/** What dragging this tab can do. own: the shared my-viewer.own map (token → { tab, path, on }).
 *  parents: the `parent` of every terminal that has one; a terminal listed there has sub-agents. */
export function tabMove(tabId, { activeTab, panes, machine, own, parents = [] }) {
  if (tabId === activeTab) return { blocked: ACTIVE };
  if (machine) return { blocked: REMOTE };
  const list = panes.filter(p => p.tab === tabId);
  if (list.length > 1) return { blocked: MANY };
  const pane = list[0];
  if (!pane) return { blocked: OTHER };
  if (pane.mod === "my-viewer") {
    const entry = Object.values(own ?? {}).find(v => v.tab === tabId);
    return entry?.path ? { kind: "viewer", path: entry.path, on: entry.on ?? null } : { blocked: OTHER };
  }
  if (pane.mod || !pane.terminal) return { blocked: OTHER };
  if (pane.terminal.includes("/")) return { blocked: REMOTE };
  if (parents.includes(pane.terminal)) return { blocked: CHILDREN };
  return { kind: "terminal", terminal: pane.terminal };
}

/** The box tabs show in: below the bar, above the status bar, beside the open panel. Null when it can't be told. */
export function workArea({ bar, window, panelWidth, statusHeight }) {
  if (!bar || !window) return null;
  const x = bar.x + GAP, y = bar.y + bar.height + GAP;
  const right = window.width - GAP - (panelWidth ? panelWidth + GAP : 0), bottom = window.height - statusHeight - GAP;
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Which side a release at position splits. The outer quarter of each side counts; a corner goes to the nearer edge. */
export function dropZone(position, area) {
  if (!position || !area) return null;
  const left = (position.x - area.x) / area.width, up = (position.y - area.y) / area.height;
  if (left < 0 || left > 1 || up < 0 || up > 1) return null;
  const sides = [["left", left], ["right", 1 - left], ["up", up], ["down", 1 - up]];
  const [zone, distance] = sides.reduce((a, b) => (b[1] < a[1] ? b : a));
  return distance < EDGE ? zone : null;
}

/** The half of the area the moved tab takes. */
export function previewBox(zone, { x, y, width, height }) {
  if (zone === "left") return { x, y, width: width / 2, height };
  if (zone === "right") return { x: x + width / 2, y, width: width / 2, height };
  if (zone === "up") return { x, y, width, height: height / 2 };
  return { x, y: y + height / 2, width, height: height / 2 };
}

/** Herdr splits only right and down, so left and up swap afterward. */
export function placement(zone) {
  return { left: { place: "right", swap: "left" }, right: { place: "right", swap: null }, up: { place: "down", swap: "up" }, down: { place: "down", swap: null } }[zone];
}

const NAMES = { left: "왼쪽", right: "오른쪽", up: "위쪽", down: "아래쪽" };

export function dropLabel(zone, move) {
  if (move.blocked) return move.blocked;
  return zone ? `놓으면 ${NAMES[zone]}으로 분할` : "놓으면 취소";
}
