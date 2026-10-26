// Package retention deletes spans older than each project's configured
// retention period, in bounded batches, without long-running transactions.
package retention

import (
	"context"
	"log/slog"
	"time"

	"github.com/aravinditte/kairo/internal/storage"
)

// CleanupOnce runs one retention pass over all projects. For each project it
// deletes spans older than retention_days in batches of batchSize until a
// batch comes back short. Returns the total number of deleted spans.
func CleanupOnce(ctx context.Context, store storage.Store, now time.Time, batchSize int) (int, error) {
	if batchSize <= 0 {
		batchSize = 1000
	}
	total := 0
	for _, p := range store.ListProjects() {
		if p.RetentionDays <= 0 {
			continue
		}
		cutoff := now.Add(-time.Duration(p.RetentionDays) * 24 * time.Hour)
		for {
			if err := ctx.Err(); err != nil {
				return total, err
			}
			n, err := store.DeleteSpansBefore(ctx, p.ID, cutoff, batchSize)
			if err != nil {
				return total, err
			}
			total += n
			if n < batchSize {
				break
			}
		}
	}
	return total, nil
}

// Run is the in-process periodic retention job: it runs CleanupOnce on every
// tick until ctx is cancelled. Cleanup failures are logged, never hidden.
func Run(ctx context.Context, store storage.Store, interval time.Duration, batchSize int, logger *slog.Logger) {
	if interval <= 0 {
		interval = time.Hour
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			n, err := CleanupOnce(ctx, store, now.UTC(), batchSize)
			if err != nil {
				logger.Error("retention cleanup failed", "error", err)
			} else if n > 0 {
				logger.Info("retention cleanup deleted spans", "count", n)
			}
		}
	}
}
