package api

import (
	"net/http"
	"slices"
	"strings"
)

// CORS support.
//
// The client is a browser application, and a self-hosted server on a different
// origin from the app is the normal case rather than the exception: someone
// running the PWA from GitHub Pages and the server on their own NAS is exactly
// who this is for. Without CORS headers the browser refuses those requests and
// the failure surfaces as an opaque network error, so this is a functional
// requirement, not a nicety.
//
// Origins are an explicit allowlist. There is no wildcard default: the server
// holds a user's encrypted ledger, and while an attacker's page could not read
// the plaintext, letting any origin spend the user's bearer token against it
// would be careless.

// corsOptions configures the middleware.
type corsOptions struct {
	// AllowedOrigins is an exact-match allowlist. The single entry "*" permits
	// any origin and is intended for local development only.
	AllowedOrigins []string
}

const corsMaxAge = "86400" // 24h; the policy is static, so re-asking is waste.

func withCORS(opts corsOptions, next http.Handler) http.Handler {
	if len(opts.AllowedOrigins) == 0 {
		// No configuration means same-origin only, which is the safe default
		// for someone serving the app and the API from one host.
		return next
	}
	allowAll := slices.Contains(opts.AllowedOrigins, "*")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := origin != "" && (allowAll || slices.Contains(opts.AllowedOrigins, origin))

		if allowed {
			// Echo the origin rather than "*": the request carries an
			// Authorization header, and "*" is invalid for credentialed use.
			w.Header().Set("Access-Control-Allow-Origin", origin)
			// Caches must not serve one origin's response to another.
			w.Header().Add("Vary", "Origin")
			// ETag is what lets the client skip re-downloading an object it
			// already has; it is not exposed to scripts unless listed here.
			w.Header().Set("Access-Control-Expose-Headers", "ETag")
		}

		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			if !allowed {
				// Refuse the preflight rather than answering it; the browser
				// then blocks the real request.
				w.WriteHeader(http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, If-None-Match")
			w.Header().Set("Access-Control-Max-Age", corsMaxAge)
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// ParseOrigins splits a comma-separated origin list from configuration.
func ParseOrigins(raw string) []string {
	var origins []string
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			origins = append(origins, strings.TrimRight(trimmed, "/"))
		}
	}
	return origins
}
