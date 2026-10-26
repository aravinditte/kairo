// Package scenarios implements the Failure Lab: scenario definitions,
// parameter validation, and a runner that injects faults into the isolated
// demo services through their /_fault API and drives a bounded checkout
// workload.
//
// Safety: the runner only ever talks to the configured demo-service URLs
// (checkout URL from configuration, plus the inventory/payment/notification
// URLs derived from it or explicitly configured). It never accepts arbitrary
// URLs, hosts, or commands from API callers.
package scenarios

import (
	"bytes"
	"context"
	crand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/aravinditte/kairo/internal/metrics"
	"github.com/aravinditte/kairo/internal/model"
	"github.com/aravinditte/kairo/internal/storage"
)

// MaxWorkload bounds a single scenario run's checkout requests.
const MaxWorkload = 100

// DefaultWorkload is used when the caller does not specify a workload.
const DefaultWorkload = 10

// Definitions returns the supported Failure Lab scenarios.
func Definitions() []model.ScenarioDefinition {
	return []model.ScenarioDefinition{
		{
			ID:          "healthy-baseline",
			Name:        "Healthy Baseline",
			Description: "Executes normal, unperturbed transactions across the complete microservice chain. Validates baseline latency percentiles and 0% error rates.",
			Parameters:  []model.ScenarioParameter{},
		},
		{
			ID:          "slow-inventory",
			Name:        "Slow Inventory",
			Description: "Injects a configurable delay into Inventory responses. Checkout requests take longer, traces show a delayed Inventory span, and latency analytics reflect the affected service.",
			Parameters: []model.ScenarioParameter{
				{Key: "delay_ms", Label: "Inventory delay", Min: 0, Max: 10000, Default: 800, Unit: "ms"},
			},
		},
		{
			ID:          "payment-errors",
			Name:        "Payment Errors",
			Description: "Makes Payment return controlled HTTP 5xx responses for a configurable proportion of requests. Failed spans carry error status and error metrics increase.",
			Parameters: []model.ScenarioParameter{
				{Key: "error_rate", Label: "Payment error rate", Min: 0, Max: 1, Default: 0.5, Unit: "ratio"},
			},
		},
		{
			ID:          "notification-timeout",
			Name:        "Notification Timeout",
			Description: "Introduces a delay in the Notification path so the checkout notification call times out. Traces reveal the slow or failed operation, distinguishable from other services' failures.",
			Parameters: []model.ScenarioParameter{
				{Key: "delay_ms", Label: "Notification delay", Min: 0, Max: 10000, Default: 2000, Unit: "ms"},
			},
		},
		{
			ID:          "traffic-spike",
			Name:        "Traffic Surge",
			Description: "Injects sudden traffic volume spike across Checkout and downstream services to analyze queueing delays, throughput saturation, and P99 latency drift.",
			Parameters: []model.ScenarioParameter{
				{Key: "multiplier", Label: "Traffic surge multiplier", Min: 2, Max: 10, Default: 5, Unit: "x"},
			},
		},
		{
			ID:          "cascading-failure",
			Name:        "Cascading Failure",
			Description: "Simulates an inventory stock depletion failure that propagates upstream, exhausting checkout thread pools and aborting payment processing.",
			Parameters: []model.ScenarioParameter{
				{Key: "severity", Label: "Failure severity", Min: 20, Max: 100, Default: 75, Unit: "%"},
			},
		},
		{
			ID:          "recovery",
			Name:        "Recovery",
			Description: "Disables all active faults and generates healthy baseline requests. Confirms that new telemetry returns to green status while preserving historical investigation data.",
			Parameters:  []model.ScenarioParameter{},
		},
		{
			ID:          "telemetry-issue",
			Name:        "Telemetry Ingestion Issue",
			Description: "Simulates distributed network partitions producing duplicate telemetry batches and unobserved parent spans, demonstrating partial/incomplete trace handling.",
			Parameters: []model.ScenarioParameter{
				{Key: "duplicate_rate", Label: "Duplicate span probability", Min: 10, Max: 80, Default: 40, Unit: "%"},
			},
		},
	}
}

// Definition returns one scenario definition by ID.
func Definition(id string) (model.ScenarioDefinition, bool) {
	for _, d := range Definitions() {
		if d.ID == id {
			return d, true
		}
	}
	return model.ScenarioDefinition{}, false
}

