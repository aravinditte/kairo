import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Play, FlaskConical } from "lucide-react";
import { useAppState } from "../app/providers";
import { DataState, EmptyState } from "../components/feedback";
import { Badge, Card, PageTitle, TraceLink, btnCls } from "../components/ui";
import { formatDuration, formatTimestamp } from "../lib/formatting";

export default function ScenarioDetailPage() {
  const { scenarioId = "" } = useParams();
  const { provider, mode } = useAppState();

  const defs = useQuery({ queryKey: ["scenarios"], queryFn: () => provider.listScenarios() });
  const runs = useQuery({
    queryKey: ["scenario-runs", scenarioId],
    queryFn: () => provider.listScenarioRuns(scenarioId),
  });

  const def = defs.data?.find((d) => d.id === scenarioId);

  return (
    <div className="space-y-6">
      <Link
        to="/failure-lab"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        <span>Back to Failure Lab</span>
      </Link>

      <PageTitle
        title={def?.name ?? "Scenario Specification"}
        subtitle={
          mode === "demo"
            ? "Simulated deterministically in your browser. Real services remain untouched."
            : "Executed against isolated microservices in the local cluster."
        }
        actions={
          <Link to="/failure-lab" className={btnCls}>
            <Play className="size-3.5 fill-current" />
            <span>Launch in Failure Lab</span>
          </Link>
        }
      />

      {defs.isLoading ? (
        <DataState isLoading isError={false} error={null} data={undefined}>
          {() => null}
        </DataState>
      ) : defs.isError ? (
        <DataState isLoading={false} isError error={defs.error} data={undefined}>
          {() => null}
        </DataState>
      ) : !def ? (
        <EmptyState title="Scenario Not Found">
          No scenario recipe with ID <span className="mono">{scenarioId}</span> exists.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <Card title="Scenario Specification & Injected Behavior">
            <p className="text-sm text-foreground/90">{def.description}</p>
            <div className="mt-5 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Configurable Parameters
              </h3>
              {def.parameters.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Baseline healthy workload: no failure parameters configured.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {def.parameters.map((p) => (
                    <div
                      key={p.key}
                      className="rounded-lg border border-border bg-muted/20 p-3 text-xs"
                    >
                      <span className="font-semibold text-foreground">{p.label}</span>
                      <p className="mt-1 text-muted-foreground">
                        Range: {p.min} to {p.max} {p.unit} • Default: {p.default} {p.unit}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card
            title="Execution History & Results"
            subtitle="Previous runs of this scenario in the active session"
          >
            {(runs.data ?? []).length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No runs recorded for this scenario yet. Trigger it from the Failure Lab to inspect live outcomes.
              </p>
            ) : (
              <div className="divide-y divide-border/40">
                {(runs.data ?? []).map((r) => (
                  <div key={r.id} className="py-3 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="mono text-muted-foreground">{formatTimestamp(r.started_at)}</span>
                        <Badge tone={r.status === "completed" ? "ok" : "neutral"}>
                          {r.status}
                        </Badge>
                      </div>
                      {r.result_summary && (
                        <div className="flex items-center gap-3">
                          <span>{r.result_summary.requests} req</span>
                          <span className={r.result_summary.failed > 0 ? "text-red-500 font-medium" : ""}>
                            {r.result_summary.failed} failed
                          </span>
                          <span className="mono font-semibold">
                            P95: {formatDuration(r.result_summary.p95_ns)}
                          </span>
                        </div>
                      )}
                    </div>
                    {r.result_summary && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-muted-foreground">Traces:</span>
                        {r.result_summary.trace_ids.slice(0, 5).map((id) => (
                          <TraceLink key={id} traceId={id} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
