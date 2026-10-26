import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { Badge, Card, PageTitle } from "../components/ui";
import DependencyGraphView from "../features/services/DependencyGraph";
import { formatDuration, formatPercent, formatTimestamp } from "../lib/formatting";

export default function ServicesPage() {
  const { provider, range, refreshTick } = useAppState();
  const q = useQuery({ queryKey: ["services", range.start, range.end, refreshTick], queryFn: () => provider.getServices({ start: range.start, end: range.end }) });
  const deps = useQuery({ queryKey: ["deps", range.start, range.end, refreshTick], queryFn: () => provider.getDependencies({ start: range.start, end: range.end }) });
  return (
    <div>
      <PageTitle title="Services" subtitle="Services are discovered from observed telemetry (server spans), not from a predefined list." />
      <DataState isLoading={q.isLoading} isError={q.isError} error={q.error} data={q.data} onRetry={() => q.refetch()} empty={(d) => d.length === 0}>
        {(d) => (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{d.map((s) => (
              <Link key={s.service_name} to={`/services/${encodeURIComponent(s.service_name)}`} className="rounded-xl border border-zinc-200 bg-white p-4 hover:border-teal-500 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between"><h2 className="font-semibold">{s.service_name}</h2>{s.threshold_status === "breach" ? <Badge tone="error">Breach</Badge> : s.threshold_status === "ok" ? <Badge tone="ok">Healthy</Badge> : <Badge>Unknown</Badge>}</div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><dt className="text-xs text-zinc-500">Requests</dt><dd>{s.request_count}</dd></div><div><dt className="text-xs text-zinc-500">Errors</dt><dd>{s.error_count}</dd></div><div><dt className="text-xs text-zinc-500">Error rate</dt><dd>{formatPercent(s.error_rate)}</dd></div><div><dt className="text-xs text-zinc-500">P95 latency</dt><dd>{formatDuration(s.p95_ns)}</dd></div></dl>
                <p className="mt-2 text-xs text-zinc-500">Last seen {formatTimestamp(s.last_seen)}</p>
              </Link>))}
            </div>
            <Card title="Service dependency map">
              {deps.isLoading ? <p className="text-sm text-zinc-500">Loading map...</p> : deps.isError ? <p className="text-sm text-red-500">Map failed to load.</p> : deps.data ? <DependencyGraphView graph={deps.data} /> : null}
            </Card>
          </div>
        )}
      </DataState>
    </div>
  );
}
