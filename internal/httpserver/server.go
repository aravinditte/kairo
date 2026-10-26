// Package httpserver implements the Kairo HTTP API with the Go standard
// library ServeMux (Go 1.22+ patterns). All endpoints, auth rules, error
// envelopes, and pagination follow the build contract.
package httpserver

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/aravinditte/kairo/internal/alerts"
	"github.com/aravinditte/kairo/internal/auth"
	"github.com/aravinditte/kairo/internal/config"
	"github.com/aravinditte/kairo/internal/metrics"
	"github.com/aravinditte/kairo/internal/model"
	"github.com/aravinditte/kairo/internal/otlp"
	"github.com/aravinditte/kairo/internal/scenarios"
	"github.com/aravinditte/kairo/internal/storage"
)

// Server is the Kairo API HTTP handler.
type Server struct {
	cfg    *config.Config
	store  storage.Store
	logger *slog.Logger
	runner *scenarios.Runner
	mux    *http.ServeMux
}

// New builds the API handler with all routes registered.
func New(cfg *config.Config, store storage.Store, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{
		cfg:    cfg,
		store:  store,
		logger: logger,
		runner: scenarios.NewRunner(store, scenarios.Endpoints{
			Checkout:     cfg.CheckoutURL,
			Inventory:    cfg.InventoryURL,
			Payment:      cfg.PaymentURL,
			Notification: cfg.NotificationURL,
		}, logger),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /readyz", s.handleReadyz)

	mux.HandleFunc("POST /api/v1/projects", s.handleCreateProject)
	mux.HandleFunc("GET /api/v1/projects", s.handleListProjects)
	mux.HandleFunc("GET /api/v1/projects/{id}", s.handleGetProject)
	mux.HandleFunc("PATCH /api/v1/projects/{id}", s.handlePatchProject)
	mux.HandleFunc("DELETE /api/v1/projects/{id}", s.handleDeleteProject)
	mux.HandleFunc("POST /api/v1/projects/{id}/api-keys", s.handleCreateAPIKey)
	mux.HandleFunc("GET /api/v1/projects/{id}/api-keys", s.handleListAPIKeys)
	mux.HandleFunc("POST /api/v1/api-keys/{keyId}/revoke", s.handleRevokeAPIKey)

	mux.HandleFunc("POST /v1/traces", s.handleIngest)

	mux.HandleFunc("GET /api/v1/traces", s.handleSearchTraces)
	mux.HandleFunc("GET /api/v1/traces/{traceId}", s.handleGetTrace)
	mux.HandleFunc("GET /api/v1/services", s.handleListServices)
	mux.HandleFunc("GET /api/v1/services/{name}", s.handleGetService)
	mux.HandleFunc("GET /api/v1/dependencies", s.handleDependencies)
	mux.HandleFunc("GET /api/v1/metrics/red", s.handleREDMetrics)
	mux.HandleFunc("GET /api/v1/overview", s.handleOverview)
	mux.HandleFunc("GET /api/v1/alerts", s.handleListAlerts)
	mux.HandleFunc("GET /api/v1/settings/thresholds", s.handleGetThresholds)
	mux.HandleFunc("PATCH /api/v1/settings/thresholds", s.handlePatchThresholds)
	mux.HandleFunc("GET /api/v1/settings/retention", s.handleGetRetention)
	mux.HandleFunc("PATCH /api/v1/settings/retention", s.handlePatchRetention)

	mux.HandleFunc("GET /api/v1/scenarios", s.handleListScenarios)
	mux.HandleFunc("POST /api/v1/scenarios", s.handleStartScenario)
	mux.HandleFunc("GET /api/v1/scenarios/{runId}", s.handleGetScenario)
	mux.HandleFunc("POST /api/v1/scenarios/{runId}/cancel", s.handleCancelScenario)

	mux.HandleFunc("/", s.handleNotFound)
	s.mux = mux
	return s
}

// ServeHTTP implements http.Handler with request logging.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	rec := &statusRecorder{ResponseWriter: w, status: 200}
	s.mux.ServeHTTP(rec, r)
	s.logger.Debug("http request", "method", r.Method, "path", r.URL.Path, "status", rec.status, "duration_ms", time.Since(start).Milliseconds())
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// --- response helpers ---

type errorEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var env errorEnvelope
	env.Error.Code = code
	env.Error.Message = message
	writeJSON(w, status, env)
}

