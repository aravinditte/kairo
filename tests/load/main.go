// Command load is Kairo's reproducible benchmark harness.
//
// It measures a running Kairo API — it never invents numbers. Every
// figure in its report is computed from HTTP exchanges performed during
// the run:
//
//  1. Ingestion throughput: concurrent workers POST deterministic
//     OTLP/JSON span batches to /v1/traces for a fixed request count.
//  2. Duplicate-heavy ingestion: one batch is re-delivered repeatedly;
//     the harness then reads the trace back and reports the span count
//     the server actually stored, next to the count it should have
//     stored if deduplication works.
//  3. Trace lookup latency: repeated GET /api/v1/traces/{traceId}.
//  4. Filtered search latency: repeated GET /api/v1/traces?service=...
//  5. RED metrics latency: repeated GET /api/v1/metrics/red.
//
// Usage:
//
//	go run ./tests/load -addr http://localhost:8080 \
//	    -api-key <project api key> -project <project id> \
//	    -concurrency 8 -requests 200 -spans-per-batch 8
//
// The report is printed twice: a short human summary, then a single
// JSON document (also written to -out when given). Latency percentiles
// use the nearest-rank method over the recorded samples.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	coltracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	resourcev1 "go.opentelemetry.io/proto/otlp/resource/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

type latencyStats struct {
	Samples int     `json:"samples"`
	MinMs   float64 `json:"min_ms"`
	MeanMs  float64 `json:"mean_ms"`
	P50Ms   float64 `json:"p50_ms"`
	P95Ms   float64 `json:"p95_ms"`
	P99Ms   float64 `json:"p99_ms"`
	MaxMs   float64 `json:"max_ms"`
}

type phaseResult struct {
	Name            string       `json:"name"`
	Requests        int          `json:"requests"`
	Succeeded       int          `json:"succeeded"`
	Failed          int          `json:"failed"`
	ElapsedSeconds  float64      `json:"elapsed_seconds"`
	RequestsPerSec  float64      `json:"requests_per_sec"`
	SpansPerSec     float64      `json:"spans_per_sec,omitempty"`
	SpansAccepted   int          `json:"spans_accepted,omitempty"`
	Latency         latencyStats `json:"latency"`
	Notes           string       `json:"notes,omitempty"`
	ObservedSpans   *int         `json:"observed_stored_spans,omitempty"`
	ExpectedSpans   *int         `json:"expected_stored_spans,omitempty"`
	FirstStatusCode int          `json:"first_status_code,omitempty"`
}

type report struct {
	Tool        string            `json:"tool"`
	StartedAt   string            `json:"started_at"`
	Environment map[string]string `json:"environment"`
	Config      map[string]any    `json:"config"`
	Phases      []phaseResult     `json:"phases"`
}

// ---------------------------------------------------------------------------
// Latency collection
// ---------------------------------------------------------------------------

type latencyRecorder struct {
	mu     sync.Mutex
	values []float64 // milliseconds
}

func (l *latencyRecorder) add(d time.Duration) {
	l.mu.Lock()
	l.values = append(l.values, float64(d.Microseconds())/1000.0)
	l.mu.Unlock()
}

func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	rank := int(p / 100.0 * float64(len(sorted)))
	if rank >= len(sorted) {
		rank = len(sorted) - 1
	}
	if rank < 0 {
		rank = 0
	}
	return sorted[rank]
}

func (l *latencyRecorder) stats() latencyStats {
	l.mu.Lock()
	values := append([]float64(nil), l.values...)
	l.mu.Unlock()
	if len(values) == 0 {
		return latencyStats{}
	}
	sort.Float64s(values)
	var sum float64
	for _, v := range values {
		sum += v
	}
	return latencyStats{
		Samples: len(values),
		MinMs:   round3(values[0]),
		MeanMs:  round3(sum / float64(len(values))),
		P50Ms:   round3(percentile(values, 50)),
		P95Ms:   round3(percentile(values, 95)),
		P99Ms:   round3(percentile(values, 99)),
		MaxMs:   round3(values[len(values)-1]),
	}
}

