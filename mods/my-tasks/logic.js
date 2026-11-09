// Pure helpers for my-tasks. No herdr or gpui imports, so `node --test` can load this file.

export const REFRESH_MS = 120000;
export const LOGIN_TIMEOUT_MS = 310000;
// Printed by `node -e`: the Herdr app folder, where the installed helper lives under mods/my-tasks.
export const APP_DIR_SCRIPT = "process.stdout.write(process.env.HERDR_APP_HOME || require('path').join(require('os').homedir(), '.config', 'herdr-app'))";

export function helperPath(appDir) {
  return appDir.replace(/[\\/]+$/, "") + "/mods/my-tasks/tasks.mjs";
}

/** Helper arguments: flags (empty ones dropped), then `--`, then the free-text positionals. */
export function command(name, positional = [], flags = {}) {
  const pairs = Object.entries(flags).filter(([, v]) => v != null && v !== "").flatMap(([k, v]) => [`--${k}`, String(v)]);
  return [name, ...pairs, "--", ...positional];
}

const firstLine = s => (s ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? "";

/** The helper's answer: its last non-blank stdout line as JSON, or a bad-output error. */
export function parseOutput(stdout, stderr = "") {
  const lines = (stdout ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  try {
    const value = JSON.parse(last);
    if (value && typeof value.ok === "boolean") return value;
  } catch {}
  return { ok: false, error: { kind: "bad-output", message: (firstLine(stderr) || last).slice(0, 200) || "출력 없음" } };
}

/** `exec` rejected: its time limit, or the program could not start. */
export function execError(e) {
  const text = String(e?.message ?? e ?? "");
  return /timed?\s?out|timeout/i.test(text) ? { kind: "timeout", message: text } : { kind: "no-node", message: text };
}

const byPosition = (a, b) => ((a.position ?? "") < (b.position ?? "") ? -1 : (a.position ?? "") > (b.position ?? "") ? 1 : 0);

/**
 * Open tasks as roots (by position) with one level of children; completed tasks newest first.
 * A task whose parent is not an open root (gone, completed, or itself a child) shows as a root.
 */
export function buildTree(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const open = list.filter(t => t.status !== "completed");
  const ids = new Set(open.map(t => t.id));
  const isTop = t => !t.parent || !ids.has(t.parent);
  const topIds = new Set(open.filter(isTop).map(t => t.id));
  const roots = open.filter(t => isTop(t) || !topIds.has(t.parent)).sort(byPosition)
    .map(t => ({ ...t, children: topIds.has(t.id) ? open.filter(c => c.parent === t.id).sort(byPosition) : [] }));
  const done = list.filter(t => t.status === "completed")
    .sort((a, b) => ((b.completed ?? "") < (a.completed ?? "") ? -1 : (b.completed ?? "") > (a.completed ?? "") ? 1 : 0));
  return { roots, done };
}

function locate(tree, id) {
  const r = tree.roots.findIndex(t => t.id === id);
  if (r >= 0) return { siblings: tree.roots, index: r, parent: null, node: tree.roots[r] };
  for (const root of tree.roots) {
    const c = root.children.findIndex(t => t.id === id);
    if (c >= 0) return { siblings: root.children, index: c, parent: root, node: root.children[c] };
  }
  return null;
}

/** Where `tasks.move` should put the task for one button press, or null when it can't move that way. */
export function moveArgs(tree, id, dir) {
  const at = locate(tree, id);
  if (!at) return null;
  const { siblings, index, parent, node } = at, parentId = parent?.id ?? null;
  // A promoted orphan (shown as a root but with a parent set) has no reliable place to move to or from.
  const promoted = t => !!t?.parent && !parent;
  if (promoted(node)) return null;
  if (dir === "up") {
    if (index === 0 || promoted(siblings[index - 2])) return null;
    return { parent: parentId, previous: siblings[index - 2]?.id ?? null };
  }
  if (dir === "down") {
    if (index >= siblings.length - 1 || promoted(siblings[index + 1])) return null;
    return { parent: parentId, previous: siblings[index + 1].id };
  }
  if (dir === "indent") {
    if (parent || index === 0 || node.children.length) return null;
    const target = siblings[index - 1];
    if (promoted(target)) return null;
    return { parent: target.id, previous: target.children.at(-1)?.id ?? null };
  }
  if (dir === "outdent") return parent ? { parent: null, previous: parent.id } : null;
  return null;
}

export const canMove = (tree, id, dir) => moveArgs(tree, id, dir) !== null;

const pad = n => String(n).padStart(2, "0");
export function todayString(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "11/12" this year, "2027/1/3" another year; overdue when before today. Null without a due date. */
export function dueLabel(due, today) {
  if (!due) return null;
  const day = due.slice(0, 10), [y, m, d] = day.split("-").map(Number);
  const text = day.slice(0, 4) === today.slice(0, 4) ? `${m}/${d}` : `${y}/${m}/${d}`;
  return { text, overdue: day < today };
}

/** The due field: "YYYY-MM-DD", null when blank, undefined when it isn't a real date. */
export function parseDue(text) {
  const value = (text ?? "").trim();
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.getUTCFullYear() === +m[1] && date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3] ? value : undefined;
}

const LOGIN = { "no-client": "OAuth 클라이언트 파일이 필요해요", "no-login": "Google 계정 연결이 필요해요", expired: "로그인이 만료됐어요. 다시 로그인해 주세요" };
const BAR = { network: "인터넷 연결을 확인해 주세요", timeout: "응답이 늦어 결과를 모르겠어요. 새로 읽어 확인해 주세요", "no-node": "Node.js가 필요해요" };

/** What the panel shows for an error: the login screen, or a line in the error bar. */
export function errorText(error) {
  const kind = error?.kind ?? "internal", message = error?.message ?? "";
  if (Object.hasOwn(LOGIN, kind)) return { screen: "login", kind, text: LOGIN[kind], detail: kind === "no-client" ? message : null };
  if (Object.hasOwn(BAR, kind)) return { screen: "bar", kind, text: BAR[kind], detail: null };
  if (kind === "api") return { screen: "bar", kind, text: message || "Google Tasks 오류", detail: null };
  return { screen: "bar", kind, text: `내부 오류: ${message || "알 수 없는 오류"}`, detail: null };
}

// 을 after a final consonant, 를 after a vowel; 을(를) when the last letter isn't Hangul. Trailing ")" etc. don't count.
function objectParticle(word) {
  const code = (word.replace(/[^\p{L}\p{N}]+$/u, "").at(-1) ?? "").charCodeAt(0) - 0xac00;
  if (code < 0 || code >= 11172) return "을(를)";
  return code % 28 ? "을" : "를";
}

export function deleteText(task, childCount) {
  const title = task.title || "(제목 없음)";
  const base = `"${title}"${objectParticle(title)} 지울까요?`;
  return childCount ? `${base} 하위 ${childCount}개도 함께 지워져요.` : base;
}

export function listDeleteText(list, count) {
  return count ? `"${list.title}" 목록과 할 일 ${count}개를 지울까요?` : `"${list.title}" 목록을 지울까요?`;
}

export function notesPreview(notes) {
  return firstLine(notes) || null;
}