func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "not_found", "route not found")
}

// --- auth helpers ---

func (s *Server) isAdmin(r *http.Request) bool {
	tok := r.Header.Get("X-Admin-Token")
	if tok == "" || s.cfg.AdminToken == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(tok), []byte(s.cfg.AdminToken)) == 1
}

func rawAPIKey(r *http.Request) string {
	if k := r.Header.Get("X-Api-Key"); k != "" {
		return k
	}
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return ""
}

// requireAdmin enforces management authentication.
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if !s.isAdmin(r) {
		writeError(w, http.StatusUnauthorized, "unauthorized", "valid X-Admin-Token header required")
		return false
	}
	return true
}

// resolveProject determines the project scope for a query endpoint: either
// admin token + project_id query param, or an API key (whose project is
// authoritative). A client-supplied project_id never grants access by itself.
func (s *Server) resolveProject(w http.ResponseWriter, r *http.Request) (string, bool) {
	qp := r.URL.Query().Get("project_id")
	if s.isAdmin(r) {
		if qp == "" {
			writeError(w, http.StatusBadRequest, "project_required", "project_id query parameter is required with admin authentication")
			return "", false
		}
		if _, ok := s.store.GetProject(qp); !ok {
			writeError(w, http.StatusNotFound, "project_not_found", "project not found")
			return "", false
		}
		return qp, true
	}
	raw := rawAPIKey(r)
	if raw == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "provide an API key or admin token")
		return "", false
	}
	meta, err := auth.Validate(s.store, raw)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid or revoked API key")
		return "", false
	}
	if qp != "" && qp != meta.ProjectID {
		writeError(w, http.StatusForbidden, "forbidden", "API key does not grant access to the requested project")
		return "", false
	}
	return meta.ProjectID, true
}

// resolveProjectForBody is resolveProject for endpoints whose project_id
// arrives in the JSON body (scenario start).
func (s *Server) resolveProjectForBody(w http.ResponseWriter, r *http.Request, bodyProjectID string) (string, bool) {
	if s.isAdmin(r) {
		if bodyProjectID == "" {
			writeError(w, http.StatusBadRequest, "project_required", "project_id is required")
			return "", false
		}
		if _, ok := s.store.GetProject(bodyProjectID); !ok {
			writeError(w, http.StatusNotFound, "project_not_found", "project not found")
			return "", false
		}
		return bodyProjectID, true
	}
	raw := rawAPIKey(r)
	if raw == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "provide an API key or admin token")
		return "", false
	}
	meta, err := auth.Validate(s.store, raw)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid or revoked API key")
		return "", false
	}
	if bodyProjectID != "" && bodyProjectID != meta.ProjectID {
		writeError(w, http.StatusForbidden, "forbidden", "API key does not grant access to the requested project")
		return "", false
	}
	return meta.ProjectID, true
}

// --- health ---

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleReadyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()
	dbStatus := "memory"
	status := "ready"
	code := http.StatusOK
	if s.store.Mode() == "postgres" {
		if err := s.store.Ping(ctx); err != nil {
			dbStatus = "down"
			status = "not_ready"
			code = http.StatusServiceUnavailable
		} else {
			dbStatus = "up"
		}
	}
	writeJSON(w, code, map[string]string{"status": status, "database": dbStatus})
}

