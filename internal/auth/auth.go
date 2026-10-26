// Package auth implements project-scoped API keys: generation, hashing,
// validation, and revocation. Only the SHA-256 hash of a key is ever stored;
// the raw key is shown exactly once, at creation time.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/aravinditte/kairo/internal/model"
)

// KeyPrefix prefixes every generated raw API key.
const KeyPrefix = "kairo_"

// ErrInvalidKey is returned when a raw key does not resolve to a live key.
var ErrInvalidKey = errors.New("invalid api key")

// HashKey returns the hex-encoded SHA-256 hash of a raw key.
func HashKey(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// GenerateRawKey returns a new cryptographically random raw API key.
func GenerateRawKey() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return KeyPrefix + hex.EncodeToString(b[:]), nil
}

// KeyStore is the subset of storage auth needs. It is satisfied by
// storage.Store without creating an import cycle.
type KeyStore interface {
	GetAPIKeyByHash(hash string) (model.APIKeyMeta, string, bool)
	TouchAPIKey(id string, at time.Time)
}

// Validate checks a raw key against the store and returns its metadata.
// Revoked and unknown keys are rejected. The key hash comparison is done by
// the store lookup; Validate additionally refuses empty keys early.
func Validate(store KeyStore, raw string) (model.APIKeyMeta, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return model.APIKeyMeta{}, ErrInvalidKey
	}
	meta, _, ok := store.GetAPIKeyByHash(HashKey(raw))
	if !ok {
		return model.APIKeyMeta{}, ErrInvalidKey
	}
	if meta.RevokedAt != nil {
		return model.APIKeyMeta{}, ErrInvalidKey
	}
	return meta, nil
}

// VerifyHash reports whether raw hashes to the stored hash, using a
// constant-time comparison. Used where a hash is already in hand.
func VerifyHash(raw, storedHash string) bool {
	return subtle.ConstantTimeCompare([]byte(HashKey(raw)), []byte(storedHash)) == 1
}

// IsRevoked reports whether the key metadata represents a revoked key.
func IsRevoked(meta model.APIKeyMeta) bool { return meta.RevokedAt != nil }
