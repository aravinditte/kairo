import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Layers, Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { useAppState } from "../app/providers";
import { DataState, EmptyState } from "../components/feedback";
import { Badge, Card, CopyButton, PageTitle } from "../components/ui";
import TraceWaterfall, { SpanInspector } from "../features/traces/TraceWaterfall";
import { formatDuration, formatTimestamp } from "../lib/formatting";
import type { Span } from "../types";

export default function TraceDetailPage() {
  const { traceId = "" } = useParams();
  const { provider, refreshTick } = useAppState();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["trace", traceId, refreshTick],
    queryFn: () => provider.getTrace(traceId),
  });

  const selected: Span | null = useMemo(
    () =>
      q.data?.spans.find((s) => s.span_id === selectedId) ??
      q.data?.spans.find((s) => s.status_code === "error") ??
      q.data?.spans[0] ??
      null,
    [q.data, selectedId]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          to="/traces"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to Trace Explorer</span>
        </Link>
      </div>

      <PageTitle
        title="Trace Inspection"
        subtitle="End-to-end request timeline with parent-child span waterfall and structured metadata inspector."
      />

      {q.isLoading ? (
        <DataState isLoading isError={false} error={null} data={undefined}>
          {() => null}
        </DataState>
      ) : q.isError ? (
        <DataState isLoading={false} isError error={q.error} data={undefined} onRetry={() => q.refetch()}>
          {() => null}
        </DataState>
      ) : !q.data ? (
        <EmptyState title="Trace Not Found">
          No spans are stored for trace ID <span className="mono">{traceId}</span> in this project.
          It may have expired according to the retention window or belongs to another project.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="mono text-base font-semibold text-foreground">{q.data.trace_id}</span>
                <CopyButton text={q.data.trace_id} label="Copy Trace ID" />
                {q.data.has_error ? (
                  <Badge tone="error">Error Trace</Badge>
                ) : (
                  <Badge tone="ok">Success Trace</Badge>
                )}
                {q.data.incomplete && (
                  <Badge tone="warn">Partial / Incomplete</Badge>
                )}
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Root Operation</dt>
                <dd className="mt-0.5 truncate font-semibold text-foreground">{q.data.root_operation}</dd>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Entry Service</dt>
                <dd className="mt-0.5 font-semibold text-foreground">{q.data.root_service}</dd>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Total Duration</dt>
                <dd className="mono mt-0.5 font-semibold text-foreground">{formatDuration(q.data.duration_ns)}</dd>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Start Time</dt>
                <dd className="mono mt-0.5 text-xs font-medium text-foreground">{formatTimestamp(q.data.start_time)}</dd>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Involved Services</dt>
                <dd className="mt-0.5 font-semibold text-foreground">{q.data.services.length}</dd>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Spans / Errors</dt>
                <dd className="mt-0.5 font-semibold text-foreground">
                  {q.data.span_count} spans • <span className={q.data.error_count > 0 ? "text-red-500" : ""}>{q.data.error_count} errors</span>
                </dd>
              </div>
            </dl>

            {q.data.error_summary && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle className="size-4 shrink-0" />
                <span><strong>Failure Cause:</strong> {q.data.error_summary}</span>
              </div>
            )}

            {q.data.incomplete && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  One or more spans reference parent IDs not present in this dataset (sampling, retention window cutoffs, or in-flight ingestion).
                </span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-border/60 text-xs">
              <span className="text-muted-foreground">Participating services:</span>
              {q.data.services.map((s) => (
                <Link
                  key={s}
                  className="rounded-md border border-border bg-muted/50 px-2 py-0.5 font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
                  to={`/services/${encodeURIComponent(s)}`}
                >
                  {s}
                </Link>
              ))}
            </div>
          </div>

          {/* Waterfall and Inspector */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_420px]">
            <div>
              <Card
                title="Span Waterfall"
                subtitle="Select a span to view full tags, OpenTelemetry events, and resource dimensions."
              >
                <TraceWaterfall
                  spans={q.data.spans}
                  selected={selected}
                  onSelect={(s) => setSelectedId(s.span_id)}
                />
              </Card>
            </div>
            <div>
              {selected ? (
                <SpanInspector span={selected} />
              ) : (
                <Card title="Span Inspector">
                  <p className="text-xs text-muted-foreground">Click any span in the waterfall to inspect its attributes.</p>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
