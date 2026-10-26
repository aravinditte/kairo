import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, KeyRound, Plus, ShieldCheck, Trash2, AlertTriangle } from "lucide-react";
import { useAppState } from "../app/providers";
import { DataState, EmptyState } from "../components/feedback";
import { Badge, btnCls, btnGhost, Card, CopyButton, PageTitle } from "../components/ui";
import { formatTimestamp } from "../lib/formatting";
import type { CreateApiKeyResponse } from "../types";

export default function ApiKeysPage() {
  const { provider, mode, projectId } = useAppState();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["api-keys", projectId],
    queryFn: () => provider.listApiKeys(),
  });

  const [created, setCreated] = useState<CreateApiKeyResponse | null>(null);

  const create = useMutation({
    mutationFn: () => provider.createApiKey(),
    onSuccess: (r) => {
      setCreated(r);
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => provider.revokeApiKey(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
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
        title="Project Ingestion API Keys"
        subtitle="Cryptographically hashed keys used to authenticate OTLP/HTTP telemetry ingestion endpoints."
        actions={
          <button
            className={btnCls}
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus className="size-3.5" />
            <span>{create.isPending ? "Generating..." : "Generate New API Key"}</span>
          </button>
        }
      />

      {mode === "demo" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            Demo Mode: Keys generated here are simulated locally in browser memory and are never transmitted to any external server.
          </span>
        </div>
      )}

      {create.isError && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400"
        >
          {create.error instanceof Error ? create.error.message : "Key generation failed."}
        </div>
      )}

      {created && (
        <Card
          title={
            mode === "demo"
              ? "New Demo API Key (Shown Once)"
              : "New Secret Ingestion Key Generated"
          }
          subtitle="Copy this secret key immediately. For security, only the cryptographic hash is stored on the server."
        >
          <div className="space-y-3">
            <div className="mono break-all rounded-lg border border-border bg-muted/40 p-3.5 text-sm font-semibold text-foreground select-all">
              {created.raw_key}
            </div>
            <div className="flex items-center gap-2">
              <CopyButton text={created.raw_key} label="Copy Secret Key" />
              <button className={btnGhost} onClick={() => setCreated(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </Card>
      )}

      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        data={q.data}
        onRetry={() => q.refetch()}
        empty={(d) => d.length === 0}
      >
        {(d) => (
          <Card title="Active & Revoked Ingestion Keys" subtitle={`${d.length} keys registered for this project`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">Key ID / Prefix</th>
                    <th className="py-2.5 px-3 font-medium">Created At</th>
                    <th className="py-2.5 px-3 font-medium">Last Ingestion Use</th>
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    <th className="py-2.5 px-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {d.map((k) => (
                    <tr key={k.id} className="hover:bg-muted/40 transition-colors">
                      <td className="mono py-2.5 px-3 font-semibold text-foreground">{k.id}</td>
                      <td className="mono py-2.5 px-3 text-muted-foreground">{formatTimestamp(k.created_at)}</td>
                      <td className="mono py-2.5 px-3 text-muted-foreground">
                        {k.last_used_at ? formatTimestamp(k.last_used_at) : "Never used"}
                      </td>
                      <td className="py-2.5 px-3">
                        {k.revoked_at ? (
                          <Badge tone="error">Revoked {formatTimestamp(k.revoked_at)}</Badge>
                        ) : (
                          <Badge tone="ok">Active</Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {!k.revoked_at && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400"
                            disabled={revoke.isPending}
                            onClick={() => {
                              if (confirm(`Revoke key ${k.id}? Ingestion requests using this key will immediately be rejected.`)) {
                                revoke.mutate(k.id);
                              }
                            }}
                          >
                            <Trash2 className="size-3" />
                            <span>Revoke Key</span>
                          </button>
                        )}
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
