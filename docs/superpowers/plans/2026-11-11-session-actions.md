# Sessions 이름 수정·삭제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each row of the Sessions panel gets a `⋯` with 이름 수정 (append a `custom-title` record, like `/rename`) and 삭제 (Recycle Bin locally, `rm` remotely; refused for open sessions).

**Architecture:** `logic.js` builds the commands (PowerShell locally on Windows, `sh` otherwise) as pure functions, sharing the "is this session open" script piece with `sessionsCommand`. `main.js` shows the menu / rename field / confirm under the row and runs the command with Herdr `exec`.

**Tech Stack:** Herdr mod API, PowerShell 5.1+, POSIX sh, `node --test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-11-session-actions-design.md`.
- Storage folder names must match `^[A-Za-z0-9-]+$`; ids must be UUIDs (existing `UUID` regex). Anything else is refused before a command is built.
- Exit codes: 2 = session file missing, 3 = session is open (nothing deleted).
- Korean copy exactly as written in this plan.
- `sessionsCommand`'s generated strings must stay byte-for-byte identical after the refactor.
- Tests: Git Bash `node --test tests/*.test.mjs`.

---

### Task 1: Commands in `logic.js`

**Files:**
- Modify: `mods/my-sessions/logic.js`
- Test: `tests/my-sessions-logic.test.mjs`

**Interfaces:**
- Produces (exported): `renameCommand(dir, id, title, windows) → {command, args}`, `deleteCommand(dir, id, windows) → {command, args}`, `actionError(code, stderr) → string`, `deleteConfirmText(title, remote) → string`. `toSessions` items gain `dir`.

- [ ] **Step 1: Snapshot `sessionsCommand` before refactoring**

Run (Git Bash) and keep the output file:

```bash
node -e 'import("./mods/my-sessions/logic.js").then(L => console.log(JSON.stringify([L.sessionsCommand(["C--r-app","-x"], true), L.sessionsCommand(["C--r-app","-x"], false)])))' > /tmp/sessions-before.json
```

- [ ] **Step 2: Write the failing tests**

In `tests/my-sessions-logic.test.mjs`:

1. Change the import line `import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";` to `import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";`.
2. In the test "toSessions: title order, start folder, UUID ids only", change the expected object to `{ id: U1, title: "내 이름", mtime: 5, branch: "main", folder: "/r/app", dir: "-r-app" }` and add at the end of that test:

```js
  assert.deepEqual(L.toSessions([{ ...base, dir: "../x", customTitle: "", aiTitle: "" }]), []);
  assert.deepEqual(L.toSessions([{ ...base, dir: "a/b", customTitle: "", aiTitle: "" }]), []);
```

3. Append:

