// Package otlp parses OTLP/HTTP trace payloads using the official
// OpenTelemetry protocol types (protobuf and protojson encodings),
// normalizes them into model.Span values, and validates them against the
// documented limits. It does not invent a custom wire format.
package otlp

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/aravinditte/kairo/internal/model"
)

// Limits bound a single ingestion batch, from backend configuration.
type Limits struct {
	MaxSpansPerBatch  int
	MaxAttrCount      int
	MaxAttrValueBytes int
}

// Parse errors are classified so the HTTP layer can return OTLP-appropriate
// status codes without leaking internals.
var (
	ErrMalformed    = errors.New("malformed otlp payload")
	ErrTooManySpans = errors.New("too many spans in batch")
)

// Parse decodes an ExportTraceServiceRequest from body. contentType must be
// application/x-protobuf or application/json (parameters such as charset are
// tolerated).
func Parse(body []byte, contentType string) (*collectortrace.ExportTraceServiceRequest, error) {
	ct := contentType
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	req := &collectortrace.ExportTraceServiceRequest{}
	switch ct {
	case "application/x-protobuf":
		if err := proto.Unmarshal(body, req); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrMalformed, err)
		}
	case "application/json":
		if err := protojson.Unmarshal(normalizeJSONIDs(body), req); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrMalformed, err)
		}
	default:
		return nil, fmt.Errorf("%w: unsupported content type %q", ErrMalformed, ct)
	}
	return req, nil
}

// normalizeJSONIDs rewrites hex-encoded trace/span IDs in an OTLP JSON
// payload to the base64 form protojson expects for protobuf bytes fields.
//
// The OTLP specification encodes trace_id (32 chars) and span_id /
// parent_span_id (16 chars) as hex strings in JSON, but protobuf-go's
// protojson decodes bytes fields from base64 only — feeding it spec-compliant
// hex silently corrupts the IDs (a 32-char hex trace ID becomes 24 bytes).
// The lengths are unambiguous: base64 of a 16-byte ID is 24 characters and of
// an 8-byte ID is 12, never 32/16, so payloads that already carry base64 IDs
// pass through untouched. If the body is not valid generic JSON it is
// returned unchanged and protojson produces the parse error.
func normalizeJSONIDs(body []byte) []byte {
	var doc any
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.UseNumber()
	if err := dec.Decode(&doc); err != nil {
		return body
	}
	rewriteIDFields(doc)
	out, err := json.Marshal(doc)
	if err != nil {
		return body
	}
	return out
}

// rewriteIDFields walks a generic JSON tree converting string values of
// members named traceId/spanId/parentSpanId (or their snake_case proto
// names) from hex to base64 when they have the exact hex ID lengths.
func rewriteIDFields(v any) {
	switch node := v.(type) {
	case map[string]any:
		for key, val := range node {
			if s, ok := val.(string); ok && isIDField(key) {
				if converted, ok := hexToBase64(s); ok {
					node[key] = converted
					continue
				}
			}
			rewriteIDFields(val)
		}
	case []any:
		for _, item := range node {
			rewriteIDFields(item)
		}
	}
}

func isIDField(key string) bool {
	switch key {
	case "traceId", "trace_id", "spanId", "span_id", "parentSpanId", "parent_span_id":
		return true
	}
	return false
}

func hexToBase64(s string) (string, bool) {
	if len(s) != 32 && len(s) != 16 {
		return "", false
	}
	raw, err := hex.DecodeString(s)
	if err != nil {
		return "", false
	}
	return base64.StdEncoding.EncodeToString(raw), true
}

// CountSpans returns the total number of spans in a request.
func CountSpans(req *collectortrace.ExportTraceServiceRequest) int {
	n := 0
	for _, rs := range req.GetResourceSpans() {
		for _, ss := range rs.GetScopeSpans() {
			n += len(ss.GetSpans())
		}
	}
	return n
}

// Normalize converts an OTLP request into stored spans for projectID. The
// whole batch is rejected (error) when any span is malformed — the API must
// never silently acknowledge dropped spans.
func Normalize(req *collectortrace.ExportTraceServiceRequest, projectID string, lim Limits, now time.Time) ([]model.Span, error) {
	if n := CountSpans(req); n > lim.MaxSpansPerBatch {
		return nil, fmt.Errorf("%w: %d > %d", ErrTooManySpans, n, lim.MaxSpansPerBatch)
	}
	out := []model.Span{}
	for _, rs := range req.GetResourceSpans() {
		resAttrs := attributesToMap(rs.GetResource().GetAttributes(), lim)
		serviceName, _ := resAttrs["service.name"].(string)
		if serviceName == "" {
			serviceName = "unknown_service"
		}
		for _, ss := range rs.GetScopeSpans() {
			for _, sp := range ss.GetSpans() {
				normalized, err := normalizeSpan(sp, projectID, serviceName, resAttrs, lim, now)
				if err != nil {
					return nil, err
				}
				out = append(out, normalized)
			}
		}
	}
	return out, nil
}

