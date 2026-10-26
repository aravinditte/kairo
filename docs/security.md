# Security

- API keys are generated from 32 bytes of `crypto/rand`, shown once, and only
  their SHA-256 hash is stored. Keys are revocable; revoked and unknown keys
  get 401. Raw keys are never logged and never accepted in URLs (headers only).
- Management operations use a separate admin token (`KAIRO_ADMIN_TOKEN`),
  distinct from ingestion keys. The development default is refused silently
  in no mode — the API logs a loud warning when the default admin token or
  the seeded development key is in use, and `KAIRO_ENV=production` with the
  default admin token fails startup.
- Tenant isolation: project scope is derived from credentials, never trusted
  from client input alone. All SQL is parameterized (pgx/`database/sql`
  placeholders).
- Ingestion bounds: body size, spans per batch, attribute count/value size,
  timestamp sanity (end ≥ start, bounded skew), trace/span id format.
- API errors use a consistent envelope and never expose database errors,
  paths, stack traces or credentials.
- Fault injection is restricted to the four bundled demo services through
  their `/_fault` endpoints with bounded parameters (delay 0–10,000 ms,
  error rate 0–1, workload 1–200). Scenario configuration cannot name
  arbitrary URLs or commands; the runner only talks to `KAIRO_CHECKOUT_URL`
  and the sibling demo services derived from it.
- The frontend renders span attributes as text (React escaping); the public
  demo build contains no secrets — anything in a static build is public, so
  no API keys are baked in.
- `.env.example` contains placeholders and clearly-labelled development-only
  values only.
