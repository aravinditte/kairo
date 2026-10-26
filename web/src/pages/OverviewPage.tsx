import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  Clock,
  Gauge,
  ArrowRight,
  ShieldAlert,
  Server,
  Layers,
  FlaskConical,
  RefreshCw,
  Sliders,
  CheckCircle2,
} from "lucide-react";
import { useAppState, TIME_PRESETS } from "../app/providers";
import { useI18n } from "../lib/i18n";
import { DataState } from "../components/feedback";
import { Badge, Card, PageTitle, StatCard, TraceLink } from "../components/ui";
import { LatencyChart, RequestTrafficChart } from "../features/charts";
import DependencyGraphView from "../features/services/DependencyGraph";
import {
  formatDuration,
  formatNumber,
  formatPercent,
  formatRate,
  formatTimestamp,
} from "../lib/formatting";

export default function OverviewPage() {
  const { provider, range, rangeMinutes, setRangeMinutes, refreshTick, refresh, mode } = useAppState();
  const { t } = useI18n();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["overview", range.start, range.end, refreshTick],
    queryFn: () =>
      provider.getOverview({
        start: range.start,
        end: range.end,
        interval_seconds: rangeMinutes <= 15 ? 30 : rangeMinutes <= 60 ? 60 : rangeMinutes <= 360 ? 300 : 900,
      }),
  });

  const deps = useQuery({
    queryKey: ["deps-overview", range.start, range.end, refreshTick],
    queryFn: () => provider.getDependencies({ start: range.start, end: range.end }),
  });

  return (
    <div className="space-y-6">
      {/* 3.1 Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#27354A] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#F7F6F3]">{t.overview.title}</h1>
          <p className="mt-1 text-xs text-[#A7B0BE]">
            {t.overview.subtitle}
          </p>
        </div>

        {/* Right-Side Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Time Range Selector */}
          <div className="flex items-center rounded-lg border border-[#27354A] bg-[#1A2332] p-0.5 text-xs">
            {TIME_PRESETS.map((p) => {
              const active = p.minutes === rangeMinutes;
              return (
                <button
                  key={p.minutes}
                  type="button"
                  onClick={() => setRangeMinutes(p.minutes)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    active
                      ? "bg-[#F472B6] text-[#0B0F1A] font-bold shadow-xs"
                      : "text-[#A7B0BE] hover:text-[#F7F6F3]"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#27354A] bg-[#1A2332] px-2.5 py-1.5 text-xs font-medium text-[#F7F6F3] hover:bg-[#1E2838] transition-colors"
            title="Refresh active telemetry snapshot"
          >
            <RefreshCw className="size-3.5 text-[#F472B6]" />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Run Demo Scenario Shortcut */}
          <Link
            to="/failure-lab"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#F472B6]/40 bg-[#F472B6]/15 px-3 py-1.5 text-xs font-semibold text-[#F472B6] hover:bg-[#F472B6]/25 transition-colors"
          >
            <FlaskConical className="size-3.5" />
            <span>{t.overview.runScenario}</span>
          </Link>

          {/* Data Source Status Pill */}
          <div className="flex items-center gap-1.5 rounded-lg border border-[#27354A] bg-[#1A2332] px-2.5 py-1.5 text-xs">
            <span
              className={`size-2 rounded-full ${
                mode === "demo" ? "bg-amber-400" : "bg-[#22C55E]"
              }`}
            />
            <span className="font-mono text-[11px] font-semibold tracking-wider text-[#A7B0BE]">
              {mode === "demo" ? t.header.simulatedData : t.header.liveBackend}
            </span>
          </div>
        </div>
      </div>

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        data={q.data}
        onRetry={() => q.refetch()}
        empty={(d) => d.kpis.total_requests === null}
      >
        {(d) => {
          const totalReqs = d.kpis.total_requests ?? 0;
          const errRate = d.kpis.error_rate ?? 0;
          const failedReqsCount = Math.round(totalReqs * errRate);
          const reqSparkline = d.series.map((s) => s.request_count);
          const p95Sparkline = d.series
            .map((s) => (s.p95_ns != null ? s.p95_ns / 1e6 : 0))
            .filter((v) => v > 0);

          // Calculate P99 from series or default
          const validP99s = d.series.map((s) => s.p99_ns).filter((v): v is number => v != null);
          const avgP99Ns = validP99s.length > 0 ? validP99s[validP99s.length - 1] : null;

          // Services affected count
          const breachingCount = d.services.filter((s) => s.threshold_status === "breach").length;

          return (
            <div className="space-y-6">
              {/* 3.2 Primary Metric Cards: 6 compact KPI cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {/* Card 1: Request Rate */}
                <StatCard
                  title={t.overview.requestRate}
                  value={formatRate(d.kpis.requests_per_sec)}
                  hint="Eligible server req/s"
                  trend="Stable"
                  trendDirection="neutral"
                  icon={<Gauge className="size-4 text-[#F472B6]" />}
                  sparkline={reqSparkline}
                />

                {/* Card 2: Error Rate */}
                <StatCard
                  title={t.overview.errorRate}
                  value={formatPercent(d.kpis.error_rate)}
                  hint={`${failedReqsCount} failed requests`}
                  trend={errRate > 0.05 ? "+Degraded" : "Normal"}
                  trendDirection={errRate > 0.05 ? "down" : "neutral"}
                  icon={<AlertCircle className="size-4 text-[#FF6B6B]" />}
                  sparkline={d.series.map((s) => s.error_count)}
                />

                {/* Card 3: P95 Latency */}
                <StatCard
                  title={t.overview.p95Latency}
                  value={formatDuration(d.kpis.p95_ns)}
                  hint="95th percentile"
                  trend={((d.kpis.p95_ns ?? 0) / 1e6) > 400 ? "+Elevated" : "Within SLO"}
                  trendDirection={((d.kpis.p95_ns ?? 0) / 1e6) > 400 ? "down" : "up"}
                  icon={<Clock className="size-4 text-[#F472B6]" />}
                  sparkline={p95Sparkline}
                />

                {/* Card 4: P99 Latency */}
                <StatCard
                  title={t.overview.p99Latency}
                  value={totalReqs < 5 ? t.overview.insufficientData : formatDuration(avgP99Ns)}
                  hint={totalReqs < 5 ? "Need >=5 samples" : "Slowest tail tier"}
                  trend={totalReqs >= 5 ? "Monitored" : undefined}
                  trendDirection="neutral"
                  icon={<Clock className="size-4 text-[#38BDF8]" />}
                />

                {/* Card 5: Failed Requests (Clickable to /traces?status=error) */}
                <StatCard
                  title={t.overview.failedRequests}
                  value={String(failedReqsCount)}
                  hint={`${formatPercent(d.kpis.error_rate)} of total`}
                  trend={failedReqsCount > 0 ? "Requires review" : "Zero errors"}
                  trendDirection={failedReqsCount > 0 ? "down" : "up"}
                  icon={<ShieldAlert className="size-4 text-[#FF6B6B]" />}
                  to="/traces?status=error"
                />

                {/* Card 6: Services Affected (Clickable to /services) */}
                <StatCard
                  title={t.overview.servicesAffected}
                  value={`${breachingCount} / ${d.services.length}`}
                  hint={breachingCount > 0 ? "Threshold breach active" : "All services healthy"}
                  trend={breachingCount > 0 ? "Breached" : "Healthy"}
                  trendDirection={breachingCount > 0 ? "down" : "up"}
                  icon={<Server className="size-4 text-[#22C55E]" />}
                  to="/services"
                />
              </div>

              {/* 3.3 Row A: Request Volume and Latency */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Left Panel (~60%): Request Traffic */}
                <div className="lg:col-span-7">
                  <Card
                    title={t.overview.requestTraffic}
                    subtitle="Requests per second, successful throughput, and failed error rate"
                  >
                    <RequestTrafficChart
                      series={d.series}
                      intervalSeconds={rangeMinutes <= 15 ? 30 : rangeMinutes <= 60 ? 60 : rangeMinutes <= 360 ? 300 : 900}
                    />
                  </Card>
                </div>

                {/* Right Panel (~40%): Latency Percentiles */}
                <div className="lg:col-span-5">
                  <Card
                    title={t.overview.latencyPercentiles}
                    subtitle="P50, P95, and P99 latency percentiles across selected time range"
                  >
                    <LatencyChart series={d.series} />
                  </Card>
                </div>
              </div>

              {/* 3.3 Row B: Service Dependency Map (The visual centerpiece!) */}
              <Card
                title={t.overview.serviceDependencyMap}
                subtitle="Reconstructed live inter-service communication topology and call performance"
                action={
                  <div className="flex items-center gap-2">
                    <Link
                      to="/dependencies"
                      className="text-xs font-semibold text-[#F472B6] hover:underline"
                    >
                      Full Topology View &rarr;
                    </Link>
                  </div>
                }
              >
                {deps.data ? (
                  <DependencyGraphView
                    graph={deps.data}
                    height={380}
                    onNavigate={(svc) => navigate(`/services/${encodeURIComponent(svc)}`)}
                  />
                ) : (
                  <div className="py-12 text-center text-xs text-[#A7B0BE]">
                    Resolving service dependency topology...
                  </div>
                )}
              </Card>

              {/* 3.3 Row C: Service Health and Recent Errors */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Left Panel: Service Health Table */}
                <Card
                  title={t.overview.serviceHealth}
                  subtitle="Monitored service components against configured SLO thresholds"
                  action={
                    <Link to="/services" className="text-xs font-semibold text-[#F472B6] hover:underline">
                      {t.overview.viewAllServices} &rarr;
                    </Link>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#27354A] text-[#A7B0BE]">
                        <tr>
                          <th className="py-2.5 font-semibold uppercase tracking-wider">Service</th>
                          <th className="py-2.5 font-semibold uppercase tracking-wider">{t.common.status}</th>
                          <th className="py-2.5 font-semibold uppercase tracking-wider">Req Rate</th>
                          <th className="py-2.5 font-semibold uppercase tracking-wider">Error Rate</th>
                          <th className="py-2.5 font-semibold uppercase tracking-wider">P95 Latency</th>
                          <th className="py-2.5 font-semibold uppercase tracking-wider">Last Observed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#27354A]">
                        {d.services.map((s) => {
                          const isBreached = s.threshold_status === "breach";
                          const isDegraded = s.error_rate > 0.05 || ((s.p95_ns ?? 0) / 1e6) > 400;
                          return (
                            <tr key={s.service_name} className="hover:bg-[#1E2838] transition-colors">
                              <td className="py-2.5 font-bold">
                                <Link
                                  className="text-[#F7F6F3] hover:text-[#F472B6] hover:underline"
                                  to={`/services/${encodeURIComponent(s.service_name)}`}
                                >
                                  {s.service_name}
                                </Link>
                              </td>
                              <td className="py-2.5">
                                {isBreached ? (
                                  <Badge tone="error">Breach</Badge>
                                ) : isDegraded ? (
                                  <Badge tone="warn">{t.overview.degraded}</Badge>
                                ) : (
                                  <Badge tone="ok">{t.overview.healthy}</Badge>
                                )}
                              </td>
                              <td className="font-mono py-2.5 text-[#F7F6F3]">
                                {s.request_count} req
                              </td>
                              <td
                                className={`font-mono py-2.5 font-semibold ${
                                  s.error_rate > 0.05 ? "text-[#FF6B6B]" : "text-[#F7F6F3]"
                                }`}
                              >
                                {formatPercent(s.error_rate)}
                              </td>
                              <td className="font-mono py-2.5 text-[#F7F6F3]">
                                {formatDuration(s.p95_ns)}
                              </td>
                              <td className="font-mono py-2.5 text-[11px] text-[#A7B0BE]">
                                {s.last_seen ? formatTimestamp(s.last_seen).slice(11, 19) : t.overview.noData}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/* Right Panel: Recent Errors */}
                <Card
                  title={t.overview.recentErrors}
                  subtitle="Latest server span error events captured across services"
                  action={
                    <Link to="/traces?status=error" className="text-xs font-semibold text-[#FF6B6B] hover:underline">
                      Filter Error Traces &rarr;
                    </Link>
                  }
                >
                  {d.recent_errors.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <CheckCircle2 className="size-8 text-[#22C55E] mb-2" />
                      <p className="text-xs font-semibold text-[#F7F6F3]">Zero Errors Recorded</p>
                      <p className="text-[11px] text-[#A7B0BE] mt-0.5">
                        {t.overview.noErrors}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-[#27354A] text-[#A7B0BE]">
                          <tr>
                            <th className="py-2.5 font-semibold uppercase tracking-wider">Timestamp</th>
                            <th className="py-2.5 font-semibold uppercase tracking-wider">Service</th>
                            <th className="py-2.5 font-semibold uppercase tracking-wider">Operation</th>
                            <th className="py-2.5 font-semibold uppercase tracking-wider">Error</th>
                            <th className="py-2.5 font-semibold uppercase tracking-wider">Duration</th>
                            <th className="py-2.5 font-semibold uppercase tracking-wider">Trace ID</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#27354A]">
                          {d.recent_errors.slice(0, 6).map((e) => (
                            <tr key={`${e.trace_id}-${e.time}`} className="hover:bg-[#1E2838] transition-colors">
                              <td className="font-mono py-2.5 text-[11px] text-[#A7B0BE] whitespace-nowrap">
                                {formatTimestamp(e.time).slice(11, 19)}
                              </td>
                              <td className="py-2.5 font-medium text-[#F7F6F3]">{e.service}</td>
                              <td className="font-mono py-2.5 text-xs text-[#A7B0BE] truncate max-w-[120px]">
                                {e.operation}
                              </td>
                              <td className="py-2.5 text-[#FF6B6B] truncate max-w-[140px]" title={e.error_summary}>
                                {e.error_summary}
                              </td>
                              <td className="font-mono py-2.5 text-[#F7F6F3]">
                                {formatDuration(e.duration_ns)}
                              </td>
                              <td className="py-2.5">
                                <TraceLink traceId={e.trace_id} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>

              {/* 3.3 Row D: Recent Traces */}
              <Card
                title={t.overview.recentTraces}
                subtitle="Latest observed end-to-end request journeys traversing the service topology"
                action={
                  <div className="flex items-center gap-3">
                    <Link to="/traces" className="text-xs font-semibold text-[#A7B0BE] hover:text-[#F7F6F3]">
                      {t.overview.viewAllTraces}
                    </Link>
                    <Link
                      to="/traces?status=error"
                      className="text-xs font-semibold text-[#FF6B6B] hover:underline"
                    >
                      View Failed Traces
                    </Link>
                    <Link
                      to="/failure-lab"
                      className="text-xs font-semibold text-[#F472B6] hover:underline"
                    >
                      {t.overview.runScenario} &rarr;
                    </Link>
                  </div>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#27354A] text-[#A7B0BE]">
                      <tr>
                        <th className="py-2.5 font-semibold uppercase tracking-wider">Start Time</th>
                        <th className="py-2.5 font-semibold uppercase tracking-wider">Root Operation</th>
                        <th className="py-2.5 font-semibold uppercase tracking-wider">Services Involved</th>
                        <th className="py-2.5 font-semibold uppercase tracking-wider">Duration</th>
                        <th className="py-2.5 font-semibold uppercase tracking-wider">Span Count</th>
                        <th className="py-2.5 font-semibold uppercase tracking-wider">Status</th>
                        <th className="py-2.5 font-semibold uppercase tracking-wider">Trace ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#27354A]">
                      {d.recent_traces.slice(0, 8).map((t) => (
                        <tr key={t.trace_id} className="hover:bg-[#1E2838] transition-colors">
                          <td className="font-mono py-2.5 text-[11px] text-[#A7B0BE] whitespace-nowrap">
                            {formatTimestamp(t.start_time).slice(11, 19)}
                          </td>
                          <td className="font-mono py-2.5 font-medium text-[#F7F6F3]">
                            {t.root_operation}
                          </td>
                          <td className="py-2.5 text-[#A7B0BE]">
                            <span className="rounded bg-[#131A26] border border-[#27354A] px-1.5 py-0.5 text-[11px] text-[#F7F6F3]">
                              {t.root_service}
                            </span>
                          </td>
                          <td className="font-mono py-2.5 text-[#F7F6F3]">
                            {formatDuration(t.duration_ns)}
                          </td>
                          <td className="font-mono py-2.5 text-[#A7B0BE]">
                            {t.span_count} spans
                          </td>
                          <td className="py-2.5">
                            {t.has_error ? (
                              <Badge tone="error">Error</Badge>
                            ) : (
                              <Badge tone="ok">OK</Badge>
                            )}
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
            </div>
          );
        }}
      </DataState>
    </div>
  );
}
