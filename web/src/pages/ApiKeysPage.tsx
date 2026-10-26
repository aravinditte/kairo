import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppState } from "../app/providers";
import { DataState } from "../components/feedback";
import { Badge, btnCls, btnGhost, Card, CopyButton, PageTitle } from "../components/ui";
import { formatTimestamp } from "../lib/formatting";
import type { CreateApiKeyResponse } from "../types";

export default function ApiKeysPage() {
  const { provider, mode, projectId } = useAppState();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["api-keys", projectId], queryFn: () => provider.listApiKeys() });
  const [created, setCreated] = useState<CreateApiKeyResponse | null>(null);
  const create = useMutation({ mutationFn: () => provider.createApiKey(), onSuccess: (r) => { setCreated(r); void qc.invalidateQueries({ queryKey: ["api-keys"] }); } });
  const revoke = useMutation({ mutationFn: (id: string) => provider.revokeApiKey(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }) });
  return (
    <div>
      <PageTitle title="API keys" subtitle="Project-scoped ingestion keys. Only a hash of each key is stored by the backend; the raw key is shown once, at creation." />
      {mode === "demo" && <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">Demo mode: keys created here are simulated locally in the browser. They are demo-only values, not real keys, and are not sent anywhere.</p>}
      <button className={btnCls} disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating..." : "Create API key"}</button>
      {create.isError && <p role="alert" className="mt-2 text-sm text-red-600">{create.error instanceof Error ? create.error.message : "Key creation failed."}</p>}
      {created && (
        <div className="mt-4"><Card title={mode === "demo" ? "New demo key - shown once (demo only, not a real key)" : "New API key - shown once, copy it now"}>
          <p className="mono break-all rounded bg-zinc-100 p-3 text-sm dark:bg-zinc-800">{created.raw_key}</p>
          <div className="mt-2 flex gap-2"><CopyButton text={created.raw_key} label="Copy key" /><button className={btnGhost} onClick={() => setCreated(null)}>Dismiss</button></div>
          <p className="mt-2 text-xs text-zinc-500">This raw value will not be shown again. The backend stores only its hash.</p>
        </Card></div>
      )}
      <div className="mt-4">
        <DataState isLoading={q.isLoading} isError={q.isError} error={q.error} data={q.data} onRetry={() => q.refetch()} empty={(d) => d.length === 0}>
          {(d) => (
            <Card><table className="w-full text-left text-sm"><thead><tr className="text-zinc-500"><th className="py-1">Key ID</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody>{d.map((k) => (<tr key={k.id} className="border-t border-zinc-100 dark:border-zinc-800"><td className="mono">{k.id}</td><td>{formatTimestamp(k.created_at)}</td><td>{k.last_used_at ? formatTimestamp(k.last_used_at) : "Never"}</td><td>{k.revoked_at ? <Badge tone="error">Revoked {formatTimestamp(k.revoked_at)}</Badge> : <Badge tone="ok">Active</Badge>}</td><td>{!k.revoked_at && <button className={btnGhost} disabled={revoke.isPending} onClick={() => { if (confirm(`Revoke key ${k.id}? Ingestion with it will stop working.`)) revoke.mutate(k.id); }}>Revoke</button>}</td></tr>))}</tbody></table></Card>
          )}
        </DataState>
      </div>
    </div>
  );
}
