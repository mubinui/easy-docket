# Build and release helpers for the Easy Docket sync server.

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
IMAGE   ?= ghcr.io/xiidea/easy-docket-sync
PLATFORMS ?= linux/amd64,linux/arm64

# Targets shipped as prebuilt binaries.
DIST_TARGETS := \
	linux/amd64 linux/arm64 linux/arm \
	darwin/amd64 darwin/arm64 \
	windows/amd64

.PHONY: all build test lint cover run docker dist clean

all: test build

build:
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o bin/docket-sync ./cmd/docket-sync

test:
	go test -race -count=1 ./...

cover:
	go test -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out | tail -1

lint:
	gofmt -l . | tee /dev/stderr | (! read)
	go vet ./...

run: build
	DOCKET_DATA_DIR=$(PWD)/.data DOCKET_TOKENS_FILE=$(PWD)/.tokens ./bin/docket-sync serve

docker:
	docker buildx build --platform $(PLATFORMS) \
		--build-arg VERSION=$(VERSION) \
		-t $(IMAGE):$(VERSION) -t $(IMAGE):latest .

# Cross-compiled binaries for every supported platform.
dist:
	@mkdir -p dist
	@for target in $(DIST_TARGETS); do \
		os=$${target%/*}; arch=$${target#*/}; \
		ext=""; [ "$$os" = "windows" ] && ext=".exe"; \
		echo "building $$os/$$arch"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch \
			go build -trimpath -ldflags "$(LDFLAGS)" \
			-o dist/docket-sync-$$os-$$arch$$ext ./cmd/docket-sync || exit 1; \
	done
	@cd dist && shasum -a 256 docket-sync-* > SHA256SUMS

clean:
	rm -rf bin dist coverage.out .data
