// Package config loads the sync server's settings from the environment.
//
// The server is meant to be run by individuals on a NAS or a small VPS, so
// configuration is deliberately flat, documented in one place, and validated
// loudly at startup rather than failing on the first request.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config is the fully validated runtime configuration.
type Config struct {
	// Addr is the listen address, e.g. ":8080".
	Addr string
	// DataDir is where encrypted objects are written.
	DataDir string
	// TokensFile lists the tokens permitted to use the server.
	TokensFile string
	// MaxObjectSize caps a single uploaded object.
	MaxObjectSize int64
	// MaxAccountBytes caps total storage per account; zero means unlimited.
	MaxAccountBytes int64
	// ReadTimeout and WriteTimeout guard against slow-loris clients.
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	// ShutdownGrace is how long in-flight requests get to finish.
	ShutdownGrace time.Duration
	// LogLevel is one of debug, info, warn, error.
	LogLevel string
	// AllowedOrigins is the comma-separated CORS allowlist. Empty means
	// same-origin only.
	AllowedOrigins string
}

// Defaults chosen to be safe on a Raspberry Pi with a slow disk.
const (
	DefaultAddr          = ":8080"
	DefaultMaxObjectSize = 8 << 20 // 8 MiB; an operation batch is normally a few KiB.
	DefaultReadTimeout   = 30 * time.Second
	DefaultWriteTimeout  = 60 * time.Second
	DefaultShutdownGrace = 15 * time.Second
)

// ErrMissingDataDir is returned when no storage location was configured.
var ErrMissingDataDir = errors.New("DOCKET_DATA_DIR must be set")

// Load reads configuration from the given lookup function, which is
// os.LookupEnv in production and a map in tests.
func Load(lookup func(string) (string, bool)) (Config, error) {
	cfg := Config{
		Addr:           stringOr(lookup, "DOCKET_ADDR", DefaultAddr),
		DataDir:        stringOr(lookup, "DOCKET_DATA_DIR", ""),
		TokensFile:     stringOr(lookup, "DOCKET_TOKENS_FILE", ""),
		MaxObjectSize:  DefaultMaxObjectSize,
		ReadTimeout:    DefaultReadTimeout,
		WriteTimeout:   DefaultWriteTimeout,
		ShutdownGrace:  DefaultShutdownGrace,
		LogLevel:       stringOr(lookup, "DOCKET_LOG_LEVEL", "info"),
		AllowedOrigins: stringOr(lookup, "DOCKET_ALLOWED_ORIGINS", ""),
	}

	var err error
	if cfg.MaxObjectSize, err = bytesOr(lookup, "DOCKET_MAX_OBJECT_SIZE", DefaultMaxObjectSize); err != nil {
		return Config{}, err
	}
	if cfg.MaxAccountBytes, err = bytesOr(lookup, "DOCKET_MAX_ACCOUNT_BYTES", 0); err != nil {
		return Config{}, err
	}

	if cfg.DataDir == "" {
		return Config{}, ErrMissingDataDir
	}
	if cfg.TokensFile == "" {
		return Config{}, errors.New("DOCKET_TOKENS_FILE must be set")
	}
	if cfg.MaxObjectSize <= 0 {
		return Config{}, errors.New("DOCKET_MAX_OBJECT_SIZE must be positive")
	}
	return cfg, nil
}

// LoadFromEnv is the production entry point.
func LoadFromEnv() (Config, error) { return Load(os.LookupEnv) }

func stringOr(lookup func(string) (string, bool), key, fallback string) string {
	if v, ok := lookup(key); ok && v != "" {
		return v
	}
	return fallback
}

func bytesOr(lookup func(string) (string, bool), key string, fallback int64) (int64, error) {
	v, ok := lookup(key)
	if !ok || v == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}
