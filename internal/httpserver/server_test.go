package httpserver_test

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	resourcev1 "go.opentelemetry.io/proto/otlp/resource/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/aravinditte/kairo/internal/config"
	"github.com/aravinditte/kairo/internal/httpserver"
	"github.com/aravinditte/kairo/internal/logging"
	"github.com/aravinditte/kairo/internal/storage"
)

const adminToken = "test-admin-token"

type fixture struct {
	srv       *httptest.Server
	projectID string
	rawKey    string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	cfg := &config.Config{
		Env: "development", HTTPAddr: ":0", AdminToken: adminToken, LogLevel: "error",
		MaxOTLPBodyBytes: 4194304, MaxSpansPerBatch: 1000, MaxAttrCount: 64,
		MaxAttrValueBytes: 2048, QueryTimeout: 10 * time.Second, DefaultRetentionDays: 7,
		CheckoutURL: "http://127.0.0.1:1", InventoryURL: "http://127.0.0.1:1",
		PaymentURL: "http://127.0.0.1:1", NotificationURL: "http://127.0.0.1:1",
	}
	store := storage.NewMemoryStore()
	srv := httptest.NewServer(httpserver.New(cfg, store, logging.New("error")))
	t.Cleanup(srv.Close)
	f := &fixture{srv: srv}
	f.projectID = f.createProject(t, "Project A")
	f.rawKey = f.createKey(t, f.projectID)
	return f
}

func (f *fixture) do(t *testing.T, method, path string, body []byte, headers map[string]string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, f.srv.URL+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

func admin() map[string]string { return map[string]string{"X-Admin-Token": adminToken} }

func (f *fixture) createProject(t *testing.T, name string) string {
	t.Helper()
	code, body := f.do(t, "POST", "/api/v1/projects", []byte(fmt.Sprintf(`{"name":%q}`, name)), admin())
	if code != http.StatusCreated {
		t.Fatalf("create project: %d %s", code, body)
	}
	var p struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &p); err != nil || p.ID == "" {
		t.Fatalf("project body = %s err = %v", body, err)
	}
	return p.ID
}

func (f *fixture) createKey(t *testing.T, projectID string) string {
	t.Helper()
	code, body := f.do(t, "POST", "/api/v1/projects/"+projectID+"/api-keys", nil, admin())
	if code != http.StatusCreated {
		t.Fatalf("create key: %d %s", code, body)
	}
	var resp struct {
		RawKey string `json:"raw_key"`
	}
	if err := json.Unmarshal(body, &resp); err != nil || resp.RawKey == "" {
		t.Fatalf("key body = %s err = %v", body, err)
	}
	return resp.RawKey
}

func tidBytes(s string) []byte { b, _ := hex.DecodeString(s); return b }

