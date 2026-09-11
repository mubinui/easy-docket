package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// FSStore keeps objects as files under a data directory:
//
//	<root>/<account>/vaults/<vault>/ops/<stamp>.edk
//
// A filesystem is the right default for a self-hosted service: it is trivially
// backed up with rsync, survives the server binary being replaced, and lets an
// operator verify with `ls` that what is stored really is unreadable ciphertext.
type FSStore struct {
	root string
	// Serialises writes per account so two concurrent PUTs of the same name
	// cannot both pass the immutability check. Reads are unaffected.
	mu     sync.Mutex
	locks  map[string]*sync.Mutex
	quota  int64
	usages sync.Map // account -> *int64 cached usage, invalidated on write
}

// NewFSStore prepares a store rooted at dir, creating it if necessary.
// A quota of zero means unlimited.
func NewFSStore(dir string, quota int64) (*FSStore, error) {
	if dir == "" {
		return nil, errors.New("storage: data directory must not be empty")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o700); err != nil {
		return nil, fmt.Errorf("storage: create data dir: %w", err)
	}
	return &FSStore{root: abs, locks: make(map[string]*sync.Mutex), quota: quota}, nil
}

// Put writes data atomically: a temporary file in the destination directory is
// renamed into place, so a crash mid-write can never leave a truncated object
// that a client would later fail to decrypt.
func (s *FSStore) Put(ctx context.Context, account, name string, data []byte) error {
	if err := ValidateName(name); err != nil {
		return err
	}
	path, err := s.path(account, name)
	if err != nil {
		return err
	}

	lock := s.accountLock(account)
	lock.Lock()
	defer lock.Unlock()

	if err := ctx.Err(); err != nil {
		return err
	}

	// Immutability check. Re-uploading identical bytes is a no-op rather than
	// an error, because a client that crashed between writing and recording
	// success must be able to retry safely.
	switch existing, err := os.ReadFile(path); {
	case err == nil:
		if bytes.Equal(existing, data) {
			return nil
		}
		return fmt.Errorf("%w: %s", ErrAlreadyExists, name)
	case !errors.Is(err, fs.ErrNotExist):
		return fmt.Errorf("storage: read existing: %w", err)
	}

	if s.quota > 0 {
		used, err := s.usage(account)
		if err != nil {
			return err
		}
		if used+int64(len(data)) > s.quota {
			return fmt.Errorf("%w: %d bytes used of %d", ErrQuotaExceeded, used, s.quota)
		}
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("storage: create dir: %w", err)
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return fmt.Errorf("storage: create temp: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // No-op once the rename has succeeded.

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("storage: write: %w", err)
	}
	// fsync before rename: without it a power loss can leave a correctly named
	// file with zero content, which is worse than no file at all.
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("storage: sync: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("storage: close: %w", err)
	}
	if err := os.Chmod(tmpName, 0o600); err != nil {
		return fmt.Errorf("storage: chmod: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("storage: rename: %w", err)
	}

	s.usages.Delete(account)
	return nil
}

// Get returns the bytes stored under name.
func (s *FSStore) Get(ctx context.Context, account, name string) ([]byte, error) {
	if err := ValidateName(name); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, err := s.path(account, name)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, name)
	}
	if err != nil {
		return nil, fmt.Errorf("storage: read: %w", err)
	}
	return data, nil
}

// List walks the account's tree and returns one page of metadata. `cursor` is
// the last name from the previous page, which works because names are returned
// in sorted order and objects are immutable.
func (s *FSStore) List(ctx context.Context, account, prefix, cursor string, limit int) (Listing, error) {
	if err := ValidatePrefix(prefix); err != nil {
		return Listing{}, err
	}
	if limit <= 0 {
		limit = 1000
	}
	base, err := s.path(account, "")
	if err != nil {
		return Listing{}, err
	}

	var objects []Object
	walkErr := filepath.WalkDir(base, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			// A missing account directory simply means nothing stored yet.
			if errors.Is(err, fs.ErrNotExist) {
				return fs.SkipAll
			}
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".tmp-") {
			return nil
		}

		rel, relErr := filepath.Rel(base, path)
		if relErr != nil {
			return relErr
		}
		name := filepath.ToSlash(rel)
		if !strings.HasPrefix(name, prefix) || name <= cursor {
			return nil
		}

		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		objects = append(objects, Object{
			Name:       name,
			Size:       info.Size(),
			ModifiedAt: info.ModTime().UnixMilli(),
		})
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, fs.ErrNotExist) {
		return Listing{}, fmt.Errorf("storage: list: %w", walkErr)
	}

	sort.Slice(objects, func(i, j int) bool { return objects[i].Name < objects[j].Name })

	listing := Listing{Objects: objects}
	if len(objects) > limit {
		listing.Objects = objects[:limit]
		listing.NextCursor = objects[limit-1].Name
	}
	if listing.Objects == nil {
		listing.Objects = []Object{}
	}
	return listing, nil
}

// Usage reports total bytes stored for an account.
func (s *FSStore) Usage(ctx context.Context, account string) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	return s.usage(account)
}

func (s *FSStore) usage(account string) (int64, error) {
	if cached, ok := s.usages.Load(account); ok {
		return cached.(int64), nil
	}
	base, err := s.path(account, "")
	if err != nil {
		return 0, err
	}

	var total int64
	err = filepath.WalkDir(base, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return fs.SkipAll
			}
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		total += info.Size()
		return nil
	})
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return 0, fmt.Errorf("storage: usage: %w", err)
	}

	s.usages.Store(account, total)
	return total, nil
}

// path resolves an account-scoped object name to an absolute path and proves
// the result stays inside the account's own directory. ValidateName already
// rejects traversal, but this is the check that actually contains a mistake
// there, so it is done unconditionally.
func (s *FSStore) path(account, name string) (string, error) {
	if account == "" || strings.ContainsAny(account, `/\.`) {
		return "", fmt.Errorf("%w: account", ErrInvalidName)
	}
	accountRoot := filepath.Join(s.root, account)
	full := filepath.Join(accountRoot, filepath.FromSlash(name))

	if full != accountRoot && !strings.HasPrefix(full, accountRoot+string(os.PathSeparator)) {
		return "", fmt.Errorf("%w: escapes account root", ErrInvalidName)
	}
	return full, nil
}

func (s *FSStore) accountLock(account string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	lock, ok := s.locks[account]
	if !ok {
		lock = &sync.Mutex{}
		s.locks[account] = lock
	}
	return lock
}

// ETag returns a strong entity tag for the given bytes, used by the API layer
// so a client can revalidate a cached object cheaply.
func ETag(data []byte) string {
	sum := sha256.Sum256(data)
	return fmt.Sprintf(`"%x"`, sum[:16])
}