// --- projects & API keys (management, admin only) ---

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var body struct {
		Name          string `json:"name"`
		RetentionDays *int   `json:"retention_days"`
	}
	if err := decodeBody(w, r, &body); err != nil {
		return
	}
	if strings.TrimSpace(body.Name) == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "name is required")
		return
	}
	retention := s.cfg.DefaultRetentionDays
	if body.RetentionDays != nil {
		retention = *body.RetentionDays
	}
	if retention < 1 || retention > 365 {
		writeError(w, http.StatusBadRequest, "validation_error", "retention_days must be between 1 and 365")
		return
	}
	now := time.Now().UTC()
	p := model.Project{
		ID:            model.NewID(),
		Name:          strings.TrimSpace(body.Name),
		CreatedAt:     now,
		UpdatedAt:     now,
		RetentionDays: retention,
	}
	if err := s.store.CreateProject(p); err != nil {
		s.logger.Error("create project failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not create project")
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	projects := s.store.ListProjects()
	if projects == nil {
		projects = []model.Project{}
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleGetProject(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	p, ok := s.store.GetProject(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handlePatchProject(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	p, ok := s.store.GetProject(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	var body struct {
		Name          *string           `json:"name"`
		RetentionDays *int              `json:"retention_days"`
		Thresholds    *model.Thresholds `json:"thresholds"`
	}
	if err := decodeBody(w, r, &body); err != nil {
		return
	}
	if body.Name != nil {
		if strings.TrimSpace(*body.Name) == "" {
			writeError(w, http.StatusBadRequest, "validation_error", "name must not be empty")
			return
		}
		p.Name = strings.TrimSpace(*body.Name)
	}
	if body.RetentionDays != nil {
		if *body.RetentionDays < 1 || *body.RetentionDays > 365 {
			writeError(w, http.StatusBadRequest, "validation_error", "retention_days must be between 1 and 365")
			return
		}
		p.RetentionDays = *body.RetentionDays
	}
	if body.Thresholds != nil {
		if err := validateThresholds(*body.Thresholds); err != nil {
			writeError(w, http.StatusBadRequest, "validation_error", err.Error())
			return
		}
		p.Thresholds = *body.Thresholds
	}
	p.UpdatedAt = time.Now().UTC()
	updated, ok := s.store.UpdateProject(p)
	if !ok {
		writeError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	if !s.store.DeleteProject(r.PathValue("id")) {
		writeError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func validateThresholds(t model.Thresholds) error {
	if t.P95LatencyMs != nil && *t.P95LatencyMs < 0 {
		return errors.New("p95_latency_ms must be >= 0")
	}
	if t.ErrorRatePercent != nil && (*t.ErrorRatePercent < 0 || *t.ErrorRatePercent > 100) {
		return errors.New("error_rate_percent must be between 0 and 100")
	}
	if t.RequestRatePerSec != nil && *t.RequestRatePerSec < 0 {
		return errors.New("request_rate_per_sec must be >= 0")
	}
	return nil
}

func (s *Server) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	projectID := r.PathValue("id")
	if _, ok := s.store.GetProject(projectID); !ok {
		writeError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	raw, err := auth.GenerateRawKey()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "could not generate key")
		return
	}
	meta := model.APIKeyMeta{ID: model.NewID(), ProjectID: projectID, CreatedAt: time.Now().UTC()}
	if err := s.store.CreateAPIKey(meta, auth.HashKey(raw)); err != nil {
		s.logger.Error("create api key failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not create api key")
		return
	}
	writeJSON(w, http.StatusCreated, model.CreateAPIKeyResponse{APIKey: meta, RawKey: raw})
}

func (s *Server) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	projectID := r.PathValue("id")
	if _, ok := s.store.GetProject(projectID); !ok {
		writeError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	keys := s.store.ListAPIKeys(projectID)
	if keys == nil {
		keys = []model.APIKeyMeta{}
	}
	writeJSON(w, http.StatusOK, keys)
}

func (s *Server) handleRevokeAPIKey(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	meta, ok := s.store.RevokeAPIKey(r.PathValue("keyId"), time.Now().UTC())
	if !ok {
		writeError(w, http.StatusNotFound, "api_key_not_found", "api key not found")
		return
	}
	writeJSON(w, http.StatusOK, meta)
}

// --- OTLP ingestion ---

func (s *Server) handleIngest(w http.ResponseWriter, r *http.Request) {
	raw := rawAPIKey(r)
	if raw == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "API key required for ingestion")
		return
	}
	meta, err := auth.Validate(s.store, raw)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "invalid or revoked API key")
		return
	}
	body, err := readLimitedBody(w, r, s.cfg.MaxOTLPBodyBytes)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "request body exceeds the configured limit")
			return
		}
		writeError(w, http.StatusBadRequest, "bad_request", "could not read request body")
		return
	}
	contentType := r.Header.Get("Content-Type")
	req, err := otlp.Parse(body, contentType)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_otlp_payload", "malformed OTLP payload")
		return
	}
	lim := otlp.Limits{
		MaxSpansPerBatch:  s.cfg.MaxSpansPerBatch,
		MaxAttrCount:      s.cfg.MaxAttrCount,
		MaxAttrValueBytes: s.cfg.MaxAttrValueBytes,
	}
	spans, err := otlp.Normalize(req, meta.ProjectID, lim, time.Now().UTC())
	if err != nil {
		if errors.Is(err, otlp.ErrTooManySpans) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_many_spans", "batch exceeds the configured span limit")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_otlp_payload", "invalid span in OTLP payload")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()
	inserted, duplicates, err := s.store.InsertSpans(ctx, spans)
	if err != nil {
		// Never false-ack: durable acceptance only after the store commits.
		s.logger.Error("span ingestion failed", "project_id", meta.ProjectID, "error", err)
		writeError(w, http.StatusServiceUnavailable, "storage_unavailable", "spans could not be stored; retry the batch")
		return
	}
	s.store.TouchAPIKey(meta.ID, time.Now().UTC())
	s.logger.Debug("ingested spans", "project_id", meta.ProjectID, "inserted", inserted, "duplicates", duplicates)
	go s.evaluateThresholds(meta.ProjectID)
	s.writeOTLPResponse(w, contentType, 0)
}

