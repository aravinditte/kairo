import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Server, ArrowRight, Network } from "lucide-react";
import { useAppState } from "../app/providers";
import { useI18n } from "../lib/i18n";
import { DataState } from "../components/feedback";
import { Badge, Card, PageTitle } from "../components/ui";
import DependencyGraphView from "../features/services/DependencyGraph";
import { formatDuration, formatPercent, formatTimestamp } from "../lib/formatting";

export default function ServicesPage() {
  const { provider, range, refreshTick } = useAppState();
  const { t } = useI18n();

  const q = useQuery({
    queryKey: ["services", range.start, range.end, refreshTick],
    queryFn: () => provider.getServices({ start: range.start, end: range.end }),
  });

  const deps = useQuery({
    queryKey: ["deps", range.start, range.end, refreshTick],
    queryFn: () => provider.getDependencies({ start: range.start, end: range.end }),
  });

  return (
    <div className="space-y-6">
      <PageTitle
        title={t.services.title}
        subtitle={t.services.subtitle}
      />

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        data={q.data}
        onRetry={() => q.refetch()}
        empty={(d) => d.length === 0}
      >
        {(d) => (
          <div className="space-y-6">
            {/* Service Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {d.map((s) => (
                <Link
                  key={s.service_name}
                  to={`/services/${encodeURIComponent(s.service_name)}`}
                  className="group flex flex-col justify-between rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs transition-all hover:border-blue-500/50 hover:shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground group-hover:text-blue-500">
                          <Server className="size-4" />
                        </div>
                        <h2 className="text-sm font-semibold text-foreground group-hover:text-blue-500">
                          {s.service_name}
                        </h2>
                      </div>
                      {s.threshold_status === "breach" ? (
                        <Badge tone="error">Breach</Badge>
                      ) : s.threshold_status === "ok" ? (
                        <Badge tone="ok">Healthy</Badge>
                      ) : (
                        <Badge tone="neutral">Unknown</Badge>
                      )}
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border border-border/40 bg-muted/20 p-2">
                        <dt className="text-muted-foreground">Requests</dt>
                        <dd className="font-mono text-sm font-semibold text-foreground">{s.request_count}</dd>
                      </div>
                      <div className="rounded-md border border-border/40 bg-muted/20 p-2">
                        <dt className="text-muted-foreground">Errors</dt>
                        <dd className="font-mono text-sm font-semibold text-foreground">{s.error_count}</dd>
                      </div>
                      <div className="rounded-md border border-border/40 bg-muted/20 p-2">
                        <dt className="text-muted-foreground">Error Rate</dt>
                        <dd className="font-mono text-sm font-semibold text-foreground">{formatPercent(s.error_rate)}</dd>
                      </div>
                      <div className="rounded-md border border-border/40 bg-muted/20 p-2">
                        <dt className="text-muted-foreground">P95 Latency</dt>
                        <dd className="font-mono text-sm font-semibold text-foreground">{formatDuration(s.p95_ns)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                    <span>Seen {formatTimestamp(s.last_seen)}</span>
                    <span className="inline-flex items-center gap-1 font-medium text-blue-600 group-hover:underline dark:text-blue-400">
                      <span>Inspect</span>
                      <ArrowRight className="size-3" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>

            {/* Dependency Map Section */}
            <div id="dependencies">
              <Card
                title="Service Dependency Topology"
                subtitle="Directional service graph derived from caller-callee span hierarchies"
              >
                {deps.isLoading ? (
                  <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                    Loading topology...
                  </div>
                ) : deps.isError ? (
                  <div className="p-4 text-xs text-red-500">Failed to render dependency topology.</div>
                ) : deps.data ? (
                  <DependencyGraphView graph={deps.data} height={420} />
                ) : null}
              </Card>
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}
