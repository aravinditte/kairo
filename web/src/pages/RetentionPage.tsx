import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Database, Clock, ShieldAlert, Save } from "lucide-react";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { btnCls, Card, PageTitle, inputCls } from "../components/ui";

const OPTIONS = [1, 3, 7, 14, 30, 90];

export default function RetentionPage() {
  const { provider, mode } = useAppState();
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["retention"], queryFn: () => provider.getRetention() });
  const [days, setDays] = useState(7);

  useEffect(() => {
    if (q.data) setDays(q.data.retention_days);
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => provider.updateRetention(days),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["retention"] }),
  });

  return (
    <div className="space-y-6">
      <Link
        to="/settings"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        <span>Back to Settings</span>
      </Link>

      <PageTitle
        title="Data Retention & Pruning Policy"
        subtitle="Configures automatic bounded-batch deletion of expired spans to maintain steady-state database sizing."
      />

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        data={q.data}
        onRetry={() => q.refetch()}
      >
        {() => (
          <div className="space-y-6 max-w-2xl">
            <Card
              title="Active Span Retention Policy"
              subtitle="Spans with end_time older than this duration are pruned"
            >
              <div className="space-y-4 text-xs text-foreground/90">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Current Active Policy:</span>
                  <strong className="text-sm font-semibold text-foreground">
                    {q.data?.retention_days} Days
                  </strong>
                </div>

                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-muted-foreground">
                  <p>
                    <strong>Data Safety Guarantee:</strong> Deletion applies only to telemetry spans and their associated span attributes.
                    Project records, API keys, thresholds, and scenario metadata are never deleted by the retention cleaner.
                  </p>
                </div>

                {mode === "demo" ? (
                  <div className="rounded-lg border border-border bg-muted/40 p-4 text-xs">
                    <p className="font-semibold text-foreground">Demo Mode (Read-Only Policy)</p>
                    <p className="mt-1 text-muted-foreground">
                      In the standalone demo, telemetry is managed in browser memory and automatically restores to baseline upon page refresh.
                    </p>
                  </div>
                ) : (
                  <div className="pt-2">
                    <label className="mb-2 block font-medium text-foreground">
                      Update Retention Window
                    </label>
                    <div className="flex items-center gap-3">
                      <select
                        className={`${inputCls} w-44`}
                        value={days}
                        onChange={(e) => setDays(Number(e.target.value))}
                      >
                        {OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o} Days Retention
                          </option>
                        ))}
                      </select>
                      <button
                        className={btnCls}
                        disabled={save.isPending}
                        onClick={() => save.mutate()}
                      >
                        <Save className="size-3.5" />
                        <span>{save.isPending ? "Saving..." : "Save Policy"}</span>
                      </button>
                    </div>

                    {save.isSuccess && (
                      <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        Retention period updated successfully.
                      </p>
                    )}
                    {save.isError && (
                      <p className="mt-2 text-xs text-red-600">
                        Save failed: {save.error instanceof Error ? save.error.message : "unknown error"}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </DataState>
    </div>
  );
}