// ValidTraceID reports whether s is a 32-char lowercase hex trace ID for a
// non-zero ID.
func ValidTraceID(s string) bool {
	if len(s) != 32 || s == "00000000000000000000000000000000" {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// ValidSpanID reports whether s is a 16-char lowercase hex non-zero span ID.
func ValidSpanID(s string) bool {
	if len(s) != 16 || s == "0000000000000000" {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func normalizeSpan(sp *tracev1.Span, projectID, serviceName string, resAttrs map[string]any, lim Limits, now time.Time) (model.Span, error) {
	traceID := hex.EncodeToString(sp.GetTraceId())
	spanID := hex.EncodeToString(sp.GetSpanId())
	if !ValidTraceID(traceID) {
		return model.Span{}, fmt.Errorf("%w: invalid trace id", ErrMalformed)
	}
	if !ValidSpanID(spanID) {
		return model.Span{}, fmt.Errorf("%w: invalid span id", ErrMalformed)
	}
	parentID := ""
	if len(sp.GetParentSpanId()) > 0 {
		parentID = hex.EncodeToString(sp.GetParentSpanId())
		if !ValidSpanID(parentID) {
			return model.Span{}, fmt.Errorf("%w: invalid parent span id", ErrMalformed)
		}
	}
	startNs := sp.GetStartTimeUnixNano()
	endNs := sp.GetEndTimeUnixNano()
	if startNs == 0 || endNs == 0 || endNs < startNs {
		return model.Span{}, fmt.Errorf("%w: invalid timestamp range", ErrMalformed)
	}
	start := time.Unix(0, int64(startNs)).UTC()
	end := time.Unix(0, int64(endNs)).UTC()
	status := "unset"
	switch sp.GetStatus().GetCode() {
	case tracev1.Status_STATUS_CODE_OK:
		status = "ok"
	case tracev1.Status_STATUS_CODE_ERROR:
		status = "error"
	}
	svc := serviceName
	attrs := attributesToMap(sp.GetAttributes(), lim)
	// A span-level service.name attribute overrides the resource one.
	if v, ok := attrs["service.name"].(string); ok && v != "" {
		svc = v
	}
	events := make([]model.SpanEvent, 0, len(sp.GetEvents()))
	for _, ev := range sp.GetEvents() {
		events = append(events, model.SpanEvent{
			Name:       ev.GetName(),
			Time:       time.Unix(0, int64(ev.GetTimeUnixNano())).UTC(),
			Attributes: attributesToMap(ev.GetAttributes(), lim),
		})
	}
	links := make([]model.SpanLink, 0, len(sp.GetLinks()))
	for _, l := range sp.GetLinks() {
		links = append(links, model.SpanLink{
			TraceID:    hex.EncodeToString(l.GetTraceId()),
			SpanID:     hex.EncodeToString(l.GetSpanId()),
			Attributes: attributesToMap(l.GetAttributes(), lim),
		})
	}
	return model.Span{
		ProjectID:          projectID,
		TraceID:            traceID,
		SpanID:             spanID,
		ParentSpanID:       parentID,
		ServiceName:        svc,
		OperationName:      sp.GetName(),
		SpanKind:           int(sp.GetKind()),
		StartTime:          start,
		EndTime:            end,
		DurationNs:         end.Sub(start).Nanoseconds(),
		StatusCode:         status,
		StatusMessage:      sp.GetStatus().GetMessage(),
		ResourceAttributes: resAttrs,
		SpanAttributes:     attrs,
		Events:             events,
		Links:              links,
		IngestedAt:         now,
	}, nil
}

// attributesToMap converts OTLP key-values to a JSON-friendly map, enforcing
// the attribute count and value-size limits by truncation (documented
// behavior: excess attributes are dropped, oversized string values are
// truncated to the byte limit).
func attributesToMap(kvs []*commonv1.KeyValue, lim Limits) map[string]any {
	out := make(map[string]any, len(kvs))
	for i, kv := range kvs {
		if lim.MaxAttrCount > 0 && i >= lim.MaxAttrCount {
			break
		}
		out[kv.GetKey()] = anyValue(kv.GetValue(), lim)
	}
	return out
}

func anyValue(v *commonv1.AnyValue, lim Limits) any {
	if v == nil {
		return nil
	}
	switch val := v.GetValue().(type) {
	case *commonv1.AnyValue_StringValue:
		return truncate(val.StringValue, lim.MaxAttrValueBytes)
	case *commonv1.AnyValue_BoolValue:
		return val.BoolValue
	case *commonv1.AnyValue_IntValue:
		return val.IntValue
	case *commonv1.AnyValue_DoubleValue:
		return val.DoubleValue
	case *commonv1.AnyValue_ArrayValue:
		arr := make([]any, 0, len(val.ArrayValue.GetValues()))
		for _, e := range val.ArrayValue.GetValues() {
			arr = append(arr, anyValue(e, lim))
		}
		return arr
	case *commonv1.AnyValue_KvlistValue:
		return attributesToMap(val.KvlistValue.GetValues(), lim)
	case *commonv1.AnyValue_BytesValue:
		return truncate(string(val.BytesValue), lim.MaxAttrValueBytes)
	default:
		return nil
	}
}

func truncate(s string, maxBytes int) string {
	if maxBytes > 0 && len(s) > maxBytes {
		return s[:maxBytes]
	}
	return s
}
