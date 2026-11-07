# GitHub 패널: 이슈 닫기와 PR 머지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub 패널의 상세 화면에서 열린 이슈를 닫고, 열린 PR을 Merge / Squash / Rebase 중 골라 머지한다.

**Architecture:** 인자와 문구는 `mods/my-github/logic.js`의 순수 함수로 만들고, `main.js`는 상세 화면 아래에 단계(처음 → 고르기 → 확인 → 실행 중 → 실패)를 가진 동작 줄을 그린다. JSON을 내지 않는 명령을 위해 종료 코드만 보는 `ghRun`을 둔다.

**Tech Stack:** Herdr mod API (`gpui-kit`, `gpui-base`, `herdr`), `gh` CLI, `node --test`.

## Global Constraints

- 사양: `docs/superpowers/specs/2026-11-07-github-close-merge-design.md`.
- `--delete-branch`, `--admin`, `--auto`는 쓰지 않는다.
- 실제 저장소에 닫기·머지를 실행하는 시험은 하지 않는다.
- 사용자에게 보이는 글은 한국어(방식 이름 Merge / Squash / Rebase는 영어).
- 테스트는 Git Bash에서 `node --test tests/*.test.mjs`.
- 라이브 앱에 mod를 손으로 복사하지 않는다.

---

### Task 1: 인자와 문구 (`logic.js`)

**Files:**
- Modify: `mods/my-github/logic.js`, `tests/my-github-logic.test.mjs:15`

**Interfaces:**
- Produces: `viewArgs(kind, number)`(PR이면 `isDraft` 추가), `canAct(kind, data)` → boolean, `METHODS` = `["merge", "squash", "rebase"]`, `methodLabel(method)` → `"Merge" | "Squash" | "Rebase"`, `actionArgs(kind, number, method)` → string[] (잘못된 방식이면 throw), `confirmText(kind, number, method)` → string.

- [ ] **Step 1: 테스트 고치고 추가**

`tests/my-github-logic.test.mjs` 15번 줄을 바꾼다:

```js
  assert.deepEqual(L.viewArgs("pr", 77), ["pr", "view", "77", "--json", "number,title,body,author,labels,state,comments,url,createdAt,isDraft"]);
```

파일 끝에 추가:

```js
test("viewArgs: an issue has no isDraft field", () => {
  assert.deepEqual(L.viewArgs("issue", 12), ["issue", "view", "12", "--json", "number,title,body,author,labels,state,comments,url,createdAt"]);
});

test("canAct: open issues and open, ready PRs only", () => {
  assert.equal(L.canAct("issue", { state: "OPEN" }), true);
  assert.equal(L.canAct("issue", { state: "CLOSED" }), false);
  assert.equal(L.canAct("pr", { state: "OPEN", isDraft: false }), true);
  assert.equal(L.canAct("pr", { state: "OPEN", isDraft: true }), false);
  assert.equal(L.canAct("pr", { state: "MERGED", isDraft: false }), false);
  assert.equal(L.canAct("pr", null), false);
});

test("actionArgs: close an issue, merge a PR by the chosen method", () => {
  assert.deepEqual(L.actionArgs("issue", 12), ["issue", "close", "12"]);
  assert.deepEqual(L.actionArgs("pr", 7, "merge"), ["pr", "merge", "7", "--merge"]);
  assert.deepEqual(L.actionArgs("pr", 7, "squash"), ["pr", "merge", "7", "--squash"]);
  assert.deepEqual(L.actionArgs("pr", 7, "rebase"), ["pr", "merge", "7", "--rebase"]);
  assert.throws(() => L.actionArgs("pr", 7, "admin"));
  assert.throws(() => L.actionArgs("pr", 7));
});

test("METHODS and methodLabel", () => {
  assert.deepEqual(L.METHODS, ["merge", "squash", "rebase"]);
  assert.deepEqual(L.METHODS.map(L.methodLabel), ["Merge", "Squash", "Rebase"]);
});

test("confirmText", () => {
  assert.equal(L.confirmText("issue", 12), "이슈 #12를 닫을까요?");
  assert.equal(L.confirmText("pr", 7, "squash"), "PR #7을 Squash로 머지할까요?");
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/my-github-logic.test.mjs`
Expected: `FIELDS and viewArgs` 실패, 새 테스트는 `L.canAct is not a function` 등으로 실패.

