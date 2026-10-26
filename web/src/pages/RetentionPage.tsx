import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { btnCls, Card, PageTitle } from "../components/ui";

const OPTIONS = [1, 3, 7, 14, 30, 90];
export default function RetentionPage() {
  const { provider, mode } = useAppState();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["retention"], queryFn: () => provider.getRetention() });
  const [days, setDays] = useState(7);
  useEffect(() => { if (q.data) setDays(q.data.retention_days); }, [q.data]);
  const save = useMutation({ mutationFn: () => provider.updateRetention(days), onSuccess: () => void qc.invalidateQueries({ queryKey: ["retention"] }) });
  return (
    <div>
      <PageTitle title="Retention" subtitle="How long spans are kept before the cleanup job deletes them in bounded batches." />
      <DataState isLoading={q.isLoading} isError={q.isError} error={q.error} data={q.data} onRetry={() => q.refetch()}>
        {() => (
          <Card>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Current policy: <strong>{q.data?.retention_days} days</strong>.</p>
            <p className="mt-2 text-sm text-zinc-500">Deletion is irreversible. Project and API-key metadata are never deleted by retention cleanup - only spans older than the limit.</p>
            {mode === "demo" ? <p className="mt-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">Demo mode: retention is read-only here. The public demo keeps its synthetic dataset in browser memory and restores the baseline on reset or reload; there is no stored telemetry to delete.</p> : (
              <div className="mt-4"><label className="text-sm">Retention period<select className="ml-2 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" value={days} onChange={(e) => setDays(Number(e.target.value))}>{OPTIONS.map((o) => <option key={o} value={o}>{o} days</option>)}</select></label>
              <button className={`${btnCls} ml-3`} disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving..." : "Save retention"}</button>
              {save.isSuccess && <p className="mt-2 text-sm text-emerald-600">Saved.</p>}{save.isError && <p className="mt-2 text-sm text-red-600">Save failed: {save.error instanceof Error ? save.error.message : "unknown error"}</p>}</div>
            )}
          </Card>
        )}
      </DataState>
    </div>
  );
}
