import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bell, AlertTriangle, ShieldCheck, ArrowRight, Settings } from "lucide-react";
import { useAppState } from "../app/providers";
import { useI18n } from "../lib/i18n";
import { DataState, EmptyState } from "../components/feedback";
import { Badge, Card, PageTitle } from "../components/ui";
import { formatTimestamp } from "../lib/formatting";

const RULE_LABEL_EN: Record<string, string> = {
  p95_latency: "P95 Latency SLO",
  error_rate: "Error Rate SLO",
  request_rate: "Throughput Drop",
};

const RULE_LABEL_JA: Record<string, string> = {
  p95_latency: "P95レイテンシ SLO",
  error_rate: "エラー率 SLO",
  request_rate: "スループット低下",
};

export default function AlertsPage() {
  const { provider, refreshTick } = useAppState();
  const { t, lang } = useI18n();

  const ruleLabels = lang === "ja" ? RULE_LABEL_JA : RULE_LABEL_EN;

  const q = useQuery({
    queryKey: ["alerts", refreshTick],
    queryFn: () => provider.getAlerts({ limit: 100 }),
  });

  const thresholds = useQuery({
    queryKey: ["thresholds", refreshTick],
    queryFn: () => provider.getThresholds(),
  });

  return (
    <div className="space-y-6">
      <PageTitle
        title={t.alerts.title}
        subtitle={t.alerts.subtitle}
        actions={
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-2xs hover:bg-accent hover:text-accent-foreground"
          >
            <Settings className="size-3.5" />
            <span>{t.alerts.configureThresholds}</span>
          </Link>
        }
      />

      {/* Threshold Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-xs shadow-xs">
        <div className="flex items-center gap-2">
          <Bell className="size-4 text-blue-500" />
          <span className="font-semibold text-foreground">{t.alerts.activeRules}</span>
          <span className="text-muted-foreground">
            P95 Latency &gt; {thresholds.data?.p95_latency_ms ?? "..."} ms • Error Rate &gt;{" "}
            {thresholds.data?.error_rate_percent ?? "..."}%
          </span>
        </div>
        <Link
          to="/settings"
          className="font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {t.alerts.manageThresholds} &rarr;
        </Link>
      </div>

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        data={q.data}
        onRetry={() => q.refetch()}
        empty={(d) => d.length === 0}
      >
        {(d) => (
          <Card title={t.alerts.recentBreaches} subtitle={lang === "ja" ? "マイクロサービス全体で記録された直近のSLO違反イベント" : "Recent SLO breaches recorded across microservices"}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">{t.alerts.timestamp}</th>
                    <th className="py-2.5 px-3 font-medium">{t.alerts.service}</th>
                    <th className="py-2.5 px-3 font-medium">{t.alerts.rule}</th>
                    <th className="py-2.5 px-3 font-medium">{t.alerts.observedValue}</th>
                    <th className="py-2.5 px-3 font-medium">{t.alerts.threshold}</th>
                    <th className="py-2.5 px-3 font-medium">{lang === "ja" ? "評価ウィンドウ" : "Evaluation Window"}</th>
                    <th className="py-2.5 px-3 font-medium">{t.alerts.severity}</th>
                    <th className="py-2.5 px-3 font-medium text-right">{lang === "ja" ? "調査" : "Investigation"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {d.map((a) => (
                    <tr key={a.id} className="hover:bg-muted/40 transition-colors">
                      <td className="mono py-2.5 px-3 whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(a.created_at)}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-foreground">
                        <Link
                          className="hover:text-blue-500 hover:underline"
                          to={`/services/${encodeURIComponent(a.service_name)}`}
                        >
                          {a.service_name}
                        </Link>
                      </td>
                      <td className="py-2.5 px-3">{ruleLabels[a.rule_type] ?? a.rule_type}</td>
                      <td className="mono py-2.5 px-3 font-semibold text-red-500">
                        {a.observed_value}
                        {a.rule_type === "p95_latency"
                          ? " ms"
                          : a.rule_type === "error_rate"
                          ? "%"
                          : ""}
                      </td>
                      <td className="mono py-2.5 px-3 text-muted-foreground">
                        {a.threshold_value}
                        {a.rule_type === "p95_latency"
                          ? " ms"
                          : a.rule_type === "error_rate"
                          ? "%"
                          : ""}
                      </td>
                      <td className="mono py-2.5 px-3 whitespace-nowrap text-[11px] text-muted-foreground">
                        {formatTimestamp(a.window_start)} – {formatTimestamp(a.window_end)}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge tone="warn">{a.status}</Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <Link
                          className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                          to="/traces"
                        >
                          {lang === "ja" ? "トレースを検査" : "Inspect Traces"} &rarr;
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </DataState>
    </div>
  );
}
