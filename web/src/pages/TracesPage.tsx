import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Search,
  Filter,
  X,
  ChevronLeft,
  ChevronRight,
  Activity,
  Layers,
  Clock,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useAppState } from "../app/providers";
import { useI18n } from "../lib/i18n";
import { DataState, EmptyState } from "../components/feedback";
import { Badge, btnGhost, btnCls, CopyButton, inputCls, PageTitle } from "../components/ui";
import { formatDuration, formatTimestamp, nsFromMs } from "../lib/formatting";
import type { TraceSearchQuery } from "../types";

export default function TracesPage() {
  const { provider, range, refreshTick } = useAppState();
  const { t } = useI18n();
  const [service, setService] = useState("");
  const [operation, setOperation] = useState("");
  const [status, setStatus] = useState<"" | "error" | "ok">("");
  const [traceId, setTraceId] = useState("");
  const [minMs, setMinMs] = useState("");
  const [maxMs, setMaxMs] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1];

  const query: TraceSearchQuery = useMemo(
    () => ({
      start: range.start,
      end: range.end,
      service: service || undefined,
      operation: operation || undefined,
      status,
      trace_id: traceId || undefined,
      min_duration_ns: nsFromMs(minMs),
      max_duration_ns: nsFromMs(maxMs),
      limit: 20,
      cursor,
    }),
    [range, service, operation, status, traceId, minMs, maxMs, cursor]
  );

  const services = useQuery({
    queryKey: ["services-list", range.start, refreshTick],
    queryFn: () => provider.getServices({ start: range.start, end: range.end }),
  });

  const q = useQuery({
    queryKey: ["traces", JSON.stringify(query), refreshTick],
    queryFn: () => provider.searchTraces(query),
  });

  const resetPage = () => setCursors([null]);
  const clearFilters = () => {
    setService("");
    setOperation("");
    setStatus("");
    setTraceId("");
    setMinMs("");
    setMaxMs("");
    resetPage();
  };

  const hasActiveFilters = Boolean(
    service || operation || status || traceId || minMs || maxMs
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title={t.traces.title}
        subtitle={t.traces.subtitle}
        actions={
          hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-2xs hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
              <span>Clear Filters</span>
            </button>
          ) : undefined
        }
      />

      {/* Filter Bar */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Filter className="size-3.5" />
          <span>Trace Filters</span>
        </div>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => e.preventDefault()}
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Service</label>
            <select
              className={`${inputCls} w-full`}
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                resetPage();
              }}
            >
              <option value="">All Services</option>
              {(services.data ?? []).map((s) => (
                <option key={s.service_name} value={s.service_name}>
                  {s.service_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Operation</label>
            <input
              className={`${inputCls} w-full`}
              value={operation}
              onChange={(e) => {
                setOperation(e.target.value);
                resetPage();
              }}
              placeholder="e.g. /checkout"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <select
              className={`${inputCls} w-full`}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                resetPage();
              }}
            >
              <option value="">Any Status</option>
              <option value="error">Errors Only</option>
              <option value="ok">Success Only</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Min Duration (ms)</label>
            <input
              className={`${inputCls} w-full`}
              type="number"
              min={0}
              value={minMs}
              onChange={(e) => {
                setMinMs(e.target.value);
                resetPage();
              }}
              placeholder="0"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Max Duration (ms)</label>
            <input
              className={`${inputCls} w-full`}
              type="number"
              min={0}
              value={maxMs}
              onChange={(e) => {
                setMaxMs(e.target.value);
                resetPage();
              }}
              placeholder="Any"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Trace ID</label>
            <input
              className={`${inputCls} mono w-full`}
              value={traceId}
              onChange={(e) => {
                setTraceId(e.target.value);
                resetPage();
              }}
              placeholder="Prefix or ID..."
            />
          </div>
        </form>
      </div>

      {/* Results Table */}
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        error={q.error}
        data={q.data}
        onRetry={() => q.refetch()}
      >
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState
              title="No traces match your filter criteria"
              icon={<Search className="size-6 text-muted-foreground" />}
            >
              Try widening the time window, clearing duration limits, or selecting All Services. Kairo
              never hallucinates or injects fake results when zero traces are found.
            </EmptyState>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Found <strong className="text-foreground">{d.total}</strong> matching trace{d.total === 1 ? "" : "s"} • Page {cursors.length}
                </span>
                {cursor && <span className="mono text-[10px]">Cursor: {cursor.slice(0, 12)}...</span>}
              </div>

              <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-xs">
                    <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="p-3.5 font-medium">Start Time</th>
                        <th className="p-3.5 font-medium">Root Service</th>
                        <th className="p-3.5 font-medium">Root Operation</th>
                        <th className="p-3.5 font-medium">Duration</th>
                        <th className="p-3.5 font-medium">Spans</th>
                        <th className="p-3.5 font-medium">Status</th>
                        <th className="p-3.5 font-medium">Trace ID</th>
                        <th className="p-3.5 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {d.items.map((t) => (
                        <tr
                          key={t.trace_id}
                          className="transition-colors hover:bg-muted/40"
                        >
                          <td className="mono p-3.5 whitespace-nowrap text-muted-foreground">
                            {formatTimestamp(t.start_time)}
                          </td>
                          <td className="p-3.5 font-medium text-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="size-2 rounded-full bg-blue-500" />
                              {t.root_service}
                            </span>
                          </td>
                          <td className="p-3.5 font-medium text-foreground">{t.root_operation}</td>
                          <td className="mono p-3.5 font-medium">{formatDuration(t.duration_ns)}</td>
                          <td className="p-3.5 text-muted-foreground">
                            <span className="mono">{t.span_count}</span>
                            {t.incomplete && (
                              <span className="ml-1 rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
                                Incomplete
                              </span>
                            )}
                          </td>
                          <td className="p-3.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {t.has_error ? (
                                <Badge tone="error">Error</Badge>
                              ) : (
                                <Badge tone="ok">OK</Badge>
                              )}
                              <Link
                                to="/failure-lab"
                                className="rounded border border-[#F472B6]/30 bg-[#F472B6]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#F472B6] hover:bg-[#F472B6]/20 transition-colors"
                                title="Inspect in Failure Lab"
                              >
                                Generated By Scenario
                              </Link>
                            </div>
                          </td>
                          <td className="p-3.5">
                            <Link
                              className="mono font-semibold text-[#F472B6] hover:underline"
                              to={`/traces/${t.trace_id}`}
                            >
                              {t.trace_id.slice(0, 12)}...
                            </Link>
                          </td>
                          <td className="p-3.5 text-right">
                            <CopyButton text={t.trace_id} label="Copy ID" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination controls */}
              <div className="flex items-center justify-between border-t border-border/60 pt-4">
                <span className="text-xs text-muted-foreground">
                  Showing 20 items per page
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={btnGhost}
                    disabled={cursors.length <= 1}
                    onClick={() => setCursors((c) => c.slice(0, -1))}
                  >
                    <ChevronLeft className="size-3.5" />
                    <span>Previous</span>
                  </button>
                  <button
                    type="button"
                    className={btnGhost}
                    disabled={!d.next_cursor}
                    onClick={() => setCursors((c) => [...c, d.next_cursor])}
                  >
                    <span>Next</span>
                    <ChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )
        }
      </DataState>
    </div>
  );
}
