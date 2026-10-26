// Package integration holds database integration tests that run against a
// real PostgreSQL instance. They SKIP unless KAIRO_TEST_DATABASE_URL is set:
// PostgreSQL is not available on the development VM, so these are exercised
// in CI (or any machine with PostgreSQL) rather than locally.
package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/aravinditte/kairo/internal/model"
	"github.com/aravinditte/kairo/internal/storage"
)

func TestPostgresStoreRoundTrip(t *testing.T) {
	dsn := os.Getenv("KAIRO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("KAIRO_TEST_DATABASE_URL not set: skipping PostgreSQL integration test")
	}
	ctx := context.Background()
	store, err := storage.NewPostgresStore(ctx, dsn)
	if err != nil {
		t.Fatalf("connect/migrate: %v", err)
	}
	defer store.Close()
	if store.Mode() != "postgres" {
		t.Fatalf("mode = %q", store.Mode())
	}
	now := time.Now().UTC()
	project := model.Project{ID: model.NewID(), Name: "integration", CreatedAt: now, UpdatedAt: now, RetentionDays: 7}
	if err := store.CreateProject(project); err != nil {
		t.Fatalf("create project: %v", err)
	}
	defer store.DeleteProject(project.ID)

	span := model.Span{
		ProjectID: project.ID, TraceID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", SpanID: "1111111111111111",
		ServiceName: "checkout", OperationName: "POST /checkout", SpanKind: 2,
		StartTime: now, EndTime: now.Add(50 * time.Millisecond), DurationNs: 50_000_000,
		StatusCode: "ok", ResourceAttributes: map[string]any{}, SpanAttributes: map[string]any{},
		Events: []model.SpanEvent{}, Links: []model.SpanLink{}, IngestedAt: now,
	}
	inserted, dups, err := store.InsertSpans(ctx, []model.Span{span})
	if err != nil || inserted != 1 || dups != 0 {
		t.Fatalf("insert = %d/%d err = %v", inserted, dups, err)
	}
	// Duplicate delivery is a no-op.
	inserted, dups, err = store.InsertSpans(ctx, []model.Span{span})
	if err != nil || inserted != 0 || dups != 1 {
		t.Fatalf("duplicate insert = %d/%d err = %v", inserted, dups, err)
	}
	spans, err := store.GetTraceSpans(ctx, project.ID, span.TraceID)
	if err != nil || len(spans) != 1 {
		t.Fatalf("trace spans = %d err = %v", len(spans), err)
	}
	// Tenant isolation at the storage layer.
	other, err := store.GetTraceSpans(ctx, model.NewID(), span.TraceID)
	if err != nil || len(other) != 0 {
		t.Fatalf("cross-tenant spans = %d err = %v", len(other), err)
	}
	// Retention cleanup.
	n, err := store.DeleteSpansBefore(ctx, project.ID, now.Add(time.Hour), 100)
	if err != nil || n != 1 {
		t.Fatalf("retention delete = %d err = %v", n, err)
	}
}
