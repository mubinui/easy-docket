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
| 2 | Budgets | 🔄 In progress — 2.1, 2.2 done |
| 3 | Reports | ⬜ Planned |
| 4 | Recurring transactions | ⬜ Planned |
| 5 | Multi-currency | ⬜ Planned |
| 6 | Release readiness | ⬜ Planned |

Tests today: **167 client**, **84 Go**.

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

## Phase 2 — Budgets 🔄

Goal: set a spending limit per category per period, and see progress against it
without opening a report.

### 2.1 Schema and entity ✅

- [x] `Budget` in `app/src/app/core/models/domain.ts`
- [x] Dexie `version(2)` in `docket-db.ts` adding a `budgets` table
- [x] `'budgets'` in `EntityName` / `EntityMap`

**Tests** (13 added, 94 → 107)
- [x] `docket-db.spec.ts` — a v1 database upgrades to v2 with accounts,
      transactions, meta and oplog rows intact; budgets table present and empty;
      fresh installs get all seven tables; budget indexes as specified
- [x] `ledger.service.spec.ts` — put / remove / merge / concurrent-edit
      resolution for budgets, plus proof that entity identity is
      `(entity, entityId)` so an account and a budget may share an id
- [x] `sync.service.spec.ts` — budget replicates between two devices, is
      encrypted like everything else, batches alongside other entities, and its
      deletion propagates

**What it found.** The task predicted that needing engine changes would mean a
leaked abstraction, and there was one. `LedgerService.merge` opened its
IndexedDB transaction against a hardcoded table list, so `budgets` was outside
the scope and every merge of one failed with `NotFoundError`. Adding the table
to the list would have fixed the symptom and left the trap for the next entity,
so the fix is structural: `ENTITY_NAMES` is now the single source of truth,
`EntityName` is derived from it, and the merge scope is built by iterating it.

**What it cost.** Three production files: `domain.ts`, `docket-db.ts`,
`ledger.service.ts`. No change to `sync.service.ts`, the crypto layer, the
envelope format or any of the three adapters — which is the property this task
existed to verify.

### 2.2 Budget calculations ✅

- [x] `core/budgets/period.ts` — window resolution, pure
- [x] `core/budgets/spend.ts` — spend, rollover, progress, stale references, pure
- [x] `core/repositories/budgets.service.ts` — live signals over both
- [x] Stale-category gap closed: surfaced via `needingAttention`, repaired by
      `pruneStaleCategories`

**Tests** (60 added, 107 → 167)
- [x] `period.spec.ts` — weekly / monthly / yearly boundaries; start-day
      anchoring; month-length clamping; 29 February starts; year crossings;
      daylight saving; and a tiling check over 36 consecutive periods
- [x] `spend.spec.ts` — expenses only, transfers and income excluded;
      multi-category budgets; boundary days inclusive; rollover accumulating,
      carrying deficits, and netting surplus against deficit; exhausted
      allowance not dividing by zero
- [x] `budgets.service.spec.ts` — validation, duplicate-category removal,
      archive vs delete, stale-reference repair, live progress and urgency order

**Decisions taken while building.**

*Windows anchor to `startDate`, not the calendar.* A budget started on the 15th
runs the 15th to the 14th, because that is what someone paid on the 15th means
by "this month". Month-length clamping (a budget started on the 31st opening on
28 February) lives in exactly one function, `windowStart`; every other boundary
falls out of "a window ends the day before the next begins", so there is one
place to be wrong rather than six.

*Rollover carries overspend as well as surplus.* Forgiving an overspent month
would make the setting flattering rather than useful. This is worth confirming
with you if you would rather it floor at zero — it is a one-line change and a
test.

*`pruneStaleCategories` refuses to empty a budget.* Pruning the last category
would leave a budget that silently tracks nothing, which is worse than an error.

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
| ~~Deleting a category leaves it referenced in `Budget.categoryIds`~~ | — | ✅ Closed in 2.2 |
| `BudgetsService.statuses` reads the whole transaction table | Fine for a personal ledger, wrong for a large one | Unscheduled; revisit with reports (Phase 3), which needs windowed queries anyway |
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
  leak rather than special-casing it. Task 2.1 found exactly one; `ENTITY_NAMES`
  now makes "iterate every entity" the only way to write that code.
