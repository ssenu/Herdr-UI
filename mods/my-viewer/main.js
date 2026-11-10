// A tab showing one file: text and code are edited and saved, markdown has a rendered view, other files
// offer an external program. With no file yet, it starts as a file search under its folder.
// Unsaved edits are kept as a draft in the app's data folder, because a tab can close without asking.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView, InputState, Input } from "gpui-base";
import { props, spaces, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, openOverlay, run, notify, shared, setShared, appHome } from "herdr";
import { mkdir, writeFile, unlink, readFile, exists } from "fs/promises";
import { editability, previewText, sameText, isSaveKey, restoreEol, syncDecision, saveFailure, REASONS, absolutePath, searchPaths, splitPath, segments, indexCommand, indexLines } from "./files-logic.js";
import { viewKind, textHash, draftName, pickDraft, watchMatters, restoreState, dirtyName, baseName, parentDir, findTab, tabInfo, keepLive } from "./logic.js";
import { chip, button, errorLine, note, HEADER_H, TOOLBAR_H } from "./ui.js";
import { OPEN_KEY, OWN_KEY, openKey, openCommands } from "./viewer-open.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const DRAFT_MS = 1000, CLAIM_MS = 500, CLAIM_TRIES = 60, RESULT_LIMIT = 200;
const GONE = "이 파일을 찾을 수 없어요";
const draftsDir = () => `${appHome()}/data/my-viewer/drafts`;
// Two generations: the new one is written whole first, then the main one, so a cut-off write leaves one intact.
const draftFile = path => `${draftsDir()}/${draftName(path)}.json`;
const draftNewFile = path => `${draftsDir()}/${draftName(path)}.new.json`;
// Text of the file, null when absent, undefined when it exists but can't be read.
const readDraftFile = async file => {
  try { return (await exists(file)) ? await readFile(file, "utf8") : null; } catch { return undefined; }
};

