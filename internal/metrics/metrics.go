// Package metrics contains the pure aggregation logic of Kairo: percentiles,
// trace grouping, service summaries, dependency reconstruction, RED metrics,
// and overview assembly. All functions operate on span slices so they can be
// unit-tested without storage.
//
// Metric classification (documented contract): a "request" is a span with
// span_kind == SERVER (2). Error rate and percentiles for RED metrics and
// service summaries are computed over server spans only, so one logical
// request is not counted once per hop.
package metrics

import (
	"math"
	"sort"
	"time"

	"github.com/aravinditte/kairo/internal/model"
)

// SpanKindServer is the OpenTelemetry server span kind.
const SpanKindServer = 2

// IsRequest reports whether a span counts as a request under the documented
// classification policy.
func IsRequest(s model.Span) bool { return s.SpanKind == SpanKindServer }

// Percentile returns the p-th percentile (p in [0,100]) of durations using
// the nearest-rank method. Returns nil for an empty slice.
func Percentile(durations []int64, p float64) *int64 {
	if len(durations) == 0 {
		return nil
	}
	sorted := make([]int64, len(durations))
	copy(sorted, durations)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	return PercentileSorted(sorted, p)
}

// PercentileSorted is Percentile for an already ascending-sorted slice.
func PercentileSorted(sorted []int64, p float64) *int64 {
	if len(sorted) == 0 {
		return nil
	}
	if p <= 0 {
		v := sorted[0]
		return &v
	}
	if p >= 100 {
		v := sorted[len(sorted)-1]
		return &v
	}
	rank := int(math.Ceil(p / 100 * float64(len(sorted))))
	if rank < 1 {
		rank = 1
	}
	if rank > len(sorted) {
		rank = len(sorted)
	}
	v := sorted[rank-1]
	return &v
}

func durationsOf(spans []model.Span) []int64 {
	out := make([]int64, 0, len(spans))
	for _, s := range spans {
		out = append(out, s.DurationNs)
	}
	return out
}

// SummarizeTrace builds a TraceSummary from the spans of a single trace.
func SummarizeTrace(traceID string, spans []model.Span) model.TraceSummary {
	sum := model.TraceSummary{TraceID: traceID}
	if len(spans) == 0 {
		return sum
	}
	ids := make(map[string]bool, len(spans))
	for _, s := range spans {
		ids[s.SpanID] = true
	}
	var start, end time.Time
	var root *model.Span
	for i := range spans {
		s := &spans[i]
		if start.IsZero() || s.StartTime.Before(start) {
			start = s.StartTime
		}
		if s.EndTime.After(end) {
			end = s.EndTime
		}
		if s.StatusCode == "error" {
			sum.ErrorCount++
			if sum.ErrorSummary == "" {
				if s.StatusMessage != "" {
					sum.ErrorSummary = s.StatusMessage
				} else {
					sum.ErrorSummary = s.OperationName + " failed"
				}
			}
		}
		if s.ParentSpanID != "" && !ids[s.ParentSpanID] {
			sum.Incomplete = true
		}
		if s.ParentSpanID == "" && (root == nil || s.StartTime.Before(root.StartTime)) {
			root = s
		}
	}
	if root == nil {
		// No parentless span: the earliest span is the best root candidate and
		// the trace is necessarily incomplete (its parents were not ingested).
		earliest := &spans[0]
		for i := range spans {
			if spans[i].StartTime.Before(earliest.StartTime) {
				earliest = &spans[i]
			}
		}
		root = earliest
		sum.Incomplete = true
	}
	sum.RootOperation = root.OperationName
	sum.RootService = root.ServiceName
	sum.StartTime = start
	if end.After(start) {
		sum.DurationNs = end.Sub(start).Nanoseconds()
	}
	sum.SpanCount = len(spans)
	sum.HasError = sum.ErrorCount > 0
	return sum
}

// GroupTraces groups spans by trace ID and returns summaries sorted by
// start_time DESC, trace_id DESC (the contract's stable search ordering).
func GroupTraces(spans []model.Span) []model.TraceSummary {
	byTrace := make(map[string][]model.Span)
	for _, s := range spans {
		byTrace[s.TraceID] = append(byTrace[s.TraceID], s)
	}
	out := make([]model.TraceSummary, 0, len(byTrace))
	for tid, ss := range byTrace {
		out = append(out, SummarizeTrace(tid, ss))
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].StartTime.Equal(out[j].StartTime) {
			return out[i].StartTime.After(out[j].StartTime)
		}
		return out[i].TraceID > out[j].TraceID
	})
	return out
}

