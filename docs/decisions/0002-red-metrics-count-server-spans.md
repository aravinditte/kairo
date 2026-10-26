# ADR 0002 — RED metrics count SERVER spans only

Status: accepted (initial release).

Context: A single logical checkout request produces a server span in each
service plus client/internal spans. Counting all spans would multiply rate
and distort error rate; counting only roots would miss per-service load.

Decision: For every service, a *request* is a span with `span_kind = SERVER`
owned by that service. Rate, error rate and duration percentiles are computed
over those spans only. Trace search and span counts still consider all spans.

Consequences: services that emit no server spans show "insufficient data"
rather than misleading zeros. The rule is stated in `docs/api.md`, in the
OpenAPI description, and in the Metrics page UI copy.
