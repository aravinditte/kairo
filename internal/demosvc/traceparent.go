// Package demosvc is the shared library for Kairo's four demonstration
// microservices (checkout, inventory, payment, notifications).
//
// It provides:
//   - W3C Trace Context (traceparent) parsing and formatting.
//   - A minimal tracer that builds official OpenTelemetry OTLP proto
//     structs and POSTs them, protobuf-encoded, to the Kairo ingestion
//     endpoint once per inbound request (batch + flush per request).
//   - A deterministic fault-injection store behind POST/DELETE /_fault.
//   - A downstream HTTP client helper that propagates traceparent and
//     records client spans.
//
// Only the Go standard library and the repository's pinned
// OpenTelemetry protobuf dependencies are used.
package demosvc

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

// TraceContext is a parsed W3C traceparent header value:
//
//	version-traceid-spanid-flags, e.g.
//	00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
type TraceContext struct {
	Version string
	TraceID string // 32 lowercase hex characters
	SpanID  string // 16 lowercase hex characters
	Flags   string // 2 lowercase hex characters
}

// Sampled reports whether the traceparent flags have the sampled bit set.
func (tc TraceContext) Sampled() bool {
	return tc.Flags == "01" || tc.Flags == "03"
}

// String formats the context back into a traceparent header value.
func (tc TraceContext) String() string {
	version := tc.Version
	if version == "" {
		version = "00"
	}
	flags := tc.Flags
	if flags == "" {
		flags = "01"
	}
	return version + "-" + tc.TraceID + "-" + tc.SpanID + "-" + flags
}

// ParseTraceparent parses and validates a W3C traceparent header.
// It returns ok=false for missing, malformed, or all-zero identifiers.
func ParseTraceparent(header string) (TraceContext, bool) {
	header = strings.TrimSpace(header)
	if header == "" {
		return TraceContext{}, false
	}
	parts := strings.Split(header, "-")
	if len(parts) != 4 {
		return TraceContext{}, false
	}
	tc := TraceContext{
		Version: strings.ToLower(parts[0]),
		TraceID: strings.ToLower(parts[1]),
		SpanID:  strings.ToLower(parts[2]),
		Flags:   strings.ToLower(parts[3]),
	}
	if len(tc.Version) != 2 || !isHex(tc.Version) || tc.Version == "ff" {
		return TraceContext{}, false
	}
	if !IsValidTraceID(tc.TraceID) || !IsValidSpanID(tc.SpanID) {
		return TraceContext{}, false
	}
	if len(tc.Flags) != 2 || !isHex(tc.Flags) {
		return TraceContext{}, false
	}
	// Version 00 forbids extra data and requires exact field lengths, which
	// the checks above already enforce.
	return tc, true
}

// IsValidTraceID reports whether s is a 32-char hex string that is not all zero.
func IsValidTraceID(s string) bool {
	if len(s) != 32 || !isHex(s) {
		return false
	}
	return s != "00000000000000000000000000000000"
}

// IsValidSpanID reports whether s is a 16-char hex string that is not all zero.
func IsValidSpanID(s string) bool {
	if len(s) != 16 || !isHex(s) {
		return false
	}
	return s != "0000000000000000"
}

func isHex(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range []byte(s) {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

// traceIDBytes decodes a hex trace ID into its 16 raw bytes.
func traceIDBytes(traceID string) ([16]byte, error) {
	var out [16]byte
	b, err := hex.DecodeString(traceID)
	if err != nil || len(b) != 16 {
		return out, fmt.Errorf("invalid trace id %q", traceID)
	}
	copy(out[:], b)
	return out, nil
}

// spanIDBytes decodes a hex span ID into its 8 raw bytes.
func spanIDBytes(spanID string) ([8]byte, error) {
	var out [8]byte
	b, err := hex.DecodeString(spanID)
	if err != nil || len(b) != 8 {
		return out, fmt.Errorf("invalid span id %q", spanID)
	}
	copy(out[:], b)
	return out, nil
}

// newTraceID returns a random, non-zero 16-byte trace ID.
func newTraceID() [16]byte {
	var id [16]byte
	for {
		if _, err := rand.Read(id[:]); err != nil {
			panic("demosvc: crypto/rand unavailable: " + err.Error())
		}
		if id != [16]byte{} {
			return id
		}
	}
}

// newSpanID returns a random, non-zero 8-byte span ID.
func newSpanID() [8]byte {
	var id [8]byte
	for {
		if _, err := rand.Read(id[:]); err != nil {
			panic("demosvc: crypto/rand unavailable: " + err.Error())
		}
		if id != [8]byte{} {
			return id
		}
	}
}

func bytesToHex(b []byte) string { return hex.EncodeToString(b) }
