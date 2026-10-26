// Package model defines the core JSON types shared across the Kairo backend.
// Field names and JSON tags are fixed by the build contract.
package model

import (
	"crypto/rand"
	"fmt"
	"time"
)

// NewID returns a random RFC 4122 version 4 UUID string.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// Thresholds holds per-project alert thresholds. Nil pointers mean "not set".
type Thresholds struct {
	P95LatencyMs      *float64 `json:"p95_latency_ms,omitempty"`
	ErrorRatePercent  *float64 `json:"error_rate_percent,omitempty"`
	RequestRatePerSec *float64 `json:"request_rate_per_sec,omitempty"`
}

// Project is a logical tenant that telemetry is scoped to.
type Project struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	RetentionDays int        `json:"retention_days"`
	Thresholds    Thresholds `json:"thresholds"`
}

// APIKeyMeta is the stored metadata for an API key. The raw key and its hash
// are never part of this type.
type APIKeyMeta struct {
	ID         string     `json:"id"`
	ProjectID  string     `json:"project_id"`
	CreatedAt  time.Time  `json:"created_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

// CreateAPIKeyResponse is returned once when a key is created; it is the only
// place the raw key ever appears.
type CreateAPIKeyResponse struct {
	APIKey APIKeyMeta `json:"api_key"`
	RawKey string     `json:"raw_key"`
}

// SpanEvent is a timestamped annotation on a span.
type SpanEvent struct {
	Name       string         `json:"name"`
	Time       time.Time      `json:"time"`
	Attributes map[string]any `json:"attributes"`
}

// SpanLink links a span to another span, possibly in another trace.
type SpanLink struct {
	TraceID    string         `json:"trace_id"`
	SpanID     string         `json:"span_id"`
	Attributes map[string]any `json:"attributes"`
}

// Span is the normalized stored representation of an OpenTelemetry span.
type Span struct {
	ProjectID          string         `json:"project_id"`
	TraceID            string         `json:"trace_id"`
	SpanID             string         `json:"span_id"`
	ParentSpanID       string         `json:"parent_span_id,omitempty"`
	ServiceName        string         `json:"service_name"`
	OperationName      string         `json:"operation_name"`
	SpanKind           int            `json:"span_kind"`
	StartTime          time.Time      `json:"start_time"`
	EndTime            time.Time      `json:"end_time"`
	DurationNs         int64          `json:"duration_ns"`
	StatusCode         string         `json:"status_code"` // "unset" | "ok" | "error"
	StatusMessage      string         `json:"status_message,omitempty"`
	ResourceAttributes map[string]any `json:"resource_attributes"`
	SpanAttributes     map[string]any `json:"span_attributes"`
	Events             []SpanEvent    `json:"events"`
	Links              []SpanLink     `json:"links"`
	IngestedAt         time.Time      `json:"ingested_at"`
}

// TraceSummary is one row of trace search results.
type TraceSummary struct {
	TraceID       string    `json:"trace_id"`
	RootOperation string    `json:"root_operation"`
	RootService   string    `json:"root_service"`
	StartTime     time.Time `json:"start_time"`
	DurationNs    int64     `json:"duration_ns"`
	SpanCount     int       `json:"span_count"`
	ErrorCount    int       `json:"error_count"`
	HasError      bool      `json:"has_error"`
	ErrorSummary  string    `json:"error_summary,omitempty"`
	Incomplete    bool      `json:"incomplete"`
}

// TraceDetail is a TraceSummary plus its services and full span list.
type TraceDetail struct {
	TraceSummary
	Services []string `json:"services"`
	Spans    []Span   `json:"spans"`
}

// ServiceSummary aggregates observed telemetry for one service.
// ErrorRate is a fraction in [0,1]. Request counting follows the documented
// classification: a "request" is a span with span_kind == SERVER (2).
type ServiceSummary struct {
	ServiceName     string    `json:"service_name"`
	RequestCount    int64     `json:"request_count"`
	ErrorCount      int64     `json:"error_count"`
	ErrorRate       float64   `json:"error_rate"`
	P50Ns           *int64    `json:"p50_ns"`
	P95Ns           *int64    `json:"p95_ns"`
	P99Ns           *int64    `json:"p99_ns"`
	LastSeen        time.Time `json:"last_seen"`
	ThresholdStatus string    `json:"threshold_status"` // "ok" | "breach" | "unknown"
}

// DependencyEdge is a dependency inferred from observed traces: a parent span
// in Source whose child span lives in Target (typically a client span in
// Source calling a server span in Target).
type DependencyEdge struct {
	Source        string  `json:"source"`
	Target        string  `json:"target"`
	RequestCount  int64   `json:"request_count"`
	ErrorCount    int64   `json:"error_count"`
	ErrorRate     float64 `json:"error_rate"`
	AvgDurationNs int64   `json:"avg_duration_ns"`
	P95Ns         *int64  `json:"p95_ns"`
}

// TimeWindow is an inclusive-exclusive query window.
type TimeWindow struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

// MetricBucket is one aggregation bucket of a RED metrics series.
type MetricBucket struct {
	BucketStart  time.Time `json:"bucket_start"`
	RequestCount int64     `json:"request_count"`
	ErrorCount   int64     `json:"error_count"`
	P50Ns        *int64    `json:"p50_ns,omitempty"`
	P95Ns        *int64    `json:"p95_ns,omitempty"`
	P99Ns        *int64    `json:"p99_ns,omitempty"`
}

// SlowOperation ranks an operation by its P95 duration.
type SlowOperation struct {
	Operation string `json:"operation"`
	Service   string `json:"service"`
	Count     int64  `json:"count"`
	P95Ns     int64  `json:"p95_ns"`
}

// ServiceErrorCount is an error tally for one service.
type ServiceErrorCount struct {
	Service    string `json:"service"`
	ErrorCount int64  `json:"error_count"`
}

// REDMetrics is the response of GET /api/v1/metrics/red. A "request" is a
// span with span_kind == SERVER (2); percentiles are computed over those
// spans' durations. Percentile fields are null when there are no samples.
type REDMetrics struct {
	Window            TimeWindow          `json:"window"`
	IntervalSeconds   int                 `json:"interval_seconds"`
	Service           string              `json:"service,omitempty"`
	RequestCount      int64               `json:"request_count"`
	ErrorCount        int64               `json:"error_count"`
	ErrorRate         float64             `json:"error_rate"`
	RequestRatePerSec float64             `json:"request_rate_per_sec"`
	P50Ns             *int64              `json:"p50_ns"`
	P95Ns             *int64              `json:"p95_ns"`
	P99Ns             *int64              `json:"p99_ns"`
	Series            []MetricBucket      `json:"series"`
	SlowOperations    []SlowOperation     `json:"slow_operations"`
	ErrorsByService   []ServiceErrorCount `json:"errors_by_service"`
}

// RecentError is one row of the overview recent-errors list.
type RecentError struct {
	Time         time.Time `json:"time"`
	Service      string    `json:"service"`
	Operation    string    `json:"operation"`
	TraceID      string    `json:"trace_id"`
	DurationNs   int64     `json:"duration_ns"`
	ErrorSummary string    `json:"error_summary"`
}

// OverviewKPIs are the headline numbers of the overview dashboard.
type OverviewKPIs struct {
	TotalRequests  int64   `json:"total_requests"`
	RequestsPerSec float64 `json:"requests_per_sec"`
	ErrorRate      float64 `json:"error_rate"`
	P95Ns          *int64  `json:"p95_ns"`
}

// Overview is the response of GET /api/v1/overview.
type Overview struct {
	ProjectID    string           `json:"project_id"`
	Window       TimeWindow       `json:"window"`
	KPIs         OverviewKPIs     `json:"kpis"`
	Series       []MetricBucket   `json:"series"`
	Services     []ServiceSummary `json:"services"`
	RecentErrors []RecentError    `json:"recent_errors"`
	RecentTraces []TraceSummary   `json:"recent_traces"`
}

// AlertEvent records one threshold violation.
type AlertEvent struct {
	ID             string    `json:"id"`
	ProjectID      string    `json:"project_id"`
	ServiceName    string    `json:"service_name"`
	RuleType       string    `json:"rule_type"` // "p95_latency" | "error_rate" | "request_rate"
	ObservedValue  float64   `json:"observed_value"`
	ThresholdValue float64   `json:"threshold_value"`
	WindowStart    time.Time `json:"window_start"`
	WindowEnd      time.Time `json:"window_end"`
	CreatedAt      time.Time `json:"created_at"`
	Status         string    `json:"status"` // "active"
}

// ScenarioParameter describes one configurable scenario parameter.
type ScenarioParameter struct {
	Key     string  `json:"key"`
	Label   string  `json:"label"`
	Min     float64 `json:"min"`
	Max     float64 `json:"max"`
	Default float64 `json:"default"`
	Unit    string  `json:"unit"`
}

// ScenarioDefinition describes a Failure Lab scenario.
type ScenarioDefinition struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Parameters  []ScenarioParameter `json:"parameters"`
}

// ScenarioResult summarizes a finished scenario run.
type ScenarioResult struct {
	Requests         int      `json:"requests"`
	Succeeded        int      `json:"succeeded"`
	Failed           int      `json:"failed"`
	P95Ns            *int64   `json:"p95_ns,omitempty"`
	AffectedServices []string `json:"affected_services"`
	TraceIDs         []string `json:"trace_ids"`
}

// ScenarioRun is one execution of a Failure Lab scenario.
type ScenarioRun struct {
	ID            string          `json:"id"`
	ProjectID     string          `json:"project_id"`
	ScenarioType  string          `json:"scenario_type"`
	Parameters    map[string]any  `json:"parameters"`
	Status        string          `json:"status"` // pending|running|completed|failed|cancelled
	StartedAt     time.Time       `json:"started_at"`
	FinishedAt    *time.Time      `json:"finished_at,omitempty"`
	ResultSummary *ScenarioResult `json:"result_summary,omitempty"`
}

// TraceSearchFilter carries validated trace-search parameters.
type TraceSearchFilter struct {
	Start          time.Time
	End            time.Time
	Service        string
	Operation      string
	Status         string // "" | "error" | "ok"
	TraceID        string
	MinDurationNs  int64
	MaxDurationNs  int64
	HasMinDuration bool
	HasMaxDuration bool
	Limit          int
	Cursor         string // opaque pagination cursor, "" for first page
}

// TraceSearchPage is one page of trace search results.
type TraceSearchPage struct {
	Traces     []TraceSummary `json:"traces"`
	NextCursor string         `json:"next_cursor,omitempty"`
}
