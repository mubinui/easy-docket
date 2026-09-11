# Easy Docket — implementation plan

Working document. One task at a time, in order, unless you say otherwise.

## How a task gets done

Every task follows the same loop, and none of it is optional:

1. **Implement** the task as scoped below.
2. **Test it.** New behaviour gets new tests. A task is not done because the
   code exists — it is done when a test would fail if the code were wrong.
3. **Verify the whole suite**, not just the new tests:
   ```bash
   cd app    && npm run test:ci && npm run lint && npm run build
   cd server && make test && make lint
   ```
4. **Update this file** — tick the task, record anything learned, note any new
   gap discovered.
5. **Commit** the implementation, its tests and this file together.
6. **Stop and confirm** before starting the next task.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Core ledger | ✅ Done |
| 2 | Budgets | ⬜ Next |
| 3 | Reports | ⬜ Planned |
| 4 | Recurring transactions | ⬜ Planned |
| 5 | Multi-currency | ⬜ Planned |
| 6 | Release readiness | ⬜ Planned |

Tests today: **94 client**, **84 Go**.

---

## Phase 1 — Core ledger ✅

- [x] Domain model, Dexie schema v1, hybrid logical clock
- [x] Operation log with atomic entity+op writes; LWW merge with tombstones
- [x] AES-256-GCM envelope, PBKDF2 key wrapping, vault lifecycle
- [x] Key in Android Keystore; memory-only on web, with the reason surfaced in the UI
- [x] Sync engine: pull, merge, push, coalesced cycles, retryable errors
- [x] Adapters: custom server, S3, Git — lazily loaded
- [x] Go sync server: auth, storage, API, CORS, Docker, cross-compiled binaries
- [x] Accounts, categories, transactions, balances, monthly summary, theming
- [x] PWA (service worker, manifest) and Android (`net.xiidea.docket`)
- [x] Zero-knowledge verified against the real stack, not just a test double

---

## Phase 2 — Budgets ⬅ next

Goal: set a spending limit per category per period, and see progress against it
without opening a report.

### 2.1 Schema and entity

- [ ] Add `Budget` to `app/src/app/core/models/domain.ts`:
      `id, name, categoryIds[], period ('monthly'|'weekly'|'yearly'), amount (Minor),
      currency, startDate (YYYY-MM-DD), rollover (boolean), archived, createdAt, updatedAt`
- [ ] Dexie `version(2)` in `docket-db.ts` adding a `budgets` table
- [ ] Add `'budgets'` to `EntityName` / `EntityMap`

**Why it should be cheap:** the operation log, envelope and all three adapters
are entity-agnostic. If this task needs changes in `sync.service.ts` or any
adapter, something has leaked and the leak is the real task.

**Tests**
- Opening a v1 database upgrades to v2 with existing rows intact
- `LedgerService.put/remove/merge` work for budgets with no new code paths
- A budget written on one simulated device converges on another
  (extend `sync.service.spec.ts` — it should need only a new fixture)

### 2.2 Budget calculations

- [ ] `BudgetsService` with live signals, mirroring `AccountsService`
- [ ] Period resolution: which window a budget is in for a given date
- [ ] Spend-per-budget from transactions in that window
- [ ] Rollover: unspent amount carries into the next period when enabled

**Tests** — pure functions first, so the edge cases are cheap to state:
- Weekly / monthly / yearly window boundaries, including month-length differences
- A budget spanning a year boundary
- Rollover accumulating across several periods, and not accumulating when off
- Transfers excluded; only expenses count
- A budget covering several categories sums them
- Spend of zero, and spend exceeding the limit

### 2.3 Budget screens

- [ ] `features/budgets/budgets.page.ts` — list with progress bars, over-budget state
- [ ] `features/budgets/budget-editor.component.ts` — create/edit/delete
- [ ] Route + tab (five tabs, or move Settings behind an overflow — decide when building)

**Tests**
- Editor validation: amount required and positive, at least one category
- Deleting a budget leaves its transactions untouched

### 2.4 Dashboard integration

- [ ] Budget summary card: the closest-to-limit budgets, with remaining amounts
- [ ] Empty state that points at budget creation

**Tests** — ordering by proximity to limit; empty state when none exist.

---

## Phase 3 — Reports

Goal: answer "where did it go, and is that normal?" — derived entirely from
transactions, so no new storage.

### 3.1 Aggregation layer
- [ ] Pure functions in `core/reports/`: spend by category, income vs expense by
      month, net worth over time, top payees
- [ ] Arbitrary date ranges, not just whole months

