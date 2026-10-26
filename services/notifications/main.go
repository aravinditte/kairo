// Command notifications is Kairo's demo Notification Service.
//
// It exposes POST /notify, applies any fault installed through
// POST /_fault, and emits OTLP spans for every request. The service
// exists in the demo topology primarily so the Notification Timeout
// Failure Lab scenario has something to time out: checkout calls it
// with an 800ms client timeout and treats failure as non-fatal.
package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"

	"github.com/aravinditte/kairo/internal/demosvc"
)

// notifyRequest is the accepted POST /notify body.
type notifyRequest struct {
	Items   int    `json:"items"`
	Channel string `json:"channel"`
}

func main() {
	cfg := demosvc.ConfigFromEnv("notifications", 8084)
	tracer := cfg.NewTracer()
	faults := demosvc.NewFaultStore()

	mux := cfg.NewMux(faults)
	mux.HandleFunc("POST /notify", func(w http.ResponseWriter, r *http.Request) {
		rec, serverSpan := tracer.StartRequest(r, "POST /notify")
		defer rec.Finish(r.Context())

		var req notifyRequest
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
		if req.Channel == "" {
			req.Channel = "email"
		}
		serverSpan.SetAttribute("notification.channel", req.Channel)
		serverSpan.SetAttribute("notification.items", req.Items)

		process := rec.StartSpan("process notification", demosvc.KindInternal, serverSpan)
		process.SetAttribute("notification.channel", req.Channel)

		// The delay runs until it elapses or the caller gives up: when
		// checkout's 800ms timeout fires, the request context is
		// cancelled and ApplyDelay returns promptly instead of sleeping
		// for the full injected delay.
		if err := faults.ApplyDelay(r.Context()); err != nil {
			process.RecordError(err, "request cancelled during fault delay")
			serverSpan.RecordError(err, "request cancelled during fault delay")
			process.End()
			demosvc.WriteError(w, http.StatusServiceUnavailable, "cancelled", "request cancelled during fault delay")
			return
		}
		if faults.ShouldError() {
			msg := "notification fault injected"
			process.SetStatus(demosvc.StatusError, msg)
			serverSpan.SetStatus(demosvc.StatusError, msg)
			process.End()
			demosvc.WriteError(w, http.StatusInternalServerError, "notification_error", msg)
			return
		}
		process.SetStatus(demosvc.StatusOK, "")
		process.End()
		serverSpan.SetStatus(demosvc.StatusOK, "")
		demosvc.WriteJSON(w, http.StatusOK, map[string]any{
			"status":  "notified",
			"service": "notifications",
			"channel": req.Channel,
			"items":   req.Items,
		})
	})

	if err := demosvc.ListenAndServe(cfg, mux); err != nil {
		slog.Error("notifications exited", "error", err)
		os.Exit(1)
	}
}
