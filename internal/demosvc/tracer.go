package demosvc

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	coltracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	resourcev1 "go.opentelemetry.io/proto/otlp/resource/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

// SpanKind mirrors the OpenTelemetry span kind values used by Kairo's
// data model (2=server spans are what RED metrics count as requests).
type SpanKind int

const (
	KindUnspecified SpanKind = 0
	KindInternal    SpanKind = 1
	KindServer      SpanKind = 2
	KindClient      SpanKind = 3
	KindProducer    SpanKind = 4
	KindConsumer    SpanKind = 5
)

// StatusCode mirrors the OpenTelemetry span status codes.
type StatusCode int

const (
	StatusUnset StatusCode = 0
	StatusOK    StatusCode = 1
	StatusError StatusCode = 2
)

// Tracer emits spans for one service. It is safe for concurrent use;
// each inbound request gets its own Recorder (see StartRequest).
type Tracer struct {
	serviceName string
	endpoint    string
	apiKey      string
	client      *http.Client
	logger      *slog.Logger
	warned      sync.Once
}

// NewTracer creates a tracer for serviceName that POSTs OTLP/JSON
// (protobuf-encoded official OTLP proto structs) to endpoint, which is
// expected to be the full ingestion URL, e.g.
// http://localhost:8080/v1/traces. If endpoint is empty, flushing is a
// no-op so services still run standalone.
func NewTracer(serviceName, endpoint, apiKey string) *Tracer {
	return &Tracer{
		serviceName: serviceName,
		endpoint:    endpoint,
		apiKey:      apiKey,
		client:      &http.Client{Timeout: 3 * time.Second},
		logger:      slog.Default().With("component", "demosvc-tracer", "service", serviceName),
	}
}

// ServiceName returns the service identity stamped on every span's
// resource attributes as service.name.
func (t *Tracer) ServiceName() string { return t.serviceName }

// spanState is the mutable in-flight representation of one span.
type spanState struct {
	traceID      [16]byte
	spanID       [8]byte
	parentSpanID [8]byte
	hasParent    bool
	name         string
	kind         SpanKind
	start        time.Time
	end          time.Time
	ended        bool
	statusCode   StatusCode
	statusMsg    string
	attrs        []*commonv1.KeyValue
	events       []*tracev1.Span_Event
}

// Span is a handle to one in-flight span owned by a Recorder.
type Span struct {
	rec *Recorder
	st  *spanState
}

// TraceID returns the span's trace ID as 32 lowercase hex characters.
func (s *Span) TraceID() string { return bytesToHex(s.st.traceID[:]) }

// SpanID returns the span's own ID as 16 lowercase hex characters.
func (s *Span) SpanID() string { return bytesToHex(s.st.spanID[:]) }

// Context returns a W3C TraceContext identifying this span, suitable for
// propagation to a downstream service.
func (s *Span) Context() TraceContext {
	return TraceContext{Version: "00", TraceID: s.TraceID(), SpanID: s.SpanID(), Flags: "01"}
}

// Traceparent returns the W3C traceparent header value for this span.
func (s *Span) Traceparent() string { return s.Context().String() }

// SetAttribute records one attribute. Supported value types are string,
// bool, int, int64, float64; anything else is stored via fmt.Sprint.
func (s *Span) SetAttribute(key string, value any) {
	s.rec.mu.Lock()
	defer s.rec.mu.Unlock()
	s.st.attrs = append(s.st.attrs, &commonv1.KeyValue{Key: key, Value: anyValue(value)})
}

// AddEvent records a timestamped span event, e.g. an exception or a
// non-fatal downstream failure.
func (s *Span) AddEvent(name string, attrs map[string]any) {
	s.rec.mu.Lock()
	defer s.rec.mu.Unlock()
	ev := &tracev1.Span_Event{Name: name, TimeUnixNano: uint64(time.Now().UTC().UnixNano())}
	for k, v := range attrs {
		ev.Attributes = append(ev.Attributes, &commonv1.KeyValue{Key: k, Value: anyValue(v)})
	}
	s.st.events = append(s.st.events, ev)
}

