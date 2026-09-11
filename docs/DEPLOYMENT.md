# Deployment

## The PWA

### GitHub Pages

`.github/workflows/pages.yml` builds and deploys on every push to `main`.
Enable Pages with "GitHub Actions" as the source, and it needs nothing else.

Two details the workflow handles that are easy to get wrong:

- **Base href.** Pages serves from `/<repo>/`, so the build passes
  `--base-href /<repo>/`. Without it the service worker scope and every asset
  path resolve against `/` and nothing loads.
- **Deep links.** Pages has no rewrite rules, so `/tabs/accounts` would 404.
  Copying `index.html` to `404.html` hands the route back to the router.

### Cloudflare Pages

| Setting | Value |
| --- | --- |
| Build command | `cd app && npm ci && npm run build` |
| Output directory | `app/www` |
| Node version | `22.22.3` |

Add a SPA fallback so deep links work — `app/www/_redirects`:

```
/*  /index.html  200
```

No base-href override is needed; Cloudflare serves from the root.

### Any static host

`npm run build` produces `app/www`. Serve it over **HTTPS** — `crypto.subtle`
is unavailable on an insecure origin, and the app refuses to run without it
rather than silently degrading.

## Android

### Requirements

- Node 22.22.3+
- JDK 21 (Gradle in this toolchain does not accept JDK 25)
- Android SDK with platform 36

### Build

```bash
cd app
npm ci
npm run cap:sync          # ng build + cap sync android
npm run android:open      # or: cd android && ./gradlew assembleDebug
```

The package name is `net.xiidea.docket`, set in `capacitor.config.ts` and
mirrored in `android/app/build.gradle` as both `namespace` and `applicationId`.
It is effectively permanent once published.

### Play Store release

1. Create an upload key:

   ```bash
   keytool -genkey -v -keystore docket-upload.jks -keyalg RSA \
     -keysize 2048 -validity 10000 -alias upload
   ```

   Keep it out of the repository — `.gitignore` already excludes `*.jks` and
   `keystore.properties`.

2. Add `android/keystore.properties`:

   ```properties
   storeFile=/absolute/path/docket-upload.jks
   storePassword=…
   keyAlias=upload
   keyPassword=…
   ```

3. Reference it from `android/app/build.gradle` in a `signingConfigs` block and
   attach it to `buildTypes.release`.

4. Bump `versionCode` and `versionName`, then:

   ```bash
   npm run android:bundle    # android/app/build/outputs/bundle/release/app-release.aab
   ```

5. Upload the `.aab`. The listing needs a privacy policy URL; the honest
   summary is that the app collects nothing and transmits only ciphertext to a
   destination the user configures.

## The sync server

### Docker

```bash
docker run -d --name docket-sync \
  -p 8080:8080 \
  -v /srv/docket/data:/data \
  -v /srv/docket/tokens:/etc/docket/tokens:ro \
  ghcr.io/xiidea/easy-docket-sync:latest
```

The image is `scratch` with a static binary — no shell, no package manager —
and runs as uid 65532.

Build it yourself for both architectures:

```bash
cd server
make docker PLATFORMS=linux/amd64,linux/arm64
```

### Binaries

`make dist` cross-compiles for linux (amd64/arm64/arm), macOS (amd64/arm64) and
Windows (amd64), with a `SHA256SUMS` file. The release workflow attaches them
to every tagged release.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOCKET_ADDR` | `:8080` | Listen address |
| `DOCKET_DATA_DIR` | — | **Required.** Where objects are written |
| `DOCKET_TOKENS_FILE` | — | **Required.** Token file |
| `DOCKET_MAX_OBJECT_SIZE` | `8388608` | Per-object cap in bytes |
| `DOCKET_MAX_ACCOUNT_BYTES` | `0` | Per-account quota; 0 is unlimited |
| `DOCKET_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `DOCKET_ALLOWED_ORIGINS` | *(none)* | Comma-separated CORS allowlist for browser clients |

### Storage over time

A vault writes one object per sync and, every few hundred operations, a snapshot
summarising everything before it. Once a snapshot is written the objects it
covers are deleted, so storage tracks the size of the ledger rather than the
number of times it has been synced. Backups of the data directory can therefore
be taken on an ordinary schedule without growing without bound.

### Browser clients and CORS

If the PWA is served from a different origin than the server — the usual case,
with the app on Pages and the server on your own machine — the browser will
refuse every request unless the server says that origin is welcome:

```bash
DOCKET_ALLOWED_ORIGINS=https://you.github.io,http://localhost:4200
```

The list is exact-match. There is no wildcard by default: an attacker's page
could not read your ciphertext, but it could spend your bearer token, so the
allowlist stays explicit. `*` is accepted for local development, and even then
the response echoes the requesting origin rather than `*`, because the requests
are credentialed.

Leaving it unset means same-origin only, which is correct when a single reverse
proxy serves both the app and the API.

### Provisioning a user

```bash
docket-sync token alice
```

Prints the token once — store it in the app immediately — and the
`alice:<sha256>` line to append to the tokens file. Only the hash is stored, so
a stolen tokens file grants nothing.

### Behind a reverse proxy

The server speaks plain HTTP and expects TLS termination in front of it. Caddy:

```
docket.example.com {
    reverse_proxy localhost:8080
}
```

Nginx needs `client_max_body_size` at or above `DOCKET_MAX_OBJECT_SIZE`, or
large pushes fail with a 413 that did not come from the app.

### Backups

The data directory is plain files. `rsync` it, or snapshot the volume. The
contents are ciphertext, so a backup destination needs no special trust — which
is the point.

## Pointing the app at a destination

In the app: **Settings → Sync → Destination**, then "Test connection" before
saving. The probe authenticates without writing, so a typo is caught there
rather than as a silent background failure later.

For Git in the browser, a CORS proxy is required — most Git hosts send no CORS
headers. The Android app does not need one. The proxy only ever relays
encrypted data, but it does see the repository URL and token, so run your own
if that matters.
