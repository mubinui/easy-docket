# Multi-architecture build for the Easy Docket sync server.
#
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/xiidea/easy-docket-sync:latest --push .
#
# BUILDPLATFORM keeps the compile step on the native architecture and
# cross-compiles to TARGETARCH, which is dramatically faster than emulating the
# toolchain under QEMU.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build

ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev

WORKDIR /src

# The module has no external dependencies, but copying the manifest first still
# gives a cached layer that survives source edits.
COPY go.mod ./
RUN go mod download

COPY . .

RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/docket-sync ./cmd/docket-sync

# Scratch rather than alpine: the binary is static, and a base image with no
# shell and no package manager is a much smaller thing to keep patched.
FROM scratch

COPY --from=build /out/docket-sync /docket-sync

# The data directory is created by the server at startup, but declaring it makes
# the volume obvious and lets the image run read-only apart from this mount.
VOLUME ["/data"]

ENV DOCKET_ADDR=:8080 \
    DOCKET_DATA_DIR=/data \
    DOCKET_TOKENS_FILE=/etc/docket/tokens

EXPOSE 8080

# Unprivileged by default; the numeric id works without /etc/passwd in scratch.
USER 65532:65532

ENTRYPOINT ["/docket-sync"]
CMD ["serve"]
