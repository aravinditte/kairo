package demosvc

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// MaxDownstreamBody caps how much of a downstream response a demo
// service will read into memory.
const MaxDownstreamBody = 1 << 20

// downstreamClient is shared by all recorders. It deliberately has no
// global timeout: per-call deadlines are applied through the request
// context so callers control them (checkout gives notifications 800ms).
var downstreamClient = &http.Client{}

// DoHTTP performs an HTTP call to a downstream demo service while
// recording a client span for it on this recorder.
//
// The client span becomes the propagated parent: the downstream service
// receives a W3C traceparent header naming the client span, so its
// server span is reconstructed as the client span's child. The span is
// always ended before DoHTTP returns.
//
// Behaviour:
//   - timeout > 0 applies a per-call context deadline.
//   - body, when non-nil, is sent with Content-Type: application/json.
//   - A transport error (including a timeout) records an exception event
//     and an error status on the client span and is returned as err.
//   - An HTTP response, including 4xx/5xx, is NOT an err: its status code
//     and body are returned so the caller decides what it means (payment
//     5xx fails a checkout; notification failure does not). Responses with
//     status >= 400 still mark the client span as errored.
func (rec *Recorder) DoHTTP(ctx context.Context, parent *Span, method, rawURL string, body []byte, timeout time.Duration) (int, []byte, error) {
	route := method
	if u, err := url.Parse(rawURL); err == nil && u.Path != "" {
		route = method + " " + u.Path
	}
	span := rec.StartSpan(route, KindClient, parent)
	span.SetAttribute("http.request.method", method)
	span.SetAttribute("url.full", rawURL)
	if u, err := url.Parse(rawURL); err == nil {
		span.SetAttribute("server.address", u.Host)
	}

	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, reader)
	if err != nil {
		span.RecordError(err, "build downstream request")
		span.End()
		return 0, nil, fmt.Errorf("build downstream request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// W3C Trace Context propagation: the downstream server span's parent
	// is this client span.
	req.Header.Set("traceparent", span.Traceparent())

	resp, err := downstreamClient.Do(req)
	if err != nil {
		span.RecordError(err, "downstream request failed")
		span.AddEvent("downstream_error", map[string]any{"error": err.Error()})
		span.End()
		return 0, nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, MaxDownstreamBody))
	if err != nil {
		span.RecordError(err, "read downstream response")
		span.End()
		return resp.StatusCode, nil, fmt.Errorf("read downstream response: %w", err)
	}
	span.SetAttribute("http.response.status_code", resp.StatusCode)
	if resp.StatusCode >= 400 {
		span.SetStatus(StatusError, fmt.Sprintf("downstream returned HTTP %d", resp.StatusCode))
	} else {
		span.SetStatus(StatusOK, "")
	}
	span.End()
	return resp.StatusCode, respBody, nil
}
