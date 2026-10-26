import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useAppState } from "../app/providers";
import { DataState, EmptyState } from "../components/feedback";
import { Badge, Card, PageTitle, TraceLink } from "../components/ui";
import { formatDuration, formatTimestamp } from "../lib/formatting";

export default function ScenarioDetailPage() {
  const { scenarioId = "" } = useParams();
  const { provider, mode } = useAppState();
  const defs = useQuery({ queryKey: ["scenarios"], queryFn: () => provider.listScenarios() });
  const runs = useQuery({ queryKey: ["scenario-runs", scenarioId], queryFn: () => provider.listScenarioRuns(scenarioId) });
  const def = defs.data?.find((d) => d.id === scenarioId);
  return (
    <div>
      <PageTitle title={def?.name ?? "Scenario"} subtitle={mode === "demo" ? "Simulated in the browser in demo mode; executed against isolated demo services in live mode." : "Executed against the isolated demo services in live mode."} />
      {defs.isLoading ? <DataState isLoading isError={false} error={null} data={undefined}>{() => null}</DataState> : defs.isError ? <DataState isLoading={false} isError error={defs.error} data={undefined}>{() => null}</DataState> : !def ? <EmptyState title="Unknown scenario">No scenario definition with this ID exists.</EmptyState> : (
        <div className="space-y-4">
          <Card title="What this scenario does"><p className="text-sm text-zinc-600 dark:text-zinc-300">{def.description}</p>
            <h3 className="mt-3 text-sm font-semibold">Parameters</h3>{def.parameters.length === 0 ? <p className="text-sm text-zinc-500">No fault parameters - this scenario runs the healthy baseline workload.</p> : def.parameters.map((p) => <p key={p.key} className="text-sm">{p.label}: {p.min} to {p.max} {p.unit}, default {p.default} {p.unit}</p>)}
            <p className="mt-3 text-sm"><Link className="text-teal-700 hover:underline dark:text-teal-300" to="/failure-lab">Open in Failure Lab to run it</Link></p>
          </Card>
          <Card title="Runs and linked investigation results">
            {(runs.data ?? []).length === 0 ? <p className="text-sm text-zinc-500">No runs recorded for this scenario in this session yet.</p> : (runs.data ?? []).map((r) => (
              <div key={r.id} className="border-b border-zinc-100 py-3 text-sm last:border-0 dark:border-zinc-800">
                <p>{formatTimestamp(r.started_at)} - <Badge tone={r.status === "completed" ? "ok" : "neutral"}>{r.status}</Badge> - {r.result_summary ? `${r.result_summary.requests} requests, ${r.result_summary.failed} failed, p95 ${formatDuration(r.result_summary.p95_ns)}` : "no summary"}</p>
                {r.result_summary && <p className="mt-1">Traces: {r.result_summary.trace_ids.slice(0, 5).map((id) => <span key={id} className="mr-2"><TraceLink traceId={id} /></span>)}</p>}
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
