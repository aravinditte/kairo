// Package config loads Kairo backend configuration from environment
// variables. Every setting has a documented default; see docs/ and README.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// DevAdminToken is the development-only default admin token. It is used only
// when KAIRO_ENV=development and KAIRO_ADMIN_TOKEN is unset, and startup logs
// a warning whenever it is in effect.
const DevAdminToken = "kairo-dev-admin"

// DevAPIKey is the documented development ingestion credential created when
// KAIRO_SEED_DEMO=true. It is never used silently in production.
const DevAPIKey = "kairo-dev-key"

// Config holds all backend settings.
type Config struct {
	Env                  string // development | production
	HTTPAddr             string
	DatabaseURL          string // empty => in-memory demo storage
	AdminToken           string
	AdminTokenIsDefault  bool
	LogLevel             string
	MaxOTLPBodyBytes     int64
	MaxSpansPerBatch     int
	MaxAttrCount         int
	MaxAttrValueBytes    int
	QueryTimeout         time.Duration
	DefaultRetentionDays int
	DemoMode             bool
	CheckoutURL          string
	InventoryURL         string
	PaymentURL           string
	NotificationURL      string
	SeedDemo             bool
	RetentionInterval    time.Duration
	RetentionBatchSize   int
}

// Load reads configuration from the environment, applying defaults and
// validating values. Invalid values are returned as errors, never ignored.
func Load() (*Config, error) {
	c := &Config{
		Env:                envOr("KAIRO_ENV", "development"),
		HTTPAddr:           envOr("KAIRO_HTTP_ADDR", ":8080"),
		DatabaseURL:        os.Getenv("KAIRO_DATABASE_URL"),
		LogLevel:           envOr("KAIRO_LOG_LEVEL", "info"),
		CheckoutURL:        envOr("KAIRO_CHECKOUT_URL", "http://localhost:8081"),
		SeedDemo:           envBool("KAIRO_SEED_DEMO", false),
		DemoMode:           envBool("KAIRO_DEMO_MODE", false),
		RetentionInterval:  time.Hour,
		RetentionBatchSize: 1000,
	}
	if c.Env != "development" && c.Env != "production" {
		return nil, fmt.Errorf("KAIRO_ENV must be development or production, got %q", c.Env)
	}
	var err error
	if c.MaxOTLPBodyBytes, err = envInt64("KAIRO_MAX_OTLP_BODY_BYTES", 4194304); err != nil {
		return nil, err
	}
	if c.MaxOTLPBodyBytes <= 0 {
		return nil, fmt.Errorf("KAIRO_MAX_OTLP_BODY_BYTES must be > 0")
	}
	if c.MaxSpansPerBatch, err = envInt("KAIRO_MAX_SPANS_PER_BATCH", 1000); err != nil {
		return nil, err
	}
	if c.MaxSpansPerBatch <= 0 {
		return nil, fmt.Errorf("KAIRO_MAX_SPANS_PER_BATCH must be > 0")
	}
	if c.MaxAttrCount, err = envInt("KAIRO_MAX_ATTR_COUNT", 64); err != nil {
		return nil, err
	}
	if c.MaxAttrCount <= 0 {
		return nil, fmt.Errorf("KAIRO_MAX_ATTR_COUNT must be > 0")
	}
	if c.MaxAttrValueBytes, err = envInt("KAIRO_MAX_ATTR_VALUE_BYTES", 2048); err != nil {
		return nil, err
	}
	if c.MaxAttrValueBytes <= 0 {
		return nil, fmt.Errorf("KAIRO_MAX_ATTR_VALUE_BYTES must be > 0")
	}
	if c.DefaultRetentionDays, err = envInt("KAIRO_DEFAULT_RETENTION_DAYS", 7); err != nil {
		return nil, err
	}
	if c.DefaultRetentionDays <= 0 {
		return nil, fmt.Errorf("KAIRO_DEFAULT_RETENTION_DAYS must be > 0")
	}
	qt := envOr("KAIRO_QUERY_TIMEOUT", "10s")
	if c.QueryTimeout, err = time.ParseDuration(qt); err != nil {
		return nil, fmt.Errorf("KAIRO_QUERY_TIMEOUT: %w", err)
	}
	if c.QueryTimeout <= 0 {
		return nil, fmt.Errorf("KAIRO_QUERY_TIMEOUT must be > 0")
	}

	// Admin token: explicit value wins. The documented development default is
	// only applied in development; in production an unset token disables
	// management endpoints (empty token never matches).
	if tok := os.Getenv("KAIRO_ADMIN_TOKEN"); tok != "" {
		c.AdminToken = tok
	} else if c.Env == "development" {
		c.AdminToken = DevAdminToken
		c.AdminTokenIsDefault = true
	}

	// Demo-service fault endpoints are derived from the checkout URL's host
	// using the documented demo port layout (checkout 8081, inventory 8082,
	// payment 8083, notifications 8084) unless explicitly overridden. The
	// scenario runner only ever talks to these configured demo services.
	c.InventoryURL = envOr("KAIRO_INVENTORY_URL", deriveSiblingURL(c.CheckoutURL, 8082))
	c.PaymentURL = envOr("KAIRO_PAYMENT_URL", deriveSiblingURL(c.CheckoutURL, 8083))
	c.NotificationURL = envOr("KAIRO_NOTIFICATIONS_URL", deriveSiblingURL(c.CheckoutURL, 8084))
	return c, nil
}

// deriveSiblingURL returns scheme://host:<port> for the given base URL,
// falling back to http://localhost:<port> when parsing fails.
func deriveSiblingURL(base string, port int) string {
	scheme, host := "http", "localhost"
	rest := base
	for i := 0; i+7 < len(rest); i++ {
		if rest[i:i+3] == "://" {
			scheme = rest[:i]
			rest = rest[i+3:]
			break
		}
	}
	// Strip path and port from the remainder.
	h := rest
	for i, ch := range h {
		if ch == '/' || ch == ':' {
			h = h[:i]
			break
		}
	}
	if h != "" {
		host = h
	}
	return fmt.Sprintf("%s://%s:%d", scheme, host, port)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

func envInt(key string, def int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}

func envInt64(key string, def int64) (int64, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}