func round3(f float64) float64 {
	return float64(int64(f*1000+0.5)) / 1000
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type client struct {
	base   string
	apiKey string
	http   *http.Client
}

func (c *client) do(ctx context.Context, method, path string, body []byte, contentType string) (int, []byte, time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, 0, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("X-Api-Key", c.apiKey)
	}
	start := time.Now()
	resp, err := c.http.Do(req)
	elapsed := time.Since(start)
	if err != nil {
		return 0, nil, elapsed, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return resp.StatusCode, respBody, elapsed, err
}

// ---------------------------------------------------------------------------
// Deterministic span batch generation
// ---------------------------------------------------------------------------

var serviceCycle = []string{"checkout", "inventory", "payment", "notifications"}

// batchFor builds one trace with spansPerBatch spans for batch index i.
// IDs and timestamps are derived from a hash of the index, so the same
// index always produces byte-identical spans — that is what makes the
// duplicate phase a true re-delivery rather than new data.
func batchFor(index int, spansPerBatch int) (string, []byte, error) {
	seed := sha256.Sum256([]byte(fmt.Sprintf("kairo-load-batch-%d", index)))
	traceID := seed[:16]
	base := time.Now().UTC().Add(-time.Duration(index%50) * time.Second)

	spans := make([]*tracev1.Span, 0, spansPerBatch)
	var parentID []byte
	for s := 0; s < spansPerBatch; s++ {
		spanSeed := sha256.Sum256([]byte(fmt.Sprintf("kairo-load-batch-%d-span-%d", index, s)))
		spanID := spanSeed[:8]
		kind := tracev1.Span_SPAN_KIND_INTERNAL
		switch {
		case s == 0:
			kind = tracev1.Span_SPAN_KIND_SERVER
		case s%3 == 1:
			kind = tracev1.Span_SPAN_KIND_CLIENT
		case s%3 == 2:
			kind = tracev1.Span_SPAN_KIND_SERVER
		}
		start := base.Add(time.Duration(s) * 2 * time.Millisecond)
		end := start.Add(time.Duration(1+s%4) * time.Millisecond)
		status := &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK}
		if s == spansPerBatch-1 && index%17 == 16 {
			// Roughly 1 in 17 traces carries an error so error-rate
			// metrics have something real to aggregate.
			status = &tracev1.Status{Code: tracev1.Status_STATUS_CODE_ERROR, Message: "synthetic load error"}
		}
		span := &tracev1.Span{
			TraceId:           append([]byte(nil), traceID...),
			SpanId:            append([]byte(nil), spanID...),
			Name:              fmt.Sprintf("load-op-%d", s),
			Kind:              kind,
			StartTimeUnixNano: uint64(start.UnixNano()),
			EndTimeUnixNano:   uint64(end.UnixNano()),
			Status:            status,
			Attributes: []*commonv1.KeyValue{
				{Key: "load.batch", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_IntValue{IntValue: int64(index)}}},
			},
		}
		if parentID != nil {
			span.ParentSpanId = append([]byte(nil), parentID...)
		}
		parentID = spanID
		spans = append(spans, span)
	}

	service := serviceCycle[index%len(serviceCycle)]
	req := &coltracev1.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{
			{
				Resource: &resourcev1.Resource{Attributes: []*commonv1.KeyValue{
					{Key: "service.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: service}}},
					{Key: "telemetry.sdk.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "kairo-load"}}},
				}},
				ScopeSpans: []*tracev1.ScopeSpans{
					{Scope: &commonv1.InstrumentationScope{Name: "kairo/load", Version: "1.0.0"}, Spans: spans},
				},
			},
		},
	}
	payload, err := protojson.Marshal(req)
	if err != nil {
		return "", nil, err
	}
	return hex.EncodeToString(traceID), payload, nil
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

func runIngestion(ctx context.Context, c *client, concurrency, requests, spansPerBatch int) (phaseResult, string) {
	lat := &latencyRecorder{}
	var mu sync.Mutex
	succeeded, failed, spansAccepted := 0, 0, 0
	firstTrace := ""
	var firstErr error

	jobs := make(chan int)
	var wg sync.WaitGroup
	start := time.Now()
	for w := 0; w < concurrency; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				traceID, payload, err := batchFor(i, spansPerBatch)
				if err != nil {
					mu.Lock()
					failed++
					if firstErr == nil {
						firstErr = err
					}
					mu.Unlock()
					continue
				}
				status, _, elapsed, err := c.do(ctx, http.MethodPost, "/v1/traces", payload, "application/json")
				lat.add(elapsed)
				mu.Lock()
				if err == nil && status >= 200 && status < 300 {
					succeeded++
					spansAccepted += spansPerBatch
					if firstTrace == "" {
						firstTrace = traceID
					}
				} else {
					failed++
					if firstErr == nil {
						if err != nil {
							firstErr = err
						} else {
							firstErr = fmt.Errorf("ingestion returned HTTP %d", status)
						}
					}
				}
				mu.Unlock()
			}
		}()
	}
	for i := 0; i < requests; i++ {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	elapsed := time.Since(start)

	res := phaseResult{
		Name:           "ingestion",
		Requests:       requests,
		Succeeded:      succeeded,
		Failed:         failed,
		ElapsedSeconds: round3(elapsed.Seconds()),
		RequestsPerSec: round3(float64(requests) / elapsed.Seconds()),
		SpansPerSec:    round3(float64(spansAccepted) / elapsed.Seconds()),
		SpansAccepted:  spansAccepted,
		Latency:        lat.stats(),
	}
	if firstErr != nil {
		res.Notes = "first error: " + firstErr.Error()
	}
	return res, firstTrace
}

