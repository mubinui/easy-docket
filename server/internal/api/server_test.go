package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xiidea/easy-docket/server/internal/auth"
	"github.com/xiidea/easy-docket/server/internal/storage"
)

const (
	aliceToken = "alice-token-value"
	bobToken   = "bob-token-value"
	vaultID    = "8f2a1c64-0a9a-4a4d-9c2a-3b7f1e5d6c90"
)

func objectName(n int) string {
	return fmt.Sprintf("vaults/%s/ops/%019d-0000-aaaaaaaa.edk", vaultID, 1700000000000+n)
}

func newServer(t *testing.T) *Server {
	t.Helper()

	tokens, err := auth.ParseTokens(strings.NewReader(
		"alice:" + auth.HashToken(aliceToken) + "\nbob:" + auth.HashToken(bobToken),
	))
	if err != nil {
		t.Fatalf("ParseTokens: %v", err)
	}
	store, err := storage.NewFSStore(t.TempDir(), 0)
	if err != nil {
		t.Fatalf("NewFSStore: %v", err)
	}

	return New(Options{
		Store:         store,
		Tokens:        tokens,
		Logger:        slog.New(slog.DiscardHandler),
		MaxObjectSize: 1024,
		Version:       "test",
	})
}

func do(t *testing.T, s *Server, method, path, token string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	r := httptest.NewRequest(method, path, reader)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func TestHealthNeedsNoToken(t *testing.T) {
	w := do(t, newServer(t), http.MethodGet, "/v1/health", "", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" || body["version"] != "test" {
		t.Errorf("body = %v", body)
	}
}

func TestAuthenticationIsRequired(t *testing.T) {
	s := newServer(t)
	cases := []struct{ method, path string }{
		{http.MethodGet, "/v1/objects"},
		{http.MethodGet, "/v1/objects/" + objectName(0)},
		{http.MethodPut, "/v1/objects/" + objectName(0)},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			for _, token := range []string{"", "not-a-real-token"} {
				w := do(t, s, tc.method, tc.path, token, []byte("x"))
				if w.Code != http.StatusUnauthorized {
					t.Errorf("token %q: status = %d, want 401", token, w.Code)
				}
				if got := w.Header().Get("WWW-Authenticate"); !strings.HasPrefix(got, "Bearer") {
					t.Errorf("WWW-Authenticate = %q", got)
				}
			}
		})
	}
}

func TestPutThenGetRoundTrip(t *testing.T) {
	s := newServer(t)
	payload := []byte{0x45, 0x44, 0x43, 0x4b, 0x01, 0x01, 0xde, 0xad}

	w := do(t, s, http.MethodPut, "/v1/objects/"+objectName(0), aliceToken, payload)
	if w.Code != http.StatusCreated {
		t.Fatalf("PUT status = %d, want 201: %s", w.Code, w.Body)
	}
	etag := w.Header().Get("ETag")
	if etag == "" {
		t.Error("PUT returned no ETag")
	}

	w = do(t, s, http.MethodGet, "/v1/objects/"+objectName(0), aliceToken, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200", w.Code)
	}
	if !bytes.Equal(w.Body.Bytes(), payload) {
		t.Errorf("body = %x, want %x", w.Body.Bytes(), payload)
	}
	if got := w.Header().Get("Content-Type"); got != "application/octet-stream" {
		t.Errorf("Content-Type = %q", got)
	}
	if w.Header().Get("ETag") != etag {
		t.Error("ETag changed between PUT and GET")
	}
}

func TestConditionalGet(t *testing.T) {
	s := newServer(t)
	do(t, s, http.MethodPut, "/v1/objects/"+objectName(0), aliceToken, []byte("payload"))

	w := do(t, s, http.MethodGet, "/v1/objects/"+objectName(0), aliceToken, nil)
	etag := w.Header().Get("ETag")

	r := httptest.NewRequest(http.MethodGet, "/v1/objects/"+objectName(0), nil)
	r.Header.Set("Authorization", "Bearer "+aliceToken)
	r.Header.Set("If-None-Match", etag)
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)

	if w.Code != http.StatusNotModified {
		t.Errorf("status = %d, want 304", w.Code)
	}
	if w.Body.Len() != 0 {
		t.Errorf("304 carried a body of %d bytes", w.Body.Len())
	}
}