// BuildTraceDetail assembles a TraceDetail from one trace's spans, sorted by
// start time then span ID for a stable waterfall order.
func BuildTraceDetail(spans []model.Span) (model.TraceDetail, bool) {
	if len(spans) == 0 {
		return model.TraceDetail{}, false
	}
	sorted := make([]model.Span, len(spans))
	copy(sorted, spans)
	sort.Slice(sorted, func(i, j int) bool {
		if !sorted[i].StartTime.Equal(sorted[j].StartTime) {
			return sorted[i].StartTime.Before(sorted[j].StartTime)
		}
		return sorted[i].SpanID < sorted[j].SpanID
	})
	detail := model.TraceDetail{TraceSummary: SummarizeTrace(sorted[0].TraceID, sorted), Spans: sorted}
	seen := make(map[string]bool)
	for _, s := range sorted {
		if !seen[s.ServiceName] {
			seen[s.ServiceName] = true
			detail.Services = append(detail.Services, s.ServiceName)
		}
	}
	sort.Strings(detail.Services)
	return detail, true
}

// ThresholdBreach reports whether a service summary breaches the thresholds.
// Observed p95 is compared in milliseconds; error rate as a percentage.
func ThresholdBreach(p95Ns *int64, errorRate float64, requestCount int64, th model.Thresholds) (bool, bool) {
	// returns (breach, anyThresholdApplies)
	applies := false
	if requestCount == 0 {
		return false, false
	}
	if th.P95LatencyMs != nil && p95Ns != nil {
		applies = true
		if float64(*p95Ns)/1e6 > *th.P95LatencyMs {
			return true, true
		}
	}
	if th.ErrorRatePercent != nil {
		applies = true
		if errorRate*100 > *th.ErrorRatePercent {
			return true, true
		}
	}
	return false, applies
}

// ServiceSummaries aggregates spans into one summary per observed service.
func ServiceSummaries(spans []model.Span, th model.Thresholds) []model.ServiceSummary {
	byService := make(map[string][]model.Span)
	lastSeen := make(map[string]time.Time)
	for _, s := range spans {
		if s.EndTime.After(lastSeen[s.ServiceName]) {
			lastSeen[s.ServiceName] = s.EndTime
		}
		if IsRequest(s) {
			byService[s.ServiceName] = append(byService[s.ServiceName], s)
		} else if _, ok := byService[s.ServiceName]; !ok {
			byService[s.ServiceName] = nil // ensure service appears even with no server spans
		}
	}
	out := make([]model.ServiceSummary, 0, len(byService))
	for name, reqs := range byService {
		sum := model.ServiceSummary{ServiceName: name, LastSeen: lastSeen[name], ThresholdStatus: "unknown"}
		var errs int64
		for _, s := range reqs {
			if s.StatusCode == "error" {
				errs++
			}
		}
		sum.RequestCount = int64(len(reqs))
		sum.ErrorCount = errs
		if len(reqs) > 0 {
			sum.ErrorRate = float64(errs) / float64(len(reqs))
			durs := durationsOf(reqs)
			sum.P50Ns = Percentile(durs, 50)
			sum.P95Ns = Percentile(durs, 95)
			sum.P99Ns = Percentile(durs, 99)
		}
		if breach, applies := ThresholdBreach(sum.P95Ns, sum.ErrorRate, sum.RequestCount, th); applies {
			if breach {
				sum.ThresholdStatus = "breach"
			} else {
				sum.ThresholdStatus = "ok"
			}
		}
		out = append(out, sum)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ServiceName < out[j].ServiceName })
	return out
}

