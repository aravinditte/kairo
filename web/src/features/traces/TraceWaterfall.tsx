import type { Span } from "../../types";
import { SPAN_KIND_LABELS } from "../../types";
import { formatDuration } from "../../lib/formatting";

export interface WaterfallRow { span: Span; depth: number; }
export function buildWaterfallRows(spans: Span[]): WaterfallRow[] {
  const byParent = new Map<string, Span[]>();
  const ids = new Set(spans.map((s) => s.span_id));
  const roots: Span[] = [];
  for (const s of spans) {
    if (s.parent_span_id && ids.has(s.parent_span_id)) { const a = byParent.get(s.parent_span_id) ?? []; a.push(s); byParent.set(s.parent_span_id, a); }
    else roots.push(s);
  }
  const byStart = (a: Span, b: Span) => Date.parse(a.start_time) - Date.parse(b.start_time);
  roots.sort(byStart); for (const a of byParent.values()) a.sort(byStart);
  const rows: WaterfallRow[] = []; const seen = new Set<string>();
  const walk = (s: Span, depth: number) => { if (seen.has(s.span_id)) return; seen.add(s.span_id); rows.push({ span: s, depth }); for (const c of byParent.get(s.span_id) ?? []) walk(c, depth + 1); };
  for (const r of roots) walk(r, 0);
  for (const s of spans) if (!seen.has(s.span_id)) rows.push({ span: s, depth: 0 });
  return rows;
}
export default function TraceWaterfall({ spans, selected, onSelect }: { spans: Span[]; selected: Span | null; onSelect: (s: Span) => void }) {
  const rows = buildWaterfallRows(spans);
  const min = Math.min(...spans.map((s) => Date.parse(s.start_time)));
  const max = Math.max(...spans.map((s) => Date.parse(s.end_time)));
  const total = Math.max(1, max - min);
  return (
    <div className="overflow-x-auto" role="table" aria-label="Trace waterfall">
      <div className="min-w-[760px]">
        <div className="flex justify-between text-xs text-zinc-500"><span>0 ms</span><span>{formatDuration(total * 1_000_000)} total</span></div>
        {rows.map(({ span, depth }) => {
          const left = ((Date.parse(span.start_time) - min) / total) * 100;
          const width = Math.max(0.6, (span.duration_ns / 1e6 / total) * 100);
          const isSel = selected?.span_id === span.span_id;
          return (
            <button key={span.span_id} type="button" onClick={() => onSelect(span)} aria-pressed={isSel}
              className={`flex w-full items-center gap-2 border-b border-zinc-100 py-1 text-left text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60 ${isSel ? "bg-teal-50 dark:bg-teal-950/40" : ""}`}>
              <span className="w-64 shrink-0 truncate" style={{ paddingLeft: depth * 16 }} title={`${span.service_name} ${span.operation_name}`}>
                <span className="font-medium text-zinc-700 dark:text-zinc-200">{span.service_name}</span> <span className="text-zinc-500">{span.operation_name}</span>
              </span>
              <span className="relative h-5 flex-1">
                <span className={`absolute top-0.5 h-4 rounded ${span.status_code === "error" ? "bg-red-500" : "bg-teal-500"}`} style={{ left: `${left}%`, width: `${width}%` }} />
              </span>
              <span className="w-32 shrink-0 text-right"><span className="mono">{formatDuration(span.duration_ns)}</span> <span className={span.status_code === "error" ? "font-semibold text-red-600 dark:text-red-400" : "text-zinc-500"}>{span.status_code === "error" ? "ERROR" : span.status_code}</span> <span className="text-zinc-400">{SPAN_KIND_LABELS[span.span_kind] ?? span.span_kind}</span></span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-500">Bars are aligned to the trace timeline. Indentation shows parent-child nesting. Distributed clocks may be skewed; treat small ordering anomalies cautiously.</p>
    </div>
  );
}
export function SpanInspector({ span }: { span: Span }) {
  const kv = (obj: Record<string, unknown>) => Object.entries(obj);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div><p className="text-xs text-zinc-500">Service</p><p className="font-medium">{span.service_name}</p></div>
        <div><p className="text-xs text-zinc-500">Operation</p><p className="font-medium">{span.operation_name}</p></div>
        <div><p className="text-xs text-zinc-500">Kind</p><p>{SPAN_KIND_LABELS[span.span_kind] ?? span.span_kind}</p></div>
        <div><p className="text-xs text-zinc-500">Duration</p><p className="mono">{formatDuration(span.duration_ns)}</p></div>
        <div><p className="text-xs text-zinc-500">Start</p><p className="mono text-xs">{span.start_time}</p></div>
        <div><p className="text-xs text-zinc-500">End</p><p className="mono text-xs">{span.end_time}</p></div>
        <div><p className="text-xs text-zinc-500">Span ID</p><p className="mono text-xs">{span.span_id}</p></div>
        <div><p className="text-xs text-zinc-500">Parent span ID</p><p className="mono text-xs">{span.parent_span_id ?? "none (root candidate)"}</p></div>
        <div><p className="text-xs text-zinc-500">Status</p><p>{span.status_code}{span.status_message ? ` - ${span.status_message}` : ""}</p></div>
      </div>
      <div><h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">Span attributes</h3>{kv(span.span_attributes).length ? <dl className="space-y-1">{kv(span.span_attributes).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="mono w-44 shrink-0 truncate text-xs text-zinc-500">{k}</dt><dd className="mono text-xs">{String(v)}</dd></div>)}</dl> : <p className="text-zinc-500">None recorded.</p>}</div>
      <div><h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">Events</h3>{span.events.length ? span.events.map((e, i) => <div key={i} className="rounded bg-zinc-50 p-2 dark:bg-zinc-800"><p className="font-medium">{e.name}</p><p className="mono text-xs text-zinc-500">{e.time}</p>{Object.entries(e.attributes).map(([k, v]) => <p key={k} className="mono text-xs">{k}: {String(v)}</p>)}</div>) : <p className="text-zinc-500">No events.</p>}</div>
      <div><h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">Resource attributes</h3>{kv(span.resource_attributes).map(([k, v]) => <p key={k} className="mono text-xs"><span className="text-zinc-500">{k}:</span> {String(v)}</p>)}</div>
      {span.links.length > 0 && <div><h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">Links</h3>{span.links.map((l, i) => <p key={i} className="mono text-xs">{l.trace_id} / {l.span_id}</p>)}</div>}
    </div>
  );
}