func runDuplicates(ctx context.Context, c *client, projectID string, repeats, spansPerBatch int) phaseResult {
	lat := &latencyRecorder{}
	traceID, payload, err := batchFor(987654, spansPerBatch)
	if err != nil {
		return phaseResult{Name: "duplicate_ingestion", Notes: "batch build failed: " + err.Error()}
	}

	succeeded, failed := 0, 0
	start := time.Now()
	for i := 0; i < repeats; i++ {
		status, _, elapsed, err := c.do(ctx, http.MethodPost, "/v1/traces", payload, "application/json")
		lat.add(elapsed)
		if err == nil && status >= 200 && status < 300 {
			succeeded++
		} else {
			failed++
		}
	}
	elapsed := time.Since(start)

	res := phaseResult{
		Name:           "duplicate_ingestion",
		Requests:       repeats,
		Succeeded:      succeeded,
		Failed:         failed,
		ElapsedSeconds: round3(elapsed.Seconds()),
		RequestsPerSec: round3(float64(repeats) / elapsed.Seconds()),
		Latency:        lat.stats(),
		Notes:          "the identical batch (same trace/span IDs) was re-delivered every request",
	}

	// Verify what the server actually stored: if deduplication works,
	// the trace holds exactly spansPerBatch spans no matter how many
	// times the batch was delivered.
	if projectID != "" {
		path := "/api/v1/traces/" + traceID + "?project_id=" + url.QueryEscape(projectID)
		status, body, _, err := c.do(ctx, http.MethodGet, path, nil, "")
		if err == nil && status == http.StatusOK {
			var detail struct {
				SpanCount int               `json:"span_count"`
				Spans     []json.RawMessage `json:"spans"`
			}
			if json.Unmarshal(body, &detail) == nil {
				observed := detail.SpanCount
				if observed == 0 && len(detail.Spans) > 0 {
					observed = len(detail.Spans)
				}
				expected := spansPerBatch
				res.ObservedSpans = &observed
				res.ExpectedSpans = &expected
				if observed != expected {
					res.Notes += fmt.Sprintf("; WARNING: stored span count %d != expected %d (possible duplicate storage)", observed, expected)
				}
			}
		}
	}
	return res
}

