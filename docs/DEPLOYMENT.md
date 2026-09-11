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

Releases are automated: tagging `v1.4.0` builds a signed bundle and sends it to
the internal track. Setting that up is a one-off, and the order matters.

#### 1. Create an upload key

```bash
keytool -genkeypair -v -keystore docket-upload.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias upload
```

Back this up somewhere you will still have in five years. With Play App Signing
a lost upload key can be reset by Google, but a lost *release* history cannot be
reconstructed, and losing the key on an app not enrolled in Play App Signing
means never updating it again.

`.gitignore` already excludes `*.jks` and `keystore.properties`.

#### 2. Build and upload the first release by hand

The API cannot create an app, only add releases to one that exists. So the first
bundle goes up through the Play Console, which is also where you complete the
store listing, content rating and data-safety form.

```bash
cd app
DOCKET_KEYSTORE_FILE=$PWD/../docket-upload.jks \
DOCKET_KEYSTORE_PASSWORD=… DOCKET_KEY_ALIAS=upload DOCKET_KEY_PASSWORD=… \
DOCKET_VERSION_CODE=1 DOCKET_VERSION_NAME=1.0.0 \
npm run android:bundle
# app/android/app/build/outputs/bundle/release/app-release.aab
```

Locally you can put the same values in `app/android/keystore.properties`
instead, which the build reads in preference to the environment:

```properties
storeFile=/absolute/path/docket-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

With neither present the release build still works and simply comes out
unsigned, so a contributor or an ordinary CI job never needs the key.

#### 3. Create a service account

In the Google Cloud console, make a service account and a JSON key for it. Then
in **Play Console → Users and permissions**, invite that service account's email
and grant it *Release to testing tracks* and *Release to production* on this app
only. The invitation has to be accepted in the Play Console before the API will
accept anything from it — a fresh account returns a permissions error that does
not say this.

#### 4. Add the repository secrets

| Secret | What it holds |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i docket-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `ANDROID_KEY_PASSWORD` | The key password |
| `PLAY_SERVICE_ACCOUNT_JSON` | The whole service-account JSON, pasted |

Without `PLAY_SERVICE_ACCOUNT_JSON` the workflow still builds and signs the
bundle and attaches it as an artifact; it just does not upload. That is
deliberate, so the pipeline can be proved before it is trusted with the store.

#### 5. Release

```bash
git tag v1.4.0 && git push origin v1.4.0
```

The workflow runs the test suite, builds the bundle, checks it really is signed,
and uploads it to the internal track. To promote it, or to publish a specific
version to another track, run **Release to Play Store** from the Actions tab and
choose the track.

#### versionCode

Play orders releases by `versionCode` and refuses one it has seen before. The
workflow passes `github.run_number`, which only ever increases — the single
property that matters. `versionName` comes from the tag, so `v1.4.0` ships as
`1.4.0`. Nothing needs editing in `build.gradle` to cut a release.

#### The listing

The data-safety form is the part worth getting right. Easy Docket collects
nothing, and transmits only ciphertext to a destination the user configures, so
the honest answers are "no data collected" and "no data shared" — with the
caveat that a user who configures sync is sending encrypted data to a service of
their own choosing, which the form has no good box for. Say so in the privacy
policy rather than leaving it implied.

The biometric plugin adds `USE_BIOMETRIC` and `USE_FINGERPRINT` to the manifest;
both are normal permissions needing no declaration form.

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

Both the Git and S3 adapters are exercised against real remotes in CI — Git
through `git http-backend`, S3 through MinIO — so the protocol paths are
checked, not assumed.

For Git in the browser, a CORS proxy is required — most Git hosts send no CORS
headers. The Android app does not need one. The proxy only ever relays
encrypted data, but it does see the repository URL and token, so run your own
if that matters.
