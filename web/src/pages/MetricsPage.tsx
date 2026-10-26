import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { Card, inputCls, PageTitle } from "../components/ui";
import { ErrorBarChart, LatencyChart, RequestVolumeChart } from "../features/charts";
import { formatDuration, formatPercent, formatRate } from "../lib/formatting";

export default function MetricsPage() {
  const { provider, range, refreshTick } = useAppState();
  const [service, setService] = useState(""); const [operation, setOperation] = useState(""); const [interval, setInterval] = useState(300);
  const services = useQuery({ queryKey: ["svc-names", range.start, refreshTick], queryFn: () => provider.getServices({ start: range.start, end: range.end }) });
  const q = useQuery({ queryKey: ["metrics", range.start, range.end, service, operation, interval, refreshTick], queryFn: () => provider.getMetrics({ start: range.start, end: range.end, service: service || undefined, operation: operation || undefined, interval_seconds: interval }) });
  return (
    <div>
      <PageTitle title="Metrics - RED" subtitle="Rate, Errors, Duration derived from stored spans. A request is a server span (span_kind = 2); client/internal spans are excluded so one logical request is not double-counted per service." />
      <div className="mb-4 flex flex-wrap gap-2">
        <label className="text-xs text-zinc-500">Service<select className={inputCls} value={service} onChange={(e) => setService(e.target.value)}><option value="">All services</option>{(services.data ?? []).map((s) => <option key={s.service_name} value={s.service_name}>{s.service_name}</option>)}</select></label>
        <label className="text-xs text-zinc-500">Operation contains<input className={inputCls} value={operation} onChange={(e) => setOperation(e.target.value)} placeholder="optional" /></label>
        <label className="text-xs text-zinc-500">Aggregation interval<select className={inputCls} value={interval} onChange={(e) => setInterval(Number(e.target.value))}><option value={60}>1 minute</option><option value={300}>5 minutes</option><option value={900}>15 minutes</option><option value={3600}>1 hour</option></select></label>
      </div>
      <DataState isLoading={q.isLoading} isError={q.isError} error={q.error} data={q.data} onRetry={() => q.refetch()}>
        {(d) => d.request_count === 0 ? <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">No samples in this window for the selected filters. Percentiles are reported as No data rather than zero when there are no samples.</p> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {([["Requests", String(d.request_count)], ["Request rate", formatRate(d.request_rate_per_sec)], ["Error rate", `${formatPercent(d.error_rate)} (${d.error_count} errors)`], ["P50 / P95 / P99", `${formatDuration(d.p50_ns)} / ${formatDuration(d.p95_ns)} / ${formatDuration(d.p99_ns)}`]] as const).map(([k, v]) => (<div key={k} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><p className="text-xs uppercase text-zinc-500">{k}</p><p className="mt-1 text-lg font-bold">{v}</p></div>))}
            </div>
            <p className="text-xs text-zinc-500">Window {d.window.start} to {d.window.end}, interval {d.interval_seconds}s. Calculation basis: {d.classification_note}</p>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card title="Request rate and errors (counts per bucket)"><RequestVolumeChart series={d.series} /></Card>
              <Card title="Duration percentiles (ms)"><LatencyChart series={d.series} /></Card>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card title="Slow operations (by p95)"><table className="w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">Operation</th><th>Service</th><th>Count</th><th>P95</th></tr></thead><tbody>{d.slow_operations.map((o) => (<tr key={`${o.service}-${o.operation}`} className="border-t border-zinc-100 dark:border-zinc-800"><td>{o.operation}</td><td>{o.service}</td><td>{o.count}</td><td>{formatDuration(o.p95_ns)}</td></tr>))}</tbody></table></Card>
              <Card title="Errors by service"><ErrorBarChart data={d.errors_by_service} />{d.errors_by_service.length === 0 && <p className="text-sm text-zinc-500">No errors in this window.</p>}</Card>
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}
