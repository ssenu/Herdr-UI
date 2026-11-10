// Herdr's Files panel, cloned as my-files. Adds two things:
//  - local text files are editable: Ctrl+S saves through writeTextFile's stale check, unsaved edits
//    survive switching files and spaces (in memory only), and disk changes reload clean buffers or
//    flag a conflict on dirty ones;
//  - dragging a row out of the panel opens mods/my-files-drag, which types the row's absolute path
//    into the focused terminal on release;
//  - a search box above the tree finds files by name (fuzzy) anywhere under the root (.git skipped);
// Remote and truncated files stay read-only, with a button to open them in nano beside.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, openOverlay, run, notify } from "herdr";
import { absolutePath, quoteForPrompt, editability, previewText, sameText, isSaveKey, restoreEol, syncDecision, saveFailure, REASONS, isMarkdown, searchPaths, splitPath, segments, indexCommand, indexLines, switchQuery } from "./logic.js";
import { followedCwd } from "./where.js";
import { panel, header, chip, button, iconButton, errorLine, note, TOOLBAR_H } from "./ui.js";

// A folder the panel shows instead of following the focused pane (the 바탕화면 button); null follows.
let pinned = null;
const lastCwd = new Map(); // space id → its last terminal folder

function location() {
  if (pinned) return { cwd: pinned, on: null, space: `pinned:${pinned}` };
  const space = spaces().find(s => s.active), f = focused();
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: followedCwd(lastCwd, space, f, panes()), on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const MAX_INDEXES = 4, RESULT_LIMIT = 200, REMOTE_INDEX_MS = 60000;
const GONE = "이 파일을 찾을 수 없어요";
const UNREADABLE = "미리 볼 수 없는 파일이에요 (바이너리이거나 너무 크거나 읽을 수 없어요)";

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Reparse points keep directory attributes even when dangling; check their target.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replaceAll("'", "''") + "'"]);
    if (r.code !== 0) throw new Error(r.stderr || "폴더를 읽지 못했어요");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "폴더를 읽지 못했어요");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map(); this.buffers = new Map();
    // File search: the query, the selected result, and per-folder indexes (context key → index).
    this.query = ""; this.at = 0; this.indexes = new Map(); this.found = null;
    this.queries = new Map(); this.querySpace = undefined; // each space keeps its own search
    this.search = InputState.new({ placeholder: "이 폴더에서 파일 찾기" });
    this.search.on("change", (_e, cx) => {
      if (this.search.value() === this.query) return; // syncQuery put it there
      this.query = this.search.value(); this.at = 0; this.ensureIndex(cx); cx.notify();
    });
    this.search.on("submit", (_e, cx) => { this.openResult(cx); cx.notify(); });
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    this.findDesktop(cx);
  }

  // The real Desktop folder (OneDrive or a localized name can move it), asked of Windows once.
  findDesktop(cx) {
    cx.spawn(async cx => {
      try {
        const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Environment]::GetFolderPath('Desktop')"]);
        const path = r.code === 0 ? r.stdout.trim() : "";
        if (path) { this.desktop = path; cx.notify(); }
      } catch {}
    });
  }

  // 바탕화면 button: show the Desktop; pressed again, follow the focused pane again.
  toggleDesktop(cx) {
    if (!this.desktop) return;
    pinned = pinned === this.desktop ? null : this.desktop;
    this.refresh(cx);
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try {
        while (this.context === context) {
          await watchFolder(root);
          const index = this.indexes.get(context.key);
          if (index) index.stale = true;
          if (this.current(context)) this.refresh(cx);
        }
      }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  // Absolute path as the terminal should see it.
  absolute(path) {
    return absolutePath(this.root, path, { remote: Boolean(this.on), windows: window()?.platform === "windows" });
  }

  // The pointer left the panel with a row held: a full-window layer takes over the drag and
  // pastes on release. ponytail: mods can't start a real OS drag; the overlay stands in for it.
  dropOut() {
    const drag = this.drag; this.drag = null;
    if (!drag) return;
    const panel = this.origin && this.size ? { ...this.origin, width: this.size.width, height: this.size.height } : null;
    openOverlay({ mod: "my-files-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { ...drag, panel } });
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) {
        this.dropClean(null);
        this.saved.set(this.context.key, { folders: this.folders, file: this.file, buffers: this.buffers });
      }
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.buffers = saved?.buffers ?? new Map();
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false; this.manual = false;
      const known = this.indexes.get(next);
      if (known && !on) known.stale = true;
      if (saved?.file) this.show(saved.file, cx);
      this.ensureIndex(cx);
    }
    if (!cwd) { this.manual = false; return; }
    if (this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        await this.syncBuffers(context);
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) { this.loading = false; this.manual = false; } cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // One open file: its editor, the disk text it was last read or saved as (base), and its state.
  makeBuffer(path, text) {
    const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
    const { editable, reason } = editability({ remote: Boolean(this.on), text });
    const state = EditorState.new({ language: LANG[ext] ?? ext, readonly: !editable, value: previewText(text),
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
    const buf = { state, base: text, dirty: false, conflict: false, editable, reason, saving: false, view: isMarkdown(path) ? "preview" : "edit", rev: 0 };
    if (editable) state.on("change", (_e, cx) => {
      buf.rev++;
      const dirty = !sameText(state.value(), buf.base);
      if (dirty !== buf.dirty) { buf.dirty = dirty; cx.notify(); }
    });
    return buf;
  }

  // Unsaved buffers stay; every other one except `keep` is released.
  dropClean(keep) {
    for (const [path, buf] of this.buffers) if (path !== keep && !buf.dirty) { buf.state.release(); this.buffers.delete(path); }
  }

  show(path, cx) {
    this.dropClean(path); this.file = path; this.fileError = null;
    if (!path || !cx || this.buffers.has(path)) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context) || this.buffers.has(path)) return;
        if (text === null) { this.fileError = GONE; return; }
        if (text.includes("\0")) { this.fileError = "바이너리 파일이라 미리 볼 수 없어요"; return; }
        this.buffers.set(path, this.makeBuffer(path, text));
      } catch { if (this.file === path && this.current(context)) this.fileError = UNREADABLE; }
      finally { cx.notify(); }
    });
  }

  // Takes the disk text into a buffer with no edits to keep (recreated if it changes editability).
  reload(path, buf, disk) {
    const next = editability({ remote: Boolean(this.on), text: disk });
    if (next.editable !== buf.editable || next.reason !== buf.reason) {
      buf.state.release();
      const fresh = this.makeBuffer(path, disk);
      fresh.view = buf.view;
      this.buffers.set(path, fresh);
      return;
    }
    buf.base = disk; buf.dirty = false; buf.conflict = false; buf.rev++;
    buf.state.set_value(previewText(disk));
  }

  // After a folder change: clean buffers follow the disk, dirty ones that diverged become conflicts.
  async syncBuffers(context) {
    const { cwd: root, on } = context;
    for (const [path, buf] of [...this.buffers]) {
      if (buf.saving) continue;
      const snap = buf.base;
      let disk;
      try { disk = await readTextFile(`${root}/${path}`, { on }); } catch { continue; }
      if (!this.current(context) || this.buffers.get(path) !== buf || buf.saving || buf.base !== snap) continue;
      if (disk !== null && disk.includes("\0")) continue;
      switch (syncDecision({ base: buf.base, dirty: buf.dirty, value: buf.state.value() }, disk)) {
        case "none": buf.conflict = false; break;
        case "adopt": buf.base = disk; buf.dirty = false; buf.conflict = false; break;
        case "reload": this.reload(path, buf, disk); break;
        case "conflict": buf.conflict = true; break;
        case "drop":
          buf.state.release(); this.buffers.delete(path);
          if (this.file === path) this.fileError = GONE;
          break;
      }
    }
  }

  save(path, cx) {
    const buf = path ? this.buffers.get(path) : null;
    if (!buf?.editable || buf.saving) return;
    const file = `${this.root}/${path}`, value = restoreEol(buf.state.value(), buf.base), base = buf.base;
    buf.saving = true;
    cx.spawn(async cx => {
      try {
        await writeTextFile(file, value, base);
        buf.base = value; buf.conflict = false; buf.dirty = !sameText(buf.state.value(), value);
      } catch (e) {
        // writeTextFile rejects stale snapshots and real failures alike: the disk tells them apart.
        const disk = await readTextFile(file).catch(() => undefined);
        if (disk !== undefined && saveFailure(base, disk) === "conflict") buf.conflict = true;
        else notify({ title: "저장하지 못했어요", body: `${path}\n${e}`, level: "error", timeout: 5000 });
      } finally { buf.saving = false; cx.notify(); }
    });
  }

  // Conflict: keep my edits, using what's on disk now as the expected snapshot.
  overwrite(path, cx) {
    const buf = this.buffers.get(path);
    if (!buf || buf.saving) return;
    const root = this.root, file = `${root}/${path}`;
    cx.spawn(async cx => {
      try {
        const disk = await readTextFile(file);
        if (this.buffers.get(path) !== buf || this.root !== root) return;
        buf.base = disk;
        buf.conflict = false;
        this.save(path, cx);
      } catch (e) { notify({ title: "저장하지 못했어요", body: `${path}\n${e}`, level: "error", timeout: 5000 }); }
      finally { cx.notify(); }
    });
  }

  // Conflict: throw my edits away and take the disk.
  loadDisk(path, cx) {
    const buf = this.buffers.get(path);
    if (!buf) return;
    const file = `${this.root}/${path}`, on = this.on;
    cx.spawn(async cx => {
      try {
        const disk = await readTextFile(file, { on });
        if (this.buffers.get(path) !== buf) return;
        if (disk === null) {
          buf.state.release(); this.buffers.delete(path);
          if (this.file === path) this.fileError = GONE;
        } else this.reload(path, buf, disk);
      } catch (e) { notify({ title: "파일을 읽지 못했어요", body: `${path}\n${e}`, level: "error", timeout: 5000 }); }
      finally { cx.notify(); }
    });
  }

  // A split to the right of the focused pane, on the space's machine, running nano on the file.
  openInNano(path) {
    const folder = this.absolute(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    try { run("terminal.open", { argv: ["nano", this.absolute(path)], folder, place: "right" }); }
    catch (e) { notify({ title: "nano를 열지 못했어요", body: String(e), level: "error", timeout: 5000 }); }
  }

  // The active space changed: its own search comes back. The input is set after this render.
  syncQuery(cx) {
    const space = spaces().find(s => s.active)?.id ?? null;
    if (space === this.querySpace) return;
    const next = switchQuery(this.queries, this.querySpace, space, this.query);
    this.querySpace = space;
    if (next === this.query) return;
    this.query = next; this.at = 0;
    cx.timer.after(0, cx => { if (this.search.value() !== this.query) this.search.set_value(this.query); this.ensureIndex(cx); cx.notify(); });
  }

  // Builds (or rebuilds, when stale) the file list the search filters. Old results stay meanwhile.
  ensureIndex(cx) {
    const context = this.context;
    if (!this.query.trim() || !context?.cwd) return;
    const old = this.indexes.get(context.key);
    if (old) { this.indexes.delete(context.key); this.indexes.set(context.key, old); }
    const outdated = !old || old.stale || Boolean(old.error) || (Boolean(context.on) && Date.now() - old.builtAt > REMOTE_INDEX_MS);
    if (old?.building || !outdated) return;
    const index = { paths: old?.paths ?? null, truncated: old?.truncated ?? false, builtAt: 0, stale: false, building: true, error: null };
    this.indexes.delete(context.key);
    this.indexes.set(context.key, index);
    for (const k of [...this.indexes.keys()]) {
      if (this.indexes.size <= MAX_INDEXES) break;
      if (k !== this.context?.key && k !== context.key) this.indexes.delete(k);
    }
    const windows = !context.on && window()?.platform === "windows";
    cx.spawn(async cx => {
      try {
        const c = indexCommand(context.cwd, windows);
        const r = await exec(c.command, c.args, { on: context.on });
        if (r.code !== 0) throw new Error((r.stderr || "").trim() || `exit ${r.code}`);
        const { paths, truncated } = indexLines(r.stdout, windows);
        index.paths = paths; index.truncated = truncated;
      } catch (e) {
        index.error = String(e?.message ?? e);
      } finally {
        index.building = false; index.builtAt = Date.now();
        cx.notify();
      }
    });
  }

  index() {
    if (!this.context) return null;
    const index = this.indexes.get(this.context.key);
    if (!index) return null;
    this.indexes.delete(this.context.key); this.indexes.set(this.context.key, index);
    return index;
  }

  // Search results for the current query, cached per (query, index paths).
  results() {
    const q = this.query.trim(), paths = this.index()?.paths;
    if (!q || !paths) return null;
    if (this.found?.q !== q || this.found.paths !== paths) this.found = { q, paths, value: searchPaths(paths, q, RESULT_LIMIT) };
    return this.found.value;
  }

  openResult(cx) {
    const r = this.results()?.results[this.at];
    if (r) this.show(r.path, cx);
  }

  clearSearch() {
    this.search.set_value("");
    this.query = ""; this.at = 0;
  }

  // Open with…: stops the press and click so the row neither drags, opens nor toggles.
  openButton(path, dir, t) {
    return iconButton(t, `open-${path}`, "⋯", () => {
      openOverlay({ mod: "my-files-open", kind: "popup", width: 200, height: 136, props: { path: this.absolute(path), dir } });
    }, { stop: true });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      const dirty = !entry.dir && this.buffers.get(path)?.dirty;
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", () => { this.drag = { text: quoteForPrompt(this.absolute(path)), path: this.absolute(path), on: this.on, name: entry.name, dir: entry.dir }; })
        .on_click((_e, cx) => { if (entry.dir) this.toggle(path, cx); else { this.show(path, cx); cx.notify(); } })
        .child(entry.dir ? svg(`mods/my-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/my-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(dirty), el => el.child(div().text_size(11).text_color(t.accent).child("●")))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)))
        .when(!this.on, el => el.child(this.openButton(path, entry.dir, t))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  resultRow(r, i, t) {
    const path = r.path, { dir, name } = splitPath(path), start = path.length - name.length;
    const mark = this.marks[`${this.root}/${path}`], dirty = this.buffers.get(path)?.dirty;
    const nameHits = r.hits.filter(h => h >= start).map(h => h - start);
    return h_flex().id(`found-${path}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7).cursor_pointer()
      .when(i === this.at, el => el.bg(t.selected))
      .hover(s => s.bg(t.hover))
      .on_mouse_down("left", () => { this.drag = { text: quoteForPrompt(this.absolute(path)), path: this.absolute(path), on: this.on, name, dir: false }; })
      .on_click((_e, cx) => { this.at = i; this.show(path, cx); cx.notify(); })
      .child(svg("mods/my-files/file.svg").size(14).flex_none().text_color(t.muted))
      .child(h_flex().min_w(0).flex_shrink(1).overflow_hidden()
        .children(segments(name, nameHits).map(s => div().when(s.hit, el => el.text_color(t.accent).font_semibold()).child(s.text.replaceAll(" ", " ")))))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(dir))
      .when(Boolean(dirty), el => el.child(div().text_size(11).text_color(t.accent).child("●")))
      .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)))
      .when(!this.on, el => el.child(this.openButton(path, false, t)));
  }

  searchBar(t) {
    const index = this.index();
    return h_flex().h(TOOLBAR_H).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
      .on_key_down((e, cx) => {
        const n = this.results()?.results.length ?? 0;
        if (e.key === "down" && n) this.at = Math.min(this.at + 1, n - 1);
        else if (e.key === "up" && n) this.at = Math.max(this.at - 1, 0);
        else if (e.key === "escape" && this.query) this.clearSearch();
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(svg("mods/my-files/search.svg").size(14).flex_none().text_color(t.dim))
      .child(Input.new(this.search).flex_1().h_full().text_size(13).text_color(t.foreground))
      .when(Boolean(index?.building), el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("목록 만드는 중…")));
  }

  foundView(t) {
    const index = this.index(), found = this.results(), q = this.query.trim();
    if (found && this.at >= found.results.length) this.at = Math.max(0, found.results.length - 1);
    return v_flex().id("files-found-wrap").flex_1().min_h(0)
      .when(Boolean(index?.error), el => el.child(errorLine(t, "files-index-error", `파일 목록을 만들지 못했어요: ${index.error}`, { retry: cx => this.ensureIndex(cx) })))
      .child(v_flex().id("files-found").flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .when(Boolean(index?.truncated), el => el.child(note(t, "파일이 너무 많아 처음 50,000개에서만 찾아요")))
      .children(found ? found.results.map((r, i) => this.resultRow(r, i, t)) : [])
      .when(Boolean(found?.more), el => el.child(note(t, "더 있어요 · 검색어를 더 입력하세요")))
      .when(Boolean(found) && found.results.length === 0, el => el.child(note(t, `‘${q}’와 맞는 파일이 없어요`)))
      .when(!found && !index?.error && !this.context?.cwd, el => el.child(note(t, "폴더가 없어요")))
      .when(!found && !index?.error && Boolean(this.context?.cwd) && Boolean(index?.building), el => el.child(note(t, "목록 만드는 중…"))));
  }

  render(cx) {
    this.syncQuery(cx);
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), file = this.file, buf = file ? this.buffers.get(file) : null;
    const nano = Boolean(file) && (Boolean(buf && !buf.editable) || this.fileError === UNREADABLE);
    const bar = () => h_flex().h(34).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12);
    return panel(t, "files")
      .on_mouse_up("left", () => { this.drag = null; })
      // Window-relative panel box (pointer minus its in-panel offset): a drop back on it cancels.
      .on_mouse_move(e => { if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; })
      .on_size_change(size => { this.size = size; })
      .on_hover(hovered => { if (!hovered) this.dropOut(); })
      .child(header(t, {
        id: "files", title: "Files",
        back: file ? cx => { this.show(null); if (this.query.trim()) this.search.focus(); } : null,
        status: file ? (buf?.dirty ? `● ${file}` : file) : this.root?.split(/[\\/]/).pop() ?? "",
        right: !file && this.desktop ? [chip(t, "files-desktop", "바탕화면", pinned === this.desktop, cx => this.toggleDesktop(cx), { toggle: true })] : [],
        refresh: cx => { this.manual = true; this.refresh(cx); }, loading: this.manual && this.loading,
      }))
      .when(nano, el => el.child(bar().text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(buf?.reason ? REASONS[buf.reason] : "미리보기 불가"))
        .child(button(t, "files-nano", "nano로 열기", () => this.openInNano(file)))))
      .when(Boolean(buf?.conflict), el => el.child(bar()
        .child(div().flex_1().min_w(0).truncate().text_color(t.blocked).child("디스크의 파일이 바뀌었어요"))
        .child(button(t, "files-overwrite", "내 것으로 덮어쓰기", cx => this.overwrite(file, cx)))
        .child(button(t, "files-load", "디스크 버전 불러오기", cx => this.loadDisk(file, cx)))))
      .when(Boolean(buf) && isMarkdown(file), el => el.child(bar()
        .child(div().flex_1())
        .child(chip(t, "files-view-preview", "보기", buf.view === "preview", () => { buf.view = "preview"; }))
        .child(chip(t, "files-view-edit", "편집", buf.view === "edit", () => { buf.view = "edit"; }))))
      .when(!file, el => el.child(this.searchBar(t)))
      .when(!file && Boolean(this.error), el => el.child(errorLine(t, "files-error", this.error, { retry: cx => this.refresh(cx), close: this.entries.get("")?.length ? () => { this.error = null; } : null })))
      .when(!file && Boolean(this.query.trim()), el => el.child(this.foundView(t)))
      .when(!file && !this.query.trim(), el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(!this.error && !this.entries.get("")?.length, el => el.child(note(t, this.loading ? "파일을 불러오는 중…" : this.root ? "파일이 없어요" : "폴더가 없어요")))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("목록은 폴더당 500개, 전체 5,000개까지만 보여요")))))
      .when(Boolean(file) && Boolean(this.fileError), el => el.child(errorLine(t, "files-file-error", this.fileError, { retry: cx => this.show(file, cx) })))
      .when(Boolean(file), el => el.child(!buf
        ? (this.fileError ? div() : note(t, "파일을 여는 중…"))
        : buf.view === "preview"
          ? v_flex().id("files-preview").flex_1().min_h(0).overflow_y_scrollbar().p(14)
            .child(buf.state.value().trim()
              ? TextView.markdown(`files-md-${buf.rev}`, buf.state.value()).selectable(true)
              : div().text_color(t.dim).child("빈 문서"))
          : v_flex().id("files-editor").flex_1().min_h(0)
            .on_key_down((e, cx) => { if (isSaveKey(e.keystroke)) { cx.stop_propagation(); this.save(file, cx); cx.notify(); } })
            .child(Editor.new(buf.state).flex_1().min_h(0))));
  }
}
