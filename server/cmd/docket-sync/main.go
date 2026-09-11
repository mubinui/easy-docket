// Command docket-sync is the self-hostable synchronisation server for Easy Docket.
//
// It stores end-to-end encrypted objects on behalf of authenticated accounts
// and can decrypt none of them. Run it behind a TLS-terminating reverse proxy:
//
//	DOCKET_DATA_DIR=/var/lib/docket \
//	DOCKET_TOKENS_FILE=/etc/docket/tokens \
//	docket-sync serve
//
// To provision a client:
//
//	docket-sync token alice
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/xiidea/easy-docket/server/internal/api"
	"github.com/xiidea/easy-docket/server/internal/auth"
	"github.com/xiidea/easy-docket/server/internal/config"
	"github.com/xiidea/easy-docket/server/internal/storage"
)

// version is overridden at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}

	var err error
	switch command {
	case "serve":
		err = serve()
	case "token":
		err = mintToken(os.Args[2:])
	case "version":
		fmt.Println(version)
	case "help", "-h", "--help":
		usage()
	default:
		usage()
		err = fmt.Errorf("unknown command %q", command)
	}

	if err != nil {
		fmt.Fprintln(os.Stderr, "docket-sync:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `docket-sync — Easy Docket synchronisation server

Commands:
  serve            Run the HTTP server (default)
  token <account>  Generate a token and print the line to add to the tokens file
  version          Print the build version

Environment:
  DOCKET_ADDR               Listen address (default :8080)
  DOCKET_DATA_DIR           Directory for encrypted objects (required)
  DOCKET_TOKENS_FILE        Path to the tokens file (required)
  DOCKET_MAX_OBJECT_SIZE    Bytes, per object (default 8388608)
  DOCKET_MAX_ACCOUNT_BYTES  Bytes, per account; 0 means unlimited
  DOCKET_LOG_LEVEL          debug | info | warn | error (default info)
  DOCKET_ALLOWED_ORIGINS    Comma-separated CORS allowlist for browser clients
`)
}

func serve() error {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel(cfg.LogLevel)}))
	slog.SetDefault(logger)

	tokensFile, err := os.Open(cfg.TokensFile)
	if err != nil {
		return fmt.Errorf("open tokens file: %w", err)
	}
	tokens, err := auth.ParseTokens(tokensFile)
	tokensFile.Close()
	if err != nil {
		return fmt.Errorf("parse tokens file: %w", err)
	}

	store, err := storage.NewFSStore(cfg.DataDir, cfg.MaxAccountBytes)
	if err != nil {
		return err
	}

	server := &http.Server{
		Addr: cfg.Addr,
		Handler: api.New(api.Options{
			Store:          store,
			Tokens:         tokens,
			Logger:         logger,
			MaxObjectSize:  cfg.MaxObjectSize,
			Version:        version,
			AllowedOrigins: api.ParseOrigins(cfg.AllowedOrigins),
		}),
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
	}

	// Shut down on SIGINT/SIGTERM, letting in-flight uploads finish so a
	// container restart never leaves a client believing a push failed.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errs := make(chan error, 1)
	go func() {
		logger.Info("listening", "addr", cfg.Addr, "data_dir", cfg.DataDir, "version", version)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- err
		}
	}()

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
		logger.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func mintToken(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: docket-sync token <account>")
	}
	account := args[0]

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Errorf("generate token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)

	// The token itself is printed once and never stored: only its hash goes in
	// the tokens file, so a stolen copy of that file grants nothing.
	fmt.Printf("Token for %s (store it in the app now; it is not recoverable):\n\n  %s\n\n", account, token)
	fmt.Printf("Add this line to the tokens file:\n\n  %s:%s\n", account, auth.HashToken(token))
	return nil
}

func logLevel(name string) slog.Level {
	switch name {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