// Dependencies reconstructs observed service dependencies from parent-child
// span relationships across services. Edges are inferred from observed
// traces only; nothing is claimed about unobserved communication.
func Dependencies(spans []model.Span) []model.DependencyEdge {
	byID := make(map[string]model.Span, len(spans))
	for _, s := range spans {
		byID[s.SpanID] = s
	}
	type agg struct {
		count, errs int64
		durs        []int64
	}
	edges := make(map[[2]string]*agg)
	for _, s := range spans {
		if s.ParentSpanID == "" {
			continue
		}
		parent, ok := byID[s.ParentSpanID]
		if !ok || parent.ServiceName == s.ServiceName {
			continue
		}
		key := [2]string{parent.ServiceName, s.ServiceName}
		a := edges[key]
		if a == nil {
			a = &agg{}
			edges[key] = a
		}
		a.count++
		if s.StatusCode == "error" {
			a.errs++
		}
		a.durs = append(a.durs, s.DurationNs)
	}
	out := make([]model.DependencyEdge, 0, len(edges))
	for key, a := range edges {
		e := model.DependencyEdge{Source: key[0], Target: key[1], RequestCount: a.count, ErrorCount: a.errs, P95Ns: Percentile(a.durs, 95)}
		if a.count > 0 {
			e.ErrorRate = float64(a.errs) / float64(a.count)
			var total int64
			for _, d := range a.durs {
				total += d
			}
			e.AvgDurationNs = total / a.count
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Source != out[j].Source {
			return out[i].Source < out[j].Source
		}
		return out[i].Target < out[j].Target
	})
	return out
}

// MaxBuckets bounds the number of series buckets produced for one query.
const MaxBuckets = 500

