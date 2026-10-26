// Command checkout is Kairo's demo Checkout Service, the entry point of
// the demonstration topology:
//
//	POST /checkout -> GET  inventory /reserve
//	               -> POST payment /charge
//	               -> POST notifications /notify
//
// Behaviour contract:
//   - Every hop propagates W3C traceparent and records a client span
//     (checkout is the only demo service that makes downstream calls).
//   - An inventory delay propagates: checkout waits for /reserve, so the
//     delay appears in the checkout span and the trace waterfall.
//   - Payment returning 5xx (or being unreachable) fails the checkout
//     with HTTP 502.
//   - Notifications are called with an 800ms client timeout and are
//     NON-FATAL: a timeout or error is recorded on the notification
//     client span and as an event on the server span, and the checkout
//     still succeeds with HTTP 200.
//   - Inventory failure also fails the checkout with HTTP 502, because a
//     checkout that could not reserve its items did not happen.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/aravinditte/kairo/internal/demosvc"
)

// notificationTimeout is the contract-fixed client deadline for the
// notification hop.
const notificationTimeout = 800 * time.Millisecond

// checkoutRequest is the accepted POST /checkout body.
type checkoutRequest struct {
	Items int `json:"items"`
}

func main() {
	cfg := demosvc.ConfigFromEnv("checkout", 8081)
	tracer := cfg.NewTracer()
	faults := demosvc.NewFaultStore()

	inventoryURL := demosvc.EnvOr("INVENTORY_URL", "http://localhost:8082")
	paymentURL := demosvc.EnvOr("PAYMENT_URL", "http://localhost:8083")
	notificationURL := demosvc.EnvOr("NOTIFICATION_URL", "http://localhost:8084")

	mux := cfg.NewMux(faults)
	mux.HandleFunc("POST /checkout", func(w http.ResponseWriter, r *http.Request) {
		rec, serverSpan := tracer.StartRequest(r, "POST /checkout")
		defer rec.Finish(r.Context())
		traceID := rec.TraceID()

		var req checkoutRequest
		body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil {
			serverSpan.RecordError(err, "read request body")
			writeCheckoutError(w, http.StatusBadRequest, "bad_request", "could not read request body", traceID)
			return
		}
		if len(body) > 0 {
			if err := json.Unmarshal(body, &req); err != nil {
				serverSpan.SetStatus(demosvc.StatusError, "invalid JSON body")
				writeCheckoutError(w, http.StatusBadRequest, "bad_request", "request body must be valid JSON", traceID)
				return
			}
		}
		if req.Items == 0 {
			req.Items = 1
		}
		if req.Items < 1 || req.Items > 1000 {
			serverSpan.SetStatus(demosvc.StatusError, "items out of range")
			writeCheckoutError(w, http.StatusBadRequest, "bad_request", "items must be between 1 and 1000", traceID)
			return
		}
		serverSpan.SetAttribute("checkout.items", req.Items)

		// Checkout honours its own /_fault too (delay before work, and a
		// deterministic chance to fail outright), like every demo service.
		process := rec.StartSpan("process checkout", demosvc.KindInternal, serverSpan)
		process.SetAttribute("checkout.items", req.Items)
		if err := faults.ApplyDelay(r.Context()); err != nil {
			process.RecordError(err, "request cancelled during fault delay")
			serverSpan.RecordError(err, "request cancelled during fault delay")
			process.End()
			writeCheckoutError(w, http.StatusServiceUnavailable, "cancelled", "request cancelled during fault delay", traceID)
			return
		}
		if faults.ShouldError() {
			msg := "checkout fault injected"
			process.SetStatus(demosvc.StatusError, msg)
			serverSpan.SetStatus(demosvc.StatusError, msg)
			process.End()
			writeCheckoutError(w, http.StatusInternalServerError, "checkout_error", msg, traceID)
			return
		}

		ctx := r.Context()

		// 1. Reserve inventory. No client-side timeout: an injected
		// inventory delay must propagate into the checkout duration.
		reserveURL := fmt.Sprintf("%s/reserve?items=%d", inventoryURL, req.Items)
		status, _, err := rec.DoHTTP(ctx, process, http.MethodGet, reserveURL, nil, 0)
		if err != nil {
			process.SetStatus(demosvc.StatusError, "inventory request failed")
			serverSpan.SetStatus(demosvc.StatusError, "inventory request failed")
			process.End()
			writeCheckoutError(w, http.StatusBadGateway, "inventory_unavailable", "inventory service could not be reached", traceID)
			return
		}
		if status >= 400 {
			msg := fmt.Sprintf("inventory returned HTTP %d", status)
			process.SetStatus(demosvc.StatusError, msg)
			serverSpan.SetStatus(demosvc.StatusError, msg)
			process.End()
			writeCheckoutError(w, http.StatusBadGateway, "inventory_failed", msg, traceID)
			return
		}

		// 2. Charge payment. A payment 5xx fails the whole checkout
		// with 502, per the contract.
		chargeBody, _ := json.Marshal(map[string]any{
			"items":        req.Items,
			"amount_cents": req.Items * 1299,
		})
		status, _, err = rec.DoHTTP(ctx, process, http.MethodPost, paymentURL+"/charge", chargeBody, 0)
		if err != nil {
			process.SetStatus(demosvc.StatusError, "payment request failed")
			serverSpan.SetStatus(demosvc.StatusError, "payment request failed")
			process.End()
			writeCheckoutError(w, http.StatusBadGateway, "payment_unavailable", "payment service could not be reached", traceID)
			return
		}
		if status >= 400 {
			msg := fmt.Sprintf("payment returned HTTP %d", status)
			process.SetStatus(demosvc.StatusError, msg)
			serverSpan.SetStatus(demosvc.StatusError, msg)
			process.End()
			writeCheckoutError(w, http.StatusBadGateway, "payment_failed", msg, traceID)
			return
		}

		// 3. Notify. Non-fatal by contract: timeout (800ms) or any
		// failure is recorded as evidence on the spans and the checkout
		// still succeeds.
		notifyBody, _ := json.Marshal(map[string]any{
			"items":   req.Items,
			"channel": "email",
		})
		notification := "sent"
		nStatus, _, nErr := rec.DoHTTP(ctx, process, http.MethodPost, notificationURL+"/notify", notifyBody, notificationTimeout)
		if nErr != nil {
			notification = "failed"
			serverSpan.AddEvent("notification_failed", map[string]any{
				"reason": nErr.Error(),
				"fatal":  false,
			})
		} else if nStatus >= 400 {
			notification = "failed"
			serverSpan.AddEvent("notification_failed", map[string]any{
				"reason": fmt.Sprintf("notifications returned HTTP %d", nStatus),
				"fatal":  false,
			})
		}
		serverSpan.SetAttribute("checkout.notification", notification)

		process.SetStatus(demosvc.StatusOK, "")
		process.End()
		serverSpan.SetStatus(demosvc.StatusOK, "")
		demosvc.WriteJSON(w, http.StatusOK, map[string]any{
			"status":       "completed",
			"service":      "checkout",
			"items":        req.Items,
			"notification": notification,
			"trace_id":     traceID,
		})
	})

	if err := demosvc.ListenAndServe(cfg, mux); err != nil {
		slog.Error("checkout exited", "error", err)
		os.Exit(1)
	}
}

// writeCheckoutError writes the standard error envelope plus the trace
// ID, so a caller can jump straight from a failed checkout to its trace.
func writeCheckoutError(w http.ResponseWriter, status int, code, message, traceID string) {
	demosvc.WriteJSON(w, status, map[string]any{
		"error":    map[string]any{"code": code, "message": message},
		"trace_id": traceID,
	})
}
