// Command payment is Kairo's demo Payment Service.
//
// It exposes POST /charge, applies any fault installed through
// POST /_fault (artificial delay and deterministic errors), and emits
// OTLP spans for every request. A fault error decision produces
// HTTP 500, which the checkout service surfaces to its caller as 502.
package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"

	"github.com/aravinditte/kairo/internal/demosvc"
)

// chargeRequest is the accepted POST /charge body. Unknown fields are
// ignored so the checkout service can evolve its payload; amounts are
// echoed back, never processed (this is a demonstration service).
type chargeRequest struct {
	Items       int   `json:"items"`
	AmountCents int64 `json:"amount_cents"`
}

func main() {
	cfg := demosvc.ConfigFromEnv("payment", 8083)
	tracer := cfg.NewTracer()
	faults := demosvc.NewFaultStore()

	mux := cfg.NewMux(faults)
	mux.HandleFunc("POST /charge", func(w http.ResponseWriter, r *http.Request) {
		rec, serverSpan := tracer.StartRequest(r, "POST /charge")
		defer rec.Finish(r.Context())

		var req chargeRequest
		body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil {
			serverSpan.RecordError(err, "read request body")
			demosvc.WriteError(w, http.StatusBadRequest, "bad_request", "could not read request body")
			return
		}
		if len(body) > 0 {
			if err := json.Unmarshal(body, &req); err != nil {
				serverSpan.SetStatus(demosvc.StatusError, "invalid JSON body")
				demosvc.WriteError(w, http.StatusBadRequest, "bad_request", "request body must be valid JSON")
				return
			}
		}
		if req.Items <= 0 {
			req.Items = 1
		}
		serverSpan.SetAttribute("payment.items", req.Items)
		serverSpan.SetAttribute("payment.amount_cents", req.AmountCents)

		process := rec.StartSpan("process charge", demosvc.KindInternal, serverSpan)
		process.SetAttribute("payment.items", req.Items)

		if err := faults.ApplyDelay(r.Context()); err != nil {
			process.RecordError(err, "request cancelled during fault delay")
			serverSpan.RecordError(err, "request cancelled during fault delay")
			process.End()
			demosvc.WriteError(w, http.StatusServiceUnavailable, "cancelled", "request cancelled during fault delay")
			return
		}
		if faults.ShouldError() {
			msg := "payment fault injected"
			process.SetStatus(demosvc.StatusError, msg)
			serverSpan.SetStatus(demosvc.StatusError, msg)
			process.End()
			demosvc.WriteError(w, http.StatusInternalServerError, "payment_error", msg)
			return
		}
		process.SetStatus(demosvc.StatusOK, "")
		process.End()
		serverSpan.SetStatus(demosvc.StatusOK, "")
		demosvc.WriteJSON(w, http.StatusOK, map[string]any{
			"status":       "charged",
			"service":      "payment",
			"items":        req.Items,
			"amount_cents": req.AmountCents,
		})
	})

	if err := demosvc.ListenAndServe(cfg, mux); err != nil {
		slog.Error("payment exited", "error", err)
		os.Exit(1)
	}
}
