// Pure helpers for the status bar's usage summary. No herdr or gpui imports, so `node --test` can load this file.

export const USAGE_BAR = 28;

const WEEK = 7, MINUTE = 60000, HOUR = 3600000;
const pad = n => String(n).padStart(2, "0");
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysBack = (now, n) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n); };
const finite = v => typeof v === "number" && Number.isFinite(v);
const money = n => `$${n.toFixed(2)}`;
const dollars = n => `$${Math.round(n)}`;

const ccusage = args => ({ command: "cmd", args: ["/c", "npx", "-y", "ccusage@latest", ...args] });

/** The two reads. Daily reaches far enough for both this month's total and the last seven days. */
export function usageCommands(now) {
  const d = new Date(now), first = new Date(d.getFullYear(), d.getMonth(), 1), back = daysBack(now, WEEK - 1);
  const since = dayKey(first < back ? first : back).replaceAll("-", "");
  return { daily: ccusage(["daily", "--json", "--since", since]), blocks: ccusage(["blocks", "--active", "--json"]) };
}

const parse = stdout => { try { return JSON.parse(stdout); } catch { return null; } };

/** `daily --json` → the days, or null when the output isn't what's expected. */
export function parseDaily(stdout) {
  const list = parse(stdout)?.daily;
  if (!Array.isArray(list) || !list.every(r => typeof r?.period === "string" && finite(r.totalCost))) return null;
  return { days: list.map(r => ({
    day: r.period, cost: r.totalCost,
    models: (r.modelBreakdowns ?? []).filter(m => typeof m?.modelName === "string" && finite(m.cost)).map(m => ({ name: m.modelName, cost: m.cost })),
  })) };
}

/** `blocks --active --json` → the block, { none: true } when none is active, or null when the output isn't what's expected. */
export function parseBlock(stdout) {
  const list = parse(stdout)?.blocks;
  if (!Array.isArray(list)) return null;
  if (!list.length) return { none: true };
  const b = list[0], start = Date.parse(b?.startTime), end = Date.parse(b?.endTime);
  if (!finite(b?.costUSD) || !finite(start) || !finite(end)) return null;
  return { cost: b.costUSD, start, end, projected: finite(b.projection?.totalCost) ? b.projection.totalCost : null };
}

const activeBlock = (usage, now) => (finite(usage?.block?.end) && usage.block.end > now ? usage.block : null);

function leftText(ms) {
  const minutes = Math.ceil(ms / MINUTE), h = Math.floor(minutes / 60);
  return h ? `${h}h${minutes % 60}m` : `${minutes}m`;
}

function ageText(ms) {
  if (ms === null) return "갱신 전";
  if (ms < MINUTE) return "방금 갱신";
  return ms < HOUR ? `${Math.floor(ms / MINUTE)}분 전 갱신` : `${Math.floor(ms / HOUR)}시간 전 갱신`;
}

const shortModel = name => {
  const m = /^claude-(?:[\d.-]+-)?(opus|sonnet|haiku|fable)(?![a-z])/i.exec(name); // claude-opus-5-5, claude-3-5-sonnet-…
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : name;
};

const findDay = (days, key) => days?.find(d => d.day === key) ?? null;

/** The status bar's text, or null while nothing worth showing has been read. */
export function usageSummary(usage, now) {
  const parts = [];
  if (usage?.days) parts.push(`Today ${dollars(findDay(usage.days, dayKey(new Date(now)))?.cost ?? 0)}`);
  const block = activeBlock(usage, now);
  if (block) parts.push(`Block ${dollars(block.cost)}`, `${leftText(block.end - now)} left`); // English like the rest of the bar
  return parts.length ? parts.join(" · ") : null;
}

function modelsText(today) {
  const sums = new Map();
  for (const m of today?.models ?? []) sums.set(shortModel(m.name), (sums.get(shortModel(m.name)) ?? 0) + m.cost);
  if (!sums.size) return null;
  return [...sums].sort((a, b) => b[1] - a[1]).map(([name, cost]) => `${name} ${money(cost)}`).join(" · ");
}

/** Everything my-usage-dash draws. */
export function usageDash(usage, now, refreshed) {
  const key = dayKey(new Date(now)), days = usage?.days ?? null, today = findDay(days, key);
  const costs = Array.from({ length: WEEK }, (_, i) => {
    const day = dayKey(daysBack(now, WEEK - 1 - i));
    return { day, cost: findDay(days, day)?.cost ?? 0, today: day === key };
  });
  const top = Math.max(...costs.map(c => c.cost));
  const week = costs.map(c => ({ day: c.day, today: c.today, h: c.cost > 0 ? Math.max(1, Math.round((c.cost / top) * USAGE_BAR)) : 0 }));
  const b = activeBlock(usage, now);
  const block = b && {
    cost: money(b.cost), projected: b.projected === null ? null : dollars(b.projected),
    percent: Math.min(100, Math.max(0, ((now - b.start) / (b.end - b.start)) * 100)), left: `${leftText(b.end - now)} 남음`,
  };
  const month = days ? dollars(days.filter(d => d.day.startsWith(key.slice(0, 7))).reduce((sum, d) => sum + d.cost, 0)) : "—";
  return { age: ageText(refreshed === null ? null : now - refreshed), block, week, today: days ? dollars(today?.cost ?? 0) : "—", models: modelsText(today), month };
}