```js
const U3 = "33333333-3333-4333-8333-333333333333";

test("renameCommand: checked inputs, the record line, both shells", () => {
  const sh = L.renameCommand("-r-app", U1, "  새   이름 ", false);
  assert.equal(sh.command, "sh");
  assert.equal(sh.args[0], "-c");
  assert.deepEqual(sh.args.slice(2), ["rename", "-r-app", U1, JSON.stringify({ type: "custom-title", customTitle: "새 이름", sessionId: U1 })]);
  const ps = L.renameCommand("C--r-app", U1, "it's 이름", true);
  assert.equal(ps.command, "powershell");
  assert.deepEqual(ps.args.slice(0, 2), ["-NoProfile", "-Command"]);
  assert.ok(ps.args[2].includes(L.psQuote("C--r-app")));
  assert.ok(ps.args[2].includes(L.psQuote(JSON.stringify({ type: "custom-title", customTitle: "it's 이름", sessionId: U1 }))));
  assert.throws(() => L.renameCommand("../x", U1, "a", false), /세션을 가리키지 못했어요/);
  assert.throws(() => L.renameCommand("a/b", U1, "a", true), /세션을 가리키지 못했어요/);
  assert.throws(() => L.renameCommand("-r-app", "nope", "a", false), /세션을 가리키지 못했어요/);
  assert.throws(() => L.renameCommand("-r-app", U1, " \n ", false), /이름이 비어 있어요/);
});

test("deleteCommand: checked inputs, both shells", () => {
  const sh = L.deleteCommand("-r-app", U1, false);
  assert.equal(sh.command, "sh");
  assert.deepEqual(sh.args.slice(2), ["delete", "-r-app", U1]);
  const ps = L.deleteCommand("C--r-app", U1, true);
  assert.equal(ps.command, "powershell");
  assert.ok(ps.args[2].includes("SendToRecycleBin"));
  assert.throws(() => L.deleteCommand("..", U1, true), /세션을 가리키지 못했어요/);
  assert.throws(() => L.deleteCommand("-r-app", "x", false), /세션을 가리키지 못했어요/);
});

test("actionError and deleteConfirmText", () => {
  assert.equal(L.actionError(2, ""), "세션 파일이 없어요");
  assert.equal(L.actionError(3, ""), "열려 있는 세션은 지울 수 없어요");
  assert.equal(L.actionError(1, "\n  Access denied\nmore"), "Access denied");
  assert.equal(L.actionError(1, ""), "실패했어요");
  assert.equal(L.deleteConfirmText("작업", false), '"작업" 세션을 휴지통으로 보낼까요?');
  assert.equal(L.deleteConfirmText("작업", true), '"작업" 세션을 완전히 지울까요? 되돌릴 수 없어요.');
});

for (const windows of [true, false]) {
  const shell = windows ? "powershell" : "sh";
  const runs = !spawnSync(shell, windows ? ["-NoProfile", "-Command", "exit 0"] : ["-c", "exit 0"]).error;
  test(`renameCommand and deleteCommand run (${shell})`, { skip: !runs || (windows && process.platform !== "win32") }, t => {
    const home = pjoin(mkdtempSync(pjoin(tmpdir(), "session-acts-")), "it's 홈");
    const store = pjoin(home, ".claude", "projects", "C--r-app");
    mkdirSync(store, { recursive: true });
    const env = { ...process.env, USERPROFILE: home, HOME: windows ? home : home.replaceAll("\\", "/") };
    const run = c => spawnSync(c.command, c.args, { encoding: "utf8", env });
    const file = u => pjoin(store, `${u}.jsonl`);
    writeFileSync(file(U1), JSON.stringify({ cwd: "C:\\r\\app" })); // no final newline
    writeFileSync(file(U2), JSON.stringify({ cwd: "C:\\r\\app" }) + "\n");
    const title = 'it\'s "$HOME" `x` 이름';
    for (const u of [U1, U2]) {
      const r = run(L.renameCommand("C--r-app", u, title, windows));
      assert.equal(r.status, 0, r.stderr);
      const lines = readFileSync(file(u), "utf8").split("\n");
      assert.equal(lines.length, 3);
      assert.deepEqual(JSON.parse(lines[1]), { type: "custom-title", customTitle: title, sessionId: u });
      assert.equal(lines[2], "");
    }
    const listed = L.sessionLines(run(L.sessionsCommand(["C--r-app"], windows)).stdout);
    assert.equal(listed.find(x => x.id === U1).customTitle, title);
    assert.equal(run(L.renameCommand("C--r-app", U3, "x", windows)).status, 2);

    // U1 is open: its record points at a running process.
    const sessions = pjoin(home, ".claude", "sessions");
    mkdirSync(sessions, { recursive: true });
    const sleeper = windows ? null : spawnSync("sh", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" }).stdout.trim();
    if (sleeper) t.after(() => spawnSync("sh", ["-c", `kill ${sleeper}`]));
    writeFileSync(pjoin(sessions, "1.json"), JSON.stringify({ pid: sleeper ? Number(sleeper) : process.pid, sessionId: U1, startedAt: Date.now() }));
    assert.equal(run(L.deleteCommand("C--r-app", U1, windows)).status, 3);
    assert.ok(existsSync(file(U1)));

    mkdirSync(pjoin(store, U2, "subagents"), { recursive: true });
    writeFileSync(pjoin(store, U2, "subagents", "a.jsonl"), "{}\n");
    const del = run(L.deleteCommand("C--r-app", U2, windows));
    assert.equal(del.status, 0, del.stderr);
    assert.ok(!existsSync(file(U2)));
    assert.ok(!existsSync(pjoin(store, U2)));
    assert.equal(run(L.deleteCommand("C--r-app", U2, windows)).status, 2);
  });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/my-sessions-logic.test.mjs`
