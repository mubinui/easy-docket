// Package api exposes the sync protocol over HTTP.
//
// The protocol is four endpoints and no cleverness:
//
//	GET  /v1/health                  liveness, unauthenticated
//	GET  /v1/objects?prefix=&cursor= list object metadata
//	GET  /v1/objects/{name...}       download one encrypted object
//	PUT  /v1/objects/{name...}       upload one encrypted object
//
// Every object is opaque ciphertext produced on the client. The server never
// sees a key, never decrypts, and stores no index of what the objects contain.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/xiidea/easy-docket/server/internal/auth"
	"github.com/xiidea/easy-docket/server/internal/storage"
)

// Options configures a Server.
type Options struct {
	Store         storage.Store
	Tokens        *auth.Registry
	Logger        *slog.Logger
	MaxObjectSize int64
	// Version is reported by /v1/health so an operator can confirm a rollout.
	Version string
	// AllowedOrigins permits browser clients served from another origin.
	// Empty means same-origin only. See cors.go.
	AllowedOrigins []string
}

// Server wires the routes and middleware.
type Server struct {
	opts    Options
	handler http.Handler
}

// New builds a Server with its routes and middleware in place.
func New(opts Options) *Server {
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	if opts.MaxObjectSize <= 0 {
		opts.MaxObjectSize = 8 << 20
	}

	s := &Server{opts: opts}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", s.handleHealth)
	// Preflights are answered by the CORS middleware, but the pattern has to
	// exist or the mux returns 405 before the middleware's check is reached.
	mux.HandleFunc("OPTIONS /", func(http.ResponseWriter, *http.Request) {})
	mux.Handle("GET /v1/objects", s.authenticated(s.handleList))
	mux.Handle("GET /v1/objects/{name...}", s.authenticated(s.handleGet))
	mux.Handle("PUT /v1/objects/{name...}", s.authenticated(s.handlePut))

	s.handler = recoverPanics(
		opts.Logger,
		withCORS(
			corsOptions{AllowedOrigins: opts.AllowedOrigins},
			securityHeaders(logRequests(opts.Logger, mux)),
		),
	)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"version": s.opts.Version,
	})
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request, account auth.Account) {
	prefix := r.URL.Query().Get("prefix")
	cursor := r.URL.Query().Get("cursor")

	limit := 1000
	if raw := r.URL.Query().Get("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = min(parsed, 1000)
	}

	listing, err := s.opts.Store.List(r.Context(), account.ID, prefix, cursor, limit)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}
	// A listing changes whenever another device syncs; caching it would show
	// stale history after a push from elsewhere.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, listing)
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request, account auth.Account) {
	name := r.PathValue("name")

	data, err := s.opts.Store.Get(r.Context(), account.ID, name)
	if err != nil {
		s.writeStoreError(w, r, err)
		return
	}

	etag := storage.ETag(data)
	w.Header().Set("ETag", etag)
	// Objects are immutable once written, so a client that already has one
	// never needs to download it again.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	if _, err := w.Write(data); err != nil {
		s.opts.Logger.WarnContext(r.Context(), "write response", "error", err)
	}
}

func (s *Server) handlePut(w http.ResponseWriter, r *http.Request, account auth.Account) {
	name := r.PathValue("name")

	// Read one byte past the limit so an oversized body is rejected outright
	// rather than silently truncated into an object that will not decrypt.
	body := http.MaxBytesReader(w, r.Body, s.opts.MaxObjectSize+1)
	defer body.Close()

	data, err := io.ReadAll(body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "object exceeds the server's size limit")
			return
		}
		writeError(w, http.StatusBadRequest, "could not read request body")
		return
	}
	if int64(len(data)) > s.opts.MaxObjectSize {
		writeError(w, http.StatusRequestEntityTooLarge, "object exceeds the server's size limit")
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "object must not be empty")
		return
	}

	if err := s.opts.Store.Put(r.Context(), account.ID, name, data); err != nil {
		s.writeStoreError(w, r, err)
		return
	}

	w.Header().Set("ETag", storage.ETag(data))
	writeJSON(w, http.StatusCreated, map[string]any{"name": name, "size": len(data)})
}

// writeStoreError maps storage failures onto status codes, and keeps anything
// unexpected out of the response body.
func (s *Server) writeStoreError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, storage.ErrNotFound):
		writeError(w, http.StatusNotFound, "object not found")
	case errors.Is(err, storage.ErrInvalidName):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, storage.ErrAlreadyExists):
		// The client names objects after the clock stamp of their contents, so
		// this means two devices produced different bytes for the same stamp.
		writeError(w, http.StatusConflict, "an object with different contents already exists under that name")
	case errors.Is(err, storage.ErrQuotaExceeded):
		writeError(w, http.StatusInsufficientStorage, "storage quota exceeded")
	case errors.Is(err, r.Context().Err()) && r.Context().Err() != nil:
		// Client hung up; nothing useful to send.
	default:
		s.opts.Logger.ErrorContext(r.Context(), "storage failure", "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

// accountHandler is a handler that has already been given an authenticated account.
type accountHandler func(http.ResponseWriter, *http.Request, auth.Account)

func (s *Server) authenticated(next accountHandler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		account, err := s.opts.Tokens.Lookup(auth.BearerToken(r))
		if err != nil {
			// WWW-Authenticate tells a well-behaved client this is an auth
			// problem rather than a routing one, without naming the account.
			w.Header().Set("WWW-Authenticate", `Bearer realm="easy-docket"`)
			writeError(w, http.StatusUnauthorized, "invalid or missing bearer token")
			return
		}
		next(w, r, account)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		// The API serves bytes to a native app and a PWA, never a document; a
		// restrictive CSP costs nothing and blocks the surprising cases.
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}

func logRequests(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)

		// Object names are logged because they contain only a random vault id
		// and a clock stamp. Tokens and bodies are never logged.
		logger.InfoContext(r.Context(), "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"bytes", recorder.written,
			"duration_ms", time.Since(started).Milliseconds(),
		)
	})
}

func recoverPanics(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.ErrorContext(r.Context(), "panic serving request",
					"error", recovered, "path", r.URL.Path)
				writeError(w, http.StatusInternalServerError, "internal error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status  int
	written int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.written += n
	return n, err
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
