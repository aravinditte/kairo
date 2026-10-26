import { describe, expect, it } from "vitest";
import { generateScenarioTraces } from "./scenarioFactory";
const base = { seed: 42, parameters: { delay_ms: 800 }, workload: 5, runCounter: 1, baseMs: 1_730_000_000_000, projectId: "demo-project" };
describe("scenario factory determinism", () => {
  it("same inputs produce identical trace and span ids", () => {
    const a = generateScenarioTraces({ ...base, scenarioId: "slow-inventory" });
    const b = generateScenarioTraces({ ...base, scenarioId: "slow-inventory" });
    expect(a.map((s) => s.span_id)).toEqual(b.map((s) => s.span_id));
    expect(a.map((s) => s.trace_id)).toEqual(b.map((s) => s.trace_id));
  });
  it("different run counter produces different traces", () => {
    const a = generateScenarioTraces({ ...base, scenarioId: "slow-inventory" });
    const b = generateScenarioTraces({ ...base, scenarioId: "slow-inventory", runCounter: 2 });
    expect(a[0].trace_id).not.toBe(b[0].trace_id);
  });
  it("slow inventory delays inventory spans beyond baseline checkout spans", () => {
    const spans = generateScenarioTraces({ ...base, scenarioId: "slow-inventory" });
    const inv = spans.filter((s) => s.service_name === "inventory" && s.span_kind === 2);
    expect(inv.length).toBe(5);
    expect(inv.every((s) => s.duration_ns >= 800_000_000)).toBe(true);
  });
  it("payment errors at 100% mark every payment and checkout root span as error", () => {
    const spans = generateScenarioTraces({ ...base, scenarioId: "payment-errors", parameters: { error_rate: 100 } });
    const pay = spans.filter((s) => s.service_name === "payment" && s.span_kind === 2);
    expect(pay.every((s) => s.status_code === "error")).toBe(true);
    const roots = spans.filter((s) => s.service_name === "checkout" && s.span_kind === 2);
    expect(roots.every((s) => s.status_code === "error")).toBe(true);
  });
  it("recovery traces are all healthy", () => {
    const spans = generateScenarioTraces({ ...base, scenarioId: "recovery", parameters: {} });
    expect(spans.every((s) => s.status_code !== "error")).toBe(true);
  });
  it("notification timeout records a timeout event and checkout still succeeds", () => {
    const spans = generateScenarioTraces({ ...base, scenarioId: "notification-timeout", parameters: { delay_ms: 1500 } });
    const client = spans.filter((s) => s.service_name === "checkout" && s.span_kind === 3 && s.operation_name.includes("notifications"));
    expect(client.some((s) => s.events.some((e) => e.name === "timeout"))).toBe(true);
    const roots = spans.filter((s) => s.service_name === "checkout" && s.span_kind === 2);
    expect(roots.every((s) => s.status_code !== "error")).toBe(true);
  });
});
