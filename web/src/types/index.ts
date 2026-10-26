// JSON shapes exactly as defined in the shared Kairo contract. Durations are nanoseconds.
export interface Thresholds { p95_latency_ms: number; error_rate_percent: number; request_rate_per_sec?: number; }
export interface Project { id: string; name: string; created_at: string; updated_at: string; retention_days: number; thresholds: Thresholds; }
export interface ApiKeyMeta { id: string; project_id: string; created_at: string; revoked_at?: string | null; last_used_at?: string | null; }
export interface CreateApiKeyResponse { api_key: ApiKeyMeta; raw_key: string; }
export interface SpanEvent { name: string; time: string; attributes: Record<string, unknown>; }
export interface SpanLink { trace_id: string; span_id: string; attributes: Record<string, unknown>; }
export interface Span {
  project_id: string; trace_id: string; span_id: string; parent_span_id?: string | null;
  service_name: string; operation_name: string; span_kind: number;
  start_time: string; end_time: string; duration_ns: number;
  status_code: "unset" | "ok" | "error"; status_message?: string | null;
  resource_attributes: Record<string, unknown>; span_attributes: Record<string, unknown>;
  events: SpanEvent[]; links: SpanLink[]; ingested_at: string;
}
export interface TraceSummary {
  trace_id: string; root_operation: string; root_service: string; start_time: string;
  duration_ns: number; span_count: number; error_count: number; has_error: boolean;
  error_summary?: string | null; incomplete: boolean;
}
export interface TraceDetail extends TraceSummary { services: string[]; spans: Span[]; }
export interface ServiceSummary {
  service_name: string; request_count: number; error_count: number; error_rate: number;
  p50_ns: number | null; p95_ns: number | null; p99_ns: number | null;
  last_seen: string | null; threshold_status: "ok" | "breach" | "unknown";
}
export interface OperationSummary { operation: string; service: string; count: number; error_count: number; p50_ns: number | null; p95_ns: number | null; }
export interface ServiceDetail { summary: ServiceSummary; operations: OperationSummary[]; incoming: DependencyEdge[]; outgoing: DependencyEdge[]; recent_traces: TraceSummary[]; }
export interface DependencyEdge { source: string; target: string; request_count: number; error_count: number; error_rate: number; avg_duration_ns: number; p95_ns: number | null; }
export interface DependencyGraph { nodes: ServiceSummary[]; edges: DependencyEdge[]; inferred_note: string; }
export interface MetricBucket { bucket_start: string; request_count: number; error_count: number; p50_ns?: number | null; p95_ns?: number | null; p99_ns?: number | null; }
export interface SlowOperation { operation: string; service: string; count: number; p95_ns: number; }
export interface RedMetrics {
  window: { start: string; end: string }; interval_seconds: number; service?: string | null;
  request_count: number; error_count: number; error_rate: number; request_rate_per_sec: number;
  p50_ns: number | null; p95_ns: number | null; p99_ns: number | null;
  series: MetricBucket[]; slow_operations: SlowOperation[]; errors_by_service: { service: string; error_count: number }[];
  classification_note: string;
}
export interface RecentError { time: string; service: string; operation: string; trace_id: string; duration_ns: number; error_summary: string; }
export interface OverviewData {
  project_id: string; window: { start: string; end: string };
  kpis: { total_requests: number | null; requests_per_sec: number | null; error_rate: number | null; p95_ns: number | null };
  series: MetricBucket[]; services: ServiceSummary[]; recent_errors: RecentError[]; recent_traces: TraceSummary[];
}
export interface AlertEvent {
  id: string; project_id: string; service_name: string; rule_type: "p95_latency" | "error_rate" | "request_rate";
  observed_value: number; threshold_value: number; window_start: string; window_end: string; created_at: string; status: string;
}
export interface ScenarioParameter { key: string; label: string; min: number; max: number; default: number; unit: string; }
export interface ScenarioDefinition { id: string; name: string; description: string; parameters: ScenarioParameter[]; }
export interface ScenarioRunResult { requests: number; succeeded: number; failed: number; p95_ns?: number | null; affected_services: string[]; trace_ids: string[]; }
export interface ScenarioRun {
  id: string; project_id: string; scenario_type: string; parameters: Record<string, number>;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  started_at: string; finished_at?: string | null; result_summary?: ScenarioRunResult | null; workload?: number;
}
// Query types
export interface TimeQuery { start: string; end: string; }
export interface OverviewQuery extends TimeQuery { interval_seconds?: number; }
export interface TraceSearchQuery extends TimeQuery {
  service?: string; operation?: string; status?: "error" | "ok" | ""; trace_id?: string;
  min_duration_ns?: number; max_duration_ns?: number; limit?: number; cursor?: string | null;
}
export interface TraceSearchResult { items: TraceSummary[]; next_cursor: string | null; total: number; }
export interface ServiceQuery extends TimeQuery {}
export interface DependencyQuery extends TimeQuery {}
export interface MetricsQuery extends TimeQuery { service?: string; operation?: string; interval_seconds?: number; }
export interface AlertQuery { limit?: number; }
export interface ScenarioRunRequest { scenario_id: string; parameters: Record<string, number>; workload: number; }
export const SPAN_KIND_LABELS: Record<number, string> = { 0: "unspecified", 1: "internal", 2: "server", 3: "client", 4: "producer", 5: "consumer" };