func runQueryPhase(ctx context.Context, c *client, name, path string, repeats int) phaseResult {
	lat := &latencyRecorder{}
	succeeded, failed := 0, 0
	firstStatus := 0
	start := time.Now()
	for i := 0; i < repeats; i++ {
		status, _, elapsed, err := c.do(ctx, http.MethodGet, path, nil, "")
		lat.add(elapsed)
		if i == 0 {
			firstStatus = status
		}
		if err == nil && status >= 200 && status < 300 {
			succeeded++
		} else {
			failed++
		}
	}
	elapsed := time.Since(start)
	return phaseResult{
		Name:            name,
		Requests:        repeats,
		Succeeded:       succeeded,
		Failed:          failed,
		ElapsedSeconds:  round3(elapsed.Seconds()),
		RequestsPerSec:  round3(float64(repeats) / elapsed.Seconds()),
		Latency:         lat.stats(),
		FirstStatusCode: firstStatus,
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	addr := flag.String("addr", "http://localhost:8080", "base URL of the Kairo API")
	apiKey := flag.String("api-key", "", "project API key (required; also sent as the query credential)")
	project := flag.String("project", "", "project ID for query phases (required)")
	adminToken := flag.String("admin-token", "", "admin token; when set it is used for query phases instead of the API key")
	concurrency := flag.Int("concurrency", 8, "concurrent ingestion workers")
	requests := flag.Int("requests", 200, "ingestion batches to send in the throughput phase")
	spansPerBatch := flag.Int("spans-per-batch", 8, "spans per ingestion batch")
	dupRepeats := flag.Int("duplicate-repeats", 25, "times the duplicate batch is re-delivered")
	queryRepeats := flag.Int("query-repeats", 30, "repetitions for each query latency phase")
	outPath := flag.String("out", "", "optional path to also write the JSON report to")
	flag.Parse()

	if *apiKey == "" {
		fmt.Fprintln(os.Stderr, "error: -api-key is required (ingestion is authenticated per project)")
		os.Exit(2)
	}
	if *project == "" {
		fmt.Fprintln(os.Stderr, "error: -project is required (query endpoints are project-scoped)")
		os.Exit(2)
	}
	if *concurrency < 1 || *requests < 1 || *spansPerBatch < 1 {
		fmt.Fprintln(os.Stderr, "error: -concurrency, -requests and -spans-per-batch must be >= 1")
		os.Exit(2)
	}

	base := strings.TrimRight(*addr, "/")
	ingestClient := &client{base: base, apiKey: *apiKey, http: &http.Client{Timeout: 30 * time.Second}}
	queryClient := ingestClient
	if *adminToken != "" {
		// Query endpoints also accept the management token; use a
		// header-injecting transport so the API key is not sent at all.
		queryClient = &client{base: base, http: &http.Client{
			Timeout:   30 * time.Second,
			Transport: adminTransport{token: *adminToken, base: http.DefaultTransport},
		}}
	}

	ctx := context.Background()
	rep := report{
		Tool:      "kairo-load",
		StartedAt: time.Now().UTC().Format(time.RFC3339),
		Environment: map[string]string{
			"os":         runtime.GOOS,
			"arch":       runtime.GOARCH,
			"go_version": runtime.Version(),
			"target":     base,
			"note":       "storage mode (memory vs PostgreSQL) is a property of the target server and is not visible to this tool; record it alongside this report",
		},
		Config: map[string]any{
			"concurrency":       *concurrency,
			"requests":          *requests,
			"spans_per_batch":   *spansPerBatch,
			"duplicate_repeats": *dupRepeats,
			"query_repeats":     *queryRepeats,
		},
	}

	// Health gate: do not report meaningless numbers against a dead target.
	if status, _, _, err := ingestClient.do(ctx, http.MethodGet, "/healthz", nil, ""); err != nil || status != http.StatusOK {
		fmt.Fprintf(os.Stderr, "error: target %s is not healthy (status %d, err %v)\n", base, status, err)
		os.Exit(1)
	}

	fmt.Println("== Kairo load harness ==")
	fmt.Printf("target: %s  concurrency: %d  batches: %d  spans/batch: %d\n\n", base, *concurrency, *requests, *spansPerBatch)

	ing, sampleTrace := runIngestion(ctx, ingestClient, *concurrency, *requests, *spansPerBatch)
	rep.Phases = append(rep.Phases, ing)
	printPhase(ing)

	dup := runDuplicates(ctx, ingestClient, *project, *dupRepeats, *spansPerBatch)
	rep.Phases = append(rep.Phases, dup)
	printPhase(dup)

	if sampleTrace == "" {
		fmt.Println("no ingestion succeeded; skipping query phases (their latencies would measure only failures)")
	} else {
		now := time.Now().UTC()
		start := now.Add(-2 * time.Hour).Format(time.RFC3339)
		end := now.Add(time.Hour).Format(time.RFC3339)
		q := url.QueryEscape

		lookup := runQueryPhase(ctx, queryClient, "trace_lookup",
			"/api/v1/traces/"+sampleTrace+"?project_id="+q(*project), *queryRepeats)
		rep.Phases = append(rep.Phases, lookup)
		printPhase(lookup)

		search := runQueryPhase(ctx, queryClient, "filtered_search",
			"/api/v1/traces?project_id="+q(*project)+"&service=checkout&start="+q(start)+"&end="+q(end)+"&limit=50", *queryRepeats)
		rep.Phases = append(rep.Phases, search)
		printPhase(search)

		metrics := runQueryPhase(ctx, queryClient, "red_metrics",
			"/api/v1/metrics/red?project_id="+q(*project)+"&start="+q(start)+"&end="+q(end)+"&interval_seconds=60", *queryRepeats)
		rep.Phases = append(rep.Phases, metrics)
		printPhase(metrics)
	}

	encoded, err := json.MarshalIndent(rep, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "error: encode report:", err)
		os.Exit(1)
	}
	fmt.Println("\n== JSON report ==")
	fmt.Println(string(encoded))
	if *outPath != "" {
		if err := os.WriteFile(*outPath, append(encoded, '\n'), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "error: write report:", err)
			os.Exit(1)
		}
		fmt.Println("report also written to", *outPath)
	}
}

