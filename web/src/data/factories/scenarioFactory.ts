import { hashSeed, mulberry32 } from "../../lib/rng";
import type { ScenarioDefinition, Span } from "../../types";
import { buildTrace } from "./traceFactory";

export const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  { id: "slow-inventory", name: "Slow Inventory", description: "Inject a configurable delay into Inventory responses. Checkout requests take longer, the delayed Inventory span is visible in the waterfall, and latency analytics reflect the affected service.", parameters: [{ key: "delay_ms", label: "Added inventory delay", min: 0, max: 5000, default: 800, unit: "ms" }] },
  { id: "payment-errors", name: "Payment Errors", description: "Return controlled HTTP 5xx responses from Payment for a configurable proportion of requests. Failed spans carry error status, are findable in trace search, and raise the error rate.", parameters: [{ key: "error_rate", label: "Payment error rate", min: 0, max: 100, default: 50, unit: "%" }] },
  { id: "notification-timeout", name: "Notification Timeout", description: "Delay the Notification path beyond the checkout client timeout (800 ms). Notification failure is non-fatal for checkout, but the trace makes the timed-out operation unmistakable.", parameters: [{ key: "delay_ms", label: "Notification delay", min: 0, max: 5000, default: 1500, unit: "ms" }] },
  { id: "recovery", name: "Recovery / Healthy Baseline", description: "Disable injected faults and run the same workload again. New traces return to baseline behaviour, distinct from the earlier failed requests in the same window.", parameters: [] },
];
export function defaultParams(def: ScenarioDefinition): Record<string, number> {
  return Object.fromEntries(def.parameters.map((p) => [p.key, p.default]));
}
/** Deterministic: same (seed, scenario, params, workload, runCounter, baseMs) -> identical trace and span ids. */
export function generateScenarioTraces(args: { seed: number; scenarioId: string; parameters: Record<string, number>; workload: number; runCounter: number; baseMs: number; projectId: string }): Span[] {
  const key = `${args.seed}:${args.scenarioId}:${JSON.stringify(args.parameters)}:${args.workload}:${args.runCounter}`;
  const rng = mulberry32(hashSeed(key));
  const spans: Span[] = [];
  for (let i = 0; i < args.workload; i++) {
    const r = rng();
    let opts: Parameters<typeof buildTrace>[1] = { projectId: args.projectId, startMs: args.baseMs + i * 2000 };
    if (args.scenarioId === "slow-inventory") opts = { ...opts, inventoryDelayMs: args.parameters.delay_ms ?? 800 };
    else if (args.scenarioId === "payment-errors") opts = { ...opts, paymentError: r < (args.parameters.error_rate ?? 50) / 100 };
    else if (args.scenarioId === "notification-timeout") opts = { ...opts, notificationTimeout: (args.parameters.delay_ms ?? 1500) > 800, notificationDelayMs: args.parameters.delay_ms ?? 1500 };
    spans.push(...buildTrace(rng, opts));
  }
  return spans;
}