// SetStatus sets the span status code and an optional description.
func (s *Span) SetStatus(code StatusCode, message string) {
	s.rec.mu.Lock()
	defer s.rec.mu.Unlock()
	s.st.statusCode = code
	s.st.statusMsg = message
}

// RecordError marks the span as errored and records an exception event.
func (s *Span) RecordError(err error, message string) {
	if err != nil {
		s.AddEvent("exception", map[string]any{
			"exception.type":    fmt.Sprintf("%T", err),
			"exception.message": err.Error(),
		})
	}
	s.SetStatus(StatusError, message)
}

// End finishes the span. It is idempotent.
func (s *Span) End() {
	s.rec.mu.Lock()
	defer s.rec.mu.Unlock()
	if !s.st.ended {
		s.st.end = time.Now().UTC()
		s.st.ended = true
	}
}

// anyValue converts a Go value into an OTLP AnyValue.
func anyValue(v any) *commonv1.AnyValue {
	switch val := v.(type) {
	case string:
		return &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: val}}
	case bool:
		return &commonv1.AnyValue{Value: &commonv1.AnyValue_BoolValue{BoolValue: val}}
	case int:
		return &commonv1.AnyValue{Value: &commonv1.AnyValue_IntValue{IntValue: int64(val)}}
	case int64:
		return &commonv1.AnyValue{Value: &commonv1.AnyValue_IntValue{IntValue: val}}
	case int32:
		return &commonv1.AnyValue{Value: &commonv1.AnyValue_IntValue{IntValue: int64(val)}}
	case float64:
		return &commonv1.AnyValue{Value: &commonv1.AnyValue_DoubleValue{DoubleValue: val}}
	default:
		return &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: fmt.Sprint(val)}}
	}
}

// Recorder collects every span created while handling one inbound
// request and flushes them as a single OTLP batch. Spans are batched in
// memory for the lifetime of the request only; nothing is queued across
// requests, so a crash loses at most the in-flight request's telemetry.
type Recorder struct {
	tracer  *Tracer
	mu      sync.Mutex
	traceID [16]byte
	spans   []*spanState
	root    *Span
	flushed bool
}

// StartRequest begins recording for an inbound HTTP request. If the
// request carries a valid W3C traceparent header, the new server span
// joins that trace as a child of the caller's span; otherwise a fresh
// trace is started. operation is the server span name, conventionally
// "<METHOD> <route>", e.g. "POST /checkout".
func (t *Tracer) StartRequest(r *http.Request, operation string) (*Recorder, *Span) {
	rec := &Recorder{tracer: t}
	var parent [8]byte
	hasParent := false
	if tc, ok := ParseTraceparent(r.Header.Get("traceparent")); ok {
		if tid, err := traceIDBytes(tc.TraceID); err == nil {
			rec.traceID = tid
		}
		if sid, err := spanIDBytes(tc.SpanID); err == nil {
			parent = sid
			hasParent = true
		}
	}
	if rec.traceID == [16]byte{} {
		rec.traceID = newTraceID()
	}
	server := rec.newSpan(operation, KindServer, parent, hasParent)
	rec.root = server
	server.SetAttribute("http.request.method", r.Method)
	server.SetAttribute("http.route", operation)
	return rec, server
}

// StartSpan starts a child span of parent (or of the recorder's root
// span when parent is nil).
func (rec *Recorder) StartSpan(name string, kind SpanKind, parent *Span) *Span {
	var parentID [8]byte
	hasParent := false
	if parent != nil {
		parentID = parent.st.spanID
		hasParent = true
	} else if rec.root != nil {
		parentID = rec.root.st.spanID
		hasParent = true
	}
	return rec.newSpan(name, kind, parentID, hasParent)
}

func (rec *Recorder) newSpan(name string, kind SpanKind, parent [8]byte, hasParent bool) *Span {
	st := &spanState{
		traceID: rec.traceID,
		spanID:  newSpanID(),
		kind:    kind,
		name:    name,
		start:   time.Now().UTC(),
	}
	if hasParent {
		st.parentSpanID = parent
		st.hasParent = true
	}
	rec.mu.Lock()
	rec.spans = append(rec.spans, st)
	rec.mu.Unlock()
	return &Span{rec: rec, st: st}
}

