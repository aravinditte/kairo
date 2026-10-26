import type { AlertEvent, DependencyEdge, MetricBucket, OverviewData, RedMetrics, ServiceSummary, Span, Thresholds, TraceSummary } from "../types";

export const CLASSIFICATION_NOTE = "A request is a span with span_kind = server (2). Client and internal spans are not counted as requests, so one logical request is counted once per receiving service.";
export const DEFAULT_THRESHOLDS: Thresholds = { p95_latency_ms: 500, error_rate_percent: 5 };

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
export function isServer(s: Span) { return s.span_kind === 2; }
export function inWindow(t: string, start: string, end: string) { const x = Date.parse(t); return x >= Date.parse(start) && x <= Date.parse(end); }

export function summarizeTrace(traceId: string, spans: Span[]): TraceSummary {
  const sorted = [...spans].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const ids = new Set(spans.map((s) => s.span_id));
  const roots = sorted.filter((s) => !s.parent_span_id || !ids.has(s.parent_span_id));
  const root = roots.find((s) => isServer(s)) ?? roots[0] ?? sorted[0];
  const start = sorted[0].start_time;
  const endMs = Math.max(...spans.map((s) => Date.parse(s.end_time)));
  const errors = spans.filter((s) => s.status_code === "error");
  const firstError = errors[0];
  return {
    trace_id: traceId, root_operation: root.operation_name, root_service: root.service_name, start_time: start,
    duration_ns: Math.max(0, (endMs - Date.parse(start)) * 1_000_000), span_count: spans.length,
    error_count: errors.length, has_error: errors.length > 0,
    error_summary: firstError ? (firstError.status_message || `${firstError.service_name} ${firstError.operation_name} failed`) : null,
    incomplete: spans.some((s) => !!s.parent_span_id && !ids.has(s.parent_span_id)),
  };
}
export function groupTraces(spans: Span[]): Map<string, Span[]> {
  const m = new Map<string, Span[]>();
  for (const s of spans) { const a = m.get(s.trace_id) ?? []; a.push(s); m.set(s.trace_id, a); }
  return m;
}
export function traceSummaries(spans: Span[]): TraceSummary[] {
  return [...groupTraces(spans).entries()].map(([id, ss]) => summarizeTrace(id, ss)).sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time) || b.trace_id.localeCompare(a.trace_id));
}
export function computeServices(spans: Span[], thresholds: Thresholds = DEFAULT_THRESHOLDS): ServiceSummary[] {
  const byService = new Map<string, Span[]>();
  for (const s of spans.filter(isServer)) { const a = byService.get(s.service_name) ?? []; a.push(s); byService.set(s.service_name, a); }
  return [...byService.entries()].map(([name, ss]) => {
    const durations = ss.map((s) => s.duration_ns);
    const errors = ss.filter((s) => s.status_code === "error").length;
    const rate = ss.length ? errors / ss.length : 0;
    const p95 = percentile(durations, 95);
    const breach = (p95 !== null && p95 / 1_000_000 > thresholds.p95_latency_ms) || rate * 100 > thresholds.error_rate_percent;
    return {
      service_name: name, request_count: ss.length, error_count: errors, error_rate: rate,
      p50_ns: percentile(durations, 50), p95_ns: p95, p99_ns: percentile(durations, 99),
      last_seen: ss.map((s) => s.start_time).sort().at(-1) ?? null,
      threshold_status: ss.length === 0 ? "unknown" as const : breach ? "breach" as const : "ok" as const,
    };
  }).sort((a, b) => a.service_name.localeCompare(b.service_name));
}
export function computeDependencies(spans: Span[]): DependencyEdge[] {
  const byId = new Map(spans.map((s) => [`${s.trace_id}:${s.span_id}`, s]));
  const edges = new Map<string, { durations: number[]; errors: number }>();
  for (const s of spans) {
    if (!s.parent_span_id) continue;
    const parent = byId.get(`${s.trace_id}:${s.parent_span_id}`);
    if (!parent || parent.service_name === s.service_name) continue;
    // Observed cross-service parent-child link (client span -> child server span, or direct parent chain).
    if (!isServer(s) && parent.span_kind !== 3) continue;
    const key = `${parent.service_name}->${s.service_name}`;
    const e = edges.get(key) ?? { durations: [], errors: 0 };
    e.durations.push(s.duration_ns); if (s.status_code === "error") e.errors++;
    edges.set(key, e);
  }
  return [...edges.entries()].map(([key, e]) => {
    const [source, target] = key.split("->");
    return { source, target, request_count: e.durations.length, error_count: e.errors, error_rate: e.durations.length ? e.errors / e.durations.length : 0, avg_duration_ns: e.durations.reduce((a, b) => a + b, 0) / Math.max(1, e.durations.length), p95_ns: percentile(e.durations, 95) };
  }).sort((a, b) => b.request_count - a.request_count);
}
export function computeSeries(spans: Span[], start: string, end: string, intervalSeconds: number): MetricBucket[] {
  const startMs = Date.parse(start), endMs = Date.parse(end);
  const buckets = new Map<number, Span[]>();
  const n = Math.max(1, Math.ceil((endMs - startMs) / (intervalSeconds * 1000)));
  for (let i = 0; i < n; i++) buckets.set(startMs + i * intervalSeconds * 1000, []);
  for (const s of spans.filter(isServer)) {
    const idx = Math.floor((Date.parse(s.start_time) - startMs) / (intervalSeconds * 1000));
    const key = startMs + idx * intervalSeconds * 1000;
    if (buckets.has(key)) buckets.get(key)!.push(s);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, ss]) => {
    const d = ss.map((s) => s.duration_ns);
    return { bucket_start: new Date(k).toISOString(), request_count: ss.length, error_count: ss.filter((s) => s.status_code === "error").length, p50_ns: percentile(d, 50), p95_ns: percentile(d, 95), p99_ns: percentile(d, 99) };
  });
}
export function computeRED(spans: Span[], q: { start: string; end: string; interval_seconds?: number; service?: string; operation?: string }): RedMetrics {
  const interval = q.interval_seconds ?? 300;
  let req = spans.filter((s) => isServer(s) && inWindow(s.start_time, q.start, q.end));
  if (q.service) req = req.filter((s) => s.service_name === q.service);
  const op = q.operation; if (op) req = req.filter((s) => s.operation_name.toLowerCase().includes(op.toLowerCase()));
  const durations = req.map((s) => s.duration_ns);
  const errors = req.filter((s) => s.status_code === "error").length;
  const windowSeconds = Math.max(1, (Date.parse(q.end) - Date.parse(q.start)) / 1000);
  const ops = new Map<string, number[]>();
  for (const s of req) { const k = `${s.service_name}|${s.operation_name}`; const a = ops.get(k) ?? []; a.push(s.duration_ns); ops.set(k, a); }
  const errBySvc = new Map<string, number>();
  for (const s of req.filter((s) => s.status_code === "error")) errBySvc.set(s.service_name, (errBySvc.get(s.service_name) ?? 0) + 1);
  return {
    window: { start: q.start, end: q.end }, interval_seconds: interval, service: q.service ?? null,
    request_count: req.length, error_count: errors, error_rate: req.length ? errors / req.length : 0,
    request_rate_per_sec: req.length / windowSeconds,
    p50_ns: percentile(durations, 50), p95_ns: percentile(durations, 95), p99_ns: percentile(durations, 99),
    series: computeSeries(req, q.start, q.end, interval),
    slow_operations: [...ops.entries()].map(([k, d]) => { const [service, operation] = k.split("|"); return { operation, service, count: d.length, p95_ns: percentile(d, 95) ?? 0 }; }).sort((a, b) => b.p95_ns - a.p95_ns).slice(0, 10),
    errors_by_service: [...errBySvc.entries()].map(([service, error_count]) => ({ service, error_count })).sort((a, b) => b.error_count - a.error_count),
    classification_note: CLASSIFICATION_NOTE,
  };
}
export function computeOverview(spans: Span[], q: { start: string; end: string; interval_seconds?: number }, projectId: string, thresholds: Thresholds = DEFAULT_THRESHOLDS): OverviewData {
  const inWin = spans.filter((s) => inWindow(s.start_time, q.start, q.end));
  const red = computeRED(spans, { start: q.start, end: q.end, interval_seconds: q.interval_seconds ?? 300 });
  const has = red.request_count > 0;
  const summaries = traceSummaries(inWin);
  const recentErrors = inWin.filter((s) => s.status_code === "error").sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time)).slice(0, 10)
    .map((s) => ({ time: s.start_time, service: s.service_name, operation: s.operation_name, trace_id: s.trace_id, duration_ns: s.duration_ns, error_summary: s.status_message || "Span reported an error" }));
  return {
    project_id: projectId, window: { start: q.start, end: q.end },
    kpis: { total_requests: has ? red.request_count : null, requests_per_sec: has ? red.request_rate_per_sec : null, error_rate: has ? red.error_rate : null, p95_ns: has ? red.p95_ns : null },
    series: red.series, services: computeServices(inWin, thresholds), recent_errors: recentErrors, recent_traces: summaries.slice(0, 10),
  };
}
export function computeAlerts(services: ServiceSummary[], spans: Span[], projectId: string, thresholds: Thresholds, window: { start: string; end: string }): AlertEvent[] {
  const alerts: AlertEvent[] = [];
  for (const svc of services) {
    if (svc.p95_ns !== null && svc.p95_ns / 1_000_000 > thresholds.p95_latency_ms)
      alerts.push({ id: `alert-${svc.service_name}-p95`, project_id: projectId, service_name: svc.service_name, rule_type: "p95_latency", observed_value: Math.round(svc.p95_ns / 1_000_000), threshold_value: thresholds.p95_latency_ms, window_start: window.start, window_end: window.end, created_at: svc.last_seen ?? window.end, status: "active" });
    if (svc.request_count > 0 && svc.error_rate * 100 > thresholds.error_rate_percent)
      alerts.push({ id: `alert-${svc.service_name}-err`, project_id: projectId, service_name: svc.service_name, rule_type: "error_rate", observed_value: Math.round(svc.error_rate * 1000) / 10, threshold_value: thresholds.error_rate_percent, window_start: window.start, window_end: window.end, created_at: svc.last_seen ?? window.end, status: "active" });
  }
  void spans;
  return alerts.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
