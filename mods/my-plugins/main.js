// Plugins panel: the MCP servers and skills Claude Code or Codex sees from the focused pane's folder.
// Read only. Local or remote (the pane's machine), like the Files and GitHub panels.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { panel as panelRoot, header, toolbar, chip, iconButton, errorLine, note } from "./ui.js";
import { spaces, panes, focused, agents, exec, readTextFile, theme, layout, openOverlay, window } from "herdr";
import {
  join, nativePath, samePath, ancestors, listingCommand, listingLines, frontmatter, agentKind, dragText,
  sortItems, groupBySource, emptyText, servers, claudeMcp, pluginRoots, codexMcp, serverSummary, configLines, mapLimit,
} from "./logic.js";

import { followedCwd } from "./where.js";

const lastCwd = new Map(); // space id → its last terminal folder
function location() {
  const space = spaces().find(s => s.active), f = focused();
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: followedCwd(lastCwd, space, f, panes()), on };
}
const bare = a => (typeof a === "string" ? a.slice(a.lastIndexOf("/") + 1) : a);
const sameAddress = (a, b) => a === b || (!a?.includes("/") !== !b?.includes("/") && bare(a) === bare(b));
const base = p => String(p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(p ?? "");
function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The focused terminal and the name of the agent running in it (null when none).
function focusedAgent() {
  const f = focused(), address = f?.shown ?? f?.terminal ?? null;
  if (!address) return { address: null, name: null };
  const agent = agents().find(a => sameAddress(a.address, address));
  if (agent) return { address, name: [agent.program?.name, agent.program?.agent, agent.name].filter(x => typeof x === "string").join(" ") };
  const pane = f.pane ? panes().find(p => p.pane === f.pane) : null;
  const program = pane?.program;
  return { address, name: program?.agent ? [program.name, program.agent].filter(x => typeof x === "string").join(" ") : null };
}

// Everything the panel shows for one place and agent. Throws when the machine can't be reached.
async function collect({ cwd, on }, agent) {
  const windows = !on && window()?.platform === "windows";
  const list = async dirs => {
    const c = listingCommand(dirs, windows);
    const r = await exec(c.command, c.args, { on });
    if (r.code !== 0) throw new Error((r.stderr || "").trim() || "목록을 읽지 못했어요");
    return listingLines(r.stdout);
  };
  const { home } = await list([]);
  if (!home) throw new Error("홈 폴더를 찾지 못했어요");
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
  const repo = top?.code === 0 && top.stdout.trim() ? top.stdout.trim() : cwd;

  // A missing or unreadable file counts as empty.
  const read = path => readTextFile(path, { on }).then(text => text, () => null);
  const problems = [], mcp = [], skillDirs = [], seen = new Set();
  const json = async (file, tab) => {
    const text = await read(file);
    if (text === null) return null;
    try { return JSON.parse(text); } catch { problems.push({ tab, file }); return null; }
  };
  // Same folder twice (e.g. cwd is the home folder): keep the first, which is 전역.
  const addDir = (dir, source, plugin = null) => {
    const k = dir.replaceAll("\\", "/").toLowerCase();
    if (!seen.has(k)) { seen.add(k); skillDirs.push({ dir, source, plugin }); }
  };

  if (agent === "claude") {
    const userFile = join(home, ".claude.json"), projectFile = join(repo, ".mcp.json");
    const pluginsFile = join(home, ".claude", "plugins", "installed_plugins.json");
    const [user, project, plugins] = await Promise.all([json(userFile, "mcp"), json(projectFile, "mcp"), json(pluginsFile, "skills")]);
    if (user) {
      const { global, local } = claudeMcp(user, cwd, repo);
      for (const s of global) mcp.push({ ...s, kind: "mcp", source: "전역", file: userFile });
      for (const s of local) mcp.push({ ...s, kind: "mcp", source: "로컬", file: userFile });
    }
    if (project) {
      for (const s of servers(project.mcpServers)) mcp.push({ ...s, kind: "mcp", source: "프로젝트", file: projectFile });
    }
    addDir(join(home, ".claude", "skills"), "전역");
    addDir(join(repo, ".claude", "skills"), "프로젝트");
    for (const p of pluginRoots(plugins, repo)) addDir(join(p.path, "skills"), `플러그인:${p.plugin}`, p.plugin);
  } else {
    const userFile = join(home, ".codex", "config.toml"), projectFile = join(repo, ".codex", "config.toml");
    const files = [[userFile, "전역"], ...(samePath(projectFile, userFile) ? [] : [[projectFile, "프로젝트"]])];
    const texts = await Promise.all(files.map(([file]) => read(file)));
    files.forEach(([file, source], i) => {
      if (texts[i] !== null) for (const s of codexMcp(texts[i])) mcp.push({ ...s, kind: "mcp", source, file });
    });
    addDir(join(home, ".agents", "skills"), "전역");
    for (const d of ancestors(cwd, repo)) addDir(join(d, ".agents", "skills"), "프로젝트");
  }

  const found = await list(skillDirs.map(d => d.dir));
  const skillRefs = skillDirs.flatMap(d => (found.dirs.get(d.dir) ?? []).map(name => ({ d, name })));
  const skills = await mapLimit(skillRefs, 6, async ({ d, name }) => {
    const file = join(d.dir, name, "SKILL.md"), text = await read(file);
    const common = { kind: "skill", source: d.source, plugin: d.plugin, file };
    if (text === null) return { ...common, name, description: "읽지 못했어요", body: "", error: true };
    const fm = frontmatter(text, name);
    return { ...common, name: fm.name, description: fm.description, body: fm.body };
  });
  return { mcp: sortItems(mcp), skills: sortItems(skills), problems };
}

export default class Plugins extends View {
  init(_props, cx) {
    this.tab = "mcp"; this.pick = null; // pick: { address, agent } chosen with the chips
    this.data = null; this.error = null; this.loading = false; this.again = false;
    this.detail = null; this.context = null; this.wasShown = this.visible();
    if (this.visible()) this.refresh(cx);
  }

  // Whether the panel is open on this tab; true when the layout has no such panel.
  visible() {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !body) return true;
    return !panel.hidden && body.active === "plugins";
  }

  // The chips' choice while the same terminal stays focused; otherwise what that terminal runs.
  agent() {
    const f = focusedAgent();
    if (this.pick && this.pick.address === f.address) return this.pick.agent;
    if (this.pick) this.pick = null;
    return agentKind(f.name);
  }

  key() {
    const loc = location();
    return JSON.stringify({ cwd: loc.cwd ?? null, on: loc.on ?? null, agent: this.agent() });
  }

  refresh(cx) {
    const next = this.key();
    if (next !== this.context?.key) {
      const loc = location();
      this.context = { key: next, cwd: loc.cwd, on: loc.on, agent: this.agent() };
      this.data = null; this.error = null; this.detail = null; this.loading = false; this.again = false;
    }
    if (!this.context.cwd) return;
    if (this.loading) { this.again = true; return; }
    const context = this.context;
    this.loading = true;
    cx.spawn(async cx => {
      try {
        const data = await collect(context, context.agent);
        if (this.context === context) { this.data = data; this.error = null; }
      } catch (e) {
        if (this.context === context) this.error = String(e?.message ?? e);
      } finally {
        if (this.context === context) {
          this.loading = false;
          if (this.again) { this.again = false; this.refresh(cx); }
        }
        cx.notify();
      }
    });
  }

  choose(agent, cx) {
    this.pick = { address: focusedAgent().address, agent };
    this.refresh(cx);
  }

  // The pointer left the panel with a row held: my-files-drag takes over and types the row on release.
  dropOut() {
    const drag = this.drag; this.drag = null;
    if (!drag) return;
    const panel = this.origin && this.size ? { ...this.origin, width: this.size.width, height: this.size.height } : null;
    openOverlay({ mod: "my-files-drag", kind: "window", frame: "none", width: 1, height: 1, at: { x: 0, y: 0 }, props: { ...drag, panel } });
  }

  row(item, t, badge) {
    const off = item.kind === "mcp" && item.enabled === false;
    const failed = item.kind === "mcp" && Boolean(item.error);
    const sub = item.kind === "mcp" ? serverSummary(item.config) : (item.description.split("\n")[0] ?? "");
    const id = `${item.kind}-${item.source}-${item.name}-${item.file}`;
    return h_flex().id(`pl-${id}`).flex_none().px(8).py(6).gap(6).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
      .on_mouse_down("left", () => { this.drag = { text: dragText(item, this.context.agent), name: item.name, icon: "🧩" }; })
      .on_click((_e, cx) => { this.detail = item; cx.notify(); })
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().flex_1().min_w(0).truncate().text_color(off ? t.dim : t.foreground).child(item.name))
          .when(off, el => el.child(badge("꺼짐", t.dim)))
          .when(failed, el => el.child(badge("읽지 못함", t.ansi1))))
        .when(Boolean(sub), el => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(sub))))
      .when(!this.context.on, el => el.child(iconButton(t, `pl-open-${id}`, "⋯", () => {
        const windows = window()?.platform === "windows";
        openOverlay({ mod: "my-files-open", kind: "popup", width: 200, height: 136, props: { path: nativePath(item.file, windows), dir: false } });
      }, { stop: true })));
  }

  listView(t, badge) {
    const c = this.context, agent = c?.agent ?? this.agent();
    const items = this.data ? (this.tab === "mcp" ? this.data.mcp : this.data.skills) : [];
    const problems = (this.data?.problems ?? []).filter(p => p.tab === this.tab);
    const message = !c?.cwd ? "폴더가 없어요" : !this.data ? "불러오는 중…" : emptyText(this.tab);
    const showError = Boolean(c?.cwd && this.error);
    const where = c?.cwd ? (c.on ? `${c.on}:${base(c.cwd)}` : base(c.cwd)) : "";
    return [
      header(t, { id: "plugins", title: "Plugins", loading: this.loading, refresh: cx => this.refresh(cx),
        right: [chip(t, "pl-agent-claude", "Claude", agent === "claude", cx => this.choose("claude", cx)),
          chip(t, "pl-agent-codex", "Codex", agent === "codex", cx => this.choose("codex", cx))] }),
      toolbar(t)
        .child(chip(t, "pl-tab-mcp", "MCP", this.tab === "mcp", () => { this.tab = "mcp"; }))
        .child(chip(t, "pl-tab-skills", "Skills", this.tab === "skills", () => { this.tab = "skills"; }))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(where)),
      ...(showError ? [errorLine(t, "plugins-error", this.error, { retry: cx => this.refresh(cx) })] : []),
      v_flex().id("plugins-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .children(problems.map(p => div().px(8).py(4).text_size(12).text_color(t.ansi1).child(`⚠ ${base(p.file)}을 읽지 못했어요`)))
        .children(groupBySource(items).flatMap(g => [
          div().px(8).pt(8).pb(2).text_size(11).text_color(t.muted).child(g.source),
          ...g.items.map(item => this.row(item, t, badge)),
        ]))
        .when(items.length === 0 && !showError, el => el.child(note(t, message))),
    ];
  }

  detailView(t, badge) {
    const d = this.detail;
    const content = v_flex().id("plugins-detail").flex_1().min_h(0).overflow_y_scrollbar().p(14).gap(8)
      .child(div().text_size(12).text_color(t.dim).child(`${d.source} · ${d.file}`));
    const body = d.kind === "skill"
      ? content
        .when(Boolean(d.description), el => el.child(div().text_size(12).text_color(t.muted).child(d.description)))
        .child(d.body.trim() ? TextView.markdown(`pl-md-${d.file}`, d.body).selectable(true) : div().text_color(t.dim).child("본문 없음"))
      : content
        .when(d.enabled === false, el => el.child(h_flex().child(badge("꺼짐", t.dim))))
        .when(Boolean(d.error), el => el.child(div().text_size(12).text_color(t.ansi1).child(`읽지 못함: ${d.error}`)))
        .children(configLines(d.config).map(line => div().pl(line.depth * 14).text_size(12).child(line.text)));
    return [
      header(t, { id: "plugins", title: d.name, back: () => { this.detail = null; } }),
      body,
    ];
  }

  render(cx) {
    const shown = this.visible();
    if (shown && (!this.wasShown || this.key() !== this.context?.key)) this.refresh(cx);
    this.wasShown = shown;
    const t = theme();
    const badge = (label, color) => div().flex_none().px(5).rounded(4).border_1().border_color(t.border).text_size(11).text_color(color).child(label);
    return panelRoot(t, "plugins")
      .on_mouse_up("left", () => { this.drag = null; })
      // Window-relative panel box (pointer minus its in-panel offset): a drop back on it cancels.
      .on_mouse_move(e => { if (e.local_position) this.origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y }; })
      .on_size_change(size => { this.size = size; })
      .on_hover(hovered => { if (!hovered) this.dropOut(); })
      .children(this.detail ? this.detailView(t, badge) : this.listView(t, badge));
  }
}