// Root returns the server span created by StartRequest.
func (rec *Recorder) Root() *Span { return rec.root }

// TraceID returns the recorded trace's ID as hex.
func (rec *Recorder) TraceID() string { return bytesToHex(rec.traceID[:]) }

// SpanCount returns how many spans have been recorded so far.
func (rec *Recorder) SpanCount() int {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	return len(rec.spans)
}

// Finish ends the root span (if not already ended) and flushes the
// batch. Flush failures are logged, never returned: telemetry loss must
// not fail the business request that produced it.
//
// The flush deliberately runs on a context detached from cancellation:
// when a caller disconnects or times out (exactly the Notification
// Timeout scenario), the request context is already cancelled, and
// flushing with it would silently lose the very spans that document the
// failure.
func (rec *Recorder) Finish(ctx context.Context) {
	if rec.root != nil {
		rec.root.End()
	}
	flushCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	if err := rec.Flush(flushCtx); err != nil {
		rec.tracer.logger.Warn("span flush failed", "error", err, "trace_id", rec.TraceID())
	}
}

// Flush serializes all recorded spans as an official OTLP
// ExportTraceServiceRequest using protobuf and POSTs it to the Kairo
// ingestion endpoint with the project API key. Any span that has not
// been ended yet is ended at flush time so no span is silently dropped.
// Flush is idempotent: a second call sends nothing.
func (rec *Recorder) Flush(ctx context.Context) error {
	rec.mu.Lock()
	if rec.flushed {
		rec.mu.Unlock()
		return nil
	}
	rec.flushed = true
	states := make([]*spanState, len(rec.spans))
	copy(states, rec.spans)
	now := time.Now().UTC()
	for _, st := range states {
		if !st.ended {
			st.end = now
			st.ended = true
		}
	}
	rec.mu.Unlock()

	t := rec.tracer
	if t.endpoint == "" {
		return nil
	}
	if t.apiKey == "" {
		t.warned.Do(func() {
			t.logger.Warn("KAIRO_API_KEY is empty; spans will be rejected by the ingestion endpoint")
		})
	}

	spans := make([]*tracev1.Span, 0, len(states))
	for _, st := range states {
		span := &tracev1.Span{
			TraceId:           append([]byte(nil), st.traceID[:]...),
			SpanId:            append([]byte(nil), st.spanID[:]...),
			Name:              st.name,
			Kind:              tracev1.Span_SpanKind(st.kind),
			StartTimeUnixNano: uint64(st.start.UnixNano()),
			EndTimeUnixNano:   uint64(st.end.UnixNano()),
			Attributes:        st.attrs,
			Events:            st.events,
			Status: &tracev1.Status{
				Code:    tracev1.Status_StatusCode(st.statusCode),
				Message: st.statusMsg,
			},
		}
		if st.hasParent {
			span.ParentSpanId = append([]byte(nil), st.parentSpanID[:]...)
		}
		spans = append(spans, span)
	}

	req := &coltracev1.ExportTraceServiceRequest{
		ResourceSpans: []*tracev1.ResourceSpans{
			{
				Resource: &resourcev1.Resource{
					Attributes: []*commonv1.KeyValue{
						{Key: "service.name", Value: anyValue(t.serviceName)},
						{Key: "telemetry.sdk.name", Value: anyValue("kairo-demosvc")},
						{Key: "telemetry.sdk.language", Value: anyValue("go")},
					},
				},
				ScopeSpans: []*tracev1.ScopeSpans{
					{
						Scope: &commonv1.InstrumentationScope{Name: "kairo/demosvc", Version: "1.0.0"},
						Spans: spans,
					},
				},
			},
		},
	}

	payload, err := proto.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal OTLP payload: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, t.endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build ingestion request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/x-protobuf")
	if t.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+t.apiKey)
		httpReq.Header.Set("X-Api-Key", t.apiKey)
	}
	// A demo service must never forward its inbound caller's traceparent
	// to the collector: the ingestion POST is not part of the business
	// trace, and forwarding it would corrupt trace reconstruction.

	resp, err := t.client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("POST %s: %w", t.endpoint, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("ingestion endpoint returned %s: %s", resp.Status, string(body))
	}
	return nil
}
