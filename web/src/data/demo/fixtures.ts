import { mulberry32 } from "../../lib/rng";
import { buildTrace } from "../factories/traceFactory";
import type { Span } from "../../types";

export const DEMO_PROJECT_ID = "demo-project";
export const DEMO_SERVICES = ["checkout", "inventory", "payment", "notifications"] as const;
/**
 * Baseline demo dataset. Base window is anchored to "now rounded to the hour":
 * traces are spread deterministically over the hour that ends at the next hour
 * boundary start (i.e. the 60 minutes before the current hour plus the elapsed
 * part of this hour is covered by the default 6h UI range).
 */
export function generateBaselineSpans(seed: number, nowMs: number, projectId = DEMO_PROJECT_ID): Span[] {
  const rng = mulberry32(seed);
  const hourStart = Math.floor(nowMs / 3_600_000) * 3_600_000;
  const baseStart = hourStart - 3_600_000; // start of previous hour
  const count = 120;
  const spans: Span[] = [];
  for (let i = 0; i < count; i++) {
    const startMs = baseStart + i * 30_000 + Math.floor(rng() * 15_000);
    const paymentError = rng() < 0.1;
    const notificationTimeout = !paymentError && rng() < 0.06;
    const slowInventory = rng() < 0.05;
    spans.push(...buildTrace(rng, {
      projectId, startMs, paymentError, notificationTimeout,
      inventoryDelayMs: slowInventory ? 300 + rng() * 300 : 0,
    }));
  }
  return spans;
}