func TestGetMissingObject(t *testing.T) {
	w := do(t, newServer(t), http.MethodGet, "/v1/objects/"+objectName(7), aliceToken, nil)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

func TestOneAccountCannotReadAnother(t *testing.T) {
	s := newServer(t)
	do(t, s, http.MethodPut, "/v1/objects/"+objectName(0), aliceToken, []byte("alice's ciphertext"))

	w := do(t, s, http.MethodGet, "/v1/objects/"+objectName(0), bobToken, nil)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}

	w = do(t, s, http.MethodGet, "/v1/objects?prefix=vaults/", bobToken, nil)
	var listing storage.Listing
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(listing.Objects) != 0 {
		t.Errorf("bob listed %d of alice's objects", len(listing.Objects))
	}
}

func TestImmutability(t *testing.T) {
	s := newServer(t)
	path := "/v1/objects/" + objectName(0)
	do(t, s, http.MethodPut, path, aliceToken, []byte("original"))

	t.Run("identical bytes are accepted", func(t *testing.T) {
		if w := do(t, s, http.MethodPut, path, aliceToken, []byte("original")); w.Code != http.StatusCreated {
			t.Errorf("status = %d, want 201", w.Code)
		}
	})

	t.Run("different bytes conflict", func(t *testing.T) {
		if w := do(t, s, http.MethodPut, path, aliceToken, []byte("replaced")); w.Code != http.StatusConflict {
			t.Errorf("status = %d, want 409", w.Code)
		}
	})
}

func TestPutRejectsBadInput(t *testing.T) {
	s := newServer(t)

	t.Run("name outside the permitted layout", func(t *testing.T) {
		w := do(t, s, http.MethodPut, "/v1/objects/etc/passwd", aliceToken, []byte("x"))
		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", w.Code)
		}
	})

	t.Run("empty body", func(t *testing.T) {
		w := do(t, s, http.MethodPut, "/v1/objects/"+objectName(0), aliceToken, []byte{})
		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", w.Code)
		}
	})

	t.Run("body over the size limit", func(t *testing.T) {
		w := do(t, s, http.MethodPut, "/v1/objects/"+objectName(0), aliceToken, bytes.Repeat([]byte("x"), 2048))
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("status = %d, want 413", w.Code)
		}
	})
}

func TestListing(t *testing.T) {
	s := newServer(t)
	for i := range 3 {
		do(t, s, http.MethodPut, "/v1/objects/"+objectName(i), aliceToken, []byte("payload"))
	}

	t.Run("returns what was stored", func(t *testing.T) {
		w := do(t, s, http.MethodGet, "/v1/objects?prefix=vaults/"+vaultID+"/ops/", aliceToken, nil)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", w.Code)
		}
		var listing storage.Listing
		if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if len(listing.Objects) != 3 {
			t.Errorf("got %d objects, want 3", len(listing.Objects))
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Error("listings must not be cached")
		}
	})

	t.Run("pages", func(t *testing.T) {
		w := do(t, s, http.MethodGet, "/v1/objects?limit=2", aliceToken, nil)
		var listing storage.Listing
		json.Unmarshal(w.Body.Bytes(), &listing)
		if len(listing.Objects) != 2 || listing.NextCursor == "" {
			t.Errorf("objects = %d, cursor = %q", len(listing.Objects), listing.NextCursor)
		}
	})

	t.Run("rejects a nonsense limit", func(t *testing.T) {
		if w := do(t, s, http.MethodGet, "/v1/objects?limit=zero", aliceToken, nil); w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", w.Code)
		}
	})

	t.Run("rejects a traversal prefix", func(t *testing.T) {
		if w := do(t, s, http.MethodGet, "/v1/objects?prefix=../../", aliceToken, nil); w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want 400", w.Code)
		}
	})
}

func TestSecurityHeaders(t *testing.T) {
	w := do(t, newServer(t), http.MethodGet, "/v1/health", "", nil)

	want := map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"Referrer-Policy":         "no-referrer",
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
	}
	for header, value := range want {
		if got := w.Header().Get(header); got != value {
			t.Errorf("%s = %q, want %q", header, got, value)
		}
	}
}

// The server must be able to store and return arbitrary ciphertext, including
// bytes that are not valid UTF-8 and would break a text-oriented pipeline.
func TestBinarySafety(t *testing.T) {
	s := newServer(t)
	payload := make([]byte, 256)
	for i := range payload {
		payload[i] = byte(i)
	}

	do(t, s, http.MethodPut, "/v1/objects/"+objectName(0), aliceToken, payload)
	w := do(t, s, http.MethodGet, "/v1/objects/"+objectName(0), aliceToken, nil)

	if !bytes.Equal(w.Body.Bytes(), payload) {
		t.Error("binary payload did not survive the round trip")
	}
}
