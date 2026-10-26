import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { Badge, Card, PageTitle } from "../components/ui";
import { formatTimestamp } from "../lib/formatting";

const RULE_LABEL: Record<string, string> = { p95_latency: "P95 latency", error_rate: "Error rate", request_rate: "Request rate" };
export default function AlertsPage() {
  const { provider, refreshTick } = useAppState();
  const q = useQuery({ queryKey: ["alerts", refreshTick], queryFn: () => provider.getAlerts({ limit: 100 }) });
  const thresholds = useQuery({ queryKey: ["thresholds", refreshTick], queryFn: () => provider.getThresholds() });
  return (
    <div>
      <PageTitle title="Alerts" subtitle="In-product threshold violations. External delivery (email, SMS, chat) is intentionally out of scope for this version." />
      <p className="mb-3 text-sm text-zinc-500">Current thresholds: p95 latency above {thresholds.data?.p95_latency_ms ?? "..."} ms or error rate above {thresholds.data?.error_rate_percent ?? "..."}% creates an event. Configure them in <Link className="text-teal-700 hover:underline dark:text-teal-300" to="/settings">Settings</Link>.</p>
      <DataState isLoading={q.isLoading} isError={q.isError} error={q.error} data={q.data} onRetry={() => q.refetch()} empty={(d) => d.length === 0}>
        {(d) => (
          <Card><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">Timestamp</th><th>Service</th><th>Rule</th><th>Observed</th><th>Threshold</th><th>Evaluation window</th><th>Status</th><th>Investigate</th></tr></thead><tbody>{d.map((a) => (<tr key={a.id} className="border-t border-zinc-100 dark:border-zinc-800"><td className="whitespace-nowrap">{formatTimestamp(a.created_at)}</td><td><Link className="text-teal-700 hover:underline dark:text-teal-300" to={`/services/${encodeURIComponent(a.service_name)}`}>{a.service_name}</Link></td><td>{RULE_LABEL[a.rule_type] ?? a.rule_type}</td><td>{a.observed_value}{a.rule_type === "p95_latency" ? " ms" : a.rule_type === "error_rate" ? "%" : ""}</td><td>{a.threshold_value}{a.rule_type === "p95_latency" ? " ms" : a.rule_type === "error_rate" ? "%" : ""}</td><td className="whitespace-nowrap text-xs">{formatTimestamp(a.window_start)} - {formatTimestamp(a.window_end)}</td><td><Badge tone="warn">{a.status}</Badge></td><td><Link className="text-teal-700 hover:underline dark:text-teal-300" to="/traces">Traces</Link></td></tr>))}</tbody></table></div></Card>
        )}
      </DataState>
    </div>
  );
}
