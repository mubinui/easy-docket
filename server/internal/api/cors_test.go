package api

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xiidea/easy-docket/server/internal/auth"
	"github.com/xiidea/easy-docket/server/internal/storage"
)

func newCORSServer(t *testing.T, origins ...string) *Server {
	t.Helper()
	tokens, err := auth.ParseTokens(strings.NewReader("alice:" + auth.HashToken(aliceToken)))
	if err != nil {
		t.Fatalf("ParseTokens: %v", err)
	}
	store, err := storage.NewFSStore(t.TempDir(), 0)
	if err != nil {
		t.Fatalf("NewFSStore: %v", err)
	}
	return New(Options{
		Store:          store,
		Tokens:         tokens,
		Logger:         slog.New(slog.DiscardHandler),
		MaxObjectSize:  1024,
		AllowedOrigins: origins,
	})
}

func request(s *Server, method, path, origin string, preflight bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if preflight {
		r.Header.Set("Access-Control-Request-Method", "PUT")
	}
	r.Header.Set("Authorization", "Bearer "+aliceToken)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}

func TestCORSDisabledByDefault(t *testing.T) {
	// With no allowlist the server is same-origin only, which is the right
	// default when the app and API are served from one host.
	w := request(newCORSServer(t), http.MethodGet, "/v1/health", "https://app.example.com", false)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Access-Control-Allow-Origin = %q, want empty", got)
	}
}

func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	s := newCORSServer(t, "https://app.example.com")
	w := request(s, http.MethodGet, "/v1/health", "https://app.example.com", false)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "https://app.example.com" {
		t.Errorf("Access-Control-Allow-Origin = %q", got)
	}
	// Echoing the origin means caches must vary on it.
	if !strings.Contains(w.Header().Get("Vary"), "Origin") {
		t.Errorf("Vary = %q, want it to include Origin", w.Header().Get("Vary"))
	}
	// Without this the client cannot read ETag and would re-download every object.
	if got := w.Header().Get("Access-Control-Expose-Headers"); !strings.Contains(got, "ETag") {
		t.Errorf("Access-Control-Expose-Headers = %q", got)
	}
}

func TestCORSRejectsUnknownOrigin(t *testing.T) {
	s := newCORSServer(t, "https://app.example.com")
	w := request(s, http.MethodGet, "/v1/health", "https://evil.example.com", false)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Access-Control-Allow-Origin = %q, want empty", got)
	}
}

func TestCORSPreflight(t *testing.T) {
	s := newCORSServer(t, "https://app.example.com")

	t.Run("allowed origin", func(t *testing.T) {
		w := request(s, http.MethodOptions, "/v1/objects/"+objectName(0), "https://app.example.com", true)

		if w.Code != http.StatusNoContent {
			t.Fatalf("status = %d, want 204", w.Code)
		}
		for _, method := range []string{"GET", "PUT", "DELETE"} {
			if got := w.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, method) {
				t.Errorf("Allow-Methods missing %s: %q", method, got)
			}
		}
		for _, header := range []string{"Authorization", "Content-Type", "If-None-Match"} {
			if !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), header) {
				t.Errorf("Allow-Headers missing %s: %q", header, w.Header().Get("Access-Control-Allow-Headers"))
			}
		}
	})

	t.Run("unknown origin is refused", func(t *testing.T) {
		w := request(s, http.MethodOptions, "/v1/objects/"+objectName(0), "https://evil.example.com", true)
		if w.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", w.Code)
		}
	})
}

func TestCORSWildcardForDevelopment(t *testing.T) {
	s := newCORSServer(t, "*")
	w := request(s, http.MethodGet, "/v1/health", "http://localhost:4200", false)

	// The origin is echoed, never literally "*", because requests are credentialed.
	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:4200" {
		t.Errorf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestParseOrigins(t *testing.T) {
	got := ParseOrigins(" https://a.example.com/, https://b.example.com ,, ")
	want := []string{"https://a.example.com", "https://b.example.com"}

	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("origin %d = %q, want %q", i, got[i], want[i])
		}
	}
	if ParseOrigins("") != nil {
		t.Error("empty configuration should produce no origins")
	}
}
