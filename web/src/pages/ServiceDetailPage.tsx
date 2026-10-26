import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useAppState } from "../app/providers";
import { DataState, EmptyState } from "../components/feedback";
import { Badge, Card, PageTitle, TraceLink } from "../components/ui";
import { formatDuration, formatPercent, formatTimestamp } from "../lib/formatting";

export default function ServiceDetailPage() {
  const { serviceName = "" } = useParams();
  const name = decodeURIComponent(serviceName);
  const { provider, range, refreshTick } = useAppState();
  const q = useQuery({ queryKey: ["service", name, range.start, range.end, refreshTick], queryFn: () => provider.getService(name, { start: range.start, end: range.end }) });
  const alerts = useQuery({ queryKey: ["alerts-for-service", refreshTick], queryFn: () => provider.getAlerts({ limit: 50 }) });
  if (!q.isLoading && !q.isError && q.data === null) return <div><PageTitle title={name} /><EmptyState title="Service not observed">No server spans for this service in the selected window for this project.</EmptyState></div>;
  return (
    <div>
      <PageTitle title={name} subtitle="Service detail derived from observed server spans in the selected window." />
      <DataState isLoading={q.isLoading} isError={q.isError} error={q.error} data={q.data ?? undefined} onRetry={() => q.refetch()}>
        {(d) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {([["Requests", String(d.summary.request_count)], ["Errors", String(d.summary.error_count)], ["Error rate", formatPercent(d.summary.error_rate)], ["P50", formatDuration(d.summary.p50_ns)], ["P95 / P99", `${formatDuration(d.summary.p95_ns)} / ${formatDuration(d.summary.p99_ns)}`]] as const).map(([k, v]) => (<div key={k} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><p className="text-xs uppercase text-zinc-500">{k}</p><p className="mt-1 text-xl font-bold">{v}</p></div>))}
            </div>
            <p className="text-sm text-zinc-500">Threshold status: {d.summary.threshold_status === "breach" ? <Badge tone="error">Breach</Badge> : d.summary.threshold_status === "ok" ? <Badge tone="ok">Healthy</Badge> : <Badge>Unknown</Badge>} - last seen {formatTimestamp(d.summary.last_seen)}</p>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card title="Operations"><table className="w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">Operation</th><th>Count</th><th>Errors</th><th>P95</th></tr></thead><tbody>{d.operations.map((o) => (<tr key={o.operation} className="border-t border-zinc-100 dark:border-zinc-800"><td>{o.operation}</td><td>{o.count}</td><td>{o.error_count}</td><td>{formatDuration(o.p95_ns)}</td></tr>))}</tbody></table></Card>
              <Card title="Recent traces"><table className="w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">Start</th><th>Operation</th><th>Duration</th><th>Status</th><th>Trace</th></tr></thead><tbody>{d.recent_traces.map((t) => (<tr key={t.trace_id} className="border-t border-zinc-100 dark:border-zinc-800"><td>{formatTimestamp(t.start_time)}</td><td>{t.root_operation}</td><td>{formatDuration(t.duration_ns)}</td><td>{t.has_error ? <Badge tone="error">Error</Badge> : <Badge tone="ok">OK</Badge>}</td><td><TraceLink traceId={t.trace_id} /></td></tr>))}</tbody></table></Card>
              <Card title="Incoming dependencies (callers)">{d.incoming.length === 0 ? <p className="text-sm text-zinc-500">None observed.</p> : d.incoming.map((e) => <p key={e.source} className="text-sm"><Link className="text-teal-700 hover:underline dark:text-teal-300" to={`/services/${encodeURIComponent(e.source)}`}>{e.source}</Link> - {e.request_count} requests, {formatPercent(e.error_rate)} errors, p95 {formatDuration(e.p95_ns)}</p>)}</Card>
              <Card title="Outgoing dependencies (callees)">{d.outgoing.length === 0 ? <p className="text-sm text-zinc-500">None observed.</p> : d.outgoing.map((e) => <p key={e.target} className="text-sm"><Link className="text-teal-700 hover:underline dark:text-teal-300" to={`/services/${encodeURIComponent(e.target)}`}>{e.target}</Link> - {e.request_count} requests, {formatPercent(e.error_rate)} errors, p95 {formatDuration(e.p95_ns)}</p>)}</Card>
            </div>
            <Card title="Threshold events for this service">{(alerts.data ?? []).filter((a) => a.service_name === name).length === 0 ? <p className="text-sm text-zinc-500">No threshold events recorded for this service.</p> : (alerts.data ?? []).filter((a) => a.service_name === name).map((a) => <p key={a.id} className="text-sm">{formatTimestamp(a.created_at)} - {a.rule_type}: observed {a.observed_value} vs threshold {a.threshold_value}</p>)}</Card>
          </div>
        )}
      </DataState>
    </div>
  );
}
