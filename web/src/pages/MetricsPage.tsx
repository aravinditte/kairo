import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, Clock, Gauge, Filter } from "lucide-react";
import { useAppState } from "../app/providers";
import { useI18n } from "../lib/i18n";
import { DataState, EmptyState } from "../components/feedback";
import { Card, inputCls, PageTitle, StatCard } from "../components/ui";
import { ErrorBarChart, LatencyChart, RequestVolumeChart } from "../features/charts";
import { formatDuration, formatPercent, formatRate } from "../lib/formatting";

export default function MetricsPage() {
  const { provider, range, refreshTick } = useAppState();
  const { t, lang } = useI18n();
  const [service, setService] = useState("");
  const [operation, setOperation] = useState("");
  const [interval, setInterval] = useState(300);

  const services = useQuery({
    queryKey: ["svc-names", range.start, refreshTick],
    queryFn: () => provider.getServices({ start: range.start, end: range.end }),
  });

  const q = useQuery({
    queryKey: ["metrics", range.start, range.end, service, operation, interval, refreshTick],
    queryFn: () =>
      provider.getMetrics({
        start: range.start,
        end: range.end,
        service: service || undefined,
        operation: operation || undefined,
        interval_seconds: interval,
      }),
  });

  return (
    <div className="space-y-6">
      <PageTitle
        title={t.metrics.title}
        subtitle={t.metrics.subtitle}
      />

      {/* Filter Toolbar */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Filter className="size-3.5" />
          <span>{t.metrics.filtersTitle}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.metrics.filterService}</label>
            <select
              className={`${inputCls} w-full`}
              value={service}
              onChange={(e) => setService(e.target.value)}
            >
              <option value="">{t.metrics.allServices}</option>
              {(services.data ?? []).map((s) => (
                <option key={s.service_name} value={s.service_name}>
                  {s.service_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.metrics.filterOperation}</label>
            <input
              className={`${inputCls} w-full`}
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              placeholder="e.g. /checkout or select"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t.metrics.resolution}</label>
            <select
              className={`${inputCls} w-full`}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            >
              <option value={60}>{lang === "ja" ? "1分間隔" : "1 Minute Resolution"}</option>
              <option value={300}>{lang === "ja" ? "5分間隔" : "5 Minutes Resolution"}</option>
              <option value={900}>{lang === "ja" ? "15分間隔" : "15 Minutes Resolution"}</option>
              <option value={3600}>{lang === "ja" ? "1時間間隔" : "1 Hour Resolution"}</option>
            </select>
          </div>
        </div>
      </div>

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        data={q.data}
        onRetry={() => q.refetch()}
      >
        {(d) =>
          d.request_count === 0 ? (
            <EmptyState title={lang === "ja" ? "この期間のテレメトリサンプルはありません" : "No Telemetry Samples in Window"}>
              {lang === "ja"
                ? "選択したフィルタに一致するサーバースパンがありません。誤解を避けるためゼロではなく「データなし」と表示されます。"
                : "Zero server spans match the selected filters. Percentiles are reported as \"No data\" rather than misleading zeroes."}
            </EmptyState>
          ) : (
            <div className="space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  title={lang === "ja" ? "総受信リクエスト数" : "Total Inbound Requests"}
                  value={String(d.request_count)}
                  hint={`${d.interval_seconds}s ${lang === "ja" ? "バケット集計" : "buckets"}`}
                  icon={<Activity className="size-4" />}
                />
                <StatCard
                  title={t.metrics.throughput}
                  value={formatRate(d.request_rate_per_sec)}
                  hint={lang === "ja" ? "スループット" : "Throughput"}
                  icon={<Gauge className="size-4" />}
                />
                <StatCard
                  title={t.metrics.errorRate}
                  value={formatPercent(d.error_rate)}
                  hint={`${d.error_count} ${lang === "ja" ? "件のエラースパン" : "failed server spans"}`}
                  trendDirection={d.error_rate > 0.05 ? "down" : "neutral"}
                  icon={<AlertCircle className="size-4" />}
                />
                <StatCard
                  title={t.metrics.p95Latency}
                  value={formatDuration(d.p95_ns)}
                  hint={`P50: ${formatDuration(d.p50_ns)} • P99: ${formatDuration(d.p99_ns)}`}
                  icon={<Clock className="size-4" />}
                />
              </div>

              {/* RED Charts */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card
                  title={t.metrics.requestVolume}
                  subtitle={lang === "ja" ? "リクエスト総数と失敗数のバケット推移" : "Bucketed distribution of total requests vs failures"}
                >
                  <RequestVolumeChart series={d.series} />
                </Card>
                <Card
                  title={t.metrics.latencyTrends}
                  subtitle={lang === "ja" ? "P50、P95、およびP99レイテンシパーセンタイルの推移" : "P50, P95, and P99 latency percentiles over time"}
                >
                  <LatencyChart series={d.series} />
                </Card>
              </div>

              {/* Slow Operations and Errors by Service */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card
                  title={lang === "ja" ? "最も低速な操作 (P95基準)" : "Slowest Operations (by P95)"}
                  subtitle={lang === "ja" ? "95パーセンタイルレイテンシが最も高いエンドポイント" : "Endpoints with the highest 95th percentile latency"}
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-border text-muted-foreground">
                        <tr>
                          <th className="py-2.5 font-medium">{lang === "ja" ? "操作" : "Operation"}</th>
                          <th className="py-2.5 font-medium">{lang === "ja" ? "サービス" : "Service"}</th>
                          <th className="py-2.5 font-medium">{lang === "ja" ? "件数" : "Count"}</th>
                          <th className="py-2.5 font-medium">{lang === "ja" ? "P95レイテンシ" : "P95 Latency"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {d.slow_operations.map((o) => (
                          <tr key={`${o.service}-${o.operation}`} className="hover:bg-muted/40 transition-colors">
                            <td className="mono py-2.5 font-medium text-foreground">{o.operation}</td>
                            <td className="py-2.5 text-muted-foreground">{o.service}</td>
                            <td className="mono py-2.5">{o.count}</td>
                            <td className="mono py-2.5 font-semibold text-foreground">{formatDuration(o.p95_ns)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card
                  title={lang === "ja" ? "サービス別エラー数" : "Errors Grouped by Service"}
                  subtitle={lang === "ja" ? "サービスコンポーネントごとのエラー発生分布" : "Distribution of errors across service components"}
                >
                  {d.errors_by_service.length === 0 ? (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      {lang === "ja" ? "この期間中にエラーを観測したサービスはありません。" : "No errors observed across any service in this window."}
                    </p>
                  ) : (
                    <ErrorBarChart data={d.errors_by_service} />
                  )}
                </Card>
              </div>
            </div>
          )
        }
      </DataState>
    </div>
  );
}
