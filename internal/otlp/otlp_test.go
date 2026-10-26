package otlp_test

import (
	"encoding/hex"
	"strings"
	"testing"
	"time"

	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	resourcev1 "go.opentelemetry.io/proto/otlp/resource/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/aravinditte/kairo/internal/otlp"
)

var limits = otlp.Limits{MaxSpansPerBatch: 1000, MaxAttrCount: 64, MaxAttrValueBytes: 2048}

func tid(s string) []byte { b, _ := hex.DecodeString(s); return b }

func makeRequest() *collectortrace.ExportTraceServiceRequest {
	start := uint64(1_700_000_000_000_000_000)
	return &collectortrace.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{{
			Resource: &resourcev1.Resource{Attributes: []*commonv1.KeyValue{
				{Key: "service.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "checkout"}}},
			}},
			ScopeSpans: []*tracev1.ScopeSpans{{
				Spans: []*tracev1.Span{{
					TraceId:           tid("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
					SpanId:            tid("1111111111111111"),
					Name:              "POST /checkout",
					Kind:              tracev1.Span_SPAN_KIND_SERVER,
					StartTimeUnixNano: start,
					EndTimeUnixNano:   start + 5_000_000,
					Status:            &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK},
					Attributes: []*commonv1.KeyValue{
						{Key: "http.status_code", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_IntValue{IntValue: 200}}},
					},
				}},
			}},
		}},
	}
}

func TestParseAndNormalizeProtobuf(t *testing.T) {
	body, err := proto.Marshal(makeRequest())
	if err != nil {
		t.Fatal(err)
	}
	req, err := otlp.Parse(body, "application/x-protobuf")
	if err != nil {
		t.Fatal(err)
	}
	spans, err := otlp.Normalize(req, "proj-1", limits, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if len(spans) != 1 {
		t.Fatalf("spans = %d", len(spans))
	}
	s := spans[0]
	if s.TraceID != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" || s.SpanID != "1111111111111111" {
		t.Fatalf("ids = %s/%s", s.TraceID, s.SpanID)
	}
	if s.ServiceName != "checkout" || s.OperationName != "POST /checkout" || s.SpanKind != 2 {
		t.Fatalf("span = %+v", s)
	}
	if s.DurationNs != 5_000_000 || s.StatusCode != "ok" || s.ProjectID != "proj-1" {
		t.Fatalf("span = %+v", s)
	}
	if s.SpanAttributes["http.status_code"] != int64(200) {
		t.Fatalf("attrs = %+v", s.SpanAttributes)
	}
}

func TestParseAndNormalizeJSON(t *testing.T) {
	body, err := protojson.Marshal(makeRequest())
	if err != nil {
		t.Fatal(err)
	}
	req, err := otlp.Parse(body, "application/json; charset=utf-8")
	if err != nil {
		t.Fatal(err)
	}
	spans, err := otlp.Normalize(req, "proj-1", limits, time.Now().UTC())
	if err != nil || len(spans) != 1 || spans[0].ServiceName != "checkout" {
		t.Fatalf("spans = %+v err = %v", spans, err)
	}
}

