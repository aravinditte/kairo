package demosvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sync"
	"time"
)

// Fault bounds from the Kairo contract: injected delays and error rates
// are deliberately capped so a Failure Lab scenario can never wedge a
// demo service indefinitely.
const (
	MaxFaultDelayMs = 10000
	MaxFaultBody    = 4096
)

// FaultConfig is the wire shape of POST /_fault.
type FaultConfig struct {
	DelayMs   int     `json:"delay_ms"`
	ErrorRate float64 `json:"error_rate"`
	Enabled   bool    `json:"enabled"`
}

// Validate checks a fault configuration against the contract bounds.
func (c FaultConfig) Validate() error {
	if c.DelayMs < 0 || c.DelayMs > MaxFaultDelayMs {
		return fmt.Errorf("delay_ms must be between 0 and %d", MaxFaultDelayMs)
	}
	if math.IsNaN(c.ErrorRate) || math.IsInf(c.ErrorRate, 0) || c.ErrorRate < 0 || c.ErrorRate > 1 {
		return errors.New("error_rate must be between 0 and 1")
	}
	return nil
}

// FaultStore holds one service's in-memory fault-injection state.
//
// Error decisions are deterministic: every decision consumes the next
// value of a monotonically increasing counter and hashes it with the
// SplitMix64 finalizer, mapping the hash uniformly into [0,1). The
// request fails iff that value is below the configured error rate.
// Given the same starting counter and the same sequence of checks, the
// exact same requests fail every time, which is what makes Failure Lab
// scenarios reproducible without storing per-request random state.
type FaultStore struct {
	mu      sync.RWMutex
	cfg     FaultConfig
	counter uint64
}

// NewFaultStore returns a store with fault injection disabled.
func NewFaultStore() *FaultStore { return &FaultStore{} }

// Config returns a copy of the current fault configuration.
func (f *FaultStore) Config() FaultConfig {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.cfg
}

// Set replaces the fault configuration after validation.
func (f *FaultStore) Set(cfg FaultConfig) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cfg = cfg
	return nil
}

// Reset disables fault injection and restores the decision counter to
// zero, so re-running a scenario after a reset replays the exact same
// deterministic error sequence as the first run.
func (f *FaultStore) Reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cfg = FaultConfig{}
	f.counter = 0
}

// Counter returns how many error decisions have been made since the
// last reset. It exists for tests and diagnostics.
func (f *FaultStore) Counter() uint64 {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.counter
}

// hashCounter maps a counter value uniformly into [0,1) using the
// SplitMix64 finalizer, a well-known deterministic integer hash.
func hashCounter(counter uint64) float64 {
	z := counter + 0x9e3779b97f4a7c15
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	z = z ^ (z >> 31)
	// Use the top 53 bits so the result is an exactly representable
	// fraction in [0,1).
	return float64(z>>11) / float64(uint64(1)<<53)
}

// ShouldError makes the deterministic error decision for one business
// request. The counter advances on every call, whether or not injection
// is enabled, so the decision sequence depends only on how many
// requests the service has decided since the last reset.
func (f *FaultStore) ShouldError() bool {
	f.mu.Lock()
	f.counter++
	counter := f.counter
	cfg := f.cfg
	f.mu.Unlock()
	if !cfg.Enabled || cfg.ErrorRate <= 0 {
		return false
	}
	if cfg.ErrorRate >= 1 {
		return true
	}
	return hashCounter(counter) < cfg.ErrorRate
}

// Delay returns the configured artificial delay, or zero when fault
// injection is disabled.
func (f *FaultStore) Delay() time.Duration {
	cfg := f.Config()
	if !cfg.Enabled || cfg.DelayMs <= 0 {
		return 0
	}
	return time.Duration(cfg.DelayMs) * time.Millisecond
}

// ApplyDelay sleeps for the configured delay, returning early with the
// context error if the request is cancelled first (for example when a
// caller's client timeout fires).
func (f *FaultStore) ApplyDelay(ctx context.Context) error {
	d := f.Delay()
	if d <= 0 {
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// HandlePost implements POST /_fault: it decodes and validates a
// FaultConfig, installs it, and echoes the installed configuration.
func (f *FaultStore) HandlePost(w http.ResponseWriter, r *http.Request) {
	var cfg FaultConfig
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, MaxFaultBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_fault", "request body must be a JSON object with delay_ms, error_rate and enabled")
		return
	}
	if err := f.Set(cfg); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_fault", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"status": "configured", "fault": f.Config()})
}

// HandleDelete implements DELETE /_fault: it clears the fault and
// resets the deterministic decision counter.
func (f *FaultStore) HandleDelete(w http.ResponseWriter, r *http.Request) {
	f.Reset()
	WriteJSON(w, http.StatusOK, map[string]any{"status": "cleared", "fault": f.Config()})
}

// HandleGet implements GET /_fault so operators and tests can inspect
// the currently installed fault without changing it.
func (f *FaultStore) HandleGet(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]any{"fault": f.Config(), "decisions": f.Counter()})
}

// RegisterFaultRoutes installs the fault-control endpoints on mux.
func (f *FaultStore) RegisterFaultRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /_fault", f.HandlePost)
	mux.HandleFunc("DELETE /_fault", f.HandleDelete)
	mux.HandleFunc("GET /_fault", f.HandleGet)
}
