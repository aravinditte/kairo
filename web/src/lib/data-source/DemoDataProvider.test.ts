import { describe, expect, it } from "vitest";
import { DemoDataProvider } from "./DemoDataProvider";
const NOW = Date.UTC(2026, 0, 15, 12, 34, 0);
function wideWindow() { const end = new Date(NOW + 3600000).toISOString(); const start = new Date(NOW - 6 * 3600000).toISOString(); return { start, end }; }
describe("DemoDataProvider determinism", () => {
  it("same seed produces identical trace ids and counts", async () => {
    const a = new DemoDataProvider(42, NOW); const b = new DemoDataProvider(42, NOW);
    expect(a.traceIds()).toEqual(b.traceIds());
    expect(a.traceIds().length).toBeGreaterThan(50);
    expect(a.spanCount()).toBe(b.spanCount());
  });
  it("different seed produces different trace ids", () => {
    const a = new DemoDataProvider(42, NOW); const b = new DemoDataProvider(7, NOW);
    expect(a.traceIds()).not.toEqual(b.traceIds());
  });
  it("baseline covers all four demo services with consistent dependencies", async () => {
    const p = new DemoDataProvider(42, NOW); const w = wideWindow();
    const services = await p.getServices(w);
    expect(services.map((s) => s.service_name).sort()).toEqual(["checkout", "inventory", "notifications", "payment"]);
    const deps = await p.getDependencies(w);
    const pairs = deps.edges.map((e) => `${e.source}->${e.target}`);
    expect(pairs).toContain("checkout->inventory");
    expect(pairs).toContain("checkout->payment");
    expect(pairs).toContain("checkout->notifications");
  });
  it("overview KPIs are consistent with trace search totals", async () => {
    const p = new DemoDataProvider(42, NOW); const w = wideWindow();
    const overview = await p.getOverview({ ...w, interval_seconds: 300 });
    const services = await p.getServices(w);
    expect(overview.kpis.total_requests).toBe(services.reduce((a, s) => a + s.request_count, 0));
  });
});
describe("DemoDataProvider search filtering", () => {
  it("status=error returns only error traces", async () => {
    const p = new DemoDataProvider(42, NOW); const w = wideWindow();
    const res = await p.searchTraces({ ...w, status: "error", limit: 200 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.items.every((t) => t.has_error)).toBe(true);
  });
  it("service filter restricts to traces touching that service", async () => {
    const p = new DemoDataProvider(42, NOW); const w = wideWindow();
    const res = await p.searchTraces({ ...w, service: "payment", limit: 200 });
    expect(res.total).toBeGreaterThan(0);
    for (const t of res.items.slice(0, 5)) { const detail = await p.getTrace(t.trace_id); expect(detail?.spans.some((s) => s.service_name === "payment")).toBe(true); }
  });
  it("trace id search finds the trace, min duration filters", async () => {
    const p = new DemoDataProvider(42, NOW); const w = wideWindow();
    const all = await p.searchTraces({ ...w, limit: 5 });
    const one = await p.searchTraces({ ...w, trace_id: all.items[0].trace_id });
    expect(one.total).toBe(1);
    const slow = await p.searchTraces({ ...w, min_duration_ns: 10_000_000_000, limit: 200 });
    expect(slow.items.every((t) => t.duration_ns >= 10_000_000_000)).toBe(true);
  });
  it("pagination walks the full result set without duplicates", async () => {
    const p = new DemoDataProvider(42, NOW); const w = wideWindow();
    const seen = new Set<string>(); let cursor: string | null = null; let pages = 0;
    do { const res = await p.searchTraces({ ...w, limit: 20, cursor }); for (const t of res.items) { expect(seen.has(t.trace_id)).toBe(false); seen.add(t.trace_id); } cursor = res.next_cursor; pages++; } while (cursor && pages < 20);
    expect(seen.size).toBeGreaterThan(50);
  });
});
describe("DemoDataProvider scenario runs", () => {
  it("run adds deterministic traces and reset restores baseline", async () => {
    const p = new DemoDataProvider(42, NOW); const before = p.spanCount();
    const run = await p.runScenario({ scenario_id: "payment-errors", parameters: { error_rate: 100 }, workload: 5 });
    expect(run.status).toBe("completed");
    expect(run.result_summary?.failed).toBe(5);
    expect(run.result_summary?.trace_ids.length).toBe(5);
    expect(p.spanCount()).toBeGreaterThan(before);
    const detail = await p.getTrace(run.result_summary!.trace_ids[0]);
    expect(detail?.has_error).toBe(true);
    p.resetDemoData();
    expect(p.spanCount()).toBe(before);
  });
  it("tracks terminal console logs and supports clear", async () => {
    const p = new DemoDataProvider(42, NOW);
    const initialLogs = await p.getConsoleLogs();
    expect(initialLogs.length).toBeGreaterThan(0);
    p.addConsoleLog({ severity: "INFO", subsystem: "test", message: "Custom test execution event" });
    const updated = await p.getConsoleLogs();
    expect(updated[updated.length - 1].message).toBe("Custom test execution event");
    p.clearConsoleLogs();
    const cleared = await p.getConsoleLogs();
    expect(cleared.length).toBe(0);
  });
});
