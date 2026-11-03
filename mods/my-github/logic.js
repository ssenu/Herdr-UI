// Pure helpers for my-github. No herdr or gpui imports, so `node --test` can load this file.

export const FIELDS = {
  issue: "number,title,author,labels,updatedAt,comments,url,state",
  pr: "number,title,author,labels,updatedAt,comments,url,state,isDraft,reviewDecision,statusCheckRollup",
};
export const VIEW_FIELDS = "number,title,body,author,labels,state,comments,url,createdAt";

/** gh arguments for one list: kind "issue" | "pr", filter "open" | "mine" | "closed". */
export function listArgs(kind, filter) {
  const args = [kind, "list", "--limit", "30", "--json", FIELDS[kind], "--state", filter === "closed" ? "closed" : "open"];
  if (filter === "mine") args.push("--search", "involves:@me");
  return args;
}

/** gh arguments for one issue or PR with its body and comments. */
export function viewArgs(kind, number) {
  return [kind, "view", String(number), "--json", VIEW_FIELDS];
}

/** Most recently updated first (ISO timestamps compare as strings). */
export function sortByUpdated(items) {
  return [...items].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

/** One mark for a PR's checks: any failure wins, then anything unfinished, else pass. */
export function ciSummary(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return null;
  let pending = false;
  for (const check of rollup) {
    if (FAILED.has(check.conclusion) || FAILED.has(check.state)) return "fail";
    // CheckRun has status/conclusion; StatusContext has state.
    if (check.status !== undefined) { if (check.status !== "COMPLETED") pending = true; }
    else if (check.state === "PENDING" || check.state === "EXPECTED") pending = true;
  }
  return pending ? "pending" : "pass";
}

const REVIEW = { APPROVED: "승인", CHANGES_REQUESTED: "변경 요청", REVIEW_REQUIRED: "리뷰 대기" };
export function reviewLabel(decision) {
  return REVIEW[decision] ?? null;
}

const STATE = { OPEN: "열림", CLOSED: "닫힘", MERGED: "병합됨" };
export function stateLabel(state) {
  return STATE[state] ?? state;
}

/** "방금", "5분 전", "3시간 전", "2일 전", "2개월 전", "2년 전"; "" for a bad timestamp. */
export function relativeTime(iso, now) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor(Math.max(0, now - then) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

/** What gets handed to an agent: short, and it tells the agent how to read the rest. */
export function agentPrompt(kind, { number, title, url }) {
  const name = kind === "pr" ? "PR" : "이슈";
  return `GitHub ${name} #${number} "${title}" 를 해결해줘. ${url}\n내용과 코멘트는 \`gh ${kind} view ${number} --comments\` 로 확인해.`;
}

/** A new tab's name: "#12 제목", at most 40 characters. */
export function tabName({ number, title }) {
  const name = `#${number} ${title}`;
  return name.length > 40 ? name.slice(0, 39) + "…" : name;
}

/** Why gh failed, as something to show. startFailed: exec itself rejected (gh not runnable). */
export function ghError(stderr, startFailed) {
  if (startFailed) return { kind: "missing", message: "이 머신에 gh가 없어요" };
  if (/not a git repository|no git remotes|none of the git remotes/i.test(stderr)) return { kind: "norepo", message: "GitHub 저장소가 아니에요" };
  if (/gh auth login|authentication|not logged in/i.test(stderr)) return { kind: "auth", message: "gh 로그인이 필요해요 (gh auth login)" };
  const line = stderr.split("\n").map(s => s.trim()).find(Boolean);
  return { kind: "other", message: line ?? "gh 오류" };
}

/** What an empty list says. */
export function emptyText(kind, filter) {
  if (filter === "mine") return "나와 관련된 항목이 없어요";
  if (filter === "closed") return "닫힌 항목이 없어요";
  return kind === "pr" ? "열린 PR이 없어요" : "열린 이슈가 없어요";
}

/** What a row dragged onto a terminal types: kind, number, title and link, then a space. */
export function dragText(kind, { number, title, url }) {
  return `${kind === "pr" ? "PR" : "이슈"} #${number} "${title}" ${url} `;
}
