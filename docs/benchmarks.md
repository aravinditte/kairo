# Benchmarks

Methodology: `tests/load` runs against a live Kairo API over HTTP and reports
measured throughput and client-observed latency percentiles for five
workloads: (1) ingestion under concurrent traffic, (2) duplicate-heavy
ingestion (with a read-back span-count dedupe verification), (3) trace lookup
by id, (4) service/time-filtered trace search, (5) RED metrics aggregation.
Every run records the environment, storage mode, payload shape (spans per
batch), concurrency and duration alongside results.

Reproduce:

```bash
KAIRO_DEMO_MODE=true KAIRO_SEED_DEMO=true go run ./cmd/kairo-api   # terminal 1
go run ./tests/load -addr http://localhost:8080 -api-key kairo-dev-key -project <seeded-project-id>
```

## Measured results — 2026-10-26, local verification run

Environment: shared Linux VM (x86_64, 2 vCPU, ~8 GB RAM), Go 1.23.4,
**in-memory demo storage** (PostgreSQL was not available on this machine —
these numbers describe the HTTP + in-memory path only and must not be read
as PostgreSQL production figures). Harness config: concurrency 8,
200 ingestion batches × 8 spans, 25 duplicate re-deliveries, 30 repeats for
each query workload.

| Workload | Result | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| Ingestion (concurrent) | 621.6 batches/s = **4,973 spans/s**, 1,600 spans accepted | 11.34 ms | 30.19 ms | 41.45 ms | 0 / 200 |
| Duplicate-heavy ingestion | 473.6 req/s; stored spans stayed **8 of 8** after 25 re-deliveries of the identical batch | 2.20 ms | 3.90 ms | 4.31 ms | 0 / 25 |
| Trace lookup by ID | 4,711.6 req/s | 0.15 ms | 0.35 ms | 0.47 ms | 0 / 30 |
| Filtered trace search | 347.4 req/s | 1.71 ms | 8.75 ms | 9.41 ms | 0 / 30 |
| RED metrics aggregation | 260.9 req/s | 3.09 ms | 7.14 ms | 9.29 ms | 0 / 30 |

No other performance figures are claimed anywhere in this project. Re-run
the harness against a PostgreSQL-backed deployment before quoting numbers
for that configuration.
