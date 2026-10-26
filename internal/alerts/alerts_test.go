package alerts_test

import (
	"testing"
	"time"

	"github.com/aravinditte/kairo/internal/alerts"
	"github.com/aravinditte/kairo/internal/model"
	"github.com/aravinditte/kairo/internal/storage"
)

func serverSpan(svc string, durMs int64, status string, start time.Time) model.Span {
	return model.Span{
		ProjectID: "p1", ServiceName: svc, OperationName: "GET /x", SpanKind: 2,
		StartTime: start, EndTime: start.Add(time.Duration(durMs) * time.Millisecond),
		DurationNs: durMs * 1_000_000, StatusCode: status,
	}
}

func TestEvaluateP95AndErrorRate(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	window := model.TimeWindow{Start: now.Add(-5 * time.Minute), End: now}
	p95 := 100.0
	errPct := 10.0
	th := model.Thresholds{P95LatencyMs: &p95, ErrorRatePercent: &errPct}
	spans := []model.Span{
		serverSpan("payment", 900, "error", now.Add(-time.Minute)),
		serverSpan("payment", 900, "ok", now.Add(-time.Minute)),
		serverSpan("fast", 5, "ok", now.Add(-time.Minute)),
	}
	events := alerts.Evaluate("p1", spans, th, window, now)
	rules := map[string]bool{}
	for _, e := range events {
		if e.ServiceName == "payment" {
			rules[e.RuleType] = true
		}
		if e.Status != "active" || e.ProjectID != "p1" {
			t.Fatalf("event = %+v", e)
		}
	}
	if !rules["p95_latency"] || !rules["error_rate"] {
		t.Fatalf("expected p95_latency and error_rate alerts for payment, got %v", rules)
	}
	for _, e := range events {
		if e.ServiceName == "fast" {
			t.Fatalf("fast service must not alert: %+v", e)
		}
	}
}

func TestEvaluateNoThresholdsNoAlerts(t *testing.T) {
	now := time.Now().UTC()
	window := model.TimeWindow{Start: now.Add(-5 * time.Minute), End: now}
	spans := []model.Span{serverSpan("payment", 9000, "error", now)}
	if events := alerts.Evaluate("p1", spans, model.Thresholds{}, window, now); len(events) != 0 {
		t.Fatalf("events = %+v, want none without thresholds", events)
	}
}

func TestEvaluateAndStoreDedupesWithin5Minutes(t *testing.T) {
	store := storage.NewMemoryStore()
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	window := model.TimeWindow{Start: now.Add(-5 * time.Minute), End: now}
	p95 := 100.0
	th := model.Thresholds{P95LatencyMs: &p95}
	spans := []model.Span{serverSpan("payment", 900, "ok", now.Add(-time.Minute))}
	if n := alerts.EvaluateAndStore(store, "p1", spans, th, window, now); n != 1 {
		t.Fatalf("first insert = %d, want 1", n)
	}
	if n := alerts.EvaluateAndStore(store, "p1", spans, th, window, now.Add(time.Minute)); n != 0 {
		t.Fatalf("duplicate within 5m inserted %d, want 0", n)
	}
	if got := store.ListAlerts("p1", 10); len(got) != 1 {
		t.Fatalf("alerts = %d, want 1", len(got))
	}
	// After the dedupe window, a fresh violation is recorded again.
	if n := alerts.EvaluateAndStore(store, "p1", spans, th, window, now.Add(6*time.Minute)); n != 1 {
		t.Fatalf("post-window insert = %d, want 1", n)
	}
}
