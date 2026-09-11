// Package auth authenticates sync clients by bearer token.
//
// The server is a blob store for data it cannot read, so authentication has one
// job: decide which account an object belongs to, and keep accounts apart. It
// deliberately does not implement user registration, sessions or password
// reset — the operator provisions tokens out of band, which is the right shape
// for a self-hosted service with a handful of users.
package auth

import (
	"bufio"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Account is the authenticated identity behind a request.
type Account struct {
	// ID namespaces an account's objects in storage. Safe for use as a path
	// segment: validated on load.
	ID string
}

var (
	// ErrUnauthorized covers a missing, malformed or unknown token. The cases
	// are not distinguished in responses, to avoid confirming valid tokens.
	ErrUnauthorized = errors.New("unauthorized")
	// ErrNoTokens guards against starting a server that would accept nobody.
	ErrNoTokens = errors.New("no tokens configured")
)

// Registry maps tokens to accounts.
//
// Tokens are stored as SHA-256 hashes and compared in constant time. A plain
// hash rather than a password KDF is appropriate here because tokens are
// high-entropy random strings issued by the operator, not user-chosen
// passwords: there is nothing to brute force.
type Registry struct {
	byHash map[string]Account
}

// ParseTokens reads a token file.
//
// Format is one entry per line, `<account-id>:<sha256-hex>`, with `#` comments
// and blank lines ignored:
//
//	# generated with: docket-sync token alice
//	alice:8f9c...e1
func ParseTokens(r io.Reader) (*Registry, error) {
	registry := &Registry{byHash: make(map[string]Account)}
	scanner := bufio.NewScanner(r)

	for line := 1; scanner.Scan(); line++ {
		text := strings.TrimSpace(scanner.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}

		id, hash, ok := strings.Cut(text, ":")
		if !ok {
			return nil, fmt.Errorf("line %d: expected <account>:<sha256-hex>", line)
		}
		id, hash = strings.TrimSpace(id), strings.ToLower(strings.TrimSpace(hash))

		if err := validAccountID(id); err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		raw, err := hex.DecodeString(hash)
		if err != nil || len(raw) != sha256.Size {
			return nil, fmt.Errorf("line %d: token hash must be 64 hex characters", line)
		}
		if _, clash := registry.byHash[hash]; clash {
			return nil, fmt.Errorf("line %d: duplicate token hash", line)
		}
		registry.byHash[hash] = Account{ID: id}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(registry.byHash) == 0 {
		return nil, ErrNoTokens
	}
	return registry, nil
}

// Lookup resolves a presented token to an account.
func (r *Registry) Lookup(token string) (Account, error) {
	if token == "" {
		return Account{}, ErrUnauthorized
	}
	sum := sha256.Sum256([]byte(token))
	presented := hex.EncodeToString(sum[:])

	// Comparing every entry keeps the work independent of which token was
	// presented, so response timing does not leak whether a prefix matched.
	var found Account
	var ok bool
	for hash, account := range r.byHash {
		if subtle.ConstantTimeCompare([]byte(hash), []byte(presented)) == 1 {
			found, ok = account, true
		}
	}
	if !ok {
		return Account{}, ErrUnauthorized
	}
	return found, nil
}

// HashToken is the helper behind the `token` subcommand.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// BearerToken extracts a token from an Authorization header.
func BearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

// validAccountID keeps account identifiers usable as a single path segment.
func validAccountID(id string) error {
	if id == "" {
		return errors.New("account id must not be empty")
	}
	if len(id) > 64 {
		return errors.New("account id must be at most 64 characters")
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '-', r == '_':
		default:
			return fmt.Errorf("account id contains invalid character %q", r)
		}
	}
	return nil
}
