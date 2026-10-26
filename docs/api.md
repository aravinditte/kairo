# API summary

Full schemas: `docs/openapi.yaml` (OpenAPI 3.1). All application endpoints are
under `/api/v1`, return JSON, and use the error envelope
`{"error":{"code":"...","message":"..."}}`.

## Auth
- Ingestion: `Authorization: Bearer <api-key>` or `X-Api-Key: <api-key>`.
  Project is resolved from the key.
- Management (projects, api-keys, settings writes): `X-Admin-Token`.
- Queries: admin token + `project_id` query parameter, **or** an API key
  (project resolved from the key).

## Endpoints
| Method & path | Purpose |
|---|---|
| `GET /healthz` | liveness |
| `GET /readyz` | readiness incl. database connectivity |
| `POST /v1/traces` | OTLP/HTTP ingestion (protobuf or JSON) |
| `POST/GET /api/v1/projects`, `GET/PATCH/DELETE /api/v1/projects/{id}` | project management |
| `POST/GET /api/v1/projects/{id}/api-keys`, `POST /api/v1/api-keys/{keyId}/revoke` | key lifecycle (raw key only in the create response) |
| `GET /api/v1/traces` | search: `start,end,service,operation,status,trace_id,min_duration_ns,max_duration_ns,limit,cursor` |
| `GET /api/v1/traces/{traceId}` | trace detail with all spans |
| `GET /api/v1/services`, `GET /api/v1/services/{name}` | observed services + detail |
| `GET /api/v1/dependencies` | observed dependency edges with counts/errors/latency (bare JSON array) |
| `GET /api/v1/metrics/red` | RED metrics + bucketed series |
| `GET /api/v1/overview` | dashboard assembly (KPIs, series, health, recent errors/traces) |
| `GET /api/v1/scenarios`, `POST /api/v1/scenarios`, `GET /api/v1/scenarios/{runId}`, `POST /api/v1/scenarios/{runId}/cancel` | Failure Lab |
| `GET /api/v1/alerts` | threshold alert events |
| `GET/PATCH /api/v1/settings/thresholds`, `GET/PATCH /api/v1/settings/retention` | project settings |

## Metric definitions (normative)
- A **request** is a span with `span_kind = SERVER` (2). Client/internal spans
  never count toward rate or error rate, so one logical request counts once.
- **Error rate** = error SERVER spans / all SERVER spans in the window.
- **Duration percentiles** (p50/p95/p99) are computed over SERVER span
  durations using the nearest-rank method; with no samples the API returns
  `null` percentiles — the UI shows “No data”, never a fake zero.
- **Rate** = SERVER spans / window seconds; bucketed series uses the
  requested `interval_seconds` (default 60, max window 7 days).
- Trace search ordering is stable: `start_time DESC, trace_id DESC`, with an
  opaque cursor encoding that pair. `limit` defaults to 50, max 200.
- Dependencies are derived from parent-child links across services in stored
  spans and are labelled *inferred from observed traces*.

## OTLP ingestion semantics
`POST /v1/traces` accepts `application/x-protobuf` and `application/json`
bodies parsed with the official OTLP protobuf types (protojson for JSON).
Invalid ids, invalid timestamp ranges, oversized bodies or batches are
rejected. Duplicate spans (same project/trace/span) are ignored via the
database unique constraint and reported in `partial_success` diagnostics in
logs; a batch is acknowledged only after durable storage succeeds.