// TestParseSpecJSONHexIDs feeds a hand-written OTLP JSON payload exactly as
// the specification (and real SDK exporters) encode it: trace/span IDs as hex
// strings. protojson alone would decode those as base64 and corrupt them.
func TestParseSpecJSONHexIDs(t *testing.T) {
	body := []byte(`{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"checkout"}}]},"scopeSpans":[{"spans":[{"traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","spanId":"1111111111111111","parentSpanId":"2222222222222222","name":"POST /checkout","kind":2,"startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000000005000000","status":{"code":2,"message":"boom"},"links":[{"traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","spanId":"3333333333333333"}]}]}]}]}`)
	req, err := otlp.Parse(body, "application/json")
	if err != nil {
		t.Fatal(err)
	}
	spans, err := otlp.Normalize(req, "proj-1", limits, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if len(spans) != 1 {
		t.Fatalf("spans = %d", len(spans))
	}
	s := spans[0]
	if s.TraceID != "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" || s.SpanID != "1111111111111111" || s.ParentSpanID != "2222222222222222" {
		t.Fatalf("hex ids corrupted: %+v", s)
	}
	if s.StatusCode != "error" || s.StatusMessage != "boom" {
		t.Fatalf("status = %+v", s)
	}
	if len(s.Links) != 1 || s.Links[0].TraceID != "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" || s.Links[0].SpanID != "3333333333333333" {
		t.Fatalf("links = %+v", s.Links)
	}
}

func TestParseRejectsMalformedAndUnsupported(t *testing.T) {
	if _, err := otlp.Parse([]byte("not protobuf"), "application/x-protobuf"); err == nil {
		t.Fatal("malformed protobuf must fail")
	}
	if _, err := otlp.Parse([]byte("{}"), "text/plain"); err == nil {
		t.Fatal("unsupported content type must fail")
	}
	if _, err := otlp.Parse([]byte("{oops"), "application/json"); err == nil {
		t.Fatal("malformed JSON must fail")
	}
}

func TestNormalizeRejectsInvalidIDsAndTimestamps(t *testing.T) {
	req := makeRequest()
	req.ResourceSpans[0].ScopeSpans[0].Spans[0].TraceId = []byte{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	if _, err := otlp.Normalize(req, "p", limits, time.Now().UTC()); err == nil {
		t.Fatal("zero trace id must be rejected")
	}
	req = makeRequest()
	sp := req.ResourceSpans[0].ScopeSpans[0].Spans[0]
	sp.EndTimeUnixNano = sp.StartTimeUnixNano - 1
	if _, err := otlp.Normalize(req, "p", limits, time.Now().UTC()); err == nil {
		t.Fatal("end before start must be rejected")
	}
	req = makeRequest()
	req.ResourceSpans[0].ScopeSpans[0].Spans[0].SpanId = []byte{1, 2, 3}
	if _, err := otlp.Normalize(req, "p", limits, time.Now().UTC()); err == nil {
		t.Fatal("short span id must be rejected")
	}
}

func TestNormalizeEnforcesSpanLimit(t *testing.T) {
	small := otlp.Limits{MaxSpansPerBatch: 0, MaxAttrCount: 64, MaxAttrValueBytes: 2048}
	if _, err := otlp.Normalize(makeRequest(), "p", small, time.Now().UTC()); err == nil || !strings.Contains(err.Error(), "too many") {
		t.Fatalf("err = %v", err)
	}
}

func TestNormalizeAttributeLimits(t *testing.T) {
	req := makeRequest()
	sp := req.ResourceSpans[0].ScopeSpans[0].Spans[0]
	for i := 0; i < 10; i++ {
		sp.Attributes = append(sp.Attributes, &commonv1.KeyValue{
			Key:   "k",
			Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: strings.Repeat("x", 5000)}},
		})
	}
	lim := otlp.Limits{MaxSpansPerBatch: 100, MaxAttrCount: 3, MaxAttrValueBytes: 10}
	spans, err := otlp.Normalize(req, "p", lim, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if len(spans[0].SpanAttributes) > 3 {
		t.Fatalf("attr count = %d, want <= 3", len(spans[0].SpanAttributes))
	}
	for _, v := range spans[0].SpanAttributes {
		if s, ok := v.(string); ok && len(s) > 10 {
			t.Fatalf("attr value not truncated: %d bytes", len(s))
		}
	}
}

func TestIDValidators(t *testing.T) {
	if !otlp.ValidTraceID("0123456789abcdef0123456789abcdef") {
		t.Fatal("valid trace id rejected")
	}
	if otlp.ValidTraceID("0123456789ABCDEF0123456789abcdef") {
		t.Fatal("uppercase trace id must be rejected")
	}
	if otlp.ValidTraceID("00000000000000000000000000000000") {
		t.Fatal("zero trace id must be rejected")
	}
	if !otlp.ValidSpanID("0123456789abcdef") || otlp.ValidSpanID("0123") {
		t.Fatal("span id validation wrong")
	}
}
