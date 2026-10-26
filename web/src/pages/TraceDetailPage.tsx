import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
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
  const q = useQuery({ queryKey: ["trace", traceId, refreshTick], queryFn: () => provider.getTrace(traceId) });
  const selected: Span | null = useMemo(() => q.data?.spans.find((s) => s.span_id === selectedId) ?? q.data?.spans.find((s) => s.status_code === "error") ?? q.data?.spans[0] ?? null, [q.data, selectedId]);
  return (
    <div>
      <PageTitle title="Trace detail" subtitle="Parent-child waterfall with a span inspector. Span relationships come from the stored spans for this trace." />
      {q.isLoading ? <DataState isLoading isError={false} error={null} data={undefined}>{() => null}</DataState> : q.isError ? <DataState isLoading={false} isError error={q.error} data={undefined} onRetry={() => q.refetch()}>{() => null}</DataState> : !q.data ? <EmptyState title="Trace not found">No spans are stored for trace ID <span className="mono">{traceId}</span> in this project. It may have expired under the retention policy or belong to another project.</EmptyState> : (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-3"><h2 className="mono break-all text-sm font-semibold">{q.data.trace_id}</h2><CopyButton text={q.data.trace_id} label="Copy trace ID" />{q.data.has_error ? <Badge tone="error">Error</Badge> : <Badge tone="ok">OK</Badge>}{q.data.incomplete && <Badge tone="warn">Possibly incomplete</Badge>}</div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <div><dt className="text-xs text-zinc-500">Root operation</dt><dd className="font-medium">{q.data.root_operation}</dd></div>
              <div><dt className="text-xs text-zinc-500">Root service</dt><dd className="font-medium">{q.data.root_service}</dd></div>
              <div><dt className="text-xs text-zinc-500">Duration</dt><dd className="font-medium">{formatDuration(q.data.duration_ns)}</dd></div>
              <div><dt className="text-xs text-zinc-500">Started</dt><dd className="font-medium">{formatTimestamp(q.data.start_time)}</dd></div>
              <div><dt className="text-xs text-zinc-500">Services</dt><dd className="font-medium">{q.data.services.length}</dd></div>
              <div><dt className="text-xs text-zinc-500">Spans / errors</dt><dd className="font-medium">{q.data.span_count} / {q.data.error_count}</dd></div>
            </dl>
            {q.data.error_summary && <p className="mt-2 text-sm text-red-600 dark:text-red-400">Error summary: {q.data.error_summary}</p>}
            {q.data.incomplete && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">Some spans reference parents that are not in this trace (sampling, retention, or partial ingestion). The trace may be incomplete.</p>}
            <p className="mt-2 text-sm text-zinc-500">Services in this trace: {q.data.services.map((s) => (<Link key={s} className="mr-2 text-teal-700 hover:underline dark:text-teal-300" to={`/services/${encodeURIComponent(s)}`}>{s}</Link>))}</p>
          </Card>
          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card title="Waterfall"><TraceWaterfall spans={q.data.spans} selected={selected} onSelect={(s) => setSelectedId(s.span_id)} /></Card>
            <Card title="Span inspector">{selected ? <SpanInspector span={selected} /> : <p className="text-sm text-zinc-500">Select a span in the waterfall to inspect it.</p>}</Card>
          </div>
        </div>
      )}
    </div>
  );
}
