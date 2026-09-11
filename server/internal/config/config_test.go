package config

import (
	"errors"
	"testing"
	"time"
)

func env(pairs map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		value, ok := pairs[key]
		return value, ok
	}
}

func minimal() map[string]string {
	return map[string]string{
		"DOCKET_DATA_DIR":    "/var/lib/docket",
		"DOCKET_TOKENS_FILE": "/etc/docket/tokens",
	}
}

func TestLoadAppliesDefaults(t *testing.T) {
	cfg, err := Load(env(minimal()))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.Addr != DefaultAddr {
		t.Errorf("Addr = %q, want %q", cfg.Addr, DefaultAddr)
	}
	if cfg.MaxObjectSize != DefaultMaxObjectSize {
		t.Errorf("MaxObjectSize = %d, want %d", cfg.MaxObjectSize, DefaultMaxObjectSize)
	}
	if cfg.MaxAccountBytes != 0 {
		t.Errorf("MaxAccountBytes = %d, want 0 (unlimited)", cfg.MaxAccountBytes)
	}
	if cfg.ShutdownGrace != 15*time.Second {
		t.Errorf("ShutdownGrace = %v", cfg.ShutdownGrace)
	}
}

func TestLoadOverrides(t *testing.T) {
	vars := minimal()
	vars["DOCKET_ADDR"] = "127.0.0.1:9000"
	vars["DOCKET_MAX_OBJECT_SIZE"] = "2048"
	vars["DOCKET_MAX_ACCOUNT_BYTES"] = "1048576"
	vars["DOCKET_LOG_LEVEL"] = "debug"

	cfg, err := Load(env(vars))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != "127.0.0.1:9000" || cfg.MaxObjectSize != 2048 ||
		cfg.MaxAccountBytes != 1048576 || cfg.LogLevel != "debug" {
		t.Errorf("overrides not applied: %+v", cfg)
	}
}

func TestLoadRejectsIncompleteConfiguration(t *testing.T) {
	t.Run("missing data dir", func(t *testing.T) {
		vars := minimal()
		delete(vars, "DOCKET_DATA_DIR")
		if _, err := Load(env(vars)); !errors.Is(err, ErrMissingDataDir) {
			t.Errorf("err = %v, want ErrMissingDataDir", err)
		}
	})

	t.Run("missing tokens file", func(t *testing.T) {
		vars := minimal()
		delete(vars, "DOCKET_TOKENS_FILE")
		if _, err := Load(env(vars)); err == nil {
			t.Error("expected an error, got nil")
		}
	})

	t.Run("unparsable size", func(t *testing.T) {
		vars := minimal()
		vars["DOCKET_MAX_OBJECT_SIZE"] = "eight megabytes"
		if _, err := Load(env(vars)); err == nil {
			t.Error("expected an error, got nil")
		}
	})

	t.Run("non-positive size", func(t *testing.T) {
		vars := minimal()
		vars["DOCKET_MAX_OBJECT_SIZE"] = "0"
		if _, err := Load(env(vars)); err == nil {
			t.Error("expected an error, got nil")
		}
	})
}

// An empty string must be treated as "unset" so that `DOCKET_ADDR=` in a
// compose file does not produce a server listening on nothing.
func TestEmptyValuesFallBackToDefaults(t *testing.T) {
	vars := minimal()
	vars["DOCKET_ADDR"] = ""
	cfg, err := Load(env(vars))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Addr != DefaultAddr {
		t.Errorf("Addr = %q, want %q", cfg.Addr, DefaultAddr)
	}
}
