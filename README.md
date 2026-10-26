# Kairo

**See every path. Find every fault.**

Kairo is a lightweight, OpenTelemetry-native observability and failure
investigation platform. It ingests distributed traces over OTLP/HTTP, stores
spans in PostgreSQL, reconstructs service dependencies, derives RED metrics
from stored spans, and ships a **Failure Lab** that injects latency, errors
and timeouts into an isolated demo environment so you can reproduce a failure
and follow its trace end to end.

![License: MIT](https://img.shields.io/badge/license-MIT-green)

## Quick start

### Option A — full local stack (Docker Compose)

```bash
docker compose -f deploy/docker-compose.yml up --build
# Frontend (API mode):  http://localhost:5173
# API:                   http://localhost:8080/healthz
docker compose -f deploy/docker-compose.yml down      # stop
docker compose -f deploy/docker-compose.yml down -v   # stop + delete data
```

Windows PowerShell: the same `docker compose` commands work as-is.

### Option B — no Docker, no PostgreSQL (in-memory demo storage)

Requires Go 1.23+ and Node 20+.

```bash
# 1) API (seeds a demo project and the documented dev key on first run)
KAIRO_DEMO_MODE=true KAIRO_SEED_DEMO=true go run ./cmd/kairo-api   # :8080

# 2) Demo services (four terminals, or background them)
KAIRO_API_KEY=kairo-dev-key PORT=8082 go run ./services/inventory
KAIRO_API_KEY=kairo-dev-key PORT=8083 go run ./services/payment
KAIRO_API_KEY=kairo-dev-key PORT=8084 go run ./services/notifications
KAIRO_API_KEY=kairo-dev-key PORT=8081 go run ./services/checkout

# 3) Real workload
curl -X POST http://localhost:8081/checkout -d '{}'

# 4) Frontend in API mode
cd web && npm install && VITE_DATA_MODE=api VITE_API_BASE_URL=http://localhost:8080 npm run dev
```

Windows PowerShell equivalents:

```powershell
$env:KAIRO_DEMO_MODE="true"; $env:KAIRO_SEED_DEMO="true"; go run ./cmd/kairo-api
$env:KAIRO_API_KEY="kairo-dev-key"; $env:PORT="8082"; go run ./services/inventory
# …repeat for payment (8083), notifications (8084), checkout (8081 — no PORT needed if you set $env:PORT="8081")
cd web; npm install; $env:VITE_DATA_MODE="api"; $env:VITE_API_BASE_URL="http://localhost:8080"; npm run dev
```

> The seeded key `kairo-dev-key` and admin token `kairo-dev-admin` are
> **development-only credentials**, logged loudly at startup. Set
> `KAIRO_ADMIN_TOKEN` (and use real project keys) for anything else;
> `KAIRO_ENV=production` refuses the default admin token.

### Option C — public demo (frontend only, synthetic data)

```bash
cd web && npm install && npm run dev   # VITE_DATA_MODE=demo is the default
```

No backend, database or login. All data is deterministic synthetic data
generated in the browser and labelled as such. See `docs/demo.md`.

### With PostgreSQL locally

```bash
KAIRO_DATABASE_URL='postgres://kairo:kairo@localhost:5432/kairo?sslmode=disable' \
KAIRO_DEMO_MODE=true KAIRO_SEED_DEMO=true go run ./cmd/kairo-api
# Migrations in migrations/ are applied automatically at startup.
```

## What you can do

- **Ingest** real OTLP traces (protobuf or JSON) at `POST /v1/traces` with a
  project API key; duplicates are safely ignored, storage failures are never
  falsely acknowledged.
- **Search and inspect traces** — filters, stable pagination, a time-aligned
  waterfall, span attributes/events, incomplete-trace indicators.
- **See the service map** — dependencies inferred from observed traces, with
  per-edge request counts, error rate and latency.
- **RED metrics** — rate / error rate / p50-p95-p99 per service and operation,
  where a "request" is a SERVER span (documented in `docs/api.md`).
- **Failure Lab** — Slow Inventory, Payment Errors, Notification Timeout and
  Recovery scenarios, reproducible in both local and demo modes.
- **Thresholds & alerts** — p95 latency / error-rate rules evaluated over a
  trailing window, with an in-product alert list.
- **Retention** — configurable per project, deleted in bounded batches.

## Configuration

Backend: `KAIRO_ENV`, `KAIRO_HTTP_ADDR` (`:8080`), `KAIRO_DATABASE_URL`
(empty = in-memory demo), `KAIRO_ADMIN_TOKEN`, `KAIRO_LOG_LEVEL`,
`KAIRO_MAX_OTLP_BODY_BYTES` (4194304), `KAIRO_MAX_SPANS_PER_BATCH` (1000),
`KAIRO_QUERY_TIMEOUT` (10s), `KAIRO_DEFAULT_RETENTION_DAYS` (7),
`KAIRO_DEMO_MODE`, `KAIRO_CHECKOUT_URL`. Frontend: `VITE_DATA_MODE`
(`demo|api`), `VITE_API_BASE_URL`, `VITE_DEMO_SCENARIO_SEED`. See
`.env.example` — placeholders and labelled dev values only.

## Tests & benchmarks

```bash
go test ./...                                   # unit + HTTP integration
KAIRO_TEST_DATABASE_URL=postgres://… go test ./tests/integration/   # PostgreSQL tests
cd web && npm run typecheck && npm test && npm run build
go run ./tests/load -addr http://localhost:8080 -api-key <key>      # benchmark harness
```

Measured benchmark results (with the exact environment used) live in
`docs/benchmarks.md`. No performance number appears anywhere in this project
without a measurement behind it.

## Documentation

`docs/architecture.md` · `docs/api.md` + `docs/openapi.yaml` ·
`docs/data-model.md` · `docs/security.md` · `docs/demo.md` ·
`docs/benchmarks.md` · `docs/decisions/`

## Known limitations

- PostgreSQL is the only durable store; in-memory mode is demo-only.
- Metrics are derived from spans, not a separate metrics pipeline; Kairo is
  not a log platform and has no Kubernetes/multi-region features (see the
  spec's out-of-scope list).
- Alerting is in-product only (no email/SMS delivery).
- Large-graph layout optimisation is out of scope for the service map.

## License

MIT — see `LICENSE`.