// adminTransport injects the management token header on every request.
type adminTransport struct {
	token string
	base  http.RoundTripper
}

func (t adminTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("X-Admin-Token", t.token)
	return t.base.RoundTrip(req)
}

func printPhase(p phaseResult) {
	fmt.Printf("[%s] requests=%d ok=%d failed=%d elapsed=%ss rps=%.2f",
		p.Name, p.Requests, p.Succeeded, p.Failed, trimFloat(p.ElapsedSeconds), p.RequestsPerSec)
	if p.SpansPerSec > 0 {
		fmt.Printf(" spans/s=%.2f", p.SpansPerSec)
	}
	fmt.Printf("\n    latency ms: p50=%.3f p95=%.3f p99=%.3f mean=%.3f max=%.3f (n=%d)\n",
		p.Latency.P50Ms, p.Latency.P95Ms, p.Latency.P99Ms, p.Latency.MeanMs, p.Latency.MaxMs, p.Latency.Samples)
	if p.ObservedSpans != nil && p.ExpectedSpans != nil {
		fmt.Printf("    stored spans after duplicate delivery: observed=%d expected=%d\n", *p.ObservedSpans, *p.ExpectedSpans)
	}
	if p.Notes != "" {
		fmt.Printf("    note: %s\n", p.Notes)
	}
}

func trimFloat(f float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.3f", f), "0"), ".")
}
