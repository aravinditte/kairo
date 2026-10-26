// Command kairo-api is the Kairo backend: OTLP trace ingestion, trace and
// metrics queries, threshold alerts, retention, and the Failure Lab runner.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/aravinditte/kairo/internal/auth"
	"github.com/aravinditte/kairo/internal/config"
	"github.com/aravinditte/kairo/internal/httpserver"
	"github.com/aravinditte/kairo/internal/logging"
	"github.com/aravinditte/kairo/internal/model"
	"github.com/aravinditte/kairo/internal/retention"
	"github.com/aravinditte/kairo/internal/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("kairo-api exited with error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := logging.New(cfg.LogLevel)
	slog.SetDefault(logger)

	if cfg.AdminTokenIsDefault {
		logger.Warn("using the documented development admin token (KAIRO_ADMIN_TOKEN unset); never use this in production",
			"env", cfg.Env)
	}
	if cfg.Env == "production" && cfg.AdminToken == "" {
		logger.Warn("KAIRO_ADMIN_TOKEN is unset in production: management endpoints are disabled")
	}

	ctx := context.Background()
	var store storage.Store
	if cfg.DatabaseURL == "" {
		logger.Warn("KAIRO_DATABASE_URL is empty: using NON-DURABLE in-memory demo storage; all data is lost on restart")
		store = storage.NewMemoryStore()
	} else {
		pg, err := storage.NewPostgresStore(ctx, cfg.DatabaseURL)
		if err != nil {
			return err
		}
		store = pg
		logger.Info("connected to PostgreSQL; migrations applied")
	}
	defer store.Close()

	if cfg.SeedDemo && cfg.DemoMode {
		seedDemo(logger, store, cfg)
	}

	// Retention job: hourly, bounded batches, in-process.
	runCtx, stopRuns := context.WithCancel(context.Background())
	defer stopRuns()
	go retention.Run(runCtx, store, cfg.RetentionInterval, cfg.RetentionBatchSize, logger)

	handler := httpserver.New(cfg, store, logger)
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	sigCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("kairo-api listening", "addr", cfg.HTTPAddr, "env", cfg.Env, "storage", store.Mode(), "demo_mode", cfg.DemoMode)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-sigCtx.Done():
		logger.Info("shutdown requested; draining in-flight requests")
	}

	// Graceful shutdown: stop accepting new requests, allow in-flight work a
	// bounded time, then close the store cleanly.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	stopRuns()
	return nil
}

// seedDemo creates the demo project and the documented development key
// (kairo-dev-key, stored hashed) when KAIRO_SEED_DEMO=true in demo mode.
// Idempotent: repeated starts reuse the existing project/key.
func seedDemo(logger *slog.Logger, store storage.Store, cfg *config.Config) {
	devHash := auth.HashKey(config.DevAPIKey)
	if meta, _, ok := store.GetAPIKeyByHash(devHash); ok {
		logger.Info("demo project already seeded", "project_id", meta.ProjectID)
		return
	}
	now := time.Now().UTC()
	project := model.Project{
		ID:            model.DemoProjectID,
		Name:          "Demo Project",
		CreatedAt:     now,
		UpdatedAt:     now,
		RetentionDays: cfg.DefaultRetentionDays,
	}
	if err := store.CreateProject(project); err != nil {
		logger.Error("seed demo project failed", "error", err)
		return
	}
	meta := model.APIKeyMeta{ID: model.NewID(), ProjectID: project.ID, CreatedAt: now}
	if err := store.CreateAPIKey(meta, devHash); err != nil {
		logger.Error("seed demo api key failed", "error", err)
		return
	}
	logger.Info("seeded demo project; development ingestion key is the documented kairo-dev-key (development only)",
		"project_id", project.ID)
}
