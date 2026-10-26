// Package alerts evaluates per-service RED aggregates against project
// thresholds and records alert events, with a 5-minute dedupe window per
// (project, service, rule).
package alerts

import (
	"time"

	"github.com/aravinditte/kairo/internal/metrics"
	"github.com/aravinditte/kairo/internal/model"
	"github.com/aravinditte/kairo/internal/storage"
)

// DedupeWindow is the window within which an identical
// (service, rule) alert is not recorded twice.
const DedupeWindow = 5 * time.Minute

// Evaluate computes candidate alerts for services over the window from spans
// (server-span classification, as in metrics). A candidate is produced when
// p95 latency exceeds the configured p95 threshold, or the error rate exceeds
// the configured error-rate threshold, or the request rate exceeds the
// configured request-rate threshold.
func Evaluate(projectID string, spans []model.Span, th model.Thresholds, window model.TimeWindow, now time.Time) []model.AlertEvent {
	if th.P95LatencyMs == nil && th.ErrorRatePercent == nil && th.RequestRatePerSec == nil {
		return nil
	}
	summaries := metrics.ServiceSummaries(spans, th)
	windowSeconds := window.End.Sub(window.Start).Seconds()
	var out []model.AlertEvent
	for _, s := range summaries {
		if s.RequestCount == 0 {
			continue
		}
		if th.P95LatencyMs != nil && s.P95Ns != nil && float64(*s.P95Ns)/1e6 > *th.P95LatencyMs {
			out = append(out, newEvent(projectID, s.ServiceName, "p95_latency", float64(*s.P95Ns)/1e6, *th.P95LatencyMs, window, now))
		}
		if th.ErrorRatePercent != nil && s.ErrorRate*100 > *th.ErrorRatePercent {
			out = append(out, newEvent(projectID, s.ServiceName, "error_rate", s.ErrorRate*100, *th.ErrorRatePercent, window, now))
		}
		if th.RequestRatePerSec != nil && windowSeconds > 0 {
			rate := float64(s.RequestCount) / windowSeconds
			if rate > *th.RequestRatePerSec {
				out = append(out, newEvent(projectID, s.ServiceName, "request_rate", rate, *th.RequestRatePerSec, window, now))
			}
		}
	}
	return out
}

func newEvent(projectID, service, rule string, observed, threshold float64, window model.TimeWindow, now time.Time) model.AlertEvent {
	return model.AlertEvent{
		ID:             model.NewID(),
		ProjectID:      projectID,
		ServiceName:    service,
		RuleType:       rule,
		ObservedValue:  observed,
		ThresholdValue: threshold,
		WindowStart:    window.Start,
		WindowEnd:      window.End,
		CreatedAt:      now,
		Status:         "active",
	}
}

// EvaluateAndStore evaluates thresholds and inserts only alerts that are not
// duplicates within the dedupe window. Returns how many were inserted.
func EvaluateAndStore(store storage.Store, projectID string, spans []model.Span, th model.Thresholds, window model.TimeWindow, now time.Time) int {
	inserted := 0
	for _, ev := range Evaluate(projectID, spans, th, window, now) {
		if store.HasRecentAlert(projectID, ev.ServiceName, ev.RuleType, now.Add(-DedupeWindow)) {
			continue
		}
		if err := store.InsertAlert(ev); err == nil {
			inserted++
		}
	}
	return inserted
}