// ComputeRED derives RED metrics from spans. Only server spans count as
// requests. service/operation filters ("" = all) are applied to those spans.
func ComputeRED(spans []model.Span, window model.TimeWindow, intervalSeconds int, service, operation string) model.REDMetrics {
	if intervalSeconds <= 0 {
		intervalSeconds = 60
	}
	interval := time.Duration(intervalSeconds) * time.Second
	windowDur := window.End.Sub(window.Start)
	if windowDur <= 0 {
		windowDur = interval
	}
	nBuckets := int(windowDur / interval)
	if windowDur%interval != 0 {
		nBuckets++
	}
	if nBuckets < 1 {
		nBuckets = 1
	}
	if nBuckets > MaxBuckets {
		nBuckets = MaxBuckets
		interval = windowDur / time.Duration(nBuckets)
		intervalSeconds = int(interval / time.Second)
		if intervalSeconds < 1 {
			intervalSeconds = 1
		}
	}
	buckets := make([]model.MetricBucket, nBuckets)
	bucketSpans := make([][]model.Span, nBuckets)
	for i := range buckets {
		buckets[i].BucketStart = window.Start.Add(time.Duration(i) * interval)
	}
	var reqs []model.Span
	for _, s := range spans {
		if !IsRequest(s) {
			continue
		}
		if service != "" && s.ServiceName != service {
			continue
		}
		if operation != "" && s.OperationName != operation {
			continue
		}
		if s.StartTime.Before(window.Start) || !s.StartTime.Before(window.End) {
			continue
		}
		reqs = append(reqs, s)
		idx := int(s.StartTime.Sub(window.Start) / interval)
		if idx < 0 {
			idx = 0
		}
		if idx >= nBuckets {
			idx = nBuckets - 1
		}
		bucketSpans[idx] = append(bucketSpans[idx], s)
	}
	m := model.REDMetrics{
		Window: window, IntervalSeconds: intervalSeconds, Service: service,
		Series: buckets, SlowOperations: []model.SlowOperation{}, ErrorsByService: []model.ServiceErrorCount{},
	}
	var allDurs []int64
	errBySvc := make(map[string]int64)
	type opAgg struct {
		service string
		durs    []int64
	}
	ops := make(map[string]*opAgg)
	for _, s := range reqs {
		m.RequestCount++
		allDurs = append(allDurs, s.DurationNs)
		if s.StatusCode == "error" {
			m.ErrorCount++
			errBySvc[s.ServiceName]++
		}
		key := s.ServiceName + "\x00" + s.OperationName
		oa := ops[key]
		if oa == nil {
			oa = &opAgg{service: s.ServiceName}
			ops[key] = oa
		}
		oa.durs = append(oa.durs, s.DurationNs)
	}
	if m.RequestCount > 0 {
		m.ErrorRate = float64(m.ErrorCount) / float64(m.RequestCount)
	}
	m.RequestRatePerSec = float64(m.RequestCount) / windowDur.Seconds()
	m.P50Ns = Percentile(allDurs, 50)
	m.P95Ns = Percentile(allDurs, 95)
	m.P99Ns = Percentile(allDurs, 99)
	for i := range buckets {
		bs := bucketSpans[i]
		buckets[i].RequestCount = int64(len(bs))
		var durs []int64
		for _, s := range bs {
			durs = append(durs, s.DurationNs)
			if s.StatusCode == "error" {
				buckets[i].ErrorCount++
			}
		}
		if len(durs) > 0 {
			buckets[i].P50Ns = Percentile(durs, 50)
			buckets[i].P95Ns = Percentile(durs, 95)
			buckets[i].P99Ns = Percentile(durs, 99)
		}
	}
	type opRow struct {
		op string
		oa *opAgg
	}
	rows := make([]opRow, 0, len(ops))
	for _, key := range sortedKeys(ops) {
		rows = append(rows, opRow{op: key, oa: ops[key]})
	}
	slow := make([]model.SlowOperation, 0, len(rows))
	for _, r := range rows {
		// key is service\x00operation
		opName := r.op[len(r.oa.service)+1:]
		p95 := Percentile(r.oa.durs, 95)
		var v int64
		if p95 != nil {
			v = *p95
		}
		slow = append(slow, model.SlowOperation{Operation: opName, Service: r.oa.service, Count: int64(len(r.oa.durs)), P95Ns: v})
	}
	sort.Slice(slow, func(i, j int) bool {
		if slow[i].P95Ns != slow[j].P95Ns {
			return slow[i].P95Ns > slow[j].P95Ns
		}
		return slow[i].Operation < slow[j].Operation
	})
	if len(slow) > 10 {
		slow = slow[:10]
	}
	m.SlowOperations = slow
	for svc, n := range errBySvc {
		m.ErrorsByService = append(m.ErrorsByService, model.ServiceErrorCount{Service: svc, ErrorCount: n})
	}
	sort.Slice(m.ErrorsByService, func(i, j int) bool {
		if m.ErrorsByService[i].ErrorCount != m.ErrorsByService[j].ErrorCount {
			return m.ErrorsByService[i].ErrorCount > m.ErrorsByService[j].ErrorCount
		}
		return m.ErrorsByService[i].Service < m.ErrorsByService[j].Service
	})
	return m
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// BuildOverview assembles the overview response from spans in the window.
func BuildOverview(projectID string, spans []model.Span, window model.TimeWindow, intervalSeconds int, th model.Thresholds) model.Overview {
	red := ComputeRED(spans, window, intervalSeconds, "", "")
	ov := model.Overview{
		ProjectID: projectID,
		Window:    window,
		KPIs: model.OverviewKPIs{
			TotalRequests:  red.RequestCount,
			RequestsPerSec: red.RequestRatePerSec,
			ErrorRate:      red.ErrorRate,
			P95Ns:          red.P95Ns,
		},
		Series:       red.Series,
		Services:     ServiceSummaries(spans, th),
		RecentErrors: []model.RecentError{},
		RecentTraces: []model.TraceSummary{},
	}
	if ov.Services == nil {
		ov.Services = []model.ServiceSummary{}
	}
	// Recent errors: error spans, newest first, capped at 10.
	var errSpans []model.Span
	for _, s := range spans {
		if s.StatusCode == "error" {
			errSpans = append(errSpans, s)
		}
	}
	sort.Slice(errSpans, func(i, j int) bool { return errSpans[i].StartTime.After(errSpans[j].StartTime) })
	for i, s := range errSpans {
		if i >= 10 {
			break
		}
		summary := s.StatusMessage
		if summary == "" {
			summary = s.OperationName + " failed"
		}
		ov.RecentErrors = append(ov.RecentErrors, model.RecentError{
			Time: s.StartTime, Service: s.ServiceName, Operation: s.OperationName,
			TraceID: s.TraceID, DurationNs: s.DurationNs, ErrorSummary: summary,
		})
	}
	traces := GroupTraces(spans)
	for i, t := range traces {
		if i >= 10 {
			break
		}
		ov.RecentTraces = append(ov.RecentTraces, t)
	}
	return ov
}
