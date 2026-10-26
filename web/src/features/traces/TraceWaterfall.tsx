import type { Span } from "../../types";
import { SPAN_KIND_LABELS } from "../../types";
import { formatDuration } from "../../lib/formatting";
import { Badge } from "../../components/ui";

export interface WaterfallRow {
  span: Span;
  depth: number;
}

export function buildWaterfallRows(spans: Span[]): WaterfallRow[] {
  const byParent = new Map<string, Span[]>();
  const ids = new Set(spans.map((s) => s.span_id));
  const roots: Span[] = [];
  for (const s of spans) {
    if (s.parent_span_id && ids.has(s.parent_span_id)) {
      const a = byParent.get(s.parent_span_id) ?? [];
      a.push(s);
      byParent.set(s.parent_span_id, a);
    } else {
      roots.push(s);
    }
  }
  const byStart = (a: Span, b: Span) => Date.parse(a.start_time) - Date.parse(b.start_time);
  roots.sort(byStart);
  for (const a of byParent.values()) a.sort(byStart);
  const rows: WaterfallRow[] = [];
  const seen = new Set<string>();
  const walk = (s: Span, depth: number) => {
    if (seen.has(s.span_id)) return;
    seen.add(s.span_id);
    rows.push({ span: s, depth });
    for (const c of byParent.get(s.span_id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const s of spans) if (!seen.has(s.span_id)) rows.push({ span: s, depth: 0 });
  return rows;
}

export default function TraceWaterfall({
  spans,
  selected,
  onSelect,
}: {
  spans: Span[];
  selected: Span | null;
  onSelect: (s: Span) => void;
}) {
  const rows = buildWaterfallRows(spans);
  const min = Math.min(...spans.map((s) => Date.parse(s.start_time)));
  const max = Math.max(...spans.map((s) => Date.parse(s.end_time)));
  const total = Math.max(1, max - min);

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card p-4 shadow-xs" role="table" aria-label="Trace waterfall">
      <div className="min-w-[760px]">
        <div className="mb-2 flex justify-between border-b border-border/60 pb-2 text-xs font-medium text-muted-foreground">
          <span>0 ms (start)</span>
          <span>Timeline: {formatDuration(total * 1_000_000)} total elapsed</span>
        </div>
        <div className="divide-y divide-border/40">
          {rows.map(({ span, depth }) => {
            const left = ((Date.parse(span.start_time) - min) / total) * 100;
            const width = Math.max(0.6, (span.duration_ns / 1e6 / total) * 100);
            const isSel = selected?.span_id === span.span_id;
            const isErr = span.status_code === "error";

            return (
              <button
                key={span.span_id}
                type="button"
                onClick={() => onSelect(span)}
                aria-pressed={isSel}
                className={`flex w-full items-center gap-3 py-2 text-left text-xs transition-colors hover:bg-muted/50 ${
                  isSel ? "bg-accent text-accent-foreground font-medium" : "text-foreground"
                }`}
              >
                <div
                  className="flex w-72 shrink-0 items-center gap-1.5 truncate"
                  style={{ paddingLeft: depth * 16 }}
                  title={`${span.service_name} • ${span.operation_name}`}
                >
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: isErr ? "#ff6568" : "#3080ff" }} />
                  <span className="font-semibold text-foreground">{span.service_name}</span>
                  <span className="text-muted-foreground truncate">{span.operation_name}</span>
                </div>
                <div className="relative h-6 flex-1 rounded bg-muted/30">
                  <span
                    className={`absolute top-1 h-4 rounded-sm transition-all ${
                      isErr ? "bg-red-500 dark:bg-red-400" : "bg-blue-600 dark:bg-blue-500"
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                </div>
                <div className="flex w-44 shrink-0 items-center justify-end gap-2 text-right">
                  <span className="mono font-medium">{formatDuration(span.duration_ns)}</span>
                  {isErr ? (
                    <Badge tone="error">ERR</Badge>
                  ) : (
                    <Badge tone="ok">OK</Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground uppercase">{SPAN_KIND_LABELS[span.span_kind] ?? span.span_kind}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Bars indicate start time and duration relative to the trace root. Indentation reflects parent-child invocation hierarchy.
      </p>
    </div>
  );
}

export function SpanInspector({ span }: { span: Span }) {
  const kv = (obj: Record<string, unknown>) => Object.entries(obj);
  const isErr = span.status_code === "error";

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5 text-sm text-card-foreground shadow-xs">
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div>
          <h3 className="font-semibold text-foreground">Span Inspector</h3>
          <p className="mono text-xs text-muted-foreground">{span.span_id}</p>
        </div>
        <Badge tone={isErr ? "error" : "ok"}>
          {isErr ? "Error" : "OK"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
          <p className="text-xs font-medium text-muted-foreground">Service</p>
          <p className="mt-0.5 font-semibold text-foreground">{span.service_name}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
          <p className="text-xs font-medium text-muted-foreground">Operation</p>
          <p className="mt-0.5 font-semibold text-foreground">{span.operation_name}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
          <p className="text-xs font-medium text-muted-foreground">Duration</p>
          <p className="mono mt-0.5 font-semibold text-foreground">{formatDuration(span.duration_ns)}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
          <p className="text-xs font-medium text-muted-foreground">Span Kind</p>
          <p className="mt-0.5 text-foreground">{SPAN_KIND_LABELS[span.span_kind] ?? span.span_kind}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div className="flex justify-between rounded border border-border/40 p-2">
          <span className="text-muted-foreground">Start Time:</span>
          <span className="mono font-medium">{span.start_time}</span>
        </div>
        <div className="flex justify-between rounded border border-border/40 p-2">
          <span className="text-muted-foreground">End Time:</span>
          <span className="mono font-medium">{span.end_time}</span>
        </div>
        <div className="flex justify-between rounded border border-border/40 p-2">
          <span className="text-muted-foreground">Parent Span ID:</span>
          <span className="mono font-medium">{span.parent_span_id ?? "None (Root)"}</span>
        </div>
        <div className="flex justify-between rounded border border-border/40 p-2">
          <span className="text-muted-foreground">Status Message:</span>
          <span className="font-medium text-foreground">{span.status_message || "—"}</span>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Span Attributes
        </h4>
        {kv(span.span_attributes).length ? (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <dl className="divide-y divide-border/40">
              {kv(span.span_attributes).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-1.5 text-xs">
                  <dt className="mono text-muted-foreground">{k}</dt>
                  <dd className="mono font-medium text-foreground">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No custom span attributes recorded.</p>
        )}
      </div>

      {span.events.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Span Events ({span.events.length})
          </h4>
          <div className="space-y-2">
            {span.events.map((e, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-foreground">{e.name}</p>
                  <p className="mono text-muted-foreground">{e.time}</p>
                </div>
                {Object.entries(e.attributes).map(([k, v]) => (
                  <p key={k} className="mono mt-1 text-muted-foreground">
                    {k}: <span className="text-foreground">{String(v)}</span>
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {kv(span.resource_attributes).length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Resource Attributes
          </h4>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <dl className="divide-y divide-border/40">
              {kv(span.resource_attributes).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-1.5">
                  <dt className="mono text-muted-foreground">{k}</dt>
                  <dd className="mono font-medium text-foreground">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
