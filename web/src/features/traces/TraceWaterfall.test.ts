import { describe, expect, it } from "vitest";
import { buildWaterfallRows } from "./TraceWaterfall";
import type { Span } from "../../types";

function mockSpan(span_id: string, parent_span_id: string | null, start_time: string, duration_ns = 10_000_000): Span {
  const start = Date.parse(start_time);
  const end = new Date(start + Math.floor(duration_ns / 1e6)).toISOString();
  return {
    project_id: "demo-project",
    trace_id: "test-trace-id-1234567890abcdef",
    span_id,
    parent_span_id,
    service_name: "test-service",
    operation_name: `op-${span_id}`,
    span_kind: 1,
    start_time,
    end_time: end,
    duration_ns,
    status_code: "ok",
    resource_attributes: {},
    span_attributes: {},
    events: [],
    links: [],
    ingested_at: start_time,
  };
}

describe("TraceWaterfall buildWaterfallRows", () => {
  it("builds a single root row at depth 0", () => {
    const spans = [mockSpan("root", null, "2026-01-01T00:00:00.000Z")];
    const rows = buildWaterfallRows(spans);
    expect(rows).toHaveLength(1);
    expect(rows[0].span.span_id).toBe("root");
    expect(rows[0].depth).toBe(0);
  });

  it("nests children and grandchildren with correct depths", () => {
    const spans = [
      mockSpan("root", null, "2026-01-01T00:00:00.000Z", 50_000_000),
      mockSpan("child-1", "root", "2026-01-01T00:00:00.010Z", 20_000_000),
      mockSpan("grandchild-1", "child-1", "2026-01-01T00:00:00.015Z", 10_000_000),
      mockSpan("child-2", "root", "2026-01-01T00:00:00.035Z", 10_000_000),
    ];
    const rows = buildWaterfallRows(spans);
    expect(rows.map((r) => ({ id: r.span.span_id, depth: r.depth }))).toEqual([
      { id: "root", depth: 0 },
      { id: "child-1", depth: 1 },
      { id: "grandchild-1", depth: 2 },
      { id: "child-2", depth: 1 },
    ]);
  });

  it("handles spans with missing parents gracefully at depth 0", () => {
    const spans = [
      mockSpan("orphan", "missing-parent", "2026-01-01T00:00:00.000Z"),
    ];
    const rows = buildWaterfallRows(spans);
    expect(rows).toHaveLength(1);
    expect(rows[0].span.span_id).toBe("orphan");
    expect(rows[0].depth).toBe(0);
  });
});
