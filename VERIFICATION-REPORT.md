# Kairo — Verification Report (2026-10-26)

Everything below was run on the build VM (shared Linux x86_64, 2 vCPU,
Go 1.23.4 at a local install, Node 24). Claims are limited to what was
actually executed; unverified items are listed explicitly at the end.

## Backend (Go)
- `go build ./...` ✅ · `go vet ./...` ✅ · `gofmt -l` clean ✅
- `go test ./...` ✅ — **45 tests passing, 0 failing** (backend packages 34,
  demosvc 11): span validation, percentile + RED classification, dependency
  reconstruction, auth generate/hash/revoke, OTLP protobuf **and** JSON
  parsing (including spec-hex JSON IDs), malformed payload rejection,
  threshold evaluation + dedupe, retention boundaries/batching, scenario
  parameter validation, and httptest end-to-end coverage of ingestion,
  duplicate delivery, tenant isolation, cursor pagination and filters.
- `tests/integration` PostgreSQL test **skips** without
  `KAIRO_TEST_DATABASE_URL` (no PostgreSQL on this VM) — it is wired into CI
  with a PostgreSQL 16 service container.

## Live end-to-end (real processes, in-memory storage)
Seeded API + all four demo services running; verified by HTTP:
- Healthy checkout → 200, one trace of 11 spans across 4 services, correct
  parent-child hierarchy; overview KPIs count 4 SERVER-span requests.
- **Slow Inventory** (API scenario, delay 900 ms, workload 5): completed,
  5/5 succeeded, run p95 ≈ 904 ms, inventory p95 ≈ 901 ms in service stats.
- **Payment Errors** (error_rate 1.0, workload 5, run sequentially):
  completed, 0/5 succeeded, affected services [payment, checkout]; error
  traces searchable with summary "payment fault injected"; payment and
  checkout error rates 15.6% over the accumulated window.
- **Notification Timeout** (delay 2000 ms > 800 ms client timeout,
  workload 3): completed, 3/3 succeeded (non-fatal by design), run p95
  ≈ 804 ms; notification spans carry errors — distinguishable from payment
  failures in search results.
- **Recovery** (workload 5): completed, 5/5 succeeded, run p95 ≈ 4.9 ms —
  back to baseline while earlier failed traces remain visible.
- Dependencies endpoint returned checkout→inventory/payment/notifications
  edges with correct counts (32 each after all runs) and latencies.
- Thresholds PATCHed to p95 100 ms / error-rate 10% → **6 alert events**
  with correct observed values (e.g. checkout p95 905.5 ms, error 15.62%).
- Tenant isolation live: second project's key sees an empty trace list,
  cross-project query returns 403, revoked key ingestion returns 401,
  unauthenticated ingestion returns 401.
- `scripts/seed-demo.sh` ran clean against the live API (project + key
  created, hex-ID OTLP/JSON sample ingested and retrievable).
- Failure Lab note: scenarios are asynchronous — the frontend polls the run
  until it completes (demo-mode runs complete immediately).

## Frontend (web/)
- `npm run typecheck` ✅ (strict) · `npm test` ✅ **20/20** (formatting,
  demo-provider determinism, filter behaviour, scenario factory) ·
  `npm run build` ✅ (demo mode). An API-mode build
  (`VITE_DATA_MODE=api`) was also produced and served: root returned 200 and
  the bundle pointed at the live API base URL. Every endpoint the
  ApiDataProvider calls was checked against the backend route table.
- No emojis in UI source (scanned).

## Benchmarks (measured, in-memory storage)
Recorded in `docs/benchmarks.md`: ingestion 4,973 spans/s (p95 30.2 ms),
dedupe verified 8/8 stored spans after 25 re-deliveries, trace lookup
p95 0.35 ms, filtered search p95 8.8 ms, RED aggregation p95 7.1 ms.
Labelled as the in-memory path on a shared VM — not PostgreSQL figures.

## Spec compliance fix made during verification
Demo services originally emitted OTLP/JSON via protojson, which encodes
trace/span IDs as base64 — not the OTLP/JSON spec encoding. Demo services
now send **protobuf** (`application/x-protobuf`, official types), and the
seed scripts send spec **hex** IDs in JSON. The receiver accepts protobuf,
spec-hex JSON, and (leniently) protojson-base64 JSON.

## NOT verified (honest list)
- **PostgreSQL execution** — no PostgreSQL on this VM. The PG store,
  migrations and integration test are code-complete and CI-wired, but were
  not executed here.
- **Docker / Docker Compose** — no Docker on this VM. Dockerfiles and
  `deploy/docker-compose.yml` are provided and statically reviewed only.
- **PowerShell scripts** — no `pwsh` on this VM; `.ps1` files mirror the
  tested `.sh` logic but their syntax is unexecuted.
- **GitHub Actions CI** — workflow file provided; not run (and, as with
  previous projects, it may need manual addition if the GitHub App lacks
  the Workflows permission).
- Public static hosting of the demo (e.g. Cloudflare Pages) — the build
  output includes `_redirects` for SPA fallback; no deployment was made.
