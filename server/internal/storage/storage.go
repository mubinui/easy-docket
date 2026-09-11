// Package storage persists the opaque, client-encrypted objects a vault syncs.
//
// The store has no idea what an object contains and must never grow one: every
// method here deals in names and bytes. That is what makes the zero-knowledge
// claim checkable — there is no code path in this package that could decrypt
// anything even if it wanted to.
package storage

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Object is one stored blob's metadata.
type Object struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	// ModifiedAt is server receive time in Unix milliseconds. It is metadata
	// about the upload, not about the ledger inside.
	ModifiedAt int64 `json:"modifiedAt"`
}

// Listing is one page of object metadata.
type Listing struct {
	Objects []Object `json:"objects"`
	// NextCursor is empty when the listing is complete.
	NextCursor string `json:"nextCursor,omitempty"`
}

var (
	// ErrNotFound is returned for an object that does not exist.
	ErrNotFound = errors.New("object not found")
	// ErrAlreadyExists is returned when a name is re-used with different bytes.
	// Objects are immutable: the client names them after the hybrid logical
	// clock of their contents, so the same name must always mean the same bytes.
	ErrAlreadyExists = errors.New("object already exists")
	// ErrQuotaExceeded is returned when an account is over its storage limit.
	ErrQuotaExceeded = errors.New("storage quota exceeded")
	// ErrInvalidName is returned for a name the server refuses to store.
	ErrInvalidName = errors.New("invalid object name")
)

// Store is the persistence contract, kept narrow so the API layer can be tested
// against an in-memory implementation and so an S3-backed store could be added
// without touching the handlers.
type Store interface {
	// Put stores bytes under a name. Storing identical bytes under an existing
	// name succeeds; storing different bytes returns ErrAlreadyExists.
	Put(ctx context.Context, account, name string, data []byte) error
	// Get returns the stored bytes, or ErrNotFound.
	Get(ctx context.Context, account, name string) ([]byte, error)
	// List returns object metadata under a prefix in ascending name order.
	List(ctx context.Context, account, prefix, cursor string, limit int) (Listing, error)
	// Usage reports total bytes stored for an account.
	Usage(ctx context.Context, account string) (int64, error)
	// Delete removes an object. Deleting one that is not there succeeds: the
	// caller wants it gone, and it is.
	Delete(ctx context.Context, account, name string) error
}

// objectNamePattern mirrors the layout the client writes:
//
//	vaults/<vault-uuid>/ops/<hlc-stamp>.edk
//
// Constraining the shape server-side is cheap and removes a whole class of
// problems: path traversal, absolute paths, control characters, and clients
// accidentally using the vault as general-purpose storage.
var objectNamePattern = regexp.MustCompile(
	`^vaults/[A-Za-z0-9-]{1,64}/ops/[0-9]{19}-[0-9a-f]{4}-[A-Za-z0-9]{1,32}\.edk$`,
)

// ValidateName reports whether a client-supplied object name may be stored.
func ValidateName(name string) error {
	if len(name) > 256 {
		return fmt.Errorf("%w: too long", ErrInvalidName)
	}
	if strings.Contains(name, "..") || strings.HasPrefix(name, "/") {
		return fmt.Errorf("%w: path traversal", ErrInvalidName)
	}
	if !objectNamePattern.MatchString(name) {
		return fmt.Errorf("%w: expected vaults/<vault>/ops/<stamp>.edk", ErrInvalidName)
	}
	return nil
}

// ValidatePrefix reports whether a listing prefix is acceptable. It is looser
// than ValidateName because a prefix is not a path to create.
func ValidatePrefix(prefix string) error {
	if len(prefix) > 256 {
		return fmt.Errorf("%w: prefix too long", ErrInvalidName)
	}
	if strings.Contains(prefix, "..") || strings.HasPrefix(prefix, "/") {
		return fmt.Errorf("%w: path traversal", ErrInvalidName)
	}
	for _, r := range prefix {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '-', r == '_', r == '/', r == '.':
		default:
			return fmt.Errorf("%w: invalid character %q in prefix", ErrInvalidName, r)
		}
	}
	return nil
}