// writeOTLPResponse returns an ExportTraceServiceResponse in the same
// encoding as the request. rejected is reported as partial success.
func (s *Server) writeOTLPResponse(w http.ResponseWriter, contentType string, rejected int64) {
	resp := &collectortrace.ExportTraceServiceResponse{}
	if rejected > 0 {
		resp.PartialSuccess = &collectortrace.ExportTracePartialSuccess{RejectedSpans: rejected}
	}
	ct := contentType
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	if ct == "application/json" {
		out, err := protojson.Marshal(resp)
		if err != nil {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(out)
		return
	}
	out, err := proto.Marshal(resp)
	if err != nil {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.Header().Set("Content-Type", "application/x-protobuf")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}

// evaluateThresholds runs threshold evaluation for the trailing 5-minute
// window after an ingestion batch. Bounded and best-effort: failures are
// logged, never surfaced to the ingestion caller (whose spans are durable).
func (s *Server) evaluateThresholds(projectID string) {
	ctx, cancel := context.WithTimeout(context.Background(), s.cfg.QueryTimeout)
	defer cancel()
	project, ok := s.store.GetProject(projectID)
	if !ok {
		return
	}
	if project.Thresholds.P95LatencyMs == nil && project.Thresholds.ErrorRatePercent == nil && project.Thresholds.RequestRatePerSec == nil {
		return
	}
	end := time.Now().UTC()
	start := end.Add(-alerts.DedupeWindow)
	spans, err := s.store.QuerySpans(ctx, projectID, start, end, "", "", 0)
	if err != nil {
		s.logger.Debug("threshold evaluation query failed", "error", err)
		return
	}
	alerts.EvaluateAndStore(s.store, projectID, spans, project.Thresholds, model.TimeWindow{Start: start, End: end}, end)
}

// --- query helpers ---

var errInvalidWindow = errors.New("invalid time window")

// parseWindow validates start/end query parameters. Defaults: the last hour
// ending now. Maximum window: 7 days.
func parseWindow(r *http.Request) (model.TimeWindow, error) {
	now := time.Now().UTC()
	end := now
	start := now.Add(-time.Hour)
	q := r.URL.Query()
	if v := q.Get("end"); v != "" {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			return model.TimeWindow{}, errInvalidWindow
		}
		end = t.UTC()
	}
	if v := q.Get("start"); v != "" {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			return model.TimeWindow{}, errInvalidWindow
		}
		start = t.UTC()
	}
	if !end.After(start) {
		return model.TimeWindow{}, errInvalidWindow
	}
	if end.Sub(start) > 7*24*time.Hour {
		return model.TimeWindow{}, errInvalidWindow
	}
	return model.TimeWindow{Start: start, End: end}, nil
}

