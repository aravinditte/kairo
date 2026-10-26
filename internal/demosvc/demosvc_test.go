package demosvc

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	coltracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

func TestTraceparentRoundTrip(t *testing.T) {
	const header = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	tc, ok := ParseTraceparent(header)
	if !ok {
		t.Fatalf("ParseTraceparent(%q) not ok", header)
	}
	if tc.String() != header {
		t.Fatalf("round trip = %q, want %q", tc.String(), header)
	}
	if !tc.Sampled() {
		t.Fatal("flags 01 should be sampled")
	}
}

func TestParseTraceparentRejectsInvalid(t *testing.T) {
	bad := []string{
		"",
		"00-xyz-00f067aa0ba902b7-01",
		"00-00000000000000000000000000000000-00f067aa0ba902b7-01", // zero trace id
		"00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01", // zero span id
		"ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01", // forbidden version
		"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7",    // missing flags
		"garbage",
	}
	for _, h := range bad {
		if _, ok := ParseTraceparent(h); ok {
			t.Errorf("ParseTraceparent(%q) ok, want not ok", h)
		}
	}
}

func TestFaultDeterministicSequence(t *testing.T) {
	run := func() []bool {
		f := NewFaultStore()
		if err := f.Set(FaultConfig{DelayMs: 0, ErrorRate: 0.5, Enabled: true}); err != nil {
			t.Fatal(err)
		}
		out := make([]bool, 0, 200)
		for i := 0; i < 200; i++ {
			out = append(out, f.ShouldError())
		}
		return out
	}
	a, b := run(), run()
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("decision %d differs between identical runs: %v vs %v", i, a[i], b[i])
		}
	}
	errs := 0
	for _, v := range a {
		if v {
			errs++
		}
	}
	// A 0.5 rate over 200 deterministic draws should land near half;
	// allow a generous band so the test checks distribution, not luck.
	if errs < 60 || errs > 140 {
		t.Fatalf("error count %d out of expected band for rate 0.5", errs)
	}
}

func TestFaultResetReplaysSequence(t *testing.T) {
	f := NewFaultStore()
	_ = f.Set(FaultConfig{ErrorRate: 0.35, Enabled: true})
	first := make([]bool, 50)
	for i := range first {
		first[i] = f.ShouldError()
	}
	f.Reset()
	_ = f.Set(FaultConfig{ErrorRate: 0.35, Enabled: true})
	for i := range first {
		if got := f.ShouldError(); got != first[i] {
			t.Fatalf("after reset, decision %d = %v, want %v", i, got, first[i])
		}
	}
}

func TestFaultValidationAndDisabled(t *testing.T) {
	f := NewFaultStore()
	if err := f.Set(FaultConfig{DelayMs: MaxFaultDelayMs + 1, Enabled: true}); err == nil {
		t.Fatal("expected delay bound error")
	}
	if err := f.Set(FaultConfig{ErrorRate: 1.5, Enabled: true}); err == nil {
		t.Fatal("expected error_rate bound error")
	}
	// Disabled store never errors, even at rate 1.
	_ = f.Set(FaultConfig{ErrorRate: 1, Enabled: false})
	for i := 0; i < 10; i++ {
		if f.ShouldError() {
			t.Fatal("disabled fault returned error decision")
		}
	}
	if f.Delay() != 0 {
		t.Fatal("disabled fault returned a delay")
	}
}

func TestFaultHandlers(t *testing.T) {
	f := NewFaultStore()
	mux := http.NewServeMux()
	f.RegisterFaultRoutes(mux)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/_fault", strings.NewReader(`{"delay_ms":250,"error_rate":0.25,"enabled":true}`))
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /_fault status = %d, body %s", rec.Code, rec.Body.String())
	}
	if cfg := f.Config(); cfg.DelayMs != 250 || cfg.ErrorRate != 0.25 || !cfg.Enabled {
		t.Fatalf("config after POST = %+v", cfg)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/_fault", strings.NewReader(`{"delay_ms":99999,"error_rate":0,"enabled":true}`))
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("out-of-bounds POST status = %d, want 400", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodDelete, "/_fault", nil)
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || f.Config().Enabled {
		t.Fatalf("DELETE /_fault did not clear: status %d cfg %+v", rec.Code, f.Config())
	}
}

// captureServer is a fake Kairo ingestion endpoint that records the
// last OTLP request it received.
type captureServer struct {
	lastBody   []byte
	lastAuth   string
	lastCT     string
	requests   int
	statusCode int
}

func (c *captureServer) handler(t *testing.T) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		c.lastBody = body
		c.lastAuth = r.Header.Get("Authorization")
		c.lastCT = r.Header.Get("Content-Type")
		c.requests++
		code := c.statusCode
		if code == 0 {
			code = http.StatusOK
		}
		w.WriteHeader(code)
	}
}

