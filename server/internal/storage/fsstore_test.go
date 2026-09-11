package storage

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// name builds a valid object name for the given clock stamp.
func name(stamp string) string {
	return fmt.Sprintf("vaults/8f2a1c64-0a9a-4a4d-9c2a-3b7f1e5d6c90/ops/%s.edk", stamp)
}

func stamp(n int) string {
	return fmt.Sprintf("%019d-0000-aaaaaaaa", 1700000000000+n)
}

func newStore(t *testing.T, quota int64) *FSStore {
	t.Helper()
	store, err := NewFSStore(t.TempDir(), quota)
	if err != nil {
		t.Fatalf("NewFSStore: %v", err)
	}
	return store
}

func TestValidateName(t *testing.T) {
	valid := []string{
		name(stamp(0)),
		"vaults/abc/ops/0000001700000000000-00ff-Device01.edk",
	}
	for _, n := range valid {
		if err := ValidateName(n); err != nil {
			t.Errorf("ValidateName(%q) = %v, want nil", n, err)
		}
	}

	invalid := map[string]string{
		"traversal":       "vaults/../../etc/passwd",
		"absolute":        "/vaults/a/ops/" + stamp(0) + ".edk",
		"wrong extension": "vaults/a/ops/" + stamp(0) + ".txt",
		"no stamp":        "vaults/a/ops/notastamp.edk",
		"extra depth":     "vaults/a/ops/sub/" + stamp(0) + ".edk",
		"empty":           "",
		"too long":        "vaults/a/ops/" + strings.Repeat("x", 300) + ".edk",
	}
	for label, n := range invalid {
		t.Run(label, func(t *testing.T) {
			if err := ValidateName(n); !errors.Is(err, ErrInvalidName) {
				t.Errorf("ValidateName(%q) = %v, want ErrInvalidName", n, err)
			}
		})
	}
}

func TestValidatePrefix(t *testing.T) {
	if err := ValidatePrefix("vaults/abc/ops/"); err != nil {
		t.Errorf("valid prefix rejected: %v", err)
	}
	for _, prefix := range []string{"../etc", "/etc", "vaults/\x00"} {
		if err := ValidatePrefix(prefix); !errors.Is(err, ErrInvalidName) {
			t.Errorf("ValidatePrefix(%q) = %v, want ErrInvalidName", prefix, err)
		}
	}
}

func TestPutAndGet(t *testing.T) {
	store := newStore(t, 0)
	ctx := context.Background()
	data := []byte("sealed-envelope-bytes")

	if err := store.Put(ctx, "alice", name(stamp(0)), data); err != nil {
		t.Fatalf("Put: %v", err)
	}
	got, err := store.Get(ctx, "alice", name(stamp(0)))
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if string(got) != string(data) {
		t.Errorf("Get returned %q, want %q", got, data)
	}
}