export default class Viewer extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.token = p.token ?? null; this.tabName = p.tabName ?? null; this.on = p.on ?? null; this.root = p.root ?? null;
    const own = this.token ? shared(OWN_KEY)?.[this.token] : null;
    this.path = p.path ?? own?.path ?? null; this.tab = own?.tab ?? null;
    this.buf = null; this.error = null; this.binary = false; this.draftSeq = 0; this.draftHeld = false; this.closed = false; this.watching = null;
    this.query = ""; this.at = 0; this.index = null; this.found = null;
    this.search = InputState.new({ placeholder: "이 폴더에서 파일 찾기" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); this.at = 0; this.ensureIndex(cx); cx.notify(); });
    this.search.on("submit", (_e, cx) => { this.openResult(cx); cx.notify(); });
    this.claimTab();
    if (this.token && !this.tab) {
      let tries = 0;
      this.claimTimer = cx.timer.every(CLAIM_MS, () => {
        if (!this.tab && ++tries <= CLAIM_TRIES) this.claimTab();
        if (this.tab || tries >= CLAIM_TRIES) this.claimTimer?.cancel();
      });
    }
    if (this.path) this.load(cx); else this.search.focus();
  }

  // run() returns nothing and props() has no tab id, so the tab is found by the unique name it was opened with.
  claimTab() {
    if (this.tab || !this.token) return;
    const id = findTab(spaces(), this.tabName);
    if (!id) return;
    this.tab = id;
    this.register();
    this.syncName(this.path ? baseName(this.path) : "파일 뷰어");
  }

  register() {
    if (!this.tab) return;
    const list = spaces(), own = keepLive(shared(OWN_KEY), list, v => v.tab);
    setShared(OWN_KEY, { ...own, [this.token]: { tab: this.tab, path: this.path, on: this.on } });
    if (this.path) setShared(OPEN_KEY, { ...keepLive(shared(OPEN_KEY), list, v => v), [openKey(this.on, this.path)]: this.tab });
  }

  syncName(name) {
    if (!this.tab) return;
    const info = tabInfo(spaces(), this.tab);
    if (!info) return;
    const current = info.name ?? "";
    const want = dirtyName(name ?? current, Boolean(this.buf?.dirty));
    if (want === current) return;
    try { run("tab.rename", { id: this.tab, name: want }); } catch {}
  }

  async readDraft() {
    if (this.on) return { draft: null, broken: false };
    const main = await readDraftFile(draftFile(this.path));
    return pickDraft(main, await readDraftFile(draftNewFile(this.path)));
  }

  // Draft writes and deletes run one at a time, deciding from the state when their turn comes.
  queueDraft(work) {
    this.draftIO = (this.draftIO ?? Promise.resolve()).then(work).catch(() => {});
    return this.draftIO;
  }

  // Removes both generations. A file that isn't there is fine.
  async removeDraft(path) {
    await unlink(draftNewFile(path)).catch(() => {});
    await unlink(draftFile(path)).catch(() => {});
  }

  // An unreadable draft is left where it is for the person to recover: no writes or deletes for this tab.
  dropDraft(path = this.path) {
    return this.queueDraft(async () => {
      if (this.draftBroken) return;
      await this.removeDraft(path);
      this.draftHeld = false;
    });
  }

  flushDraft() {
    return this.queueDraft(async () => {
      const buf = this.buf, path = this.path;
      if (!buf?.editable || this.draftBroken) return;
      try {
        // A clean buffer removes only a draft this viewer holds: another viewer of the file may own the one on disk.
        if (!buf.dirty) {
          if (this.draftHeld) { await this.removeDraft(path); this.draftHeld = false; }
          return;
        }
        await mkdir(draftsDir(), { recursive: true });
        const base = buf.conflict === "draft" ? buf.draftBase : textHash(buf.base ?? "");
        const body = JSON.stringify({ path, text: buf.state.value(), base });
        await writeFile(draftNewFile(path), body);
        await writeFile(draftFile(path), body);
        await unlink(draftNewFile(path)).catch(() => {});
        this.draftHeld = true;
      } catch (e) {
        if (!this.draftWarned) notify({ title: "초안을 보관하지 못했어요", body: String(e), level: "warning", timeout: 5000 });
        this.draftWarned = true;
      }
    });
  }

  scheduleDraft(cx) {
    const seq = ++this.draftSeq;
    cx.timer.after(DRAFT_MS, () => { if (seq === this.draftSeq) this.flushDraft(); });
  }

  makeBuffer(path, text, base) {
    const t = theme(), ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "txt";
    const { editable, reason } = editability({ remote: Boolean(this.on), text: typeof base === "string" ? base : text });
    const state = EditorState.new({ language: LANG[ext] ?? ext, readonly: !editable, value: editable ? text : previewText(text),
      font_family: settings().font_family, font_size: 13,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    const buf = { state, base, dirty: false, conflict: null, editable, reason, saving: false, view: viewKind(path, text) === "markdown" ? "preview" : "edit", rev: 0 };
    if (editable) state.on("change", (_e, cx) => {
      buf.rev++;
      const dirty = !sameText(state.value(), buf.base);
      if (dirty !== buf.dirty) { buf.dirty = dirty; this.syncName(); cx.notify(); }
      this.scheduleDraft(cx);
    });
    return buf;
  }

  load(cx) {
    const path = this.path;
    this.error = null; this.binary = false;
    if (viewKind(path, null) === "binary") { this.binary = true; return; }
    cx.spawn(async cx => {
      try {
        const disk = await readTextFile(path, { on: this.on });
        if (this.path !== path) return;
        if (viewKind(path, disk) === "binary") { this.binary = true; return; }
        const { draft, broken } = await this.readDraft();
        if (this.path !== path) return;
        this.draftBroken = broken;
        if (broken && !this.brokenWarned) {
          this.brokenWarned = true;
          notify({ title: "저장 안 한 초안을 읽지 못했어요", body: draftFile(path), level: "warning", timeout: 8000 });
        }
        if (disk === null && !draft) { this.error = GONE; this.watch(cx); return; }
        const start = restoreState(draft, path, disk);
        if (start.discard) this.dropDraft(path);
        this.buf?.state.release();
        const buf = this.makeBuffer(path, start.text, disk);
        buf.dirty = start.dirty;
        if (start.dirty) this.draftHeld = true; // the draft on disk is this viewer's to remove
        buf.conflict = start.conflict ? "draft" : null;
        if (start.conflict) buf.draftBase = draft.base;
        this.buf = buf;
        this.syncName();
        this.watch(cx);
      } catch (e) { if (this.path === path) this.error = `파일을 읽지 못했어요: ${e?.message ?? e}`; }
      finally { cx.notify(); }
    });
  }

  watch(cx) {
    if (this.on || this.watching === this.path) return;
    const path = this.path, dir = parentDir(path);
    this.watching = path;
    cx.spawn(async cx => {
      try {
        while (!this.closed && this.path === path) {
          const changed = await watchFolder(dir);
          if (this.closed || this.path !== path || !watchMatters(changed, path, dir)) continue;
          let redraw = await this.syncDisk();
          // The file came back after it was gone: load() starts over (watch() sees it is already running).
          if (this.error === GONE && !this.buf && await readTextFile(path).catch(() => null) !== null && this.path === path) {
            this.load(cx);
            redraw = true;
          }
          if (redraw) cx.notify();
        }
      } catch { if (this.watching === path) this.watching = null; }
    });
  }

  // After a folder change: a clean buffer follows the disk, a dirty one that diverged becomes a conflict.
  // Returns whether anything shown changed.
  async syncDisk() {
    const buf = this.buf;
    if (!buf || buf.saving || buf.conflict === "draft") return false;
    const snap = buf.base;
    const disk = await readTextFile(this.path).catch(() => undefined);
    if (disk === undefined || this.buf !== buf || buf.saving || buf.base !== snap || (disk !== null && disk.includes("\0"))) return false;
    switch (syncDecision({ base: buf.base, dirty: buf.dirty, value: buf.state.value() }, disk)) {
      case "none": { const had = buf.conflict !== null; buf.conflict = null; return had; }
      case "adopt": buf.base = disk; buf.dirty = false; buf.conflict = null; this.syncName(); this.dropDraft(); return true;
      case "reload": this.reload(disk); return true;
      case "conflict": { const had = buf.conflict === "disk"; buf.conflict = "disk"; return !had; }
      case "drop":
        buf.state.release(); this.buf = null; this.error = GONE;
        return true;
    }
    return false;
  }

  // Takes the disk text into a buffer with no edits to keep (recreated if it changes editability).
  reload(disk) {
    const buf = this.buf, next = editability({ remote: Boolean(this.on), text: disk });
    if (next.editable !== buf.editable || next.reason !== buf.reason) {
      buf.state.release();
      const fresh = this.makeBuffer(this.path, disk, disk);
      fresh.view = buf.view;
      this.buf = fresh;
    } else {
      buf.base = disk; buf.dirty = false; buf.conflict = null; buf.rev++;
      buf.state.set_value(previewText(disk));
    }
    this.syncName();
  }

  save(cx) {
    const buf = this.buf;
    if (!buf?.editable || buf.saving || buf.conflict) return;
    const path = this.path, value = restoreEol(buf.state.value(), buf.base), base = buf.base;
    buf.saving = true;
    cx.spawn(async cx => {
      try {
        await writeTextFile(path, value, base);
        buf.base = value; buf.conflict = null; buf.dirty = !sameText(buf.state.value(), value);
        this.draftSeq++; // a pending draft must not come back after the save
        if (buf.dirty) this.scheduleDraft(cx); // typed during the save: it still needs its draft
        else await this.dropDraft(path);
        this.syncName();
      } catch (e) {
        // writeTextFile rejects stale snapshots and real failures alike: the disk tells them apart.
        const disk = await readTextFile(path).catch(() => undefined);
        if (disk !== undefined && saveFailure(base, disk) === "conflict") buf.conflict = "disk";
        else notify({ title: "저장하지 못했어요", body: `${path}\n${e}`, level: "error", timeout: 5000 });
      } finally { buf.saving = false; cx.notify(); }
    });
  }

  // Conflict: keep my edits, using what's on disk now as the expected snapshot.
  overwrite(cx) {
    const buf = this.buf;
    if (!buf || buf.saving) return;
    cx.spawn(async cx => {
      try {
        const disk = await readTextFile(this.path);
        if (this.buf !== buf) return;
        buf.base = disk; buf.conflict = null;
        this.save(cx);
      } catch (e) { notify({ title: "저장하지 못했어요", body: `${this.path}\n${e}`, level: "error", timeout: 5000 }); }
      finally { cx.notify(); }
    });
  }

  // Draft conflict: go on with the draft, now against what's on disk.
  keepDraft(cx) {
    const buf = this.buf;
    if (!buf) return;
    cx.spawn(async cx => {
      try {
        const disk = await readTextFile(this.path);
        if (this.buf !== buf) return;
        buf.base = disk; buf.conflict = null;
        this.flushDraft();
      } catch (e) { notify({ title: "파일을 읽지 못했어요", body: `${this.path}\n${e}`, level: "error", timeout: 5000 }); }
      finally { cx.notify(); }
    });
  }

  // Conflict: throw my edits away and take the disk.
  loadDisk(cx) {
    const buf = this.buf;
    if (!buf) return;
    this.draftSeq++;
    cx.spawn(async cx => {
      try {
        const disk = await readTextFile(this.path, { on: this.on });
        if (this.buf !== buf) return;
        await this.dropDraft();
        if (disk === null) { buf.state.release(); this.buf = null; this.error = GONE; }
        else this.reload(disk);
      } catch (e) { notify({ title: "파일을 읽지 못했어요", body: `${this.path}\n${e}`, level: "error", timeout: 5000 }); }
      finally { cx.notify(); }
    });
  }

  openExternal() {
    openOverlay({ mod: "my-files-open", kind: "popup", width: 200, height: 136, props: { path: this.path, dir: false } });
  }

  // A new tab: a nano split needs a terminal pane to split, and this tab has none.
  openInNano() {
    try { run("terminal.open", { argv: ["nano", this.path], folder: parentDir(this.path), place: "tab" }); }
    catch (e) { notify({ title: "nano를 열지 못했어요", body: String(e), level: "error", timeout: 5000 }); }
  }

  ensureIndex(cx) {
    if (!this.query.trim() || !this.root || this.index?.building || this.index?.paths) return;
    const index = { paths: null, truncated: false, building: true, error: null }, windows = !this.on && window()?.platform === "windows";
    this.index = index;
    cx.spawn(async cx => {
      try {
        const c = indexCommand(this.root, windows);
        const r = await exec(c.command, c.args, { on: this.on });
        if (r.code !== 0) throw new Error((r.stderr || "").trim() || `exit ${r.code}`);
        Object.assign(index, indexLines(r.stdout, windows));
      } catch (e) { index.error = String(e?.message ?? e); }
      finally { index.building = false; cx.notify(); }
    });
  }

  results() {
    const q = this.query.trim(), paths = this.index?.paths;
    if (!q || !paths) return null;
    if (this.found?.q !== q || this.found.paths !== paths) this.found = { q, paths, value: searchPaths(paths, q, RESULT_LIMIT) };
    return this.found.value;
  }

  openResult(cx) {
    const r = this.results()?.results[this.at];
    if (r) this.pick(r.path, cx);
  }

  // A file chosen in the search. Already open elsewhere: go there and close this empty tab.
  pick(rel, cx) {
    const path = absolutePath(this.root, rel, { remote: Boolean(this.on), windows: !this.on && window()?.platform === "windows" });
    const commands = openCommands({ path, on: this.on, root: this.root, space: null }, shared(OPEN_KEY), spaces(), this.token);
    if (commands[0][0] !== "tab.new") {
      const me = this.tab;
      for (const [name, args] of commands) run(name, args);
      if (me) run("tab.close", { id: me });
      return;
    }
    this.path = path;
    this.register();
    this.syncName(baseName(path));
    this.load(cx);
  }

  async close() {
    this.closed = true;
    this.draftSeq++;
    await this.flushDraft();
  }

  resultRow(r, i, t, cx) {
    const { dir, name } = splitPath(r.path), start = r.path.length - name.length;
    const hits = r.hits.filter(h => h >= start).map(h => h - start);
    return h_flex().id(`found-${r.path}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7).cursor_pointer()
      .when(i === this.at, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { this.at = i; this.pick(r.path, cx); cx.notify(); })
      .child(svg("mods/my-files/file.svg").size(14).flex_none().text_color(t.muted))
      .child(h_flex().min_w(0).flex_shrink(1).overflow_hidden()
        .children(segments(name, hits).map(s => div().when(s.hit, el => el.text_color(t.accent).font_semibold()).child(s.text.replaceAll(" ", " ")))))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dir));
  }

  pickerView(t, cx) {
    const index = this.index, found = this.results(), q = this.query.trim();
    if (found && this.at >= found.results.length) this.at = Math.max(0, found.results.length - 1);
    return v_flex().flex_1().min_h(0)
      .child(h_flex().h(TOOLBAR_H).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .on_key_down((e, cx) => {
          if (e.key === "escape" && this.query) { this.query = ""; this.at = 0; this.search.set_value(""); cx.stop_propagation(); cx.notify(); return; }
          const n = this.results()?.results.length ?? 0;
          if (e.key === "down" && n) this.at = Math.min(this.at + 1, n - 1);
          else if (e.key === "up" && n) this.at = Math.max(this.at - 1, 0);
          else return;
          cx.stop_propagation();
          cx.notify();
        })
        .child(svg("mods/my-files/search.svg").size(14).flex_none().text_color(t.dim))
        .child(Input.new(this.search).flex_1().h_full().text_size(13).text_color(t.foreground))
        .when(Boolean(index?.building), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("목록 만드는 중…"))))
      .when(Boolean(index?.error), el => el.child(errorLine(t, "viewer-index-error", `파일 목록을 만들지 못했어요: ${index.error}`, { retry: cx => { this.index = null; this.ensureIndex(cx); } })))
      .child(v_flex().id("viewer-found").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .when(!this.root, el => el.child(note(t, "폴더가 없어요")))
        .when(Boolean(this.root) && !q, el => el.child(note(t, `${baseName(this.root)} 아래에서 파일 이름을 찾아요`)))
        .when(Boolean(index?.truncated), el => el.child(note(t, "파일이 너무 많아 처음 50,000개에서만 찾아요")))
        .children(found ? found.results.map((r, i) => this.resultRow(r, i, t, cx)) : [])
        .when(Boolean(found?.more), el => el.child(note(t, "더 있어요 · 검색어를 더 입력하세요")))
        .when(Boolean(found) && found.results.length === 0, el => el.child(note(t, `‘${q}’와 맞는 파일이 없어요`))));
  }

  render(cx) {
    const t = theme(), buf = this.buf, path = this.path;
    const bar = () => h_flex().h(34).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12);
    const root = v_flex().id("viewer").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13);
    if (!path) return root.child(this.pickerView(t, cx));
    const message = text => v_flex().flex_1().items_center().justify_center().gap(10).text_color(t.dim).child(div().child(text));
    return root
      .child(h_flex().h(HEADER_H).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(`${this.on ? `${this.on}:` : ""}${path}`))
        .when(Boolean(buf?.dirty), el => el.child(div().flex_none().text_size(11).text_color(t.accent).child("● 저장 안 됨")))
        .when(Boolean(buf) && viewKind(path, null) === "markdown", el => el
          .child(chip(t, "viewer-preview", "보기", buf.view === "preview", () => { buf.view = "preview"; }))
          .child(chip(t, "viewer-edit", "편집", buf.view === "edit", () => { buf.view = "edit"; }))))
      .when(Boolean(buf && !buf.editable), el => el.child(bar().text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(REASONS[buf.reason] ?? "읽기 전용"))
        .child(this.on
          ? button(t, "viewer-nano", "nano로 열기", () => this.openInNano())
          : button(t, "viewer-external-ro", "외부 프로그램으로 열기", () => this.openExternal()))))
      .when(buf?.conflict === "disk", el => el.child(bar()
        .child(div().flex_1().min_w(0).truncate().text_color(t.blocked).child("디스크의 파일이 바뀌었어요"))
        .child(button(t, "viewer-overwrite", "내 것으로 덮어쓰기", cx => this.overwrite(cx)))
        .child(button(t, "viewer-load", "디스크 버전 불러오기", cx => this.loadDisk(cx)))))
      .when(buf?.conflict === "draft", el => el.child(bar()
        .child(div().flex_1().min_w(0).truncate().text_color(t.blocked).child(buf.base === null ? "파일이 지워졌어요 · 저장 안 한 초안이 있어요" : "디스크의 파일이 바뀌었어요 · 저장 안 한 초안이 있어요"))
        .child(button(t, "viewer-keep", "초안 유지", cx => this.keepDraft(cx)))
        .child(button(t, "viewer-load-draft", buf.base === null ? "초안 버리기" : "디스크 버전 불러오기", cx => this.loadDisk(cx)))))
      .child(this.binary
        ? message(`${baseName(path)} · 여기서 표시할 수 없는 파일이에요`)
          .when(!this.on, el => el.child(button(t, "viewer-external", "외부 프로그램으로 열기", () => this.openExternal())))
        : this.error
          ? message(this.error).child(button(t, "viewer-retry", "다시 읽기", cx => this.load(cx)))
            .when(!this.on, el => el.child(button(t, "viewer-external", "외부 프로그램으로 열기", () => this.openExternal())))
            .when(Boolean(this.on), el => el.child(button(t, "viewer-nano-error", "nano로 열기", () => this.openInNano())))
          : !buf
            ? message("불러오는 중…")
            : buf.view === "preview"
              ? v_flex().id("viewer-md").flex_1().min_h(0).overflow_y_scrollbar().p(18)
                .child(buf.state.value().trim()
                  ? TextView.markdown(`viewer-md-${buf.rev}`, buf.state.value()).selectable(true)
                  : div().text_color(t.dim).child("빈 문서"))
              : v_flex().id("viewer-editor").flex_1().min_h(0)
                .on_key_down((e, cx) => { if (isSaveKey(e.keystroke)) { cx.stop_propagation(); this.save(cx); cx.notify(); } })
                .child(Editor.new(buf.state).flex_1().min_h(0)));
  }
}
