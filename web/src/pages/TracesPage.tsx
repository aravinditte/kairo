import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAppState } from "../app/providers";
import { DataState, EmptyState } from "../components/feedback";
import { Badge, btnGhost, CopyButton, inputCls, PageTitle } from "../components/ui";
import { formatDuration, formatTimestamp, nsFromMs } from "../lib/formatting";
import type { TraceSearchQuery } from "../types";

export default function TracesPage() {
  const { provider, range, refreshTick } = useAppState();
  const [service, setService] = useState(""); const [operation, setOperation] = useState("");
  const [status, setStatus] = useState<"" | "error" | "ok">(""); const [traceId, setTraceId] = useState("");
  const [minMs, setMinMs] = useState(""); const [maxMs, setMaxMs] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];
  const query: TraceSearchQuery = useMemo(() => ({ start: range.start, end: range.end, service: service || undefined, operation: operation || undefined, status, trace_id: traceId || undefined, min_duration_ns: nsFromMs(minMs), max_duration_ns: nsFromMs(maxMs), limit: 20, cursor }), [range, service, operation, status, traceId, minMs, maxMs, cursor]);
  const services = useQuery({ queryKey: ["services-list", range.start, refreshTick], queryFn: () => provider.getServices({ start: range.start, end: range.end }) });
  const q = useQuery({ queryKey: ["traces", JSON.stringify(query), refreshTick], queryFn: () => provider.searchTraces(query) });
  const resetPage = () => setCursors([null]);
  return (
    <div>
      <PageTitle title="Trace explorer" subtitle="Search persisted traces. Filters apply on the server in live mode and deterministically in demo mode." />
      <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(e) => e.preventDefault()}>
        <label className="text-xs text-zinc-500">Service<select className={inputCls} value={service} onChange={(e) => { setService(e.target.value); resetPage(); }}><option value="">All services</option>{(services.data ?? []).map((s) => <option key={s.service_name} value={s.service_name}>{s.service_name}</option>)}</select></label>
        <label className="text-xs text-zinc-500">Operation contains<input className={inputCls} value={operation} onChange={(e) => { setOperation(e.target.value); resetPage(); }} placeholder="e.g. /checkout" /></label>
        <label className="text-xs text-zinc-500">Status<select className={inputCls} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); resetPage(); }}><option value="">Any status</option><option value="error">Error only</option><option value="ok">OK only</option></select></label>
        <label className="text-xs text-zinc-500">Min duration (ms)<input className={inputCls} type="number" min={0} value={minMs} onChange={(e) => { setMinMs(e.target.value); resetPage(); }} /></label>
        <label className="text-xs text-zinc-500">Max duration (ms)<input className={inputCls} type="number" min={0} value={maxMs} onChange={(e) => { setMaxMs(e.target.value); resetPage(); }} /></label>
        <label className="text-xs text-zinc-500">Trace ID search<input className={`${inputCls} mono w-56`} value={traceId} onChange={(e) => { setTraceId(e.target.value); resetPage(); }} placeholder="full or partial trace id" /></label>
      </form>
      <DataState isLoading={q.isLoading} isError={q.isError} error={q.error} data={q.data} onRetry={() => q.refetch()}>
        {(d) => d.items.length === 0 ? <EmptyState title="No traces match these filters">Widen the time range or clear a filter. Missing data is shown as an empty result, never replaced with invented traces.</EmptyState> : (
          <div>
            <p className="mb-2 text-sm text-zinc-500">{d.total} matching trace{d.total === 1 ? "" : "s"} - page {cursors.length}</p>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="text-zinc-500"><th className="p-3">Start time</th><th>Service</th><th>Root operation</th><th>Duration</th><th>Spans</th><th>Status</th><th>Trace ID</th><th></th></tr></thead>
              <tbody>{d.items.map((t) => (<tr key={t.trace_id} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"><td className="whitespace-nowrap p-3">{formatTimestamp(t.start_time)}</td><td>{t.root_service}</td><td>{t.root_operation}</td><td>{formatDuration(t.duration_ns)}</td><td>{t.span_count}{t.incomplete ? " (incomplete)" : ""}</td><td>{t.has_error ? <Badge tone="error">Error</Badge> : <Badge tone="ok">OK</Badge>}</td><td><Link className="mono text-teal-700 hover:underline dark:text-teal-300" to={`/traces/${t.trace_id}`}>{t.trace_id.slice(0, 16)}...</Link></td><td><CopyButton text={t.trace_id} label="Copy ID" /></td></tr>))}</tbody></table>
            </div>
            <div className="mt-3 flex gap-2">
              <button className={btnGhost} disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>Previous page</button>
              <button className={btnGhost} disabled={!d.next_cursor} onClick={() => setCursors((c) => [...c, d.next_cursor])}>Next page</button>
            </div>
          </div>
        )}
      </DataState>
    </div>
  );
}