- [ ] **Step 3: 구현**

`mods/my-github/logic.js`의 `viewArgs`를 바꾼다:

```js
/** gh arguments for one issue or PR with its body and comments. A PR also says whether it is a draft. */
export function viewArgs(kind, number) {
  return [kind, "view", String(number), "--json", kind === "pr" ? `${VIEW_FIELDS},isDraft` : VIEW_FIELDS];
}

const METHOD = { merge: "Merge", squash: "Squash", rebase: "Rebase" };
export const METHODS = Object.keys(METHOD);
export const methodLabel = method => METHOD[method];

/** Whether the detail view offers closing or merging: open, and for a PR not a draft. */
export function canAct(kind, data) {
  return data?.state === "OPEN" && !(kind === "pr" && data.isDraft);
}

/** gh arguments that close an issue or merge a PR. Never deletes the branch or bypasses rules. */
export function actionArgs(kind, number, method) {
  if (kind === "issue") return ["issue", "close", String(number)];
  if (!METHOD[method]) throw new Error(`unknown merge method: ${method}`);
  return ["pr", "merge", String(number), `--${method}`];
}

export function confirmText(kind, number, method) {
  return kind === "issue" ? `이슈 #${number}를 닫을까요?` : `PR #${number}을 ${METHOD[method]}로 머지할까요?`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/*.test.mjs`
Expected: 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add mods/my-github/logic.js tests/my-github-logic.test.mjs
git commit -m "my-github: arguments and wording for closing issues and merging PRs"
```

---

### Task 2: 동작 줄 (`main.js`)과 README

**Files:**
- Modify: `mods/my-github/main.js`, `README.md`

**Interfaces:**
- Consumes: Task 1의 `canAct`, `actionArgs`, `confirmText`, `METHODS`, `methodLabel`.

- [ ] **Step 1: import**

`main.js` 6번 줄 import 목록 끝(`dragText` 뒤)에 `, canAct, actionArgs, confirmText, METHODS, methodLabel`을 더한다.

- [ ] **Step 2: 종료 코드만 보는 실행**

`gh()` 함수 바로 뒤에 추가:

```js

// For gh commands that print no JSON (issue close, pr merge): success is the exit code.
async function ghRun(args, { cwd, on }) {
  let r;
  try { r = await exec("gh", args, { cwd, on }); }
  catch { return { ok: false, error: ghError("", true) }; }
  return r.code === 0 ? { ok: true } : { ok: false, error: ghError(r.stderr || r.stdout || "", false) };
}

const itemKey = (kind, number) => `${kind}#${number}`;
```

- [ ] **Step 3: 상태와 이동**

`init`의 `this.detail = null; // ...` 줄 아래에 추가:

```js
    this.act = null; // { key, kind, number, step: "pick" | "confirm" | "running" | "failed", method, error }
```

`openDetail(item, cx)`를 다음으로 바꾼다:

```js
  openDetail(item, cx, kind = this.kind) {
    if (this.act?.step !== "running") this.act = null; // a half-made choice doesn't follow to another item
    const context = this.context, detail = { kind, item, data: null, error: null };
    this.detail = detail;
    cx.spawn(async cx => {
      const r = await gh(viewArgs(detail.kind, item.number), context);
      if (this.detail !== detail) return;
      if (r.ok) detail.data = r.data; else detail.error = r.error;
      cx.notify();
    });
  }
```

`detailView`의 뒤로 버튼 `on_click`을 다음으로 바꾼다:

```js
          .on_click((_e, cx) => { this.detail = null; if (this.act?.step !== "running") this.act = null; cx.notify(); }).child("←"))
```

- [ ] **Step 4: 실행**

`handOff` 앞에 메서드를 추가한다:

```js
  // Runs the confirmed close or merge. On success the item is read again (its buttons go away) and the list refreshes.
  runAction(cx) {
    const act = this.act, context = this.context;
    if (!act || act.step === "running") return;
    act.step = "running"; act.error = null;
    cx.spawn(async cx => {
      let r;
      try { r = await ghRun(actionArgs(act.kind, act.number, act.method), context); }
      catch (e) { r = { ok: false, error: { kind: "other", message: String(e) } }; }
      if (r.ok) {
        if (this.act === act) this.act = null;
        if (this.context === context) {
          this.refresh(cx);
          const d = this.detail;
          if (d && itemKey(d.kind, (d.data ?? d.item).number) === act.key) this.openDetail(d.item, cx, d.kind);
        }
      } else if (this.act === act) {
        act.step = "failed"; act.error = r.error;
      } else {
        notify({ title: act.kind === "pr" ? `PR #${act.number}을 머지하지 못했어요` : `이슈 #${act.number}를 닫지 못했어요`, body: r.error.message, level: "error", timeout: 5000 });
      }
      cx.notify();
    });
  }

  // The close / merge row under the detail toolbar, or null when the item can't be acted on.
  actionRow(t, button) {
    const d = this.detail, data = d.data;
    if (!canAct(d.kind, data)) return null;
    const pr = d.kind === "pr", key = itemKey(d.kind, data.number), act = this.act?.key === key ? this.act : null;
    const start = method => ({ key, kind: d.kind, number: data.number, step: method || !pr ? "confirm" : "pick", method: method ?? null, error: null });
    const row = h_flex().min_h(38).flex_none().px(14).py(6).gap(8).items_center().flex_wrap().border_b(1).border_color(t.border).text_size(12);
    const cancel = button("gh-act-cancel", "취소", () => { this.act = null; });
    if (!act) return row.child(button("gh-act-start", pr ? "머지" : "이슈 닫기", () => { this.act = start(null); }));
    if (act.step === "pick") return row.children(METHODS.map(m => button(`gh-merge-${m}`, methodLabel(m), () => { this.act = start(m); }))).child(cancel);
    if (act.step === "confirm") return row.child(div().child(confirmText(d.kind, data.number, act.method)))
      .child(button("gh-act-go", pr ? "머지" : "닫기", cx => this.runAction(cx))).child(cancel);
    if (act.step === "running") return row.child(div().text_color(t.dim).child(pr ? "머지 중…" : "닫는 중…"));
    return row.child(div().text_color(t.ansi1).child(`⚠ ${act.error?.message ?? "gh 오류"}`))
      .child(button("gh-act-retry", "다시 시도", cx => this.runAction(cx))).child(cancel);
  }

```

- [ ] **Step 5: 상세 화면에 붙이기**

`detailView`에서 도구 줄(`github-open`, `github-agent` 버튼이 있는 `h_flex().h(38)...`) 항목 뒤, `d.error ? ...` 항목 앞에 다음을 넣는다. 배열 안이므로 펼쳐서 넣는다:

```js
      ...(d.data ? [this.actionRow(t, button)].filter(Boolean) : []),
```

- [ ] **Step 6: README**

`GitHub 패널` 절의 `- 항목을 누르면 본문과 코멘트를 마크다운으로 보여 주고, **[브라우저로 열기]** 가 있습니다.` 줄 아래에 추가:

```markdown
- 상세 화면에서 열린 이슈는 **[이슈 닫기]**, 열린 PR은 **[머지]** 후 **Merge / Squash / Rebase** 를 골라 확인하면 실행됩니다. 브랜치는 지우지 않고, 저장소 규칙(필수 리뷰·체크 등)을 우회하지 않습니다. 실패하면 gh가 알려 준 이유와 **[다시 시도]** 가 나옵니다. 초안 PR에는 버튼이 없습니다.
```

- [ ] **Step 7: 확인**

Run: `node --test tests/*.test.mjs` → 전부 통과.
Run: `node --input-type=module --check < mods/my-github/main.js` → 오류 없음.
앱에 설치하지 않는다. 실제 이슈를 닫거나 PR을 머지하지 않는다.

- [ ] **Step 8: 커밋**

```bash
git add mods/my-github/main.js README.md
git commit -m "my-github: close issues and merge PRs from the detail view, with a confirm step"
```