func parseInterval(r *http.Request) (int, error) {
	v := r.URL.Query().Get("interval_seconds")
	if v == "" {
		return 60, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 || n > 86400 {
		return 0, errors.New("interval_seconds must be between 1 and 86400")
	}
	return n, nil
}

func (s *Server) queryWindowSpans(r *http.Request, projectID string, window model.TimeWindow, service, operation string) ([]model.Span, error) {
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()
	return s.store.QuerySpans(ctx, projectID, window.Start, window.End, service, operation, 0)
}

func (s *Server) projectThresholds(projectID string) model.Thresholds {
	if p, ok := s.store.GetProject(projectID); ok {
		return p.Thresholds
	}
	return model.Thresholds{}
}

// --- traces ---

func (s *Server) handleSearchTraces(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	window, err := parseWindow(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_window", "start/end must be RFC3339, end after start, window at most 7 days")
		return
	}
	q := r.URL.Query()
	filter := model.TraceSearchFilter{Start: window.Start, End: window.End, Limit: 50}
	filter.Service = q.Get("service")
	filter.Operation = q.Get("operation")
	filter.TraceID = q.Get("trace_id")
	filter.Cursor = q.Get("cursor")
	if v := q.Get("status"); v != "" {
		if v != "error" && v != "ok" {
			writeError(w, http.StatusBadRequest, "invalid_filter", "status must be error or ok")
			return
		}
		filter.Status = v
	}
	if filter.TraceID != "" && !otlp.ValidTraceID(filter.TraceID) {
		writeError(w, http.StatusBadRequest, "invalid_filter", "trace_id must be 32 lowercase hex characters")
		return
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, "invalid_filter", "limit must be a positive integer")
			return
		}
		if n > 200 {
			n = 200
		}
		filter.Limit = n
	}
	if v := q.Get("min_duration_ns"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, "invalid_filter", "min_duration_ns must be a non-negative integer")
			return
		}
		filter.MinDurationNs = n
		filter.HasMinDuration = true
	}
	if v := q.Get("max_duration_ns"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, "invalid_filter", "max_duration_ns must be a non-negative integer")
			return
		}
		filter.MaxDurationNs = n
		filter.HasMaxDuration = true
	}
	if filter.HasMinDuration && filter.HasMaxDuration && filter.MinDurationNs > filter.MaxDurationNs {
		writeError(w, http.StatusBadRequest, "invalid_filter", "min_duration_ns must not exceed max_duration_ns")
		return
	}
	if filter.Cursor != "" {
		if _, _, err := storage.DecodeCursor(filter.Cursor); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_cursor", "cursor is not valid")
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()
	page, err := s.store.SearchTraces(ctx, projectID, filter)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor", "cursor is not valid")
		return
	}
	if page.Traces == nil {
		page.Traces = []model.TraceSummary{}
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleGetTrace(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	traceID := r.PathValue("traceId")
	if !otlp.ValidTraceID(traceID) {
		writeError(w, http.StatusBadRequest, "invalid_trace_id", "trace id must be 32 lowercase hex characters")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.cfg.QueryTimeout)
	defer cancel()
	spans, err := s.store.GetTraceSpans(ctx, projectID, traceID)
	if err != nil {
		s.logger.Error("get trace failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load trace")
		return
	}
	detail, found := metrics.BuildTraceDetail(spans)
	if !found {
		writeError(w, http.StatusNotFound, "trace_not_found", "trace not found in this project")
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

// --- services, dependencies, metrics, overview ---

func (s *Server) handleListServices(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	window, err := parseWindow(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_window", "start/end must be RFC3339, end after start, window at most 7 days")
		return
	}
	spans, err := s.queryWindowSpans(r, projectID, window, "", "")
	if err != nil {
		s.logger.Error("services query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load services")
		return
	}
	summaries := metrics.ServiceSummaries(spans, s.projectThresholds(projectID))
	if summaries == nil {
		summaries = []model.ServiceSummary{}
	}
	writeJSON(w, http.StatusOK, summaries)
}

func (s *Server) handleGetService(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	name := r.PathValue("name")
	window, err := parseWindow(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_window", "start/end must be RFC3339, end after start, window at most 7 days")
		return
	}
	spans, err := s.queryWindowSpans(r, projectID, window, "", "")
	if err != nil {
		s.logger.Error("service query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load service")
		return
	}
	var found *model.ServiceSummary
	for _, sum := range metrics.ServiceSummaries(spans, s.projectThresholds(projectID)) {
		if sum.ServiceName == name {
			cp := sum
			found = &cp
			break
		}
	}
	if found == nil {
		writeError(w, http.StatusNotFound, "service_not_found", "service has not been observed in this window")
		return
	}
	// Operation breakdown over the service's server spans.
	type opSummary struct {
		Operation  string `json:"operation"`
		Count      int64  `json:"count"`
		ErrorCount int64  `json:"error_count"`
		P95Ns      *int64 `json:"p95_ns"`
	}
	opDurs := make(map[string][]int64)
	opErrs := make(map[string]int64)
	for _, sp := range spans {
		if sp.ServiceName != name || !metrics.IsRequest(sp) {
			continue
		}
		opDurs[sp.OperationName] = append(opDurs[sp.OperationName], sp.DurationNs)
		if sp.StatusCode == "error" {
			opErrs[sp.OperationName]++
		}
	}
	operations := []opSummary{}
	for op, durs := range opDurs {
		operations = append(operations, opSummary{Operation: op, Count: int64(len(durs)), ErrorCount: opErrs[op], P95Ns: metrics.Percentile(durs, 95)})
	}
	edges := metrics.Dependencies(spans)
	incoming := []model.DependencyEdge{}
	outgoing := []model.DependencyEdge{}
	for _, e := range edges {
		if e.Target == name {
			incoming = append(incoming, e)
		}
		if e.Source == name {
			outgoing = append(outgoing, e)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"service":           found,
		"operations":        operations,
		"incoming":          incoming,
		"outgoing":          outgoing,
		"window":            window,
		"dependencies_note": "Dependencies are inferred from observed traces only.",
	})
}

func (s *Server) handleDependencies(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	window, err := parseWindow(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_window", "start/end must be RFC3339, end after start, window at most 7 days")
		return
	}
	spans, err := s.queryWindowSpans(r, projectID, window, "", "")
	if err != nil {
		s.logger.Error("dependencies query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load dependencies")
		return
	}
	edges := metrics.Dependencies(spans)
	if edges == nil {
		edges = []model.DependencyEdge{}
	}
	writeJSON(w, http.StatusOK, edges)
}

func (s *Server) handleREDMetrics(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	window, err := parseWindow(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_window", "start/end must be RFC3339, end after start, window at most 7 days")
		return
	}
	interval, err := parseInterval(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_filter", err.Error())
		return
	}
	service := r.URL.Query().Get("service")
	operation := r.URL.Query().Get("operation")
	spans, err := s.queryWindowSpans(r, projectID, window, service, operation)
	if err != nil {
		s.logger.Error("metrics query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load metrics")
		return
	}
	writeJSON(w, http.StatusOK, metrics.ComputeRED(spans, window, interval, service, operation))
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	window, err := parseWindow(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_window", "start/end must be RFC3339, end after start, window at most 7 days")
		return
	}
	interval, err := parseInterval(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_filter", err.Error())
		return
	}
	spans, err := s.queryWindowSpans(r, projectID, window, "", "")
	if err != nil {
		s.logger.Error("overview query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load overview")
		return
	}
	th := s.projectThresholds(projectID)
	// On-demand threshold evaluation over the trailing 5 minutes.
	now := time.Now().UTC()
	recent, err := s.queryWindowSpans(r, projectID, model.TimeWindow{Start: now.Add(-alerts.DedupeWindow), End: now}, "", "")
	if err == nil {
		alerts.EvaluateAndStore(s.store, projectID, recent, th, model.TimeWindow{Start: now.Add(-alerts.DedupeWindow), End: now}, now)
	}
	writeJSON(w, http.StatusOK, metrics.BuildOverview(projectID, spans, window, interval, th))
}

// --- alerts & settings ---

func (s *Server) handleListAlerts(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, "invalid_filter", "limit must be a positive integer")
			return
		}
		if n > 500 {
			n = 500
		}
		limit = n
	}
	events := s.store.ListAlerts(projectID, limit)
	if events == nil {
		events = []model.AlertEvent{}
	}
	writeJSON(w, http.StatusOK, events)
}