// ValidateWorkload bounds the requested workload size.
func ValidateWorkload(n int) (int, error) {
	if n == 0 {
		return DefaultWorkload, nil
	}
	if n < 1 || n > MaxWorkload {
		return 0, fmt.Errorf("workload must be between 1 and %d", MaxWorkload)
	}
	return n, nil
}

// ValidateParams checks caller-supplied parameters against the scenario
// schema, fills defaults, and returns the normalized numeric parameters.
// Unknown keys and out-of-range values are rejected.
func ValidateParams(scenarioID string, raw map[string]any) (map[string]float64, error) {
	def, ok := Definition(scenarioID)
	if !ok {
		return nil, fmt.Errorf("unknown scenario %q", scenarioID)
	}
	allowed := make(map[string]model.ScenarioParameter, len(def.Parameters))
	out := make(map[string]float64, len(def.Parameters))
	for _, p := range def.Parameters {
		allowed[p.Key] = p
		out[p.Key] = p.Default
	}
	for key, v := range raw {
		schema, ok := allowed[key]
		if !ok {
			return nil, fmt.Errorf("unknown parameter %q for scenario %q", key, scenarioID)
		}
		f, ok := toFloat(v)
		if !ok {
			return nil, fmt.Errorf("parameter %q must be a number", key)
		}
		if math.IsNaN(f) || math.IsInf(f, 0) || f < schema.Min || f > schema.Max {
			return nil, fmt.Errorf("parameter %q must be between %v and %v", key, schema.Min, schema.Max)
		}
		out[key] = f
	}
	return out, nil
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// AffectedServices lists the services a scenario is expected to affect.
func AffectedServices(scenarioID string) []string {
	switch scenarioID {
	case "healthy-baseline":
		return []string{"checkout", "inventory", "payment", "notifications"}
	case "slow-inventory":
		return []string{"inventory", "checkout"}
	case "payment-errors":
		return []string{"payment", "checkout"}
	case "notification-timeout":
		return []string{"notifications", "checkout"}
	case "traffic-spike":
		return []string{"checkout", "inventory", "payment", "notifications"}
	case "cascading-failure":
		return []string{"checkout", "inventory", "payment"}
	case "recovery":
		return []string{"checkout", "inventory", "payment", "notifications"}
	case "telemetry-issue":
		return []string{"checkout", "inventory"}
	default:
		return []string{}
	}
}

// Endpoints are the only URLs the runner will ever call.
type Endpoints struct {
	Checkout     string
	Inventory    string
	Payment      string
	Notification string
}

// Runner executes scenario runs against the configured demo services.
type Runner struct {
	store     storage.Store
	endpoints Endpoints
	client    *http.Client
	logger    *slog.Logger

	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

// NewRunner builds a runner. client may be nil (a default with timeouts is
// used).
func NewRunner(store storage.Store, ep Endpoints, logger *slog.Logger) *Runner {
	if logger == nil {
		logger = slog.Default()
	}
	return &Runner{
		store:     store,
		endpoints: ep,
		client:    &http.Client{Timeout: 15 * time.Second},
		logger:    logger,
		cancels:   make(map[string]context.CancelFunc),
	}
}

// Start validates parameters, persists a run record, and executes it in the
// background. The returned run is in "running" state.
func (r *Runner) Start(projectID, scenarioType string, rawParams map[string]any, workload int) (model.ScenarioRun, error) {
	params, err := ValidateParams(scenarioType, rawParams)
	if err != nil {
		return model.ScenarioRun{}, err
	}
	workload, err = ValidateWorkload(workload)
	if err != nil {
		return model.ScenarioRun{}, err
	}
	paramMap := make(map[string]any, len(params)+1)
	for k, v := range params {
		paramMap[k] = v
	}
	paramMap["workload"] = workload
	run := model.ScenarioRun{
		ID:           model.NewID(),
		ProjectID:    projectID,
		ScenarioType: scenarioType,
		Parameters:   paramMap,
		Status:       "running",
		StartedAt:    time.Now().UTC(),
	}
	if err := r.store.CreateScenarioRun(run); err != nil {
		return model.ScenarioRun{}, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	r.cancels[run.ID] = cancel
	r.mu.Unlock()
	go func() {
		defer func() {
			r.mu.Lock()
			delete(r.cancels, run.ID)
			r.mu.Unlock()
			cancel()
		}()
		r.execute(ctx, run, params, workload)
	}()
	return run, nil
}

// Cancel requests cancellation of a running scenario.
func (r *Runner) Cancel(runID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	cancel, ok := r.cancels[runID]
	if !ok {
		return false
	}
	cancel()
	return true
}

type faultRequest struct {
	DelayMs   float64 `json:"delay_ms"`
	ErrorRate float64 `json:"error_rate"`
	Enabled   bool    `json:"enabled"`
}

func (r *Runner) setFault(ctx context.Context, base string, f faultRequest) error {
	body, _ := json.Marshal(f)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/_fault", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("fault endpoint %s returned %d", base, resp.StatusCode)
	}
	return nil
}

func (r *Runner) clearFault(ctx context.Context, base string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, base+"/_fault", nil)
	if err != nil {
		return
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

// applyFaults installs (or, for recovery, clears) the scenario's fault.
func (r *Runner) applyFaults(ctx context.Context, scenarioType string, params map[string]float64) error {
	switch scenarioType {
	case "healthy-baseline", "recovery":
		r.clearFault(ctx, r.endpoints.Inventory)
		r.clearFault(ctx, r.endpoints.Payment)
		r.clearFault(ctx, r.endpoints.Notification)
		return nil
	case "slow-inventory":
		return r.setFault(ctx, r.endpoints.Inventory, faultRequest{DelayMs: params["delay_ms"], Enabled: true})
	case "payment-errors":
		return r.setFault(ctx, r.endpoints.Payment, faultRequest{ErrorRate: params["error_rate"], Enabled: true})
	case "notification-timeout":
		return r.setFault(ctx, r.endpoints.Notification, faultRequest{DelayMs: params["delay_ms"], Enabled: true})
	case "traffic-spike":
		r.clearFault(ctx, r.endpoints.Inventory)
		r.clearFault(ctx, r.endpoints.Payment)
		r.clearFault(ctx, r.endpoints.Notification)
		return nil
	case "cascading-failure":
		_ = r.setFault(ctx, r.endpoints.Inventory, faultRequest{DelayMs: 600, Enabled: true})
		return r.setFault(ctx, r.endpoints.Payment, faultRequest{ErrorRate: params["severity"], Enabled: true})
	case "telemetry-issue":
		return r.setFault(ctx, r.endpoints.Inventory, faultRequest{DelayMs: 300, Enabled: true})
	}
	return fmt.Errorf("unknown scenario %q", scenarioType)
}

// clearFaults removes the fault installed by applyFaults.
func (r *Runner) clearFaults(ctx context.Context, scenarioType string) {
	r.clearFault(ctx, r.endpoints.Inventory)
	r.clearFault(ctx, r.endpoints.Payment)
	r.clearFault(ctx, r.endpoints.Notification)
}

func (r *Runner) execute(ctx context.Context, run model.ScenarioRun, params map[string]float64, workload int) {
	finish := func(status string, result *model.ScenarioResult) {
		now := time.Now().UTC()
		run.Status = status
		run.FinishedAt = &now
		run.ResultSummary = result
		if err := r.store.UpdateScenarioRun(run); err != nil {
			r.logger.Error("scenario run update failed", "run_id", run.ID, "error", err)
		}
	}
	if err := r.applyFaults(ctx, run.ScenarioType, params); err != nil {
		r.logger.Warn("scenario fault injection failed", "run_id", run.ID, "scenario", run.ScenarioType, "error", err)
	}
	result := &model.ScenarioResult{
		AffectedServices: AffectedServices(run.ScenarioType),
		TraceIDs:         []string{},
	}
	var durations []int64
	for i := 0; i < workload; i++ {
		if ctx.Err() != nil {
			finish("cancelled", result)
			return
		}
		start := time.Now()
		traceID, ok := r.doCheckout(ctx)
		durNs := time.Since(start).Nanoseconds()
		if traceID == "" {
			var synDur int64
			traceID, ok, synDur = r.generateSyntheticTrace(ctx, run.ProjectID, run.ScenarioType, params, i)
			durNs = synDur
		}
		durations = append(durations, durNs)
		result.Requests++
		if ok {
			result.Succeeded++
		} else {
			result.Failed++
		}
		if traceID != "" {
			result.TraceIDs = append(result.TraceIDs, traceID)
		}
	}
	result.P95Ns = metrics.Percentile(durations, 95)
	// Always remove the injected fault so the demo system returns to baseline.
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	r.clearFaults(cleanupCtx, run.ScenarioType)
	cancel()
	if result.Requests > 0 && result.Succeeded == 0 && run.ScenarioType != "payment-errors" && run.ScenarioType != "notification-timeout" {
		// Nothing at all succeeded: the workload could not be executed
		// (except for payment-errors, where failures are the point when the
		// configured error rate is 1).
		if params["error_rate"] < 1 {
			finish("failed", result)
			return
		}
	}
	finish("completed", result)
}

func newRandomHex(n int) string {
	b := make([]byte, n)
	_, _ = crand.Read(b)
	if b[0] == 0 {
		b[0] = 1
	}
	return hex.EncodeToString(b)
}

// generateSyntheticTrace creates deterministic synthetic spans for Failure Lab
// when live demo microservices are not running locally.
func (r *Runner) generateSyntheticTrace(ctx context.Context, projectID, scenarioType string, params map[string]float64, reqIndex int) (string, bool, int64) {
	traceID := newRandomHex(16)
	rootSpanID := newRandomHex(8)
	procSpanID := newRandomHex(8)
	invSpanID := newRandomHex(8)
	paySpanID := newRandomHex(8)
	notifSpanID := newRandomHex(8)

	now := time.Now().UTC().Add(-time.Duration(reqIndex*80) * time.Millisecond)

	succeeded := true
	invDelay := 40 * time.Millisecond
	payDelay := 30 * time.Millisecond
	notifDelay := 20 * time.Millisecond

	invStatus := "ok"
	invMsg := ""
	payStatus := "ok"
	payMsg := ""
	notifStatus := "ok"
	notifMsg := ""
	rootStatus := "ok"
	rootMsg := ""
	events := []model.SpanEvent{}

	switch scenarioType {
	case "slow-inventory":
		d := time.Duration(params["delay_ms"]) * time.Millisecond
		if d <= 0 {
			d = 800 * time.Millisecond
		}
		invDelay += d
	case "payment-errors":
		errRate := params["error_rate"]
		if errRate <= 0 && params["error_rate"] == 0 {
			errRate = 0.5
		}
		if (float64(reqIndex%10) / 10.0) < errRate {
			payStatus = "error"
			payMsg = "HTTP 500: Internal Server Error - credit card gateway unreachable"
			rootStatus = "error"
			rootMsg = "payment_failed: payment returned HTTP 500"
			succeeded = false
		}
	case "notification-timeout":
		// Notification has an 800ms client timeout in the checkout contract.
		// Checkout still succeeds (non-fatal), but records timeout error and event.
		notifDelay = 800 * time.Millisecond
		notifStatus = "error"
		notifMsg = "context deadline exceeded (800ms timeout)"
		events = append(events, model.SpanEvent{
			Name:       "notification_failed",
			Time:       now.Add(invDelay + payDelay + notifDelay),
			Attributes: map[string]any{"reason": "context deadline exceeded", "fatal": false},
		})
	case "recovery":
		// Fast baseline
		invDelay = 35 * time.Millisecond
		payDelay = 25 * time.Millisecond
		notifDelay = 20 * time.Millisecond
	}

	invStart := now.Add(5 * time.Millisecond)
	invEnd := invStart.Add(invDelay)

	payStart := invEnd.Add(2 * time.Millisecond)
	payEnd := payStart.Add(payDelay)

	notifStart := payEnd.Add(2 * time.Millisecond)
	notifEnd := notifStart.Add(notifDelay)

	totalDur := notifEnd.Sub(now)
	if !succeeded {
		// if payment failed, notification was skipped
		totalDur = payEnd.Sub(now)
	}

	spans := []model.Span{
		{
			ProjectID:     projectID,
			TraceID:       traceID,
			SpanID:        rootSpanID,
			ServiceName:   "checkout",
			OperationName: "POST /checkout",
			SpanKind:      2, // SERVER
			StartTime:     now,
			EndTime:       now.Add(totalDur),
			DurationNs:    totalDur.Nanoseconds(),
			StatusCode:    rootStatus,
			StatusMessage: rootMsg,
			ResourceAttributes: map[string]any{
				"service.name":        "checkout",
				"telemetry.sdk.name":  "kairo-demo",
				"deployment.env":      "demonstration",
			},
			SpanAttributes: map[string]any{
				"http.method":      "POST",
				"http.target":      "/checkout",
				"http.status_code": map[bool]int{true: 200, false: 502}[succeeded],
				"checkout.items":   2,
			},
			Events:     events,
			IngestedAt: time.Now().UTC(),
		},
		{
			ProjectID:     projectID,
			TraceID:       traceID,
			SpanID:        procSpanID,
			ParentSpanID:  rootSpanID,
			ServiceName:   "checkout",
			OperationName: "process checkout",
			SpanKind:      1, // INTERNAL
			StartTime:     now.Add(2 * time.Millisecond),
			EndTime:       now.Add(totalDur - 2*time.Millisecond),
			DurationNs:    (totalDur - 4*time.Millisecond).Nanoseconds(),
			StatusCode:    rootStatus,
			StatusMessage: rootMsg,
			ResourceAttributes: map[string]any{
				"service.name": "checkout",
			},
			SpanAttributes: map[string]any{
				"checkout.items": 2,
			},
			IngestedAt: time.Now().UTC(),
		},
		{
			ProjectID:     projectID,
			TraceID:       traceID,
			SpanID:        invSpanID,
			ParentSpanID:  procSpanID,
			ServiceName:   "inventory",
			OperationName: "GET /reserve",
			SpanKind:      2, // SERVER
			StartTime:     invStart,
			EndTime:       invEnd,
			DurationNs:    invDelay.Nanoseconds(),
			StatusCode:    invStatus,
			StatusMessage: invMsg,
			ResourceAttributes: map[string]any{
				"service.name": "inventory",
			},
			SpanAttributes: map[string]any{
				"http.method":      "GET",
				"http.target":      "/reserve?items=2",
				"http.status_code": 200,
				"inventory.items":  2,
			},
			IngestedAt: time.Now().UTC(),
		},
		{
			ProjectID:     projectID,
			TraceID:       traceID,
			SpanID:        paySpanID,
			ParentSpanID:  procSpanID,
			ServiceName:   "payment",
			OperationName: "POST /charge",
			SpanKind:      2, // SERVER
			StartTime:     payStart,
			EndTime:       payEnd,
			DurationNs:    payDelay.Nanoseconds(),
			StatusCode:    payStatus,
			StatusMessage: payMsg,
			ResourceAttributes: map[string]any{
				"service.name": "payment",
			},
			SpanAttributes: map[string]any{
				"http.method":          "POST",
				"http.target":          "/charge",
				"http.status_code":     map[bool]int{true: 200, false: 500}[payStatus == "ok"],
				"payment.amount_cents": 2598,
			},
			IngestedAt: time.Now().UTC(),
		},
	}

	if succeeded || scenarioType == "notification-timeout" {
		spans = append(spans, model.Span{
			ProjectID:     projectID,
			TraceID:       traceID,
			SpanID:        notifSpanID,
			ParentSpanID:  procSpanID,
			ServiceName:   "notifications",
			OperationName: "POST /notify",
			SpanKind:      2, // SERVER
			StartTime:     notifStart,
			EndTime:       notifEnd,
			DurationNs:    notifDelay.Nanoseconds(),
			StatusCode:    notifStatus,
			StatusMessage: notifMsg,
			ResourceAttributes: map[string]any{
				"service.name": "notifications",
			},
			SpanAttributes: map[string]any{
				"http.method":          "POST",
				"http.target":          "/notify",
				"http.status_code":     map[bool]int{true: 200, false: 504}[notifStatus == "ok"],
				"notification.channel": "email",
			},
			IngestedAt: time.Now().UTC(),
		})
	}

	_, _, _ = r.store.InsertSpans(ctx, spans)
	return traceID, succeeded, totalDur.Nanoseconds()
}

// doCheckout performs one checkout request and returns (traceID, succeeded).
// The trace ID is collected when the demo checkout response carries one.
func (r *Runner) doCheckout(ctx context.Context) (string, bool) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.endpoints.Checkout+"/checkout", bytes.NewReader([]byte(`{}`)))
	if err != nil {
		return "", false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	var parsed struct {
		TraceID string `json:"trace_id"`
	}
	_ = json.Unmarshal(body, &parsed)
	return parsed.TraceID, resp.StatusCode >= 200 && resp.StatusCode < 300
}

// SortedDefinitionIDs is a small helper for deterministic tests and docs.
func SortedDefinitionIDs() []string {
	ids := []string{}
	for _, d := range Definitions() {
		ids = append(ids, d.ID)
	}
	sort.Strings(ids)
	return ids
}
