# Easy Docket

A personal money manager that works with no network at all, and that encrypts
everything on the device before it goes anywhere else.

- **Offline-first.** The local database is the source of truth. Every screen
  renders from IndexedDB; nothing waits on a request.
- **Zero-knowledge sync.** Your ledger is sealed with AES-256-GCM under a key
  that never leaves your device. Git, S3 and the bundled server all receive
  opaque ciphertext.
- **Your storage, your choice.** Sync to a Git repository, any S3-compatible
  bucket, or the self-hostable Go server in this repo. Or to nothing at all.
- **One codebase, two products.** A PWA for the browser and an Android app
  (`net.xiidea.docket`) for the Play Store.

## Why "Easy Docket"

A *docket* is a running list of items to be dealt with — a court's list of
cases, a shipment's contents, a day's agenda. It is the right word for a
personal ledger: a plain record of what happened, kept in order, meant to be
scanned rather than studied. It avoids the two traps most finance-app names
fall into. It does not promise wealth (`Fortune`, `Prosper`, `Wealthfront`),
which is a promise a ledger cannot keep, and it does not describe a feature
(`BudgetTracker`, `SpendLog`), which dates the product the moment it grows past
that feature. "Easy" sets the expectation that the app should hold the notes
without becoming a second job.

It also makes a good namespace. `net.xiidea.docket` is short, pronounceable,
and unlikely to collide.

## Repository layout

```
app/       Ionic 9 + Angular 22 client — PWA and Android
server/    Go 1.26 sync server — stateless HTTP over a blob store
docs/      Architecture, security model, deployment
```

## Quick start

Requires **Node 22.22.3+** (see `.nvmrc`) and, for the server, **Go 1.26+**.

```bash
# Client
cd app
npm ci
npm start            # http://localhost:4200

# Server
cd server
make run             # listens on :8080
```

Generate a token before pointing the app at your server:

```bash
cd server
go run ./cmd/docket-sync token alice
# prints the token once, and the line to add to your tokens file
```

## Verifying it

```bash
cd app    && npm run test:ci   # 94 tests: crypto, merge, sync, vault, money
cd server && make test         # race-enabled Go suite
```

The suites that matter most are the ones that hold the central promises:

| Promise | Where it is proven |
| --- | --- |
| Nothing readable leaves the device | `app/src/app/core/sync/sync.service.spec.ts` — "zero knowledge" |
| The master key never reaches disk | `app/src/app/core/keys/vault.service.spec.ts` — "key storage" |
| Two devices converge, in any order | `app/src/app/core/repositories/ledger.service.spec.ts` |
| One account cannot read another | `server/internal/api/server_test.go` |

The zero-knowledge claim was also checked against the real stack rather than a
test double — see [Security](docs/SECURITY.md#how-the-main-claim-was-checked).

## Releasing

- **PWA** — every push to `main` deploys to GitHub Pages.
- **Android** — tagging `v1.4.0` builds a signed bundle and publishes it to the
  Play Store's internal track. See
  [Deployment](docs/DEPLOYMENT.md#play-store-release) for the one-off setup:
  an upload key, a service account, five repository secrets, and a first
  release uploaded by hand because the API cannot create an app.
- **Sync server** — the same tag publishes a multi-architecture image and
  cross-compiled binaries.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — layers, data flow, storage, sync protocol
- [Security](docs/SECURITY.md) — threat model, crypto protocol, key handling, what still leaks
- [Deployment](docs/DEPLOYMENT.md) — PWA hosting, Play Store, self-hosting the server

## Status

The core ledger is complete: accounts, categories, transactions (income,
expense, transfer), balances, a monthly summary, theming, and all three sync
adapters. Budgets and charted reports are the next phase — see
[Architecture](docs/ARCHITECTURE.md#roadmap) for how the schema already
accommodates them.

## Licence

MIT.