func (s *Server) handleGetThresholds(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	p, _ := s.store.GetProject(projectID)
	writeJSON(w, http.StatusOK, p.Thresholds)
}

func (s *Server) handlePatchThresholds(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	var th model.Thresholds
	if err := decodeBody(w, r, &th); err != nil {
		return
	}
	if err := validateThresholds(th); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
		return
	}
	p, _ := s.store.GetProject(projectID)
	p.Thresholds = th
	p.UpdatedAt = time.Now().UTC()
	updated, ok := s.store.UpdateProject(p)
	if !ok {
		writeError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	writeJSON(w, http.StatusOK, updated.Thresholds)
}

func (s *Server) handleGetRetention(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	p, _ := s.store.GetProject(projectID)
	writeJSON(w, http.StatusOK, map[string]any{
		"project_id":     projectID,
		"retention_days": p.RetentionDays,
	})
}

func (s *Server) handlePatchRetention(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	var body struct {
		RetentionDays *int `json:"retention_days"`
	}
	if err := decodeBody(w, r, &body); err != nil {
		return
	}
	if body.RetentionDays == nil || *body.RetentionDays < 1 || *body.RetentionDays > 365 {
		writeError(w, http.StatusBadRequest, "validation_error", "retention_days must be between 1 and 365")
		return
	}
	p, _ := s.store.GetProject(projectID)
	p.RetentionDays = *body.RetentionDays
	p.UpdatedAt = time.Now().UTC()
	updated, ok := s.store.UpdateProject(p)
	if !ok {
		writeError(w, http.StatusNotFound, "project_not_found", "project not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"project_id":     projectID,
		"retention_days": updated.RetentionDays,
	})
}

