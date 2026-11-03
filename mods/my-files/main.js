// Herdr's Files panel, cloned as my-files. Adds two things:
//  - local text files are editable: Ctrl+S saves through writeTextFile's stale check, unsaved edits
//    survive switching files and spaces (in memory only), and disk changes reload clean buffers or
//    flag a conflict on dirty ones;
//  - dragging a row out of the panel opens mods/my-files-drag, which types the row's absolute path
//    into the focused terminal on release.
// Remote and truncated files stay read-only, with a button to open them in nano beside.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, openOverlay, run, notify } from "herdr";
import { absolutePath, quoteForPrompt, editability, previewText, sameText, isSaveKey, restoreEol, syncDecision, saveFailure, REASONS, isMarkdown } from "./logic.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;
const GONE = "This file is no longer available";
const UNREADABLE = "Cannot preview this file (binary, too large, or unreadable)";

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Reparse points keep directory attributes even when dangling; check their target.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replaceAll("'", "''") + "'"]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map(); this.buffers = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
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
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
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
      finally { if (this.context === context) this.loading = false; cx.notify(); }
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
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
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

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      const dirty = !entry.dir && this.buffers.get(path)?.dirty;
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", () => { this.drag = { text: quoteForPrompt(this.absolute(path)), name: entry.name, dir: entry.dir }; })
        .on_click((_e, cx) => { if (entry.dir) this.toggle(path, cx); else { this.show(path, cx); cx.notify(); } })
        .child(entry.dir ? svg(`mods/my-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/my-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(dirty), el => el.child(div().text_size(11).text_color(t.accent).child("●")))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), file = this.file, buf = file ? this.buffers.get(file) : null;
    const button = (id, label, onClick) => h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).cursor_pointer()
      .text_size(12).text_color(t.foreground).border_1().border_color(t.border).hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const nano = Boolean(file) && (Boolean(buf && !buf.editable) || this.fileError === UNREADABLE);
    const bar = () => h_flex().h(34).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12);
    const chip = (id, label, on, onClick) => h_flex().id(id).h(24).px(9).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_mouse_up("left", () => { this.drag = null; })
      // Window-relative panel box (pointer minus its in-panel offset): a drop back on it cancels.
      .on_mouse_move(e => { if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; })
      .on_size_change(size => { this.size = size; })
      .on_hover(hovered => { if (!hovered) this.dropOut(); })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
          .child(file ? (buf?.dirty ? `● ${file}` : file) : this.root?.split(/[\\/]/).pop() ?? "")))
      .when(nano, el => el.child(bar().text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(buf?.reason ? REASONS[buf.reason] : "미리보기 불가"))
        .child(button("files-nano", "nano로 열기", () => this.openInNano(file)))))
      .when(Boolean(buf?.conflict), el => el.child(bar()
        .child(div().flex_1().min_w(0).truncate().text_color(t.blocked).child("디스크의 파일이 바뀌었어요"))
        .child(button("files-overwrite", "내 것으로 덮어쓰기", cx => this.overwrite(file, cx)))
        .child(button("files-load", "디스크 버전 불러오기", cx => this.loadDisk(file, cx)))))
      .when(Boolean(buf) && isMarkdown(file), el => el.child(bar()
        .child(div().flex_1())
        .child(chip("files-view-preview", "보기", buf.view === "preview", () => { buf.view = "preview"; }))
        .child(chip("files-view-edit", "편집", buf.view === "edit", () => { buf.view = "edit"; }))))
      .when(!file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(file), el => el.child(!buf
        ? div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")
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
