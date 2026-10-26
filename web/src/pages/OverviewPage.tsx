import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { Badge, Card, PageTitle, TraceLink } from "../components/ui";
import { LatencyChart, RequestVolumeChart } from "../features/charts";
import DependencyGraphView from "../features/services/DependencyGraph";
import { formatDuration, formatNumber, formatPercent, formatRate, formatTimestamp } from "../lib/formatting";

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p><p className="text-xs text-zinc-500">{hint}</p></div>;
}
export default function OverviewPage() {
  const { provider, range, refreshTick, mode } = useAppState();
  const q = useQuery({ queryKey: ["overview", range.start, range.end, refreshTick], queryFn: () => provider.getOverview({ start: range.start, end: range.end, interval_seconds: range.minutes >= 1440 ? 3600 : 300 }) });
  const deps = useQuery({ queryKey: ["deps-preview", range.start, range.end, refreshTick], queryFn: () => provider.getDependencies({ start: range.start, end: range.end }) });
  return (
    <div>
      <PageTitle title="Overview" subtitle={`Project window: last ${range.label}. A request is a server span (span_kind = 2), so each logical request is counted once per receiving service.`} />
      <DataState isLoading={q.isLoading} isError={q.isError} error={q.error} data={q.data} onRetry={() => q.refetch()} empty={(d) => d.kpis.total_requests === null}>
        {(d) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label="Total requests" value={formatNumber(d.kpis.total_requests)} hint={`In the selected ${range.label} window`} />
              <Kpi label="Requests / sec" value={formatRate(d.kpis.requests_per_sec)} hint="Average over the window" />
              <Kpi label="Error rate" value={formatPercent(d.kpis.error_rate)} hint="Share of server spans with error status" />
              <Kpi label="P95 latency" value={formatDuration(d.kpis.p95_ns)} hint="95th percentile server-span duration" />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card title="Request volume and errors"><RequestVolumeChart series={d.series} /></Card>
              <Card title="Latency distribution (ms)"><LatencyChart series={d.series} /></Card>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card title="Service health">
                {d.services.length === 0 ? <p className="text-sm text-zinc-500">No services observed.</p> : (
                <table className="w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">Service</th><th>Requests</th><th>Error rate</th><th>P95</th><th>Status</th></tr></thead><tbody>{d.services.map((s) => (<tr key={s.service_name} className="border-t border-zinc-100 dark:border-zinc-800"><td><Link className="text-teal-700 hover:underline dark:text-teal-300" to={`/services/${encodeURIComponent(s.service_name)}`}>{s.service_name}</Link></td><td>{s.request_count}</td><td>{formatPercent(s.error_rate)}</td><td>{formatDuration(s.p95_ns)}</td><td>{s.threshold_status === "breach" ? <Badge tone="error">Breach</Badge> : s.threshold_status === "ok" ? <Badge tone="ok">Healthy</Badge> : <Badge>Unknown</Badge>}</td></tr>))}</tbody></table>)}
              </Card>
              <Card title="Recent errors">
                {d.recent_errors.length === 0 ? <p className="text-sm text-zinc-500">No errors in this window.</p> : (
                <table className="w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">Time</th><th>Service</th><th>Operation</th><th>Trace</th><th>Duration</th></tr></thead><tbody>{d.recent_errors.map((e, i) => (<tr key={i} className="border-t border-zinc-100 dark:border-zinc-800"><td className="whitespace-nowrap">{formatTimestamp(e.time)}</td><td>{e.service}</td><td className="max-w-[140px] truncate" title={e.error_summary}>{e.operation}</td><td><TraceLink traceId={e.trace_id} /></td><td>{formatDuration(e.duration_ns)}</td></tr>))}</tbody></table>)}
              </Card>
            </div>
            <Card title="Dependency map preview" action={<Link className="text-sm text-teal-700 hover:underline dark:text-teal-300" to="/services">Open services and map</Link>}>
              {deps.isLoading ? <p className="text-sm text-zinc-500">Loading dependency map...</p> : deps.isError ? <p className="text-sm text-red-500">Dependency map failed to load. Use the services page to retry.</p> : deps.data ? <DependencyGraphView graph={deps.data} height={300} /> : null}
            </Card>
            <Card title="Recent traces">
              <table className="w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">Start</th><th>Root operation</th><th>Service</th><th>Duration</th><th>Spans</th><th>Status</th><th>Trace ID</th></tr></thead><tbody>{d.recent_traces.map((t) => (<tr key={t.trace_id} className="border-t border-zinc-100 dark:border-zinc-800"><td className="whitespace-nowrap">{formatTimestamp(t.start_time)}</td><td>{t.root_operation}</td><td>{t.root_service}</td><td>{formatDuration(t.duration_ns)}</td><td>{t.span_count}</td><td>{t.has_error ? <Badge tone="error">Error</Badge> : <Badge tone="ok">OK</Badge>}</td><td><TraceLink traceId={t.trace_id} /></td></tr>))}</tbody></table>
            </Card>
            <p className="text-xs text-zinc-400">{mode === "demo" ? "Synthetic demo dataset. " : ""}Last refreshed for window ending {formatTimestamp(d.window.end)}.</p>
          </div>
        )}
      </DataState>
    </div>
  );
}