func TestGetMissingObject(t *testing.T) {
	store := newStore(t, 0)
	if _, err := store.Get(context.Background(), "alice", name(stamp(9))); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestObjectsAreImmutable(t *testing.T) {
	store := newStore(t, 0)
	ctx := context.Background()
	objectName := name(stamp(0))

	if err := store.Put(ctx, "alice", objectName, []byte("original")); err != nil {
		t.Fatalf("Put: %v", err)
	}

	t.Run("re-uploading identical bytes succeeds", func(t *testing.T) {
		// A client that crashed after uploading but before recording success
		// must be able to retry without hitting an error.
		if err := store.Put(ctx, "alice", objectName, []byte("original")); err != nil {
			t.Errorf("idempotent Put failed: %v", err)
		}
	})

	t.Run("different bytes are refused", func(t *testing.T) {
		err := store.Put(ctx, "alice", objectName, []byte("tampered"))
		if !errors.Is(err, ErrAlreadyExists) {
			t.Fatalf("err = %v, want ErrAlreadyExists", err)
		}
		got, _ := store.Get(ctx, "alice", objectName)
		if string(got) != "original" {
			t.Errorf("stored object was modified: %q", got)
		}
	})
}

func TestAccountsAreIsolated(t *testing.T) {
	store := newStore(t, 0)
	ctx := context.Background()
	objectName := name(stamp(0))

	if err := store.Put(ctx, "alice", objectName, []byte("alice's data")); err != nil {
		t.Fatalf("Put: %v", err)
	}

	if _, err := store.Get(ctx, "bob", objectName); !errors.Is(err, ErrNotFound) {
		t.Errorf("bob could read alice's object: %v", err)
	}
	listing, err := store.List(ctx, "bob", "", "", 100)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(listing.Objects) != 0 {
		t.Errorf("bob sees %d objects, want 0", len(listing.Objects))
	}
}

func TestPutRejectsTraversal(t *testing.T) {
	store := newStore(t, 0)
	err := store.Put(context.Background(), "alice", "vaults/../../../escape.edk", []byte("x"))
	if !errors.Is(err, ErrInvalidName) {
		t.Fatalf("err = %v, want ErrInvalidName", err)
	}

	// And nothing was written outside the root.
	if _, statErr := os.Stat(filepath.Join(store.root, "..", "escape.edk")); statErr == nil {
		t.Error("a file was written outside the data directory")
	}
}

func TestDelete(t *testing.T) {
	store := newStore(t, 0)
	ctx := context.Background()
	objectName := name(stamp(0))

	if err := store.Put(ctx, "alice", objectName, []byte("payload")); err != nil {
		t.Fatalf("Put: %v", err)
	}

	if err := store.Delete(ctx, "alice", objectName); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := store.Get(ctx, "alice", objectName); !errors.Is(err, ErrNotFound) {
		t.Errorf("object survived deletion: %v", err)
	}

	t.Run("is idempotent", func(t *testing.T) {
		// A retried prune must not fail on its own earlier progress.
		if err := store.Delete(ctx, "alice", objectName); err != nil {
			t.Errorf("second Delete failed: %v", err)
		}
	})

	t.Run("frees the quota", func(t *testing.T) {
		used, err := store.Usage(ctx, "alice")
		if err != nil {
			t.Fatalf("Usage: %v", err)
		}
		if used != 0 {
			t.Errorf("usage = %d after deleting everything, want 0", used)
		}
	})

	t.Run("rejects a name outside the permitted layout", func(t *testing.T) {
		if err := store.Delete(ctx, "alice", "../../etc/passwd"); !errors.Is(err, ErrInvalidName) {
			t.Errorf("err = %v, want ErrInvalidName", err)
		}
	})

	t.Run("cannot reach another account's object", func(t *testing.T) {
		if err := store.Put(ctx, "bob", objectName, []byte("bob's")); err != nil {
			t.Fatalf("Put: %v", err)
		}
		if err := store.Delete(ctx, "alice", objectName); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if _, err := store.Get(ctx, "bob", objectName); err != nil {
			t.Errorf("bob's object was removed by alice: %v", err)
		}
	})
}

func TestList(t *testing.T) {
	store := newStore(t, 0)
	ctx := context.Background()
	for i := range 5 {
		if err := store.Put(ctx, "alice", name(stamp(i)), []byte("payload")); err != nil {
			t.Fatalf("Put %d: %v", i, err)
		}
	}

	t.Run("returns objects in ascending name order", func(t *testing.T) {
		listing, err := store.List(ctx, "alice", "vaults/", "", 100)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(listing.Objects) != 5 {
			t.Fatalf("got %d objects, want 5", len(listing.Objects))
		}
		for i := 1; i < len(listing.Objects); i++ {
			if listing.Objects[i-1].Name >= listing.Objects[i].Name {
				t.Fatalf("objects out of order at %d", i)
			}
		}
		if listing.Objects[0].Size != int64(len("payload")) {
			t.Errorf("size = %d, want %d", listing.Objects[0].Size, len("payload"))
		}
	})

	t.Run("pages with a cursor", func(t *testing.T) {
		var seen []string
		cursor := ""
		for range 10 {
			listing, err := store.List(ctx, "alice", "", cursor, 2)
			if err != nil {
				t.Fatalf("List: %v", err)
			}
			for _, object := range listing.Objects {
				seen = append(seen, object.Name)
			}
			if listing.NextCursor == "" {
				break
			}
			cursor = listing.NextCursor
		}
		if len(seen) != 5 {
			t.Errorf("paged through %d objects, want 5", len(seen))
		}
	})

	t.Run("filters by prefix", func(t *testing.T) {
		listing, err := store.List(ctx, "alice", "vaults/other-vault/", "", 100)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(listing.Objects) != 0 {
			t.Errorf("got %d objects for an unrelated prefix, want 0", len(listing.Objects))
		}
	})

	t.Run("an account with nothing stored lists cleanly", func(t *testing.T) {
		listing, err := store.List(ctx, "nobody", "", "", 100)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if listing.Objects == nil {
			t.Error("Objects is nil; want an empty slice so it encodes as []")
		}
	})
}

func TestQuota(t *testing.T) {
	store := newStore(t, 20)
	ctx := context.Background()

	if err := store.Put(ctx, "alice", name(stamp(0)), []byte("0123456789")); err != nil {
		t.Fatalf("first Put: %v", err)
	}
	err := store.Put(ctx, "alice", name(stamp(1)), []byte("0123456789extra"))
	if !errors.Is(err, ErrQuotaExceeded) {
		t.Fatalf("err = %v, want ErrQuotaExceeded", err)
	}

	// The quota is per account, so another account is unaffected.
	if err := store.Put(ctx, "bob", name(stamp(0)), []byte("0123456789")); err != nil {
		t.Errorf("bob's Put failed: %v", err)
	}
}

func TestUsage(t *testing.T) {
	store := newStore(t, 0)
	ctx := context.Background()

	if used, _ := store.Usage(ctx, "alice"); used != 0 {
		t.Errorf("initial usage = %d, want 0", used)
	}
	if err := store.Put(ctx, "alice", name(stamp(0)), []byte("12345")); err != nil {
		t.Fatalf("Put: %v", err)
	}
	used, err := store.Usage(ctx, "alice")
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}
	if used != 5 {
		t.Errorf("usage = %d, want 5", used)
	}
}

func TestConcurrentPutsOfTheSameName(t *testing.T) {
	store := newStore(t, 0)
	ctx := context.Background()
	objectName := name(stamp(0))

	// Two devices racing with different bytes: exactly one must win, and the
	// loser must be told rather than silently overwriting.
	var wg sync.WaitGroup
	results := make([]error, 8)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i] = store.Put(ctx, "alice", objectName, fmt.Appendf(nil, "payload-%d", i))
		}(i)
	}
	wg.Wait()

	var succeeded int
	for _, err := range results {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrAlreadyExists):
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if succeeded != 1 {
		t.Errorf("%d writers succeeded, want exactly 1", succeeded)
	}
}

func TestNoTempFilesSurviveOrAppearInListings(t *testing.T) {
	store := newStore(t, 0)
	ctx := context.Background()
	if err := store.Put(ctx, "alice", name(stamp(0)), []byte("payload")); err != nil {
		t.Fatalf("Put: %v", err)
	}

	listing, err := store.List(ctx, "alice", "", "", 100)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, object := range listing.Objects {
		if strings.Contains(object.Name, ".tmp-") {
			t.Errorf("listing exposed a temporary file: %s", object.Name)
		}
	}
}
