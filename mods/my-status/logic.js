// Pure helpers for my-status. No herdr or gpui imports, so `node --test` can load this file.

const KB_PER_GB = 1048576, HOT = 90, HIDE_AFTER = 3;

/** One PowerShell run printing "METRICS<TAB>cpu<TAB>ramUsedKb<TAB>ramTotalKb<TAB>gpu"; an unreadable value stays blank. */
export function metricsCommand() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$cpu = ''; $used = ''; $total = ''; $gpu = ''",
    "try { $cpu = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime } catch {}",
    "try { $o = Get-CimInstance Win32_OperatingSystem; $total = $o.TotalVisibleMemorySize; $used = $total - $o.FreePhysicalMemory } catch {}",
    // Each engine type's total, and the busiest type: what Task Manager's GPU figure is close to.
    "try { $g = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine); if ($g.Count) { " +
      "$gpu = ($g | Group-Object { $_.Name -replace '^.*engtype_', '' } | ForEach-Object { ($_.Group | Measure-Object UtilizationPercentage -Sum).Sum } | Measure-Object -Maximum).Maximum } } catch {}",
    "\"METRICS`t$cpu`t$used`t$total`t$gpu\"",
  ].join("; ");
  return { command: "powershell", args: ["-NoProfile", "-Command", script] };
}

function number(s, max) {
  if (s === undefined || String(s).trim() === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return max === undefined ? n : Math.min(n, max);
}

/** metricsCommand's output → values, or null when neither CPU nor RAM could be read. */
export function parseMetrics(stdout) {
  const line = String(stdout ?? "").split(/\r?\n/).find(l => l.startsWith("METRICS\t"));
  if (!line) return null;
  const f = line.split("\t");
  const cpu = number(f[1], 100), used = number(f[2]), total = number(f[3]), gpu = number(f[4], 100);
  const ram = used !== null && total !== null && total > 0 && used <= total;
  if (cpu === null && !ram) return null;
  return { cpu, ramUsed: ram ? used / KB_PER_GB : null, ramTotal: ram ? total / KB_PER_GB : null, gpu };
}

export const isHot = percent => typeof percent === "number" && percent >= HOT;

export function ramPercent(m) {
  return typeof m?.ramUsed === "number" && m.ramTotal > 0 ? (m.ramUsed / m.ramTotal) * 100 : null;
}

export const emptyHistory = () => ({ cpu: [], ram: [], gpu: [] });

/** Adds one sample (null: a blank) of percentages, dropping the oldest past the limit. */
export function pushHistory(history, metrics, limit = 60) {
  const add = (list, value) => [...list, value ?? null].slice(-limit);
  return { cpu: add(history.cpu, metrics?.cpu), ram: add(history.ram, ramPercent(metrics)), gpu: add(history.gpu, metrics?.gpu) };
}

/** Counts failures in a row; the figures hide from the third on. */
export function failStep(state, ok) {
  if (ok) return { fails: 0, hidden: false };
  const fails = state.fails + 1;
  return { fails, hidden: fails >= HIDE_AFTER };
}

/** The status bar's items, in order. */
export function summaryParts(metrics, remote) {
  if (!metrics) return [];
  const parts = remote ? [{ label: "이 PC", value: "", hot: false }] : [];
  if (metrics.cpu !== null) parts.push({ label: "CPU", value: `${Math.round(metrics.cpu)}%`, hot: isHot(metrics.cpu) });
  if (metrics.ramUsed !== null) parts.push({ label: "RAM", value: `${metrics.ramUsed.toFixed(1)}/${metrics.ramTotal.toFixed(1)}GB`, hot: isHot(ramPercent(metrics)) });
  if (metrics.gpu !== null) parts.push({ label: "GPU", value: `${Math.round(metrics.gpu)}%`, hot: isHot(metrics.gpu) });
  return parts;
}

/** Percentages → bar heights in px. Any value shows at least 1 px; a blank shows nothing. */
export function barHeights(values, height) {
  return values.map(v => (v === null || v === undefined ? 0 : Math.max(1, Math.round((v / 100) * height))));
}

const bars = (values, height) => {
  const heights = barHeights(values, height);
  return values.map((v, i) => ({ h: heights[i], hot: isHot(v) }));
};

/** The dashboard's rows: everything my-status-dash draws. GPU only once it has been read. */
export function dashRows(metrics, history, barHeight) {
  const percent = v => (typeof v === "number" ? `${Math.round(v)}%` : "—");
  const ram = typeof metrics?.ramUsed === "number" ? `${metrics.ramUsed.toFixed(1)} / ${metrics.ramTotal.toFixed(1)} GB` : "—";
  const rows = [
    { key: "cpu", label: "CPU", value: percent(metrics?.cpu), hot: isHot(metrics?.cpu), bars: bars(history.cpu, barHeight) },
    { key: "ram", label: "RAM", value: ram, hot: isHot(ramPercent(metrics)), bars: bars(history.ram, barHeight) },
  ];
  if (typeof metrics?.gpu === "number" || history.gpu.some(v => v !== null)) {
    rows.push({ key: "gpu", label: "GPU", value: percent(metrics?.gpu), hot: isHot(metrics?.gpu), bars: bars(history.gpu, barHeight) });
  }
  return rows;
}

/** The dashboard's height for its rows: title + rows + footer. */
export const dashHeight = rowCount => 40 + rowCount * 58 + 30;

const MARGIN = 14, GAP = 6, EDGE = 8;

/** Where the dashboard opens: above the bar, at its right end, on screen. Null until the bar was measured. */
export function dashAnchor(bounds, size) {
  if (!bounds) return null;
  return {
    x: Math.max(EDGE, bounds.x + bounds.width - size.width - MARGIN),
    y: Math.max(EDGE, bounds.y - size.height - GAP),
  };
}