// --- scenarios ---

func (s *Server) handleListScenarios(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, scenarios.Definitions())
}

func (s *Server) handleStartScenario(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProjectID    string         `json:"project_id"`
		ScenarioType string         `json:"scenario_type"`
		Parameters   map[string]any `json:"parameters"`
		Workload     int            `json:"workload"`
	}
	if err := decodeBody(w, r, &body); err != nil {
		return
	}
	projectID, ok := s.resolveProjectForBody(w, r, body.ProjectID)
	if !ok {
		return
	}
	if body.ScenarioType == "" {
		writeError(w, http.StatusBadRequest, "validation_error", "scenario_type is required")
		return
	}
	run, err := s.runner.Start(projectID, body.ScenarioType, body.Parameters, body.Workload)
	if err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, run)
}

func (s *Server) handleGetScenario(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	run, found := s.store.GetScenarioRun(projectID, r.PathValue("runId"))
	if !found {
		writeError(w, http.StatusNotFound, "scenario_run_not_found", "scenario run not found in this project")
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) handleCancelScenario(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.resolveProject(w, r)
	if !ok {
		return
	}
	runID := r.PathValue("runId")
	run, found := s.store.GetScenarioRun(projectID, runID)
	if !found {
		writeError(w, http.StatusNotFound, "scenario_run_not_found", "scenario run not found in this project")
		return
	}
	if run.Status == "running" || run.Status == "pending" {
		s.runner.Cancel(runID)
		now := time.Now().UTC()
		run.Status = "cancelled"
		run.FinishedAt = &now
		_ = s.store.UpdateScenarioRun(run)
	}
	writeJSON(w, http.StatusOK, run)
}

// --- body helpers ---

var errBodyTooLarge = errors.New("request body too large")

func readLimitedBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, limit+1)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, errBodyTooLarge
		}
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, errBodyTooLarge
	}
	return body, nil
}

const maxJSONBody = 1 << 20 // 1 MiB for management/query JSON bodies

func decodeBody(w http.ResponseWriter, r *http.Request, v any) error {
	body, err := readLimitedBody(w, r, maxJSONBody)
	if err != nil {
		if errors.Is(err, errBodyTooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "request body exceeds the configured limit")
		} else {
			writeError(w, http.StatusBadRequest, "bad_request", "could not read request body")
		}
		return err
	}
	if len(body) == 0 {
		return nil // treat empty body as zero value
	}
	dec := json.NewDecoder(strings.NewReader(string(body)))
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return err
	}
	return nil
}
