import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Server, Activity, AlertCircle, Clock, ArrowDownLeft, ArrowUpRight, FlaskConical } from "lucide-react";
import { useAppState } from "../app/providers";
import { useI18n } from "../lib/i18n";
import { DataState, EmptyState } from "../components/feedback";
import { Badge, Card, PageTitle, StatCard, TraceLink } from "../components/ui";
import { formatDuration, formatPercent, formatTimestamp } from "../lib/formatting";

const SCENARIO_FOR_SERVICE: Record<string, string> = {
  inventory: "slow-inventory",
  payment: "payment-errors",
  notifications: "notification-timeout",
  checkout: "cascading-failure",
};

export default function ServiceDetailPage() {
  const { serviceName = "" } = useParams();
  const name = decodeURIComponent(serviceName);
  const { provider, range, refreshTick } = useAppState();
  const { t } = useI18n();

  const faultScenario = SCENARIO_FOR_SERVICE[name.toLowerCase()] || "slow-inventory";

  const q = useQuery({
    queryKey: ["service", name, range.start, range.end, refreshTick],
    queryFn: () => provider.getService(name, { start: range.start, end: range.end }),
  });

  const alerts = useQuery({
    queryKey: ["alerts-for-service", refreshTick],
    queryFn: () => provider.getAlerts({ limit: 50 }),
  });

  if (!q.isLoading && !q.isError && q.data === null) {
    return (
      <div className="space-y-4">
        <Link
          to="/services"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Services</span>
        </Link>
        <PageTitle title={name} />
        <EmptyState title="Service Not Observed">
          No server spans recorded for <strong className="text-foreground">{name}</strong> in the
          selected time window for this project.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/services"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        <span>Back to Services</span>
      </Link>

      <PageTitle
        title={name}
        subtitle="Individual service telemetry profile, observed endpoints, callers, callees, and SLO threshold status."
        actions={
          <Link
            to={`/failure-lab?scenario=${faultScenario}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#F472B6]/40 bg-[#F472B6]/15 px-3 py-1.5 text-xs font-semibold text-[#F472B6] hover:bg-[#F472B6]/25 transition-colors"
          >
            <FlaskConical className="size-3.5" />
            <span>{t.services.simulateFault}</span>
          </Link>
        }
      />

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        data={q.data ?? undefined}
        onRetry={() => q.refetch()}
      >
        {(d) => (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard
                title="Requests"
                value={String(d.summary.request_count)}
                hint="Total server spans"
                icon={<Activity className="size-4" />}
              />
              <StatCard
                title="Errors"
                value={String(d.summary.error_count)}
                hint="Span errors"
                icon={<AlertCircle className="size-4" />}
              />
              <StatCard
                title="Error Rate"
                value={formatPercent(d.summary.error_rate)}
                hint="Failure percentage"
                trendDirection={d.summary.error_rate > 0.05 ? "down" : "neutral"}
                icon={<AlertCircle className="size-4" />}
              />
              <StatCard
                title="P50 Latency"
                value={formatDuration(d.summary.p50_ns)}
                hint="Median response time"
                icon={<Clock className="size-4" />}
              />
              <StatCard
                title="P95 / P99 Latency"
                value={`${formatDuration(d.summary.p95_ns)}`}
                hint={`P99: ${formatDuration(d.summary.p99_ns)}`}
                icon={<Clock className="size-4" />}
              />
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-xs">
              <span className="text-muted-foreground">SLO Status:</span>
              {d.summary.threshold_status === "breach" ? (
                <Badge tone="error">Threshold Breach</Badge>
              ) : d.summary.threshold_status === "ok" ? (
                <Badge tone="ok">Within SLO Limits</Badge>
              ) : (
                <Badge tone="neutral">No Rules Defined</Badge>
              )}
              <span className="text-muted-foreground">• Last telemetry heartbeat:</span>
              <span className="mono text-foreground">{formatTimestamp(d.summary.last_seen)}</span>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {/* Operations */}
              <Card
                title="Observed Operations"
                subtitle="Endpoints and RPC methods serviced by this component"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border text-muted-foreground">
                      <tr>
                        <th className="py-2.5 font-medium">Operation</th>
                        <th className="py-2.5 font-medium">Count</th>
                        <th className="py-2.5 font-medium">Errors</th>
                        <th className="py-2.5 font-medium">P95 Latency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {d.operations.map((o) => (
                        <tr key={o.operation} className="hover:bg-muted/40 transition-colors">
                          <td className="py-2.5 font-mono font-medium text-foreground">{o.operation}</td>
                          <td className="py-2.5">{o.count}</td>
                          <td className="py-2.5">
                            <span className={o.error_count > 0 ? "font-semibold text-red-500" : ""}>
                              {o.error_count}
                            </span>
                          </td>
                          <td className="mono py-2.5">{formatDuration(o.p95_ns)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Recent Traces */}
              <Card
                title="Recent Service Traces"
                subtitle="Traces that traversed or originated in this service"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border text-muted-foreground">
                      <tr>
                        <th className="py-2.5 font-medium">Start Time</th>
                        <th className="py-2.5 font-medium">Operation</th>
                        <th className="py-2.5 font-medium">Duration</th>
                        <th className="py-2.5 font-medium">Status</th>
                        <th className="py-2.5 font-medium">Trace ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {d.recent_traces.map((t) => (
                        <tr key={t.trace_id} className="hover:bg-muted/40 transition-colors">
                          <td className="mono py-2.5 whitespace-nowrap text-muted-foreground">
                            {formatTimestamp(t.start_time)}
                          </td>
                          <td className="py-2.5 font-medium text-foreground">{t.root_operation}</td>
                          <td className="mono py-2.5">{formatDuration(t.duration_ns)}</td>
                          <td className="py-2.5">
                            {t.has_error ? <Badge tone="error">Error</Badge> : <Badge tone="ok">OK</Badge>}
                          </td>
                          <td className="py-2.5">
                            <TraceLink traceId={t.trace_id} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Callers */}
              <Card
                title="Inbound Callers (Upstream)"
                subtitle="Services making calls into this component"
              >
                {d.incoming.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No upstream callers detected (entry service).</p>
                ) : (
                  <div className="space-y-2">
                    {d.incoming.map((e) => (
                      <div
                        key={e.source}
                        className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <ArrowDownLeft className="size-4 text-blue-500" />
                          <Link
                            className="font-semibold text-foreground hover:text-blue-500 hover:underline"
                            to={`/services/${encodeURIComponent(e.source)}`}
                          >
                            {e.source}
                          </Link>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="mono">{e.request_count} calls</span>
                          <span className="mono">{formatPercent(e.error_rate)} err</span>
                          <span className="mono font-semibold">P95: {formatDuration(e.p95_ns)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Callees */}
              <Card
                title="Outbound Callees (Downstream)"
                subtitle="Services called by this component"
              >
                {d.outgoing.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No downstream dependencies observed.</p>
                ) : (
                  <div className="space-y-2">
                    {d.outgoing.map((e) => (
                      <div
                        key={e.target}
                        className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <ArrowUpRight className="size-4 text-emerald-500" />
                          <Link
                            className="font-semibold text-foreground hover:text-blue-500 hover:underline"
                            to={`/services/${encodeURIComponent(e.target)}`}
                          >
                            {e.target}
                          </Link>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="mono">{e.request_count} calls</span>
                          <span className="mono">{formatPercent(e.error_rate)} err</span>
                          <span className="mono font-semibold">P95: {formatDuration(e.p95_ns)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Threshold alerts for this service */}
            <Card
              title="Recent Threshold Breach Events"
              subtitle="Latency and error rate violations evaluated against configured thresholds"
            >
              {(alerts.data ?? []).filter((a) => a.service_name === name).length === 0 ? (
                <p className="text-xs text-muted-foreground">No threshold breach events recorded for this service.</p>
              ) : (
                <div className="space-y-2">
                  {(alerts.data ?? [])
                    .filter((a) => a.service_name === name)
                    .map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs"
                      >
                        <div>
                          <span className="mono text-muted-foreground">{formatTimestamp(a.created_at)}</span>
                          <strong className="ml-2 text-foreground font-semibold uppercase">{a.rule_type}</strong>
                        </div>
                        <div className="mono font-medium text-red-500">
                          Observed {a.observed_value} vs limit {a.threshold_value}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </DataState>
    </div>
  );
}