// traceRequest builds a two-service trace: checkout server span -> payment
// server span (child via a client span).
func traceRequest(traceID string, start time.Time, paymentStatus tracev1.Status_StatusCode) *collectortrace.ExportTraceServiceRequest {
	ns := uint64(start.UnixNano())
	mkSpan := func(id, parent, name string, kind tracev1.Span_SpanKind, offset, dur uint64, code tracev1.Status_StatusCode, msg string) *tracev1.Span {
		return &tracev1.Span{
			TraceId: tidBytes(traceID), SpanId: tidBytes(id), ParentSpanId: tidBytes(parent),
			Name: name, Kind: kind, StartTimeUnixNano: ns + offset, EndTimeUnixNano: ns + offset + dur,
			Status: &tracev1.Status{Code: code, Message: msg},
		}
	}
	return &collectortrace.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{
			{
				Resource: &resourcev1.Resource{Attributes: []*commonv1.KeyValue{{Key: "service.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "checkout"}}}}},
				ScopeSpans: []*tracev1.ScopeSpans{{Spans: []*tracev1.Span{
					mkSpan("1111111111111111", "", "POST /checkout", tracev1.Span_SPAN_KIND_SERVER, 0, 100_000_000, tracev1.Status_STATUS_CODE_OK, ""),
					mkSpan("2222222222222222", "1111111111111111", "POST payment/charge", tracev1.Span_SPAN_KIND_CLIENT, 10_000_000, 80_000_000, tracev1.Status_STATUS_CODE_OK, ""),
				}}},
			},
			{
				Resource: &resourcev1.Resource{Attributes: []*commonv1.KeyValue{{Key: "service.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "payment"}}}}},
				ScopeSpans: []*tracev1.ScopeSpans{{Spans: []*tracev1.Span{
					mkSpan("3333333333333333", "2222222222222222", "POST /charge", tracev1.Span_SPAN_KIND_SERVER, 12_000_000, 70_000_000, paymentStatus, "card declined"),
				}}},
			},
		},
	}
}

func (f *fixture) ingest(t *testing.T, key string, req *collectortrace.ExportTraceServiceRequest, jsonMode bool) (int, []byte) {
	t.Helper()
	var body []byte
	var ct string
	var err error
	if jsonMode {
		body, err = protojson.Marshal(req)
		ct = "application/json"
	} else {
		body, err = proto.Marshal(req)
		ct = "application/x-protobuf"
	}
	if err != nil {
		t.Fatal(err)
	}
	return f.do(t, "POST", "/v1/traces", body, map[string]string{"Authorization": "Bearer " + key, "Content-Type": ct})
}

func TestHealthAndReady(t *testing.T) {
	f := newFixture(t)
	code, body := f.do(t, "GET", "/healthz", nil, nil)
	if code != 200 || !bytes.Contains(body, []byte(`"ok"`)) {
		t.Fatalf("healthz = %d %s", code, body)
	}
	code, body = f.do(t, "GET", "/readyz", nil, nil)
	if code != 200 || !bytes.Contains(body, []byte(`"memory"`)) {
		t.Fatalf("readyz = %d %s", code, body)
	}
}

func TestManagementRequiresAdmin(t *testing.T) {
	f := newFixture(t)
	if code, _ := f.do(t, "GET", "/api/v1/projects", nil, nil); code != http.StatusUnauthorized {
		t.Fatalf("no token: %d, want 401", code)
	}
	if code, _ := f.do(t, "GET", "/api/v1/projects", nil, map[string]string{"X-Admin-Token": "wrong"}); code != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d, want 401", code)
	}
	// Raw keys are shown once and never in list responses.
	code, body := f.do(t, "GET", "/api/v1/projects/"+f.projectID+"/api-keys", nil, admin())
	if code != 200 || bytes.Contains(body, []byte(f.rawKey)) || bytes.Contains(body, []byte("raw_key")) {
		t.Fatalf("key list leaks raw key: %d %s", code, body)
	}
}

func TestIngestProtobufAndJSONAndDuplicates(t *testing.T) {
	f := newFixture(t)
	start := time.Now().Add(-time.Minute).UTC()
	req := traceRequest("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", start, tracev1.Status_STATUS_CODE_ERROR)

	code, body := f.ingest(t, f.rawKey, req, false)
	if code != 200 {
		t.Fatalf("protobuf ingest = %d %s", code, body)
	}
	// Duplicate delivery of the same batch must not create new spans.
	code, _ = f.ingest(t, f.rawKey, req, false)
	if code != 200 {
		t.Fatalf("duplicate ingest = %d", code)
	}
	// JSON encoding of a second trace.
	req2 := traceRequest("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", start.Add(time.Second), tracev1.Status_STATUS_CODE_OK)
	code, body = f.ingest(t, f.rawKey, req2, true)
	if code != 200 {
		t.Fatalf("json ingest = %d %s", code, body)
	}

	// Trace search: 2 traces; first has 3 spans despite duplicate delivery.
	path := fmt.Sprintf("/api/v1/traces?project_id=%s&start=%s&end=%s", f.projectID,
		start.Add(-time.Hour).Format(time.RFC3339Nano), start.Add(time.Hour).Format(time.RFC3339Nano))
	code, body = f.do(t, "GET", path, nil, admin())
	if code != 200 {
		t.Fatalf("search = %d %s", code, body)
	}
	var page struct {
		Traces []struct {
			TraceID     string `json:"trace_id"`
			SpanCount   int    `json:"span_count"`
			HasError    bool   `json:"has_error"`
			RootService string `json:"root_service"`
		} `json:"traces"`
	}
	if err := json.Unmarshal(body, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Traces) != 2 {
		t.Fatalf("traces = %d: %s", len(page.Traces), body)
	}
	for _, tr := range page.Traces {
		if tr.TraceID == "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
			if tr.SpanCount != 3 {
				t.Fatalf("duplicate delivery inflated span count: %d", tr.SpanCount)
			}
			if !tr.HasError {
				t.Fatal("first trace must have_error")
			}
		}
	}

	// Trace detail preserves parent-child relationships.
	code, body = f.do(t, "GET", "/api/v1/traces/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?project_id="+f.projectID, nil, admin())
	if code != 200 {
		t.Fatalf("detail = %d %s", code, body)
	}
	var detail struct {
		Services []string `json:"services"`
		Spans    []struct {
			SpanID       string `json:"span_id"`
			ParentSpanID string `json:"parent_span_id"`
		} `json:"spans"`
	}
	if err := json.Unmarshal(body, &detail); err != nil {
		t.Fatal(err)
	}
	if len(detail.Spans) != 3 || len(detail.Services) != 2 {
		t.Fatalf("detail = %s", body)
	}

	// Dependencies: checkout -> payment inferred from observed spans.
	code, body = f.do(t, "GET", "/api/v1/dependencies?project_id="+f.projectID, nil, admin())
	if code != 200 || !bytes.Contains(body, []byte(`"payment"`)) || !bytes.Contains(body, []byte(`"checkout"`)) {
		t.Fatalf("dependencies = %d %s", code, body)
	}

	// Metrics: 2 checkout + 2 payment server requests; one payment error.
	code, body = f.do(t, "GET", "/api/v1/metrics/red?project_id="+f.projectID, nil, admin())
	if code != 200 {
		t.Fatalf("metrics = %d %s", code, body)
	}
	var m struct {
		RequestCount int64 `json:"request_count"`
		ErrorCount   int64 `json:"error_count"`
	}
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatal(err)
	}
	if m.RequestCount != 4 || m.ErrorCount != 1 {
		t.Fatalf("metrics = %s, want 4 requests / 1 error in last hour window", body)
	}
}

func TestIngestAuthAndPayloadErrors(t *testing.T) {
	f := newFixture(t)
	req := traceRequest("cccccccccccccccccccccccccccccccc", time.Now().Add(-time.Minute).UTC(), tracev1.Status_STATUS_CODE_OK)
	body, _ := proto.Marshal(req)
	if code, _ := f.do(t, "POST", "/v1/traces", body, map[string]string{"Content-Type": "application/x-protobuf"}); code != 401 {
		t.Fatalf("no key: %d, want 401", code)
	}
	if code, _ := f.do(t, "POST", "/v1/traces", body, map[string]string{"Content-Type": "application/x-protobuf", "X-Api-Key": "kairo_nope"}); code != 401 {
		t.Fatalf("bad key: %d, want 401", code)
	}
	if code, _ := f.do(t, "POST", "/v1/traces", []byte("garbage"), map[string]string{"Content-Type": "application/x-protobuf", "Authorization": "Bearer " + f.rawKey}); code != 400 {
		t.Fatalf("malformed: %d, want 400", code)
	}
	if code, _ := f.do(t, "POST", "/v1/traces", body, map[string]string{"Content-Type": "text/plain", "Authorization": "Bearer " + f.rawKey}); code != 400 {
		t.Fatalf("bad content type: %d, want 400", code)
	}
	// Revoked key is rejected.
	var keys []struct {
		ID string `json:"id"`
	}
	_, kb := f.do(t, "GET", "/api/v1/projects/"+f.projectID+"/api-keys", nil, admin())
	_ = json.Unmarshal(kb, &keys)
	if len(keys) != 1 {
		t.Fatalf("keys = %s", kb)
	}
	if code, _ := f.do(t, "POST", "/api/v1/api-keys/"+keys[0].ID+"/revoke", nil, admin()); code != 200 {
		t.Fatalf("revoke = %d", code)
	}
	if code, _ := f.ingest(t, f.rawKey, req, false); code != 401 {
		t.Fatalf("revoked key ingest: %d, want 401", code)
	}
}

func TestTenantIsolation(t *testing.T) {
	f := newFixture(t)
	otherProject := f.createProject(t, "Project B")
	otherKey := f.createKey(t, otherProject)
	start := time.Now().Add(-time.Minute).UTC()
	req := traceRequest("dddddddddddddddddddddddddddddddd", start, tracev1.Status_STATUS_CODE_OK)
	if code, body := f.ingest(t, f.rawKey, req, false); code != 200 {
		t.Fatalf("ingest = %d %s", code, body)
	}
	// Project B's key cannot read project A's trace.
	code, _ := f.do(t, "GET", "/api/v1/traces/dddddddddddddddddddddddddddddddd", nil,
		map[string]string{"Authorization": "Bearer " + otherKey})
	if code != http.StatusNotFound {
		t.Fatalf("cross-tenant trace read = %d, want 404", code)
	}
	// Nor query project A by naming it.
	code, _ = f.do(t, "GET", "/api/v1/traces?project_id="+f.projectID, nil,
		map[string]string{"Authorization": "Bearer " + otherKey})
	if code != http.StatusForbidden {
		t.Fatalf("cross-tenant query = %d, want 403", code)
	}
	// Project B sees none of project A's traces with its own scope.
	code, body := f.do(t, "GET", "/api/v1/traces", nil, map[string]string{"Authorization": "Bearer " + otherKey})
	if code != 200 || bytes.Contains(body, []byte("dddddddddddddddddddddddddddddddd")) {
		t.Fatalf("project B search = %d %s", code, body)
	}
	// Admin without project_id gets a clear 400.
	if code, _ := f.do(t, "GET", "/api/v1/traces", nil, admin()); code != http.StatusBadRequest {
		t.Fatalf("admin without project = %d, want 400", code)
	}
}

func TestTraceSearchPaginationAndFilters(t *testing.T) {
	f := newFixture(t)
	base := time.Now().Add(-30 * time.Minute).UTC()
	for i := 0; i < 5; i++ {
		traceID := fmt.Sprintf("%032x", i+1)
		status := tracev1.Status_STATUS_CODE_OK
		if i == 4 {
			status = tracev1.Status_STATUS_CODE_ERROR
		}
		if code, body := f.ingest(t, f.rawKey, traceRequest(traceID, base.Add(time.Duration(i)*time.Minute), status), false); code != 200 {
			t.Fatalf("ingest %d = %d %s", i, code, body)
		}
	}
	authz := map[string]string{"Authorization": "Bearer " + f.rawKey}
	// Page 1 of 2.
	code, body := f.do(t, "GET", "/api/v1/traces?limit=2", nil, authz)
	if code != 200 {
		t.Fatalf("page1 = %d %s", code, body)
	}
	var page1 struct {
		Traces []struct {
			TraceID string `json:"trace_id"`
		} `json:"traces"`
		NextCursor string `json:"next_cursor"`
	}
	if err := json.Unmarshal(body, &page1); err != nil {
		t.Fatal(err)
	}
	if len(page1.Traces) != 2 || page1.NextCursor == "" {
		t.Fatalf("page1 = %s", body)
	}
	// Page 2 continues without overlap; page 3 finishes.
	seen := map[string]bool{page1.Traces[0].TraceID: true, page1.Traces[1].TraceID: true}
	cursor := page1.NextCursor
	total := 2
	for cursor != "" {
		code, body := f.do(t, "GET", "/api/v1/traces?limit=2&cursor="+cursor, nil, authz)
		if code != 200 {
			t.Fatalf("page = %d %s", code, body)
		}
		var page struct {
			Traces []struct {
				TraceID string `json:"trace_id"`
			} `json:"traces"`
			NextCursor string `json:"next_cursor"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			t.Fatal(err)
		}
		for _, tr := range page.Traces {
			if seen[tr.TraceID] {
				t.Fatalf("trace %s appeared on two pages", tr.TraceID)
			}
			seen[tr.TraceID] = true
			total++
		}
		cursor = page.NextCursor
	}
	if total != 5 {
		t.Fatalf("paginated total = %d, want 5", total)
	}
	// Invalid cursor is a 400.
	if code, _ := f.do(t, "GET", "/api/v1/traces?cursor=!!!bogus", nil, authz); code != http.StatusBadRequest {
		t.Fatalf("bad cursor = %d, want 400", code)
	}
	// Status filter returns only the error trace.
	code, body = f.do(t, "GET", "/api/v1/traces?status=error", nil, authz)
	if code != 200 || bytes.Count(body, []byte(`"trace_id"`)) != 1 {
		t.Fatalf("error filter = %d %s", code, body)
	}
	// Service filter.
	code, body = f.do(t, "GET", "/api/v1/traces?service=payment", nil, authz)
	if code != 200 || bytes.Count(body, []byte(`"trace_id"`)) != 5 {
		t.Fatalf("service filter = %d %s", code, body)
	}
	if code, _ := f.do(t, "GET", "/api/v1/traces?status=bogus", nil, authz); code != http.StatusBadRequest {
		t.Fatalf("bad status filter must be 400, got %d", code)
	}
	if code, _ := f.do(t, "GET", "/api/v1/traces?start=2020-01-01T00:00:00Z&end=2020-02-01T00:00:00Z", nil, authz); code != http.StatusBadRequest {
		t.Fatalf("window over 7 days must be 400, got %d", code)
	}
}

func TestScenarioValidationAndDefinitions(t *testing.T) {
	f := newFixture(t)
	code, body := f.do(t, "GET", "/api/v1/scenarios", nil, nil)
	if code != 200 || !bytes.Contains(body, []byte("slow-inventory")) || !bytes.Contains(body, []byte("payment-errors")) {
		t.Fatalf("definitions = %d %s", code, body)
	}
	start := func(payload string) (int, []byte) {
		return f.do(t, "POST", "/api/v1/scenarios", []byte(payload), admin())
	}
	if code, body := start(fmt.Sprintf(`{"project_id":%q,"scenario_type":"slow-inventory","parameters":{"delay_ms":99999}}`, f.projectID)); code != 400 {
		t.Fatalf("out-of-range param = %d %s, want 400", code, body)
	}
	if code, _ := start(fmt.Sprintf(`{"project_id":%q,"scenario_type":"nope"}`, f.projectID)); code != 400 {
		t.Fatalf("unknown scenario must be 400, got %d", code)
	}
	if code, _ := start(fmt.Sprintf(`{"project_id":%q,"scenario_type":"recovery","parameters":{"url":"http://evil.example"}}`, f.projectID)); code != 400 {
		t.Fatalf("arbitrary URL param must be 400, got %d", code)
	}
	if code, _ := start(fmt.Sprintf(`{"project_id":%q,"scenario_type":"recovery","workload":100000}`, f.projectID)); code != 400 {
		t.Fatalf("oversized workload must be 400, got %d", code)
	}
	// A valid run is accepted and stored (checkout is unreachable in this
	// fixture, so it finishes as failed — but it must be retrievable and
	// tenant-scoped).
	code, body = start(fmt.Sprintf(`{"project_id":%q,"scenario_type":"recovery","workload":2}`, f.projectID))
	if code != http.StatusCreated {
		t.Fatalf("start run = %d %s", code, body)
	}
	var run struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &run); err != nil || run.ID == "" {
		t.Fatalf("run body = %s", body)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		code, body = f.do(t, "GET", "/api/v1/scenarios/"+run.ID+"?project_id="+f.projectID, nil, admin())
		if code != 200 {
			t.Fatalf("get run = %d %s", code, body)
		}
		if bytes.Contains(body, []byte(`"completed"`)) || bytes.Contains(body, []byte(`"failed"`)) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	// Another project cannot read the run.
	other := f.createProject(t, "Project C")
	if code, _ := f.do(t, "GET", "/api/v1/scenarios/"+run.ID+"?project_id="+other, nil, admin()); code != http.StatusNotFound {
		t.Fatalf("cross-project run read = %d, want 404", code)
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	f := newFixture(t)
	authz := map[string]string{"Authorization": "Bearer " + f.rawKey}
	code, body := f.do(t, "PATCH", "/api/v1/settings/thresholds", []byte(`{"p95_latency_ms":250,"error_rate_percent":5}`), authz)
	if code != 200 {
		t.Fatalf("patch thresholds = %d %s", code, body)
	}
	code, body = f.do(t, "GET", "/api/v1/settings/thresholds", nil, authz)
	if code != 200 || !bytes.Contains(body, []byte(`250`)) {
		t.Fatalf("get thresholds = %d %s", code, body)
	}
	if code, _ := f.do(t, "PATCH", "/api/v1/settings/thresholds", []byte(`{"error_rate_percent":150}`), authz); code != 400 {
		t.Fatalf("invalid threshold must be 400, got %d", code)
	}
	code, body = f.do(t, "PATCH", "/api/v1/settings/retention", []byte(`{"retention_days":30}`), authz)
	if code != 200 || !bytes.Contains(body, []byte(`30`)) {
		t.Fatalf("patch retention = %d %s", code, body)
	}
	code, body = f.do(t, "GET", "/api/v1/settings/retention", nil, authz)
	if code != 200 || !bytes.Contains(body, []byte(`30`)) {
		t.Fatalf("get retention = %d %s", code, body)
	}
}
