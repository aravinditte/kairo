# ADR 0001 — Modular monolith, storage interface, stdlib HTTP

Status: accepted (initial release).

Context: Kairo must be operable by one developer from a fresh clone at zero
cost, with PostgreSQL as the durable store, while remaining testable on
machines without PostgreSQL (CI sandboxes, this project's build VM).

Decision:
- One Go binary (modular monolith) for ingestion, query, metrics and
  scenarios. Demo applications are separate small binaries sharing
  `internal/demosvc`.
- HTTP via the Go standard library `net/http` ServeMux (Go 1.22+ patterns)
  instead of a framework — one less dependency, and the spec explicitly
  allows stdlib.
- All persistence goes through `internal/storage.Store`. PostgreSQL
  (pgx via `database/sql`) is the production implementation; an in-memory
  implementation with identical uniqueness/tenant rules backs local demos
  and tests. The API logs loudly that memory mode is non-durable and
  `/readyz` reports `database: "memory"`.

Consequences: behaviour verified against the memory store is not proof of
PostgreSQL behaviour; PostgreSQL integration tests exist and run wherever
`KAIRO_TEST_DATABASE_URL` is provided (CI service container), and the
verification report states plainly which environment ran what.
