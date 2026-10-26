export function formatDuration(ns: number | null | undefined): string {
  if (ns === null || ns === undefined || Number.isNaN(ns)) return "No data";
  if (ns < 1000) return `${Math.round(ns)} ns`;
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(1)} us`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(ns < 10_000_000 ? 2 : 1)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}
export function durationMs(ns: number | null | undefined): number | null {
  if (ns === null || ns === undefined) return null; return ns / 1_000_000;
}
export function formatPercent(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "No data";
  return `${(rate * 100).toFixed(digits)}%`;
}
export function formatRate(v: number | null | undefined): string {
  if (v === null || v === undefined) return "No data"; return `${v.toFixed(2)} req/s`;
}
export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined) return "No data"; return new Intl.NumberFormat("en-US").format(v);
}
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "No data";
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "No data"; const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function shortId(id: string, n = 12): string { return id.length > n ? id.slice(0, n) + "..." : id; }
export function nsFromMs(ms: string): number | undefined { const v = Number(ms); return ms.trim() === "" || Number.isNaN(v) || v < 0 ? undefined : Math.round(v * 1_000_000); }
