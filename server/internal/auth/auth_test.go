package auth

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

func registryWith(t *testing.T, lines string) *Registry {
	t.Helper()
	registry, err := ParseTokens(strings.NewReader(lines))
	if err != nil {
		t.Fatalf("ParseTokens: %v", err)
	}
	return registry
}

func TestParseTokens(t *testing.T) {
	t.Run("accepts comments and blank lines", func(t *testing.T) {
		registry := registryWith(t, "# a comment\n\nalice:"+HashToken("secret")+"\n")

		account, err := registry.Lookup("secret")
		if err != nil {
			t.Fatalf("Lookup: %v", err)
		}
		if account.ID != "alice" {
			t.Errorf("account = %q, want alice", account.ID)
		}
	})

	t.Run("rejects a file with no usable entries", func(t *testing.T) {
		if _, err := ParseTokens(strings.NewReader("# nothing here\n")); !errors.Is(err, ErrNoTokens) {
			t.Errorf("err = %v, want ErrNoTokens", err)
		}
	})

	t.Run("rejects malformed input", func(t *testing.T) {
		cases := map[string]string{
			"missing separator": "alice " + HashToken("x"),
			"short hash":        "alice:abcdef",
			"non-hex hash":      "alice:" + strings.Repeat("z", 64),
			"empty account":     ":" + HashToken("x"),
			"path in account":   "../alice:" + HashToken("x"),
			"duplicate hash":    "alice:" + HashToken("x") + "\nbob:" + HashToken("x"),
		}
		for name, input := range cases {
			t.Run(name, func(t *testing.T) {
				if _, err := ParseTokens(strings.NewReader(input)); err == nil {
					t.Error("expected an error, got nil")
				}
			})
		}
	})

	t.Run("keeps accounts apart", func(t *testing.T) {
		registry := registryWith(t,
			"alice:"+HashToken("alice-token")+"\nbob:"+HashToken("bob-token"))

		alice, err := registry.Lookup("alice-token")
		if err != nil {
			t.Fatalf("Lookup(alice): %v", err)
		}
		bob, err := registry.Lookup("bob-token")
		if err != nil {
			t.Fatalf("Lookup(bob): %v", err)
		}
		if alice.ID == bob.ID {
			t.Fatalf("both tokens resolved to %q", alice.ID)
		}
	})
}

func TestLookupRejectsUnknownTokens(t *testing.T) {
	registry := registryWith(t, "alice:"+HashToken("secret"))

	for _, token := range []string{"", "wrong", "secre", "secret ", "SECRET"} {
		if _, err := registry.Lookup(token); !errors.Is(err, ErrUnauthorized) {
			t.Errorf("Lookup(%q) = %v, want ErrUnauthorized", token, err)
		}
	}
}

func TestBearerToken(t *testing.T) {
	cases := map[string]struct {
		header string
		want   string
	}{
		"standard":         {"Bearer abc123", "abc123"},
		"lowercase scheme": {"bearer abc123", "abc123"},
		"padded":           {"Bearer   abc123  ", "abc123"},
		"absent":           {"", ""},
		"wrong scheme":     {"Basic abc123", ""},
		"scheme only":      {"Bearer", ""},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			r, _ := http.NewRequest(http.MethodGet, "/", nil)
			if tc.header != "" {
				r.Header.Set("Authorization", tc.header)
			}
			if got := BearerToken(r); got != tc.want {
				t.Errorf("BearerToken() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestHashTokenIsStable(t *testing.T) {
	if HashToken("abc") != HashToken("abc") {
		t.Error("HashToken is not deterministic")
	}
	if HashToken("abc") == HashToken("abd") {
		t.Error("HashToken collided on different inputs")
	}
	if len(HashToken("abc")) != 64 {
		t.Errorf("hash length = %d, want 64", len(HashToken("abc")))
	}
}
