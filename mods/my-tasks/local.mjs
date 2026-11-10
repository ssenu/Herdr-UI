// Local task storage for my-tasks: the same functions and result shapes as google.mjs, kept in one JSON
// file (env.localPath) on this PC. A file that can't be read is never overwritten.
import { TasksError } from "./google.mjs";

const DEFAULT_LIST = "내 할 일";
const FIELDS = ["id", "title", "notes", "due", "status", "completed", "parent"];

function valid(data) {
  return Boolean(data) && typeof data === "object" && Array.isArray(data.lists)
    && data.lists.every(l => l && typeof l.id === "string")
    && Boolean(data.tasks) && typeof data.tasks === "object" && !Array.isArray(data.tasks)
    && Object.values(data.tasks).every(Array.isArray);
}

const save = (env, data) => env.writeFile(env.localPath, JSON.stringify(data));

function load(env) {
  const raw = env.readFile(env.localPath);
  if (raw == null) {
    const id = env.newId();
    const data = { lists: [{ id, title: DEFAULT_LIST }], tasks: { [id]: [] } };
    save(env, data);
    return data;
  }
  let data = null;
  try { data = JSON.parse(raw); } catch {}
  if (!valid(data)) throw new TasksError("local", `로컬 저장 파일을 읽지 못했어요: ${env.localPath}`);
  return data;
}

// Loads, lets `fn` change the data, then saves. If `fn` throws, nothing is saved.
function change(env, fn) {
  const data = load(env);
  const result = fn(data);
  save(env, data);
  return result;
}

function listTasks(data, list) {
  if (!data.lists.some(l => l.id === list)) throw new TasksError("api", "목록을 찾을 수 없어요");
  return (data.tasks[list] ??= []);
}

function indexOf(arr, id) {
  const i = arr.findIndex(t => t.id === id);
  if (i < 0) throw new TasksError("api", "할 일을 찾을 수 없어요");
  return i;
}

const out = (task, index) => ({ ...Object.fromEntries(FIELDS.map(k => [k, task[k] ?? null])), position: String(index).padStart(8, "0") });
const outList = l => ({ id: l.id, title: l.title });

export async function status(env) {
  load(env);
  return { loggedIn: true };
}

export async function lists(env) {
  return load(env).lists.map(outList);
}

export async function listAdd(env, title) {
  return change(env, data => {
    const l = { id: env.newId(), title };
    data.lists.push(l);
    data.tasks[l.id] = [];
    return outList(l);
  });
}

export async function listRename(env, id, title) {
  return change(env, data => {
    const l = data.lists.find(x => x.id === id);
    if (!l) throw new TasksError("api", "목록을 찾을 수 없어요");
    l.title = title;
    return outList(l);
  });
}

export async function listDelete(env, id) {
  return change(env, data => {
    if (!data.lists.some(x => x.id === id)) throw new TasksError("api", "목록을 찾을 수 없어요");
    data.lists = data.lists.filter(x => x.id !== id);
    delete data.tasks[id];
    return null;
  });
}

export async function tasks(env, list) {
  return listTasks(load(env), list).map(out);
}

// Like Google: a new task goes first; a new subtask goes first under its parent.
export async function add(env, list, title, parent) {
  return change(env, data => {
    const arr = listTasks(data, list);
    const at = parent ? indexOf(arr, parent) + 1 : 0;
    const task = { id: env.newId(), title, notes: null, due: null, status: "needsAction", completed: null, parent: parent ?? null };
    arr.splice(at, 0, task);
    return out(task, at);
  });
}

export async function update(env, list, id, fields) {
  return change(env, data => {
    const arr = listTasks(data, list), i = indexOf(arr, id), task = arr[i];
    if ("title" in fields) task.title = fields.title;
    if ("notes" in fields) task.notes = fields.notes;
    if ("due" in fields) task.due = fields.due == null ? null : `${fields.due}T00:00:00.000Z`;
    return out(task, i);
  });
}

function setStatus(env, list, id, values) {
  return change(env, data => {
    const arr = listTasks(data, list), i = indexOf(arr, id);
    Object.assign(arr[i], values);
    return out(arr[i], i);
  });
}
export const done = async (env, list, id) => setStatus(env, list, id, { status: "completed", completed: new Date(env.now()).toISOString() });
export const undone = async (env, list, id) => setStatus(env, list, id, { status: "needsAction", completed: null });

export async function remove(env, list, id) {
  return change(env, data => {
    const arr = listTasks(data, list);
    indexOf(arr, id);
    data.tasks[list] = arr.filter(t => t.id !== id && t.parent !== id);
    return null;
  });
}

// Like Google's tasks.move: right after `previous`; else first under `parent`; else first in the list.
export async function move(env, list, id, { parent, previous } = {}) {
  return change(env, data => {
    const arr = listTasks(data, list);
    if (parent) indexOf(arr, parent);
    if (previous) indexOf(arr, previous);
    const [task] = arr.splice(indexOf(arr, id), 1);
    task.parent = parent || null;
    const at = previous ? indexOf(arr, previous) + 1 : parent ? indexOf(arr, parent) + 1 : 0;
    arr.splice(at, 0, task);
    return out(task, at);
  });
}