Expected: the new tests and the changed `toSessions` test FAIL (`renameCommand is not a function`, missing `dir`).

- [ ] **Step 4: Implement in `mods/my-sessions/logic.js`**

1. In `toSessions`, change `return rows.filter(r => UUID.test(r.id)).map(r => ({` to `return rows.filter(r => UUID.test(r.id) && STORE.test(r.dir ?? "")).map(r => ({` and add `dir: r.dir,` after `folder: startFolder(r.dir, r.cwd),`. Above `toSessions` add:

```js
/** Storage folder names under ~/.claude/projects: encodeProject's output. */
const STORE = /^[A-Za-z0-9-]+$/;
```

2. Extract the "open sessions" loops of `sessionsCommand` into two functions placed right above `sessionsCommand`, and use them there so its output is unchanged:

```js
// The loop over ~/.claude/sessions/*.json that finds sessions a running Claude Code has open.
// `found` runs for each one, with the session id in $i.Groups[1].Value. Needs $live set first.
function psLiveLoop(found) {
  return "if ([IO.Directory]::Exists($live)) { foreach ($f in [IO.Directory]::GetFiles($live, '*.json')) { try { " +
    "$t = [IO.File]::ReadAllText($f); " +
    "$p = [regex]::Match($t, '\"pid\"\\s*:\\s*(\\d+)'); $i = [regex]::Match($t, '\"sessionId\"\\s*:\\s*\"([0-9a-fA-F-]{36})\"'); $s = [regex]::Match($t, '\"startedAt\"\\s*:\\s*(\\d+)'); " +
    "if (-not $p.Success -or -not $i.Success) { continue }; " +
    "$proc = Get-Process -Id ([int]$p.Groups[1].Value) -ErrorAction Stop; " +
    "if ($s.Success -and [DateTimeOffset]::new($proc.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() -gt [long]$s.Groups[1].Value + 5000) { continue }; " +
    found +
    "} catch {} } }";
}

// The same for sh; `found` runs with the id in $id.
function shLiveLoop(found) {
  return 'for f in "$HOME/.claude/sessions"/*.json; do [ -f "$f" ] || continue; ' +
    `pid=$(grep -a -o -E '"pid": *[0-9]+' "$f" | head -n 1 | sed 's/.*[^0-9]//'); ` +
    `id=$(grep -a -o -E '"sessionId": *"[0-9a-fA-F-]{36}"' "$f" | head -n 1 | sed 's/.*: *"//; s/"$//'); ` +
    `[ -n "$pid" ] && [ -n "$id" ] && kill -0 "$pid" 2>/dev/null && ${found}; done; `;
}
```

In `sessionsCommand`'s Windows array, replace the whole element that starts with `"if ([IO.Directory]::Exists($live)) {` (through `"} catch {} } }",`) with `psLiveLoop("\"LIVE`t$($i.Groups[1].Value)\" "),` (keep the comment line above it). In the sh `script`, replace the part from `'for f in "$HOME/.claude/sessions"/*.json; do [ -f "$f" ] || continue; ' +` through `'[ -n "$pid" ] && [ -n "$id" ] && kill -0 "$pid" 2>/dev/null && printf "LIVE\\t%s\\n" "$id"; done; ' +` with `shLiveLoop('printf "LIVE\\t%s\\n" "$id"') +`.

3. Append the new functions at the end of the file:

```js
function checkTarget(dir, id) {
  if (!STORE.test(String(dir ?? "")) || !UUID.test(String(id ?? ""))) throw new Error("세션을 가리키지 못했어요");
}

/**
 * Renames a session the way Claude Code's /rename does: one custom-title record appended to its file.
 * A file not ending in a newline gets one first. Exit 2: no such session file.
 */
