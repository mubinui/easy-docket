# Architecture

## The shape of the problem

A personal ledger has an unusual set of constraints. It is small (tens of
thousands of rows over a lifetime), it is edited from two or three devices that
are frequently offline, it is intensely private, and it must never lose a
record. It also has no server-side logic worth running: there is nothing to
compute centrally that the device cannot compute itself.

That combination points at one design. Keep the whole ledger on the device.
Treat sync as replication between peers, not as a client talking to an
authority. And since no server needs to read the data, do not let any of them.

## Layers

```
        UI: pages and components (Ionic / Angular standalone)
                          │  signals
        Facades: AccountsService · CategoriesService · TransactionsService
                          │
        LedgerService — writes entities *and* the operation log, atomically
                          │
        Dexie / IndexedDB  ←  the source of truth
                          │
        SyncService — pull, merge, push
              │                        │
        CryptoService              AdapterFactory
        (AES-GCM, PBKDF2)          (lazy-loaded)
              │                   ┌────┴─────┬──────────┐
        VaultService          ServerAdapter  S3Adapter  GitAdapter
        (key lifecycle)
              │
        SecureStore — Android Keystore, or memory-only on the web
```

The dependency arrows only ever point downward. The UI knows nothing about
encryption; the crypto layer knows nothing about transactions; the adapters know
nothing about either, because by the time bytes reach them they are already a
sealed envelope.

## Data flow

**A local edit.**

```
user taps Save
  → TransactionsService.save() validates and defaults
  → LedgerService.put() stamps an HLC and, in ONE IndexedDB transaction:
        writes the row  +  appends an operation (synced = 0)
  → Dexie liveQuery fires → signals update → the list re-renders
```

The single transaction is the important part. A crash cannot leave a row
without its operation, or an operation without its row, so the log and the state
can never disagree.

**A sync cycle.**

```
pull                                        push
────                                        ────
adapter.list(prefix)                        ledger.pendingOperations()
  ↓ names not already applied                 ↓ batched (≤ 500 ops)
adapter.get(name)                           crypto.sealJson(key, header, batch)
  ↓ ciphertext                                ↓ envelope bytes
crypto.openJson(key, bytes)                 adapter.put(vaults/<id>/ops/<hlc>.edk)
  ↓ operations                                ↓
ledger.observeStamps() → merge()            ledger.markSynced()
                                            adapter.flush()   (Git: one commit)
```

Pull runs first, so an edit made immediately after a sync is causally ordered
above everything just learned.

## Local storage

Dexie over IndexedDB. Six tables, in two groups.

**Materialised state** — what the UI queries:

| Table | Primary key | Indexes |
| --- | --- | --- |
| `accounts` | `id` | `name`, `kind`, `archived` |
| `categories` | `id` | `name`, `kind`, `parentId`, `archived` |
| `transactions` | `id` | `date`, `accountId`, `categoryId`, `kind`, `[accountId+date]`, `[kind+date]` |

**Replication bookkeeping** — what sync needs:

| Table | Primary key | Purpose |
| --- | --- | --- |
| `oplog` | `hlc` | Append-only operation log; `synced` flag, `[entity+entityId]` index |
| `remoteObjects` | `name` | Objects already downloaded and applied, so a repeated pull is free |
| `meta` | `key` | Clock state, last sync time, the encrypted sync settings blob |

Amounts are integers in the currency's minor unit. A float ledger drifts; an
integer one does not.

## Replication

### Operations, not snapshots

Each mutation appends an immutable operation:

```ts
{ hlc, entity, entityId, op: 'put' | 'delete', value?, device }
```

Shipping operations rather than snapshots is what makes offline editing on two
devices work. Two phones that have been apart for a week exchange two sets of
operations and both arrive at the same ledger, without either having to be
designated the winner.

### Hybrid logical clocks

Wall-clock time cannot order events across devices whose clocks disagree, and a
pure counter loses the human ordering a ledger needs. An HLC keeps both: it
tracks physical time, never moves backwards, and bumps a counter when time
stands still or a remote stamp is ahead.

```
0000001739059200000-0000-3f9a2c17
physical ms (19)    ctr  device (8)
```

Fixed width, so string comparison *is* causal comparison. That single property
buys a lot: operations sort correctly in IndexedDB, remote objects sort
correctly by name, and no decoding is needed to order anything. A remote stamp
more than an hour ahead is rejected as a clock fault rather than absorbed.

### Conflict resolution

Last-writer-wins per entity, ordered by HLC, ties broken by device id.

Field-level merging was considered and rejected. For a personal ledger, two
devices editing the *same* transaction simultaneously is vanishingly rare, while
a half-merged transaction whose amount came from one device and category from
another would be actively misleading in a financial record. Whole-entity LWW is
predictable, and predictable is what a ledger owes you.

Deletions leave tombstones in the log. Without them, a stale `put` arriving from
a device that was offline would quietly resurrect a deleted record.

### Idempotence

Remote destinations offer no locking, no transactions and no ordering. The
engine assumes none of that, and gets away with it because objects are
**immutable and content-named**: the object name is the HLC of the newest
operation inside. Two devices cannot write conflicting bytes to one name, and
applying an object twice is a no-op. Every failure mode collapses into "try
again later".

## Remote layout

Identical at all three destinations:

```
vaults/<vault-uuid>/ops/<hlc-stamp>.edk
```

The `.edk` file is a self-describing envelope — magic, version, algorithm, IV,
authenticated header, ciphertext. See [Security](SECURITY.md#the-envelope).

## Sync adapters

One interface: `list`, `get`, `put`, optional `flush`, `probe`. That is the
whole contract, and it is narrow on purpose — it is what lets the engine be
written once instead of three times.

| Adapter | Notes |
| --- | --- |
| **Server** | The bundled Go service. Bearer token, paged listings, immutable objects. |
| **S3** | Any S3-compatible store. Path-style addressing for R2 and MinIO. |
| **Git** | `isomorphic-git` over an IndexedDB filesystem. One commit per sync. Needs a CORS proxy in the browser; not on Android. |

All three are loaded with dynamic `import()`. The S3 client (57 kB) and the Git
implementation (67 kB) are most of what the app could possibly download, and
someone syncing to their own server — or to nothing — should never pay for
either. Initial transfer is ~236 kB gzipped.

## Scheduling

`SyncSchedulerService` owns *when*; `SyncService` owns *how*. Three triggers —
an interval timer, regaining connectivity, and app resume — all funnel into one
method that coalesces concurrent callers into a single cycle.

## Roadmap

The phase-one schema already leaves room for what comes next:

- **Budgets** — a `budgets` table added in a Dexie `version(2)` migration, with
  `'budgets'` joining the `EntityName` union. The operation log, envelope format
  and every adapter are entity-agnostic and need no change.
- **Reports** — derived entirely from `transactions`; no new storage.
- **Recurring transactions** — a rule table plus a materialiser that runs on
  app open, emitting ordinary transactions so history stays a flat log.
- **Multi-currency** — `Account.currency` already exists per account; what is
  missing is a rate table and a reporting currency.
