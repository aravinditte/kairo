package metrics_test

import (
	"testing"
	"time"

	"github.com/aravinditte/kairo/internal/metrics"
	"github.com/aravinditte/kairo/internal/model"
)

func span(svc, op string, kind int, durMs int64, status string, start time.Time) model.Span {
	return model.Span{
		ServiceName: svc, OperationName: op, SpanKind: kind,
		StartTime: start, EndTime: start.Add(time.Duration(durMs) * time.Millisecond),
		DurationNs: durMs * 1_000_000, StatusCode: status,
	}
}

func TestPercentile(t *testing.T) {
	if got := metrics.Percentile(nil, 95); got != nil {
		t.Fatalf("empty percentile = %v, want nil", got)
	}
	durs := []int64{10, 20, 30, 40, 50, 60, 70, 80, 90, 100}
	if got := metrics.Percentile(durs, 50); got == nil || *got != 50 {
		t.Fatalf("p50 = %v, want 50", got)
	}
	if got := metrics.Percentile(durs, 95); got == nil || *got != 100 {
		t.Fatalf("p95 = %v, want 100", got)
	}
	if got := metrics.Percentile(durs, 0); got == nil || *got != 10 {
		t.Fatalf("p0 = %v, want 10", got)
	}
	// input must not be mutated
	if durs[0] != 10 || durs[9] != 100 {
		t.Fatalf("input mutated: %v", durs)
	}
}

func TestPercentileSingleSample(t *testing.T) {
	if got := metrics.Percentile([]int64{42}, 99); got == nil || *got != 42 {
		t.Fatalf("single p99 = %v, want 42", got)
	}
}

func TestSummarizeTraceIncompleteAndErrors(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	spans := []model.Span{
		{TraceID: "t", SpanID: "a", ServiceName: "checkout", OperationName: "POST /checkout", StartTime: base, EndTime: base.Add(100 * time.Millisecond), DurationNs: 100_000_000, StatusCode: "ok"},
		{TraceID: "t", SpanID: "b", ParentSpanID: "a", ServiceName: "payment", OperationName: "POST /charge", StartTime: base.Add(10 * time.Millisecond), EndTime: base.Add(90 * time.Millisecond), DurationNs: 80_000_000, StatusCode: "error", StatusMessage: "card declined"},
		{TraceID: "t", SpanID: "c", ParentSpanID: "missing", ServiceName: "inventory", OperationName: "GET /reserve", StartTime: base.Add(5 * time.Millisecond), EndTime: base.Add(20 * time.Millisecond), DurationNs: 15_000_000, StatusCode: "ok"},
	}
	sum := metrics.SummarizeTrace("t", spans)
	if sum.RootOperation != "POST /checkout" || sum.RootService != "checkout" {
		t.Fatalf("root = %s/%s", sum.RootService, sum.RootOperation)
	}
	if sum.SpanCount != 3 || sum.ErrorCount != 1 || !sum.HasError {
		t.Fatalf("counts = %+v", sum)
	}
	if sum.ErrorSummary != "card declined" {
		t.Fatalf("error summary = %q", sum.ErrorSummary)
	}
	if !sum.Incomplete {
		t.Fatal("trace with missing parent must be incomplete")
	}
	if sum.DurationNs != 100_000_000 {
		t.Fatalf("duration = %d", sum.DurationNs)
	}
}

func TestComputeREDCountsOnlyServerSpans(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	window := model.TimeWindow{Start: base, End: base.Add(time.Hour)}
	spans := []model.Span{
		span("checkout", "POST /checkout", 2, 100, "ok", base),
		span("checkout", "POST /checkout", 2, 200, "error", base.Add(time.Minute)),
		span("checkout", "call payment", 3, 50, "error", base), // client span: not a request
		span("payment", "POST /charge", 2, 80, "error", base),
		span("other", "job", 1, 10, "ok", base), // internal: not a request
	}
	m := metrics.ComputeRED(spans, window, 60, "", "")
	if m.RequestCount != 3 {
		t.Fatalf("request_count = %d, want 3 (server spans only)", m.RequestCount)
	}
	if m.ErrorCount != 2 {
		t.Fatalf("error_count = %d, want 2", m.ErrorCount)
	}
	if m.ErrorRate != 2.0/3.0 {
		t.Fatalf("error_rate = %v", m.ErrorRate)
	}
	if m.P95Ns == nil {
		t.Fatal("p95 must be present with samples")
	}
	if len(m.Series) != 60 {
		t.Fatalf("buckets = %d, want 60", len(m.Series))
	}
	if len(m.ErrorsByService) != 2 {
		t.Fatalf("errors_by_service = %+v", m.ErrorsByService)
	}
}

