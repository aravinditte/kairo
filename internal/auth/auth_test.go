package auth_test

import (
	"strings"
	"testing"
	"time"

	"github.com/aravinditte/kairo/internal/auth"
	"github.com/aravinditte/kairo/internal/model"
	"github.com/aravinditte/kairo/internal/storage"
)

func TestGenerateAndHash(t *testing.T) {
	raw, err := auth.GenerateRawKey()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(raw, auth.KeyPrefix) || len(raw) < 40 {
		t.Fatalf("raw key shape = %q", raw)
	}
	raw2, _ := auth.GenerateRawKey()
	if raw == raw2 {
		t.Fatal("generated keys must be unique")
	}
	if auth.HashKey(raw) == auth.HashKey(raw2) {
		t.Fatal("distinct keys must hash distinctly")
	}
	if !auth.VerifyHash(raw, auth.HashKey(raw)) || auth.VerifyHash(raw2, auth.HashKey(raw)) {
		t.Fatal("hash verification wrong")
	}
}

func TestValidateAndRevocation(t *testing.T) {
	store := storage.NewMemoryStore()
	now := time.Now().UTC()
	if err := store.CreateProject(model.Project{ID: "p1", Name: "P", CreatedAt: now, UpdatedAt: now, RetentionDays: 7}); err != nil {
		t.Fatal(err)
	}
	raw, _ := auth.GenerateRawKey()
	meta := model.APIKeyMeta{ID: "k1", ProjectID: "p1", CreatedAt: now}
	if err := store.CreateAPIKey(meta, auth.HashKey(raw)); err != nil {
		t.Fatal(err)
	}
	got, err := auth.Validate(store, raw)
	if err != nil || got.ID != "k1" || got.ProjectID != "p1" {
		t.Fatalf("validate = %+v err = %v", got, err)
	}
	if _, err := auth.Validate(store, "kairo_wrong"); err == nil {
		t.Fatal("wrong key must be rejected")
	}
	if _, err := auth.Validate(store, ""); err == nil {
		t.Fatal("empty key must be rejected")
	}
	// Revocation takes effect immediately.
	if _, ok := store.RevokeAPIKey("k1", now); !ok {
		t.Fatal("revoke failed")
	}
	if _, err := auth.Validate(store, raw); err == nil {
		t.Fatal("revoked key must be rejected")
	}
	revoked, _ := store.GetAPIKeyByID("k1")
	if !auth.IsRevoked(revoked) {
		t.Fatal("IsRevoked must report the revoked key")
	}
}