**Tests** — each aggregation against a fixed fixture ledger; empty ranges;
single-transaction ranges; transfers excluded from income/expense totals.

### 3.2 Charts
- [ ] Inline SVG chart components — donut, bar, line

**Decision, made now to avoid churn later:** no chart library. The CDN is not
reachable offline, a bundled library is heavy for four chart types, and inline
SVG themes correctly in dark mode with the tokens already defined. Revisit only
if a chart needs real interaction.

**Tests** — geometry from known inputs (path data, bar heights), empty series,
single-point series, all-zero series.

### 3.3 Reports screen
- [ ] Range picker, chart selection, per-category drill-down
- [ ] CSV export of the current view

**Tests** — CSV escaping (commas, quotes, newlines in notes and payees).

---

## Phase 4 — Recurring transactions

Goal: rent, salary and subscriptions appear without being typed monthly.

### 4.1 Rule model
- [ ] `RecurringRule` entity, Dexie `version(3)`
- [ ] Schedule: interval + unit, optional end date, optional occurrence count

### 4.2 Materialiser
- [ ] On app open, emit ordinary transactions for every due occurrence
- [ ] Idempotent per `(ruleId, occurrenceDate)` — this is the whole difficulty

**Why it matters:** two devices opening the app on the same morning must not
each create the rent transaction. The occurrence key has to be derived, not
random, so both devices produce the same id and LWW collapses them into one.

**Tests**
- Catch-up after the app is unopened for months
- Two simulated devices materialising the same occurrence produce one transaction
- End date and occurrence-count limits respected
- A rule edited mid-stream does not rewrite history already materialised

### 4.3 UI
- [ ] Rule list and editor; "skip this occurrence"; upcoming preview

---

## Phase 5 — Multi-currency

Goal: accounts in different currencies that still roll into one net worth.

- [ ] Rate table (`meta` or its own entity) with manual entry and an optional fetch
- [ ] A reporting currency setting
- [ ] Conversion in balances, net worth, budgets and reports
- [ ] Currency shown wherever a converted figure is displayed

**Tests** — conversion rounding at the minor unit; a missing rate degrading
visibly rather than silently showing a wrong total; zero-decimal currencies
(JPY) against three-decimal ones (KWD).

**Open question for you when we get there:** should a transaction store the
rate at the time it happened (historically accurate, more storage) or convert at
display time (simpler, but last year's totals shift when rates move)? My
recommendation is to store the rate on the transaction — a ledger that changes
its own history is unsettling.

---

## Phase 6 — Release readiness

- [ ] **6.1 Import / export** — CSV import with column mapping; encrypted full
      backup file; restore flow. Tests: malformed CSV, duplicate detection,
      round-trip of a backup.
- [ ] **6.2 Biometric unlock** on Android, gating keystore retrieval.
- [ ] **6.3 Oplog compaction** — see Known gaps.
- [ ] **6.4 Play Store signing** — `signingConfigs` wired to
      `keystore.properties`, release workflow producing a signed `.aab`.
- [ ] **6.5 E2E suite in CI** — the CDP script used during the build becomes a
      committed Playwright suite covering create-vault → record → sync → reload.

---

## Known gaps

Real, currently unaddressed, and each one has a home above.

| Gap | Impact | Where it gets fixed |
| --- | --- | --- |
| `oplog` grows without bound | A long-lived vault re-downloads its whole history on a new device | 6.3 — periodic snapshot objects plus a compaction watermark |
| Git adapter has no integration test | Only unit-level coverage; a real push is unproven | 6.5, against a local git-http-backend |
| No rate limiting on the server | A leaked token can be used to exhaust disk | Server hardening, unscheduled — quotas blunt it today |
| Single currency assumed in UI totals | Dashboard uses the first account's currency | Phase 5 |
| Category deletion leaves transactions uncategorised | Silent, no warning | Small fix, fold into 2.3 |
| Android build needs JDK 21 | JDK 25 is rejected by this Gradle | Documented in `docs/DEPLOYMENT.md`; revisit on Gradle upgrade |

---

## Ground rules carried forward

- **The local database is the source of truth.** Nothing in the UI waits on the
  network. If a feature needs a round trip to be usable, it is designed wrong.
- **Nothing readable leaves the device.** Any new entity syncs through the same
  envelope. If a feature wants to send something a destination can read, it
  needs an explicit decision, not a quiet exception.
- **Money is integer minor units.** No floats, anywhere.
- **A new entity should need no change to the sync engine.** If it does, fix the
  leak rather than special-casing it.
