import { hexFromRng } from "../../lib/rng";
import type { Span } from "../../types";

export interface TraceOptions {
  projectId: string;
  startMs: number;
  inventoryDelayMs?: number;
  paymentError?: boolean;
  notificationTimeout?: boolean;
  notificationDelayMs?: number;
  trafficSpikeMultiplier?: number;
  cascadingFailure?: boolean;
  incompleteTrace?: boolean;
  scenarioId?: string;
}
function iso(ms: number) { return new Date(ms).toISOString(); }
interface Partial { service: string; op: string; kind: number; parent: string | null; start: number; durMs: number; error?: string; attrs?: Record<string, unknown>; events?: Span["events"]; }
export function buildTrace(rng: () => number, opts: TraceOptions): Span[] {
  const traceId = hexFromRng(rng, 32);
  const ids: string[] = Array.from({ length: 10 }, () => hexFromRng(rng, 16));
  const mult = opts.trafficSpikeMultiplier ? Math.max(1, opts.trafficSpikeMultiplier * 0.7) : 1;
  const invBase = (40 + rng() * 50 + (opts.inventoryDelayMs ?? 0)) * mult;
  const payBase = (60 + rng() * 60) * mult;
  const notifDelay = opts.notificationTimeout ? (opts.notificationDelayMs ?? 1500) : 0;
  const notifBase = (30 + rng() * 40 + notifDelay) * mult;
  const notifElapsed = opts.notificationTimeout ? 800 : notifBase; // checkout client timeout is 800 ms
  const t0 = opts.startMs;
  const invStart = t0 + 5, payStart = invStart + invBase + 12, notifStart = payStart + payBase + 12;
  const total = 5 + invBase + 12 + payBase + 12 + notifElapsed + 10;
  const isCascade = !!opts.cascadingFailure;
  const paymentError = !!opts.paymentError || isCascade;
  const inventoryError = isCascade ? "Inventory out of stock: cascading abort" : undefined;
  const checkoutError = paymentError
    ? "Payment failed: checkout returned 502"
    : isCascade
    ? "Cascading failure: downstream inventory depletion"
    : undefined;

  const parts: Partial[] = [
    {
      service: "checkout",
      op: "POST /checkout",
      kind: 2,
      parent: opts.incompleteTrace ? null : null,
      start: t0,
      durMs: total,
      error: checkoutError,
      attrs: {
        "http.request.method": "POST",
        "http.route": "/checkout",
        "http.response.status_code": checkoutError ? 502 : 200,
      },
    },
    {
      service: "checkout",
      op: "GET inventory /reserve",
      kind: 3,
      parent: opts.incompleteTrace ? "unobserved_parent_span" : ids[0],
      start: invStart - 2,
      durMs: invBase + 4,
      error: inventoryError,
      attrs: { "server.address": "inventory" },
    },
    {
      service: "inventory",
      op: "GET /reserve",
      kind: 2,
      parent: ids[1],
      start: invStart,
      durMs: invBase,
      error: inventoryError,
      attrs: { "http.route": "/reserve" },
    },
    {
      service: "inventory",
      op: "inventory.reserve",
      kind: 1,
      parent: ids[2],
      start: invStart + 3,
      durMs: Math.max(5, invBase - 6),
      error: inventoryError,
      attrs: { "inventory.items": 2 },
    },
    {
      service: "checkout",
      op: "POST payment /charge",
      kind: 3,
      parent: opts.incompleteTrace ? "unobserved_parent_span" : ids[0],
      start: payStart - 2,
      durMs: payBase + 4,
      error: paymentError ? "Payment gateway returned 502" : undefined,
      attrs: { "server.address": "payment" },
    },
    {
      service: "payment",
      op: "POST /charge",
      kind: 2,
      parent: ids[4],
      start: payStart,
      durMs: payBase,
      error: paymentError ? "Payment gateway returned 502" : undefined,
      attrs: { "http.route": "/charge", "payment.currency": "INR" },
      events: paymentError
        ? [
            {
              name: "exception",
              time: iso(payStart + payBase),
              attributes: {
                "exception.type": "PaymentGatewayError",
                "exception.message": "Upstream payment gateway returned 502",
              },
            },
          ]
        : [],
    },
    {
      service: "payment",
      op: "payment.charge",
      kind: 1,
      parent: ids[5],
      start: payStart + 4,
      durMs: Math.max(5, payBase - 8),
      error: paymentError ? "Payment gateway returned 502" : undefined,
    },
    {
      service: "checkout",
      op: "POST notifications /notify",
      kind: 3,
      parent: opts.incompleteTrace ? "unobserved_parent_span" : ids[0],
      start: notifStart - 2,
      durMs: notifElapsed,
      error: opts.notificationTimeout ? "Notification call timed out after 800 ms" : undefined,
      attrs: { "server.address": "notifications" },
      events: opts.notificationTimeout
        ? [
            {
              name: "timeout",
              time: iso(notifStart + 800),
              attributes: { "timeout.ms": 800 },
            },
          ]
        : [],
    },
    {
      service: "notifications",
      op: "POST /notify",
      kind: 2,
      parent: ids[7],
      start: notifStart,
      durMs: notifBase,
      error: opts.notificationTimeout ? "Notification send exceeded deadline" : undefined,
      attrs: { "http.route": "/notify", "notification.channel": "email" },
    },
    {
      service: "notifications",
      op: "notification.send",
      kind: 1,
      parent: ids[8],
      start: notifStart + 3,
      durMs: Math.max(5, notifBase - 6),
      error: opts.notificationTimeout ? "Notification send exceeded deadline" : undefined,
    },
  ];

  const selectedParts = opts.incompleteTrace ? parts.slice(1) : parts;

  return selectedParts.map((p, i) => {
    const spanId = opts.incompleteTrace ? ids[i + 1] : ids[i];
    return {
      project_id: opts.projectId,
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: p.parent,
      service_name: p.service,
      operation_name: p.op,
      span_kind: p.kind,
      start_time: iso(p.start),
      end_time: iso(p.start + p.durMs),
      duration_ns: Math.round(p.durMs * 1_000_000),
      status_code: p.error ? ("error" as const) : ("ok" as const),
      status_message: p.error ?? null,
      resource_attributes: {
        "service.name": p.service,
        "telemetry.sdk.name": "opentelemetry",
        "kairo.synthetic": true,
        ...(opts.scenarioId ? { "kairo.scenario_id": opts.scenarioId } : {}),
      },
      span_attributes: {
        ...(p.attrs ?? {}),
        ...(opts.scenarioId ? { "kairo.scenario": opts.scenarioId } : {}),
      },
      events: p.events ?? [],
      links: [],
      ingested_at: iso(p.start + p.durMs + 5),
    };
  });
}