func TestComputeREDNoSamples(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	m := metrics.ComputeRED(nil, model.TimeWindow{Start: base, End: base.Add(time.Hour)}, 60, "", "")
	if m.RequestCount != 0 || m.P50Ns != nil || m.P95Ns != nil || m.P99Ns != nil {
		t.Fatalf("empty metrics must have null percentiles: %+v", m)
	}
	if m.ErrorRate != 0 {
		t.Fatalf("error rate = %v", m.ErrorRate)
	}
}

func TestComputeREDServiceFilter(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	window := model.TimeWindow{Start: base, End: base.Add(time.Hour)}
	spans := []model.Span{
		span("checkout", "POST /checkout", 2, 100, "ok", base),
		span("payment", "POST /charge", 2, 80, "ok", base),
	}
	m := metrics.ComputeRED(spans, window, 60, "payment", "")
	if m.RequestCount != 1 || m.Service != "payment" {
		t.Fatalf("filtered = %+v", m)
	}
}

func TestDependenciesFromParentChild(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	spans := []model.Span{
		{SpanID: "a", ServiceName: "checkout", OperationName: "POST /checkout", StartTime: base, EndTime: base.Add(time.Second), DurationNs: 1_000_000_000, StatusCode: "ok"},
		{SpanID: "b", ParentSpanID: "a", ServiceName: "checkout", OperationName: "call payment", SpanKind: 3, StartTime: base, EndTime: base.Add(500 * time.Millisecond), DurationNs: 500_000_000, StatusCode: "ok"},
		{SpanID: "c", ParentSpanID: "b", ServiceName: "payment", OperationName: "POST /charge", SpanKind: 2, StartTime: base, EndTime: base.Add(400 * time.Millisecond), DurationNs: 400_000_000, StatusCode: "error"},
		{SpanID: "d", ParentSpanID: "a", ServiceName: "checkout", OperationName: "internal", StartTime: base, EndTime: base.Add(10 * time.Millisecond), DurationNs: 10_000_000, StatusCode: "ok"},
	}
	edges := metrics.Dependencies(spans)
	if len(edges) != 1 {
		t.Fatalf("edges = %+v, want exactly the checkout->payment edge", edges)
	}
	e := edges[0]
	if e.Source != "checkout" || e.Target != "payment" || e.RequestCount != 1 || e.ErrorCount != 1 || e.ErrorRate != 1 {
		t.Fatalf("edge = %+v", e)
	}
	if e.AvgDurationNs != 400_000_000 {
		t.Fatalf("avg = %d", e.AvgDurationNs)
	}
}

func TestServiceSummariesThresholdStatus(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	p95 := 100.0 // ms
	th := model.Thresholds{P95LatencyMs: &p95}
	summaries := metrics.ServiceSummaries([]model.Span{
		span("slow", "GET /x", 2, 500, "ok", base),
		span("fast", "GET /y", 2, 10, "ok", base),
	}, th)
	byName := map[string]model.ServiceSummary{}
	for _, s := range summaries {
		byName[s.ServiceName] = s
	}
	if byName["slow"].ThresholdStatus != "breach" {
		t.Fatalf("slow status = %q", byName["slow"].ThresholdStatus)
	}
	if byName["fast"].ThresholdStatus != "ok" {
		t.Fatalf("fast status = %q", byName["fast"].ThresholdStatus)
	}
	// No thresholds configured -> unknown.
	summaries = metrics.ServiceSummaries([]model.Span{span("fast", "GET /y", 2, 10, "ok", base)}, model.Thresholds{})
	if summaries[0].ThresholdStatus != "unknown" {
		t.Fatalf("status = %q, want unknown", summaries[0].ThresholdStatus)
	}
}

func TestGroupTracesOrdering(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	mk := func(tid string, start time.Time) model.Span {
		return model.Span{TraceID: tid, SpanID: "s" + tid, ServiceName: "svc", OperationName: "op", StartTime: start, EndTime: start.Add(time.Second), DurationNs: 1_000_000_000, StatusCode: "ok"}
	}
	out := metrics.GroupTraces([]model.Span{
		mk("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", base),
		mk("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", base.Add(time.Hour)),
		mk("cccccccccccccccccccccccccccccccc", base),
	})
	if len(out) != 3 || out[0].TraceID != "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" {
		t.Fatalf("ordering = %+v", out)
	}
	// Tie on start time: trace_id DESC.
	if out[1].TraceID != "cccccccccccccccccccccccccccccccc" || out[2].TraceID != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("tie-break ordering = %+v", out)
	}
}
