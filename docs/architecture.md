# Kairo architecture

**See every path. Find every fault.**

Kairo is a lightweight, OpenTelemetry-native observability platform: it ingests
OTLP traces, stores spans durably, reconstructs service dependencies, derives
RED metrics from stored spans, and provides a Failure Lab that injects latency,
errors and timeouts into an isolated demo environment so failures can be
reproduced and investigated.

## Layers

```text
Instrumented demo services (checkout → inventory / payment / notifications)
        │  OTLP/HTTP (official OpenTelemetry protobuf + protojson), W3C traceparent
        ▼
Kairo API (Go modular monolith)
  ingest/otlp   — parse, validate, normalize (official OTLP types only)
  auth          — project API keys (SHA-256 hashed, revocable), admin token
  storage       — Store interface: PostgreSQL (pgx) or in-memory demo store
  metrics       — RED aggregation, percentiles, dependency reconstruction
  alerts        — threshold evaluation over a trailing 5-minute window
  scenarios     — Failure Lab runner (faults only on the demo services)
  retention     — bounded-batch deletion of spans older than retention
  httpserver    — REST API, error envelope, pagination, graceful shutdown
        │
        ▼
PostgreSQL (projects, api_keys, spans, scenario_runs, alert_events, thresholds)
        │  REST /api/v1
        ▼
React + TypeScript frontend (live API provider or deterministic demo provider)
```

## Key decisions

- **Modular monolith.** One Go binary for ingestion, query and scenarios;
  transport, domain logic and storage are separate packages so behaviour is
  testable without HTTP. See `docs/decisions/`.
- **Official OTLP types.** Ingestion parses `ExportTraceServiceRequest` with
  protobuf and protojson (`go.opentelemetry.io/proto/otlp`). There is no
  custom tracing format.
- **Database is the duplicate authority.** Span identity is
  `(project_id, trace_id, span_id)` with a unique constraint and
  conflict-safe insertion (`ON CONFLICT DO NOTHING` on PostgreSQL; the same
  key in the memory store). No in-memory dedup cache is trusted.
- **Durable acknowledgement.** `/v1/traces` returns success only after the
  storage transaction commits. Storage failure returns an OTLP-compatible
  error (503), never a false acknowledgement.
- **A "request" is a SERVER span.** RED metrics count spans with
  `span_kind = SERVER` only, so one logical request that produces server +
  client + internal spans is counted once. See `docs/api.md`.
- **Dependencies are observed, not declared.** An edge A → B exists only when
  a client/internal span in A is the parent of a span in B (or B's server span
  shares the parent) in stored traces. The UI labels edges as inferred from
  observed traces.
- **Tenant isolation.** The project is resolved from the presented API key
  (or, for management calls, from the admin token + explicit project id).
  A client-supplied project id alone grants nothing. Tests verify one
  project's key cannot read another project's data.
- **Two honest modes.** Local mode runs the real backend. The public demo is
  frontend-only with deterministic synthetic data, labelled as such in the
  UI; it never silently substitutes for a failing live API.

## Bounded resource usage

Body-size limit, spans-per-batch limit, attribute count/value limits, query
limit + maximum time window, scenario workload/parameter bounds, and database
timeouts via request contexts are enforced in config and validated at the
edges. Defaults are in `.env.example`.

## Self-observability

The API logs structured records (slog) for ingestion batch sizes, persisted /
duplicate / rejected span counts, query durations and scenario results, and
counts them in-process. It deliberately does **not** ingest its own telemetry
into itself, avoiding recursive trace loops.