func TestTracerFlushEmitsValidOTLP(t *testing.T) {
	cap := &captureServer{}
	srv := httptest.NewServer(cap.handler(t))
	defer srv.Close()

	tracer := NewTracer("checkout", srv.URL, "test-key")
	req := httptest.NewRequest(http.MethodPost, "/checkout", nil)
	req.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	rec, serverSpan := tracer.StartRequest(req, "POST /checkout")
	if rec.TraceID() != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Fatalf("recorder did not join inbound trace, got %s", rec.TraceID())
	}
	child := rec.StartSpan("process checkout", KindInternal, serverSpan)
	child.SetAttribute("items", 3)
	child.End()
	rec.Finish(context.Background())

	if cap.requests != 1 {
		t.Fatalf("ingestion requests = %d, want 1", cap.requests)
	}
	if cap.lastAuth != "Bearer test-key" {
		t.Fatalf("Authorization = %q", cap.lastAuth)
	}
	if cap.lastCT != "application/x-protobuf" {
		t.Fatalf("Content-Type = %q", cap.lastCT)
	}
	var decoded coltracev1.ExportTraceServiceRequest
	if err := proto.Unmarshal(cap.lastBody, &decoded); err != nil {
		t.Fatalf("flushed payload is not valid OTLP protobuf: %v", err)
	}
	rs := decoded.ResourceSpans[0]
	var serviceName string
	for _, kv := range rs.Resource.Attributes {
		if kv.Key == "service.name" {
			serviceName = kv.Value.GetStringValue()
		}
	}
	if serviceName != "checkout" {
		t.Fatalf("service.name = %q", serviceName)
	}
	spans := rs.ScopeSpans[0].Spans
	if len(spans) != 2 {
		t.Fatalf("span count = %d, want 2", len(spans))
	}
	server := spans[0]
	if got := len(server.ParentSpanId); got != 8 {
		t.Fatalf("server span parent length = %d, want 8 (the caller's span)", got)
	}
	if spans[1].ParentSpanId == nil || len(spans[1].ParentSpanId) != 8 {
		t.Fatal("internal span missing parent")
	}
	// Flush is idempotent.
	if err := rec.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if cap.requests != 1 {
		t.Fatalf("second flush sent another request: %d", cap.requests)
	}
}

// Regression test: a handler that finishes with an already-cancelled
// request context (what happens when a caller's timeout fires, e.g. the
// notification hop) must still deliver its spans.
func TestFinishFlushesDespiteCancelledContext(t *testing.T) {
	cap := &captureServer{}
	srv := httptest.NewServer(cap.handler(t))
	defer srv.Close()

	tracer := NewTracer("notifications", srv.URL, "k")
	req := httptest.NewRequest(http.MethodPost, "/notify", nil)
	rec, _ := tracer.StartRequest(req, "POST /notify")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rec.Finish(ctx)
	if cap.requests != 1 {
		t.Fatalf("flush with cancelled context delivered %d requests, want 1", cap.requests)
	}
}

func TestDoHTTPPropagatesTraceparent(t *testing.T) {
	var downstreamParent string
	downstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downstreamParent = r.Header.Get("traceparent")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer downstream.Close()

	ingest := &captureServer{}
	ingestSrv := httptest.NewServer(ingest.handler(t))
	defer ingestSrv.Close()

	tracer := NewTracer("checkout", ingestSrv.URL, "k")
	req := httptest.NewRequest(http.MethodPost, "/checkout", nil)
	rec, serverSpan := tracer.StartRequest(req, "POST /checkout")
	status, body, err := rec.DoHTTP(context.Background(), serverSpan, http.MethodGet, downstream.URL+"/reserve", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusOK || !strings.Contains(string(body), "ok") {
		t.Fatalf("status %d body %s", status, body)
	}
	tc, ok := ParseTraceparent(downstreamParent)
	if !ok {
		t.Fatalf("downstream received invalid traceparent %q", downstreamParent)
	}
	if tc.TraceID != rec.TraceID() {
		t.Fatalf("downstream trace id %s != recorder trace id %s", tc.TraceID, rec.TraceID())
	}
	if tc.SpanID == serverSpan.SpanID() {
		t.Fatal("downstream parent should be the client span, not the server span")
	}
	rec.Finish(context.Background())
}

func TestDoHTTPErrorStatusAndTransportError(t *testing.T) {
	ingest := &captureServer{}
	ingestSrv := httptest.NewServer(ingest.handler(t))
	defer ingestSrv.Close()
	tracer := NewTracer("checkout", ingestSrv.URL, "k")

	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer failing.Close()

	req := httptest.NewRequest(http.MethodPost, "/checkout", nil)
	rec, serverSpan := tracer.StartRequest(req, "POST /checkout")
	status, _, err := rec.DoHTTP(context.Background(), serverSpan, http.MethodPost, failing.URL+"/charge", []byte(`{}`), 0)
	if err != nil {
		t.Fatalf("5xx response should not be a transport error: %v", err)
	}
	if status != http.StatusBadGateway {
		t.Fatalf("status = %d", status)
	}

	// Transport error path: connect to a closed server.
	closed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closedURL := closed.URL
	closed.Close()
	_, _, err = rec.DoHTTP(context.Background(), serverSpan, http.MethodGet, closedURL, nil, 0)
	if err == nil {
		t.Fatal("expected transport error for closed server")
	}
	rec.Finish(context.Background())

	var decoded coltracev1.ExportTraceServiceRequest
	if err := proto.Unmarshal(ingest.lastBody, &decoded); err != nil {
		t.Fatal(err)
	}
	spans := decoded.ResourceSpans[0].ScopeSpans[0].Spans
	errored := 0
	for _, s := range spans {
		if s.Status.Code.String() == "STATUS_CODE_ERROR" {
			errored++
		}
	}
	if errored < 2 {
		t.Fatalf("expected both client spans errored, got %d of %d", errored, len(spans))
	}
}

func TestHealthHandlerAndJSONErrorEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()
	HealthHandler(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("health status %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["status"] != "ok" {
		t.Fatalf("health body %s err %v", rec.Body.String(), err)
	}

	rec = httptest.NewRecorder()
	WriteError(rec, http.StatusBadRequest, "bad_request", "nope")
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Code != "bad_request" {
		t.Fatalf("envelope %+v", env)
	}
}
