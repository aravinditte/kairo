// Command inventory is Kairo's demo Inventory Service.
//
// It exposes GET /reserve, applies any fault installed through
// POST /_fault (artificial delay and deterministic errors), and emits
// OTLP spans for every request to the Kairo ingestion endpoint.
//
// Behaviour contract: a configured delay is slept before the response
// (so it propagates into the caller's checkout latency and trace
// waterfall), and a fault error decision produces HTTP 500.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"strconv"

	"github.com/aravinditte/kairo/internal/demosvc"
)

func main() {
	cfg := demosvc.ConfigFromEnv("inventory", 8082)
	tracer := cfg.NewTracer()
	faults := demosvc.NewFaultStore()

	mux := cfg.NewMux(faults)
	mux.HandleFunc("GET /reserve", func(w http.ResponseWriter, r *http.Request) {
		rec, serverSpan := tracer.StartRequest(r, "GET /reserve")
		defer rec.Finish(r.Context())

		items := 1
		if raw := r.URL.Query().Get("items"); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
				items = parsed
			}
		}
		serverSpan.SetAttribute("inventory.items", items)

		process := rec.StartSpan("process reservation", demosvc.KindInternal, serverSpan)
		process.SetAttribute("inventory.items", items)

		// The fault delay is applied inside the process span so the
		// waterfall shows exactly where the time went.
		if err := faults.ApplyDelay(r.Context()); err != nil {
			process.RecordError(err, "request cancelled during fault delay")
			serverSpan.RecordError(err, "request cancelled during fault delay")
			process.End()
			demosvc.WriteError(w, http.StatusServiceUnavailable, "cancelled", "request cancelled during fault delay")
			return
		}
		if faults.ShouldError() {
			msg := "inventory fault injected"
			process.SetStatus(demosvc.StatusError, msg)
			serverSpan.SetStatus(demosvc.StatusError, msg)
			process.End()
			demosvc.WriteError(w, http.StatusInternalServerError, "inventory_error", msg)
			return
		}
		process.SetStatus(demosvc.StatusOK, "")
		process.End()
		serverSpan.SetStatus(demosvc.StatusOK, "")
		demosvc.WriteJSON(w, http.StatusOK, map[string]any{
			"status":  "reserved",
			"service": "inventory",
			"items":   items,
		})
	})

	if err := demosvc.ListenAndServe(cfg, mux); err != nil {
		slog.Error("inventory exited", "error", err)
		os.Exit(1)
	}
}