export function renameCommand(dir, id, title, windows) {
  checkTarget(dir, id);
  const name = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("이름이 비어 있어요");
  const line = JSON.stringify({ type: "custom-title", customTitle: name, sessionId: id });
  if (windows) {
    const script = [
      `$f = [IO.Path]::Combine($env:USERPROFILE, '.claude', 'projects', ${psQuote(dir)}, ${psQuote(`${id}.jsonl`)})`,
      "if (-not [IO.File]::Exists($f)) { exit 2 }",
      "$s = [IO.File]::Open($f, 'Open', 'ReadWrite', 'ReadWrite, Delete')",
      "try { $nl = $true; if ($s.Length -gt 0) { [void]$s.Seek(-1, 'End'); $nl = $s.ReadByte() -eq 10 }; [void]$s.Seek(0, 'End'); " +
        `$text = $(if ($nl) { '' } else { [string][char]10 }) + ${psQuote(line)} + [char]10; ` +
        "$b = [Text.UTF8Encoding]::new($false).GetBytes($text); $s.Write($b, 0, $b.Length) } finally { $s.Close() }",
    ].join("; ");
    return { command: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  const script = 'f="$HOME/.claude/projects/$1/$2.jsonl"; [ -f "$f" ] || exit 2; ' +
    '[ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ] && printf "\\n" >> "$f"; printf "%s\\n" "$3" >> "$f"';
  return { command: "sh", args: ["-c", script, "rename", dir, id, line] };
}

/**
 * Deletes a session file and its same-named folder: to the Recycle Bin on Windows, for good elsewhere.
 * Exit 3: the session is open (nothing deleted). Exit 2: no such session file.
 */
export function deleteCommand(dir, id, windows) {
  checkTarget(dir, id);
  if (windows) {
    const script = [
      `$id = ${psQuote(id)}`,
      "$live = Join-Path $env:USERPROFILE '.claude\\sessions'",
      psLiveLoop("if ($i.Groups[1].Value -eq $id) { exit 3 } "),
      `$d = [IO.Path]::Combine($env:USERPROFILE, '.claude', 'projects', ${psQuote(dir)})`,
      "$file = Join-Path $d ($id + '.jsonl'); $sub = Join-Path $d $id",
      "if (-not [IO.File]::Exists($file)) { exit 2 }",
      "Add-Type -AssemblyName Microsoft.VisualBasic",
      "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($file, 'OnlyErrorDialogs', 'SendToRecycleBin')",
      "if ([IO.Directory]::Exists($sub)) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($sub, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
    ].join("; ");
    return { command: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  const script = shLiveLoop('[ "$id" = "$2" ] && exit 3') +
    'd="$HOME/.claude/projects/$1"; [ -f "$d/$2.jsonl" ] || exit 2; rm -f "$d/$2.jsonl" && rm -rf "$d/$2"';
  return { command: "sh", args: ["-c", script, "delete", dir, id] };
}

export function actionError(code, stderr) {
  if (code === 2) return "세션 파일이 없어요";
  if (code === 3) return "열려 있는 세션은 지울 수 없어요";
  return String(stderr ?? "").split(/\r?\n/).map(l => l.trim()).find(Boolean) || "실패했어요";
}

export function deleteConfirmText(title, remote) {
  return remote ? `"${title}" 세션을 완전히 지울까요? 되돌릴 수 없어요.` : `"${title}" 세션을 휴지통으로 보낼까요?`;
}
```

- [ ] **Step 5: Verify `sessionsCommand` is unchanged**

```bash
node -e 'import("./mods/my-sessions/logic.js").then(L => console.log(JSON.stringify([L.sessionsCommand(["C--r-app","-x"], true), L.sessionsCommand(["C--r-app","-x"], false)])))' > /tmp/sessions-after.json && cmp /tmp/sessions-before.json /tmp/sessions-after.json && echo SAME
```

Expected: `SAME`.

- [ ] **Step 6: Run tests**

Run: `node --test tests/*.test.mjs`
Expected: PASS (the PowerShell run test sends two temp files to the Recycle Bin on Windows).

- [ ] **Step 7: Commit**

```bash
git add mods/my-sessions/logic.js tests/my-sessions-logic.test.mjs
git commit -m "my-sessions: rename and delete commands, shared open-session check"
```

---

### Task 2: `⋯` menu in the panel, README

**Files:**
- Modify: `mods/my-sessions/main.js`
- Modify: `README.md`

**Interfaces:**
- Consumes (Task 1): `renameCommand`, `deleteCommand`, `actionError`, `deleteConfirmText`; sessions now have `dir`.

- [ ] **Step 1: Imports and state**

Change `import { v_flex, h_flex } from "gpui-base";` to `import { v_flex, h_flex, InputState, Input } from "gpui-base";` and add `renameCommand, deleteCommand, actionError, deleteConfirmText` to the `./logic.js` import list.

In `init`, after the first line, add:

```js
    this.act = null; // the ⋯ box: { id, dir, title, step: "menu" | "rename" | "confirm" | "running" | "failed", kind, error }
    this.nameInput = InputState.new({ placeholder: "세션 이름" });
    this.nameInput.on("submit", (_e, cx) => { this.runAct("rename", cx); cx.notify(); });
```

- [ ] **Step 2: Close the box when the list moves on**

In `refresh`, inside `if (next !== this.context?.key) {`, add as its first line:

```js
      if (this.act?.step !== "running") this.act = null;
```

and in the `cx.spawn` success branch change `if (this.context === context) { this.data = data; this.error = null; }` to:

```js
        if (this.context === context) {
          this.data = data; this.error = null;
          if (this.act && this.act.step !== "running" && !data.sessions.some(x => x.id === this.act.id)) this.act = null;
        }
```

- [ ] **Step 3: Actions**

Add these methods after `open(session)`:

```js
  toggleMenu(s) {
    if (this.act?.step === "running") return;
    this.act = this.act?.id === s.id ? null : { id: s.id, dir: s.dir, title: s.title, step: "menu", kind: null, error: null };
  }

  startRename() {
    const a = this.act;
    if (!a) return;
    a.step = "rename";
    this.nameInput.set_value(a.title === "(제목 없음)" ? "" : a.title);
    this.nameInput.focus();
  }

  // Runs the rename or delete where the list was read; then reads the list again either way.
  runAct(kind, cx) {
    const a = this.act, context = this.context;
    if (!a || !context || a.step === "running") return;
    if (kind === "rename" && (a.step !== "rename" || !this.nameInput.value().trim())) return;
    const windows = !context.on && window()?.platform === "windows";
    let c;
    try { c = kind === "rename" ? renameCommand(a.dir, a.id, this.nameInput.value(), windows) : deleteCommand(a.dir, a.id, windows); }
    catch (e) { a.step = "failed"; a.error = String(e?.message ?? e); return; }
    a.step = "running"; a.kind = kind;
    cx.spawn(async cx => {
      let r = null;
      try { r = await exec(c.command, c.args, { on: context.on }); } catch {}
      const error = !r ? "명령을 실행하지 못했어요" : r.code === 0 ? null : actionError(r.code, r.stderr);
      if (this.act === a) {
        if (error) { a.step = "failed"; a.error = error; } else this.act = null;
      } else if (error) {
        notify({ title: kind === "rename" ? "세션 이름을 바꾸지 못했어요" : "세션을 지우지 못했어요", body: error, level: "error", timeout: 5000 });
      }
      if (this.context === context) this.refresh(cx);
      cx.notify();
    });
  }

  // The box under a row: menu, rename field, delete question, progress or error.
  actBox(s, live, t, button) {
    const a = this.act;
    if (!a || a.id !== s.id) return [];
    const box = h_flex().id(`session-act-${s.id}`).flex_none().mx(8).mb(4).px(8).py(6).gap(6).items_center().flex_wrap()
      .rounded(7).bg(t.hover).text_size(12);
    const close = button("session-act-close", a.step === "menu" ? "닫기" : "취소", () => { this.act = null; });
    if (a.step === "menu") return [box
      .child(button("session-rename", "이름 수정", () => this.startRename()))
      .child(live ? div().text_color(t.dim).child("열려 있는 세션은 지울 수 없어요") : button("session-delete", "삭제", () => { a.step = "confirm"; }))
      .child(close)];
    if (a.step === "rename") return [box
      .child(Input.new(this.nameInput).flex_1().min_w(120).h(26).text_size(12.5))
      .child(button("session-rename-ok", "저장", cx => this.runAct("rename", cx)))
      .child(close)];
    if (a.step === "confirm") return [box
      .child(div().child(deleteConfirmText(a.title, Boolean(this.context?.on))))
      .child(button("session-delete-ok", "삭제", cx => this.runAct("delete", cx)))
      .child(close)];
    if (a.step === "running") return [box.child(div().text_color(t.dim).child(a.kind === "rename" ? "이름 바꾸는 중…" : "지우는 중…"))];
    return [box.child(div().flex_1().min_w(0).text_color(t.ansi1).child(`⚠ ${a.error}`)).child(button("session-act-close", "닫기", () => { this.act = null; }))];
  }
```

- [ ] **Step 4: Row with `⋯`, box as a sibling**

In `render`, after the `chip` helper add:

```js
    const button = (id, label, onClick) => h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(6).cursor_pointer()
      .text_size(12).text_color(t.foreground).border_1().border_color(t.border).bg(t.background).hover(s => s.bg(t.selected))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
```

Replace the whole `.children(picked.items.map(s => v_flex().id(`session-${s.id}`) … ))` expression (the row list, ending right before `.when(picked.more, …`) with:

```js
        .children(picked.items.flatMap(s => {
          const live = d.live.has(s.id.toLowerCase());
          return [v_flex().id(`session-${s.id}`).flex_none().px(8).py(6).gap(3).rounded(7).cursor_pointer().hover(st => st.bg(t.hover))
            .on_click(e => { if (e.click_count === 1) this.open(s); })
            .child(h_flex().min_w(0).gap(6).items_center()
              .when(live, el => el.child(div().flex_none().w(8).h(8).rounded(4).bg(t.ansi2)))
              .child(div().flex_1().min_w(0).truncate().child(s.title))
              // ⋯: its press and click stop here, so the row doesn't open the session.
              .child(div().id(`session-more-${s.id}`).w(20).h(20).flex_none().flex().items_center().justify_center().rounded(5)
                .text_color(t.dim).hover(st => st.bg(t.selected).text_color(t.foreground))
                .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                .on_click((_e, cx) => { cx.stop_propagation(); this.toggleMenu(s); cx.notify(); })
                .child("⋯")))
            .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(sessionMeta(s, d.root, now))),
          ...this.actBox(s, live, t, button)];
        }))
```

- [ ] **Step 5: README**

In `README.md`, section "### Sessions 패널 (`my-sessions`)", after the bullet that starts with `- 행을 누르면 **새 탭**이`, add:

```markdown
- 행 오른쪽의 **`⋯`** 로 **이름 수정**과 **삭제**를 합니다. 이름 수정은 Claude Code의 `/rename` 과 같은 방식(세션 파일 끝에 이름 기록 한 줄)이라 `claude -r` 에서도 새 이름으로 보입니다. 삭제는 한 번 물은 뒤 세션 파일과 같은 이름의 폴더를 이 PC에서는 **휴지통**으로 보내고, 원격 스페이스에서는 완전히 지웁니다. 열려 있는 세션(초록 점)은 지울 수 없습니다. `~/.claude` 의 다른 부속 기록(파일 변경 이력 등)은 남습니다.
```

- [ ] **Step 6: Check**

PowerShell (mod.json first):

```powershell
$to = "$env:USERPROFILE\.config\herdr-app\mods\my-sessions"; Copy-Item mods\my-sessions\mod.json $to -Force; Copy-Item mods\my-sessions\* $to -Recurse -Force; herdr-app check $to
```

Expected: `check passed`. Git Bash: `node --test tests/*.test.mjs` → PASS.

- [ ] **Step 7: Commit**

```bash
git add mods/my-sessions/main.js README.md
git commit -m "my-sessions: ⋯ on each row to rename or delete a session"
```
