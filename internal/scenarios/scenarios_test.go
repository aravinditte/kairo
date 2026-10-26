package scenarios_test

import (
	"testing"

	"github.com/aravinditte/kairo/internal/scenarios"
)

func TestDefinitionsCoverRequiredScenarios(t *testing.T) {
	ids := map[string]bool{}
	for _, d := range scenarios.Definitions() {
		ids[d.ID] = true
		if d.Name == "" || d.Description == "" {
			t.Fatalf("definition %+v missing name/description", d)
		}
	}
	for _, want := range []string{"slow-inventory", "payment-errors", "notification-timeout", "recovery"} {
		if !ids[want] {
			t.Fatalf("missing scenario %q", want)
		}
	}
}

func TestValidateParamsDefaultsAndBounds(t *testing.T) {
	params, err := scenarios.ValidateParams("slow-inventory", nil)
	if err != nil {
		t.Fatal(err)
	}
	if params["delay_ms"] != 800 {
		t.Fatalf("default delay_ms = %v, want 800", params["delay_ms"])
	}
	params, err = scenarios.ValidateParams("payment-errors", map[string]any{"error_rate": 0.25})
	if err != nil || params["error_rate"] != 0.25 {
		t.Fatalf("params = %v err = %v", params, err)
	}
	bad := []struct {
		scenario string
		params   map[string]any
	}{
		{"slow-inventory", map[string]any{"delay_ms": 10001.0}},          // above max
		{"slow-inventory", map[string]any{"delay_ms": -1.0}},             // below min
		{"payment-errors", map[string]any{"error_rate": 1.5}},            // above 1
		{"payment-errors", map[string]any{"error_rate": "high"}},         // wrong type
		{"slow-inventory", map[string]any{"url": "http://evil.example"}}, // unknown param: no arbitrary URLs
		{"recovery", map[string]any{"delay_ms": 5.0}},                    // recovery takes no params
		{"does-not-exist", nil},                                          // unknown scenario
	}
	for _, tc := range bad {
		if _, err := scenarios.ValidateParams(tc.scenario, tc.params); err == nil {
			t.Fatalf("ValidateParams(%q, %v) must fail", tc.scenario, tc.params)
		}
	}
}

func TestValidateWorkload(t *testing.T) {
	if n, err := scenarios.ValidateWorkload(0); err != nil || n != scenarios.DefaultWorkload {
		t.Fatalf("default workload = %d err = %v", n, err)
	}
	if _, err := scenarios.ValidateWorkload(scenarios.MaxWorkload + 1); err == nil {
		t.Fatal("workload above max must fail")
	}
	if _, err := scenarios.ValidateWorkload(-3); err == nil {
		t.Fatal("negative workload must fail")
	}
	if n, err := scenarios.ValidateWorkload(5); err != nil || n != 5 {
		t.Fatalf("workload = %d err = %v", n, err)
	}
}
