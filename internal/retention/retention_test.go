package retention_test

import (
	"context"
	"testing"
	"time"

	"github.com/aravinditte/kairo/internal/model"
	"github.com/aravinditte/kairo/internal/retention"
	"github.com/aravinditte/kairo/internal/storage"
)

func TestCleanupOnceRespectsRetentionAndBatches(t *testing.T) {
	store := storage.NewMemoryStore()
	now := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	_ = store.CreateProject(model.Project{ID: "p1", Name: "P", CreatedAt: now, UpdatedAt: now, RetentionDays: 7})
	mk := func(id string, start time.Time) model.Span {
		return model.Span{ProjectID: "p1", TraceID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SpanID: id,
			ServiceName: "svc", OperationName: "op", StartTime: start, EndTime: start.Add(time.Second),
			DurationNs: 1_000_000_000, StatusCode: "ok", IngestedAt: now}
	}
	old := now.Add(-8 * 24 * time.Hour)  // beyond 7d retention
	edge := now.Add(-7 * 24 * time.Hour) // exactly at cutoff: kept (deletes strictly before)
	fresh := now.Add(-time.Hour)
	spans := []model.Span{mk("0000000000000001", old), mk("0000000000000002", old), mk("0000000000000003", old), mk("0000000000000004", edge), mk("0000000000000005", fresh)}
	if _, _, err := store.InsertSpans(context.Background(), spans); err != nil {
		t.Fatal(err)
	}
	// Batch size 2 forces multiple bounded batches inside one pass.
	deleted, err := retention.CleanupOnce(context.Background(), store, now, 2)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 3 {
		t.Fatalf("deleted = %d, want 3", deleted)
	}
	remaining, err := store.QuerySpans(context.Background(), "p1", now.Add(-30*24*time.Hour), now.Add(time.Hour), "", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 2 {
		t.Fatalf("remaining = %d, want 2 (boundary + fresh)", len(remaining))
	}
	// Second pass deletes nothing.
	deleted, err = retention.CleanupOnce(context.Background(), store, now, 2)
	if err != nil || deleted != 0 {
		t.Fatalf("second pass deleted = %d err = %v", deleted, err)
	}
}
