# Demo modes

Kairo has two deliberately distinct modes. Mixing them up would be dishonest,
so the UI always shows which one is active.

## Local application mode (real telemetry)
Docker Compose (or the local processes) run PostgreSQL, the Kairo API, the
four instrumented demo services and the frontend in `api` mode. Every trace
in the UI was produced by a real request, propagated with W3C Trace Context,
sent over OTLP/HTTP, and persisted. The Failure Lab sets real faults on the
demo services and runs a real workload against checkout.

## Public demonstration mode (synthetic, frontend-only)
The static frontend build (`VITE_DATA_MODE=demo`) needs no backend, database
or login. It ships a deterministic dataset generated in the browser from a
seeded RNG (`VITE_DEMO_SCENARIO_SEED`): healthy and failed traces, services
and dependencies that match those traces, and metrics computed from that same
data. Failure Lab scenarios *simulate* outcomes in the browser and append
deterministic synthetic traces; the page labels them as simulations. A reset
action restores the exact baseline dataset. Nothing in demo mode is evidence
of a real backend workload, and the UI says so (banner + data-source
indicator).

## Failure Lab scenarios (both modes)
- **Slow Inventory** — injects a bounded delay into Inventory; checkout traces
  show the delayed span and p95 rises for inventory/checkout.
- **Payment Errors** — Payment returns HTTP 500 for a configured proportion of
  requests (deterministic sequence); error spans become searchable and the
  error rate moves.
- **Notification Timeout** — Notification is delayed past checkout's 800 ms
  client timeout; checkout still completes (notification is non-fatal) and
  the trace shows the timed-out client span, distinguishable from a payment
  failure.
- **Recovery** — clears all faults and re-runs the same workload; new traces
  return to baseline and can be compared with the fault window.
