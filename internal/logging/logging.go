// Package logging provides the structured slog logger used across Kairo.
package logging

import (
	"log/slog"
	"os"
	"strings"
)

// New returns a JSON structured logger at the given level
// (debug|info|warn|error; unknown values fall back to info).
func New(level string) *slog.Logger {
	var lvl slog.Level
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn", "warning":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}
