import test from "node:test";
import assert from "node:assert/strict";
// Tests the repository copy of the mod (mods/ next to tests/).
const L = await import(new URL("../mods/my-github/logic.js", import.meta.url).href);

test("listArgs builds gh list arguments per filter", () => {
  assert.deepEqual(L.listArgs("issue", "open"), ["issue", "list", "--limit", "30", "--json", L.FIELDS.issue, "--state", "open"]);
  assert.deepEqual(L.listArgs("pr", "mine"), ["pr", "list", "--limit", "30", "--json", L.FIELDS.pr, "--state", "open", "--search", "involves:@me"]);
  assert.deepEqual(L.listArgs("issue", "closed"), ["issue", "list", "--limit", "30", "--json", L.FIELDS.issue, "--state", "closed"]);
});

test("FIELDS and viewArgs", () => {
  assert.equal(L.FIELDS.issue, "number,title,author,labels,updatedAt,comments,url,state");
  assert.equal(L.FIELDS.pr, "number,title,author,labels,updatedAt,comments,url,state,isDraft,reviewDecision,statusCheckRollup");
  assert.deepEqual(L.viewArgs("pr", 77), ["pr", "view", "77", "--json", "number,title,body,author,labels,state,comments,url,createdAt,isDraft"]);
});

test("sortByUpdated: newest first, input untouched", () => {
  const input = [{ n: 1, updatedAt: "2026-11-01T00:00:00Z" }, { n: 2, updatedAt: "2026-11-03T00:00:00Z" }, { n: 3, updatedAt: "2026-11-02T00:00:00Z" }];
  assert.deepEqual(L.sortByUpdated(input).map(i => i.n), [2, 3, 1]);
  assert.deepEqual(input.map(i => i.n), [1, 2, 3]);
});

test("ciSummary", () => {
  const ok = { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" };
  assert.equal(L.ciSummary(null), null);
  assert.equal(L.ciSummary([]), null);
  assert.equal(L.ciSummary([ok, ok]), "pass");
  assert.equal(L.ciSummary([ok, { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" }, { __typename: "CheckRun", status: "COMPLETED", conclusion: "NEUTRAL" }]), "pass");
  assert.equal(L.ciSummary([ok, { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" }]), "pending");
  assert.equal(L.ciSummary([ok, { __typename: "StatusContext", state: "PENDING" }]), "pending");
  assert.equal(L.ciSummary([{ __typename: "CheckRun", status: "IN_PROGRESS", conclusion: "" }, { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }]), "fail");
  assert.equal(L.ciSummary([{ __typename: "StatusContext", state: "ERROR" }]), "fail");
  assert.equal(L.ciSummary([{ __typename: "CheckRun", status: "COMPLETED", conclusion: "TIMED_OUT" }]), "fail");
});

test("reviewLabel and stateLabel", () => {
  assert.equal(L.reviewLabel("APPROVED"), "승인");
  assert.equal(L.reviewLabel("CHANGES_REQUESTED"), "변경 요청");
  assert.equal(L.reviewLabel("REVIEW_REQUIRED"), "리뷰 대기");
  assert.equal(L.reviewLabel(""), null);
  assert.equal(L.reviewLabel(undefined), null);
  assert.equal(L.stateLabel("OPEN"), "열림");
  assert.equal(L.stateLabel("CLOSED"), "닫힘");
  assert.equal(L.stateLabel("MERGED"), "병합됨");
  assert.equal(L.stateLabel("WEIRD"), "WEIRD");
});

test("relativeTime", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  assert.equal(L.relativeTime("2026-11-03T11:59:30Z", now), "방금");
  assert.equal(L.relativeTime("2026-11-03T12:05:00Z", now), "방금");
  assert.equal(L.relativeTime("2026-11-03T11:55:00Z", now), "5분 전");
  assert.equal(L.relativeTime("2026-11-03T09:00:00Z", now), "3시간 전");
  assert.equal(L.relativeTime("2026-11-01T12:00:00Z", now), "2일 전");
  assert.equal(L.relativeTime("2026-09-03T12:00:00Z", now), "2개월 전");
  assert.equal(L.relativeTime("2024-11-03T12:00:00Z", now), "2년 전");
  assert.equal(L.relativeTime("not a date", now), "");
});

test("agentPrompt", () => {
  const item = { number: 12, title: "로그인 버그", url: "https://github.com/o/r/issues/12" };
  assert.equal(L.agentPrompt("issue", item), 'GitHub 이슈 #12 "로그인 버그" 를 해결해줘. https://github.com/o/r/issues/12\n내용과 코멘트는 `gh issue view 12 --comments` 로 확인해.');
  const pr = { number: 34, title: "API 추가", url: "https://github.com/o/r/pull/34" };
  assert.equal(L.agentPrompt("pr", pr), 'GitHub PR #34 "API 추가" 를 해결해줘. https://github.com/o/r/pull/34\n내용과 코멘트는 `gh pr view 34 --comments` 로 확인해.');
});

test("tabName: '#N title', cut to 40 chars", () => {
  assert.equal(L.tabName({ number: 12, title: "로그인 버그" }), "#12 로그인 버그");
  const long = L.tabName({ number: 7, title: "a".repeat(60) });
  assert.equal(long.length, 40);
  assert.equal(long, "#7 " + "a".repeat(36) + "…");
});

test("ghError classifies gh failures", () => {
  assert.deepEqual(L.ghError("", true), { kind: "missing", message: "이 머신에 gh가 없어요" });
  assert.deepEqual(L.ghError("failed to run git: fatal: not a git repository (or any of the parent directories): .git\n", false), { kind: "norepo", message: "GitHub 저장소가 아니에요" });
  assert.deepEqual(L.ghError("no git remotes found\n", false), { kind: "norepo", message: "GitHub 저장소가 아니에요" });
  assert.deepEqual(L.ghError("To get started with GitHub CLI, please run:  gh auth login\n", false), { kind: "auth", message: "gh 로그인이 필요해요 (gh auth login)" });
  assert.deepEqual(L.ghError("\nHTTP 404: Not Found\nmore\n", false), { kind: "other", message: "HTTP 404: Not Found" });
  assert.deepEqual(L.ghError("", false), { kind: "other", message: "gh 오류" });
});

test("emptyText", () => {
  assert.equal(L.emptyText("issue", "open"), "열린 이슈가 없어요");
  assert.equal(L.emptyText("pr", "open"), "열린 PR이 없어요");
  assert.equal(L.emptyText("pr", "closed"), "닫힌 항목이 없어요");
  assert.equal(L.emptyText("issue", "mine"), "나와 관련된 항목이 없어요");
});

test("dragText: one line, trailing space", () => {
  assert.equal(L.dragText("issue", { number: 78, title: "WS 테스트", url: "https://github.com/o/r/issues/78" }), '이슈 #78 "WS 테스트" https://github.com/o/r/issues/78 ');
  assert.equal(L.dragText("pr", { number: 77, title: "API", url: "https://github.com/o/r/pull/77" }), 'PR #77 "API" https://github.com/o/r/pull/77 ');
});

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
