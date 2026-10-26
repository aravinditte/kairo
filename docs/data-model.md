# Data model

PostgreSQL schema lives in versioned migrations (`migrations/001`–`005`),
applied by the API at startup when `KAIRO_DATABASE_URL` is set. The in-memory
demo store keeps the same shapes and the same uniqueness rules.

## projects
`id` UUID PK · `name` · `created_at` · `updated_at` · `retention_days` int ·
thresholds stored in `thresholds` (one row per project).

## api_keys
`id` UUID PK · `project_id` FK · `key_hash` (SHA-256 hex of the raw key; the
raw key is shown once at creation and never stored or logged) · `created_at` ·
`revoked_at` nullable · `last_used_at` nullable.

## spans
`project_id` + `trace_id` (32 lowercase hex chars) + `span_id` (16 hex) form
the primary key — this unique constraint is the duplicate-delivery authority.
Plus `parent_span_id` nullable, `service_name`, `operation_name`, `span_kind`
smallint (OTLP enum), `start_time`/`end_time` timestamptz, `duration_ns`
bigint ≥ 0, `status_code` (`unset|ok|error`), `status_message`,
`resource_attributes`/`span_attributes`/`events`/`links` JSONB, `ingested_at`.

Indexes: `(project_id, start_time DESC)`, `(project_id, service_name, start_time DESC)`,
partial error index `(project_id, start_time DESC) WHERE status_code='error'`,
`(project_id, trace_id)`.

Limits: attribute count and value size are capped at ingestion
(`KAIRO_MAX_ATTR_COUNT`, `KAIRO_MAX_ATTR_VALUE_BYTES`); oversized values are
truncated with an `kairo.truncated` marker rather than stored unbounded.

## scenario_runs
`id` UUID PK · `project_id` · `scenario_type` · `parameters` JSONB ·
`status` (`pending|running|completed|failed|cancelled`) · `started_at` ·
`finished_at` nullable · `result_summary` JSONB.

## alert_events
`id` UUID PK · `project_id` · `service_name` · `rule_type`
(`p95_latency|error_rate|request_rate`) · `observed_value` · `threshold_value` ·
`window_start`/`window_end` · `created_at` · `status`.

## Query rules
Every tenant query includes `project_id`. Results are bounded (limit +
7-day maximum window). Retention deletion runs in bounded batches of 1,000
rows and never touches project or key metadata.
