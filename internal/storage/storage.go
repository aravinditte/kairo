// Package storage defines the Store interface and its two implementations:
// MemoryStore (non-durable, for demo mode when KAIRO_DATABASE_URL is empty)
// and PostgresStore (durable, pgx/stdlib, embedded migrations).
package storage

import (
	"context"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/aravinditte/kairo/internal/model"
)

// Store is the persistence contract for the whole backend. Every
// tenant-scoped method takes a project ID; callers must resolve that ID from
// credentials, never trust a client-supplied one on its own.
type Store interface {
	// Mode reports "memory" or "postgres".
	Mode() string
	// Ping checks the backing store is reachable.
	Ping(ctx context.Context) error
	Close() error

	CreateProject(p model.Project) error
	ListProjects() []model.Project
	GetProject(id string) (model.Project, bool)
	UpdateProject(p model.Project) (model.Project, bool)
	DeleteProject(id string) bool

	// CreateAPIKey stores metadata plus the key hash (never the raw key).
	CreateAPIKey(meta model.APIKeyMeta, keyHash string) error
	ListAPIKeys(projectID string) []model.APIKeyMeta
	// GetAPIKeyByHash returns (meta, storedHash, found).
	GetAPIKeyByHash(hash string) (model.APIKeyMeta, string, bool)
	GetAPIKeyByID(id string) (model.APIKeyMeta, bool)
	RevokeAPIKey(id string, at time.Time) (model.APIKeyMeta, bool)
	TouchAPIKey(id string, at time.Time)

	// InsertSpans durably stores spans, skipping duplicates identified by
	// (project_id, trace_id, span_id). Returns (inserted, duplicates, err).
	// A non-nil error means nothing was durably accepted.
	InsertSpans(ctx context.Context, spans []model.Span) (int, int, error)
	// QuerySpans returns spans of a project inside [start, end), optionally
	// filtered by service and/or operation. Bounded by limit (<=0 = default).
	QuerySpans(ctx context.Context, projectID string, start, end time.Time, service, operation string, limit int) ([]model.Span, error)
	// GetTraceSpans returns all stored spans of one trace in a project.
	GetTraceSpans(ctx context.Context, projectID, traceID string) ([]model.Span, error)
	// SearchTraces returns one page of trace summaries for the filter.
	SearchTraces(ctx context.Context, projectID string, f model.TraceSearchFilter) (model.TraceSearchPage, error)
	// DeleteSpansBefore deletes up to batch spans of the project ingested or
	// started before cutoff; returns how many were deleted.
	DeleteSpansBefore(ctx context.Context, projectID string, cutoff time.Time, batch int) (int, error)

	InsertAlert(a model.AlertEvent) error
	ListAlerts(projectID string, limit int) []model.AlertEvent
	// HasRecentAlert reports whether an alert for (project, service, rule)
	// was created at or after since (used for 5-minute dedupe).
	HasRecentAlert(projectID, service, rule string, since time.Time) bool

	CreateScenarioRun(r model.ScenarioRun) error
	GetScenarioRun(projectID, id string) (model.ScenarioRun, bool)
	UpdateScenarioRun(r model.ScenarioRun) error
}

// EncodeCursor builds the opaque pagination cursor for stable ordering
// start_time DESC, trace_id DESC: base64 of "<start_unixnano>:<trace_id>".
func EncodeCursor(start time.Time, traceID string) string {
	raw := strconv.FormatInt(start.UnixNano(), 10) + ":" + traceID
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// DecodeCursor parses a cursor produced by EncodeCursor.
func DecodeCursor(cursor string) (time.Time, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", fmt.Errorf("invalid cursor")
	}
	parts := strings.SplitN(string(raw), ":", 2)
	if len(parts) != 2 || parts[1] == "" {
		return time.Time{}, "", fmt.Errorf("invalid cursor")
	}
	ns, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, "", fmt.Errorf("invalid cursor")
	}
	return time.Unix(0, ns).UTC(), parts[1], nil
}

// ApplyCursor filters trace summaries to those strictly after the cursor
// position in (start DESC, trace_id DESC) order.
func ApplyCursor(traces []model.TraceSummary, cursor string) ([]model.TraceSummary, error) {
	if cursor == "" {
		return traces, nil
	}
	ct, cid, err := DecodeCursor(cursor)
	if err != nil {
		return nil, err
	}
	out := traces[:0:0]
	for _, t := range traces {
		if t.StartTime.Before(ct) || (t.StartTime.Equal(ct) && t.TraceID < cid) {
			out = append(out, t)
		}
	}
	return out, nil
}

// PaginateTraces applies cursor + limit to an already sorted summary list.
func PaginateTraces(sorted []model.TraceSummary, f model.TraceSearchFilter) (model.TraceSearchPage, error) {
	filtered, err := ApplyCursor(sorted, f.Cursor)
	if err != nil {
		return model.TraceSearchPage{}, err
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	page := model.TraceSearchPage{Traces: []model.TraceSummary{}}
	if len(filtered) > limit {
		page.Traces = append(page.Traces, filtered[:limit]...)
		last := filtered[limit-1]
		page.NextCursor = EncodeCursor(last.StartTime, last.TraceID)
	} else {
		page.Traces = append(page.Traces, filtered...)
	}
	return page, nil
}

// MatchTraceFilter reports whether a trace summary matches the non-time
// search filters (duration bounds). Service/operation/status/trace filters
// are applied at the span level by MatchesSpan.
func MatchTraceFilter(sum model.TraceSummary, f model.TraceSearchFilter) bool {
	if f.HasMinDuration && sum.DurationNs < f.MinDurationNs {
		return false
	}
	if f.HasMaxDuration && sum.DurationNs > f.MaxDurationNs {
		return false
	}
	return true
}

// MatchesSpan reports whether a span matches the span-level search filters.
func MatchesSpan(s model.Span, f model.TraceSearchFilter) bool {
	if f.Service != "" && s.ServiceName != f.Service {
		return false
	}
	if f.Operation != "" && s.OperationName != f.Operation {
		return false
	}
	if f.TraceID != "" && s.TraceID != f.TraceID {
		return false
	}
	switch f.Status {
	case "error":
		if s.StatusCode != "error" {
			return false
		}
	case "ok":
		if s.StatusCode == "error" {
			return false
		}
	}
	return true
}
