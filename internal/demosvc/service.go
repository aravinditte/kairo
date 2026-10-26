package demosvc

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Config carries the environment configuration shared by every demo
// service binary.
type Config struct {
	// ServiceName is fixed per binary (checkout, inventory, payment,
	// notifications); it is passed in by main, never read from the
	// environment, so a misconfigured deployment cannot rename a service.
	ServiceName string
	// Port comes from the PORT environment variable, falling back to the
	// per-binary default passed to ConfigFromEnv.
	Port int
	// Endpoint is KAIRO_ENDPOINT: the full OTLP ingestion URL.
	Endpoint string
	// APIKey is KAIRO_API_KEY: the project API key used for ingestion.
	APIKey string
}

// EnvOr returns the environment variable's value, or def when unset/empty.
func EnvOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

// ConfigFromEnv builds a Config for a demo service binary. serviceName
// and defaultPort are the binary's fixed identity and port.
func ConfigFromEnv(serviceName string, defaultPort int) Config {
	port := defaultPort
	if raw := strings.TrimSpace(os.Getenv("PORT")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 65535 {
			port = parsed
		} else {
			slog.Warn("ignoring invalid PORT value", "value", raw, "service", serviceName)
		}
	}
	return Config{
		ServiceName: serviceName,
		Port:        port,
		Endpoint:    EnvOr("KAIRO_ENDPOINT", "http://localhost:8080/v1/traces"),
		APIKey:      os.Getenv("KAIRO_API_KEY"),
	}
}

// Addr returns the listen address for the configured port.
func (c Config) Addr() string { return ":" + strconv.Itoa(c.Port) }

// NewMux returns a ServeMux pre-wired with the endpoints every demo
// service must expose: GET /healthz and the /_fault controls.
func (c Config) NewMux(faults *FaultStore) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", HealthHandler)
	faults.RegisterFaultRoutes(mux)
	return mux
}

// NewTracer builds the tracer for this configuration.
func (c Config) NewTracer() *Tracer {
	return NewTracer(c.ServiceName, c.Endpoint, c.APIKey)
}

// HealthHandler implements GET /healthz.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

// WriteJSON writes v as a JSON response with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes Kairo's standard error envelope:
// {"error":{"code":"...","message":"..."}}.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	WriteJSON(w, status, map[string]any{
		"error": map[string]any{"code": code, "message": message},
	})
}

// ListenAndServe runs handler for cfg until SIGINT/SIGTERM, then shuts
// down gracefully with a bounded drain period so in-flight requests can
// finish and flush their spans.
func ListenAndServe(cfg Config, handler http.Handler) error {
	srv := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		// WriteTimeout must exceed the maximum injectable fault delay
		// (10s) plus downstream call time, otherwise a Slow Inventory
		// scenario would be cut off by the server itself.
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		slog.Info("demo service listening",
			"service", cfg.ServiceName, "addr", cfg.Addr(), "kairo_endpoint", cfg.Endpoint)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		slog.Info("shutting down", "service", cfg.ServiceName)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
