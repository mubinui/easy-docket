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
| 2 | Budgets | ✅ Done |
| 3 | Reports | ✅ Done |
| 4 | Recurring transactions | ✅ Done |
| 5 | Multi-currency | ✅ Done |
| 6 | Release readiness | ✅ Done |
| 7 | Account groups & credit cards | ✅ Done |
| 8 | Accounts in totals | ✅ Done |
| 9 | Assets and liabilities | ✅ Done |
| 10 | Starter accounts | ✅ Done |
| 11 | Categories and subcategories | ✅ Done |
| 12 | The vault's currency | ✅ Done |

Tests today: **886 client unit**, **98 end-to-end**, **95 Go**, **25 worker**.

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

## Phase 2 — Budgets ✅

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

### 2.3 Budget screens ✅

- [x] `features/budgets/budgets.page.ts` — list, progress bars, over-budget
      state, archived section, stale-category repair
- [x] `features/budgets/budget-editor.component.ts` — create / edit / archive /
      delete, expense categories only
- [x] Route `/budgets`, reached from the Summary screen

**Navigation decided:** four tabs kept; Budgets is reached from a Summary card.
The tab bar stays uncluttered and budgets remain a glance-then-leave screen.

**Tests** (25 added, 167 → 192)
- [x] Editor: name / amount / category all required, whitespace-only name
      rejected, non-positive and unparsable amounts reported rather than saved,
      minor-unit conversion, edit-in-place, income categories not offered,
      start-date hint wording
- [x] Page: empty state, progress rendering, urgency order, over-budget in the
      danger colour, archived separated, stale-category warning and repair,
      repair not opening the editor behind it, archive from the editor
- [x] Verified in a real browser: budget created from Summary, `$0.00 of
      $250.00` becoming `$150.00 left` after a $100 expense, no page errors

**What it found.** `BudgetsService.all` sorted with `orderBy('name')`, but the
v2 schema indexes only `id`, `period` and `archived`, so Dexie threw
`SchemaError: KeyPath name on object store budgets is not indexed` as soon as a
screen read the list. The service spec had missed it by only exercising
`statuses`, which reads via `toArray`. Fixed by sorting in memory rather than
adding an index: a ledger has tens of budgets, an index would buy nothing, and
tying display order to the schema would mean a migration to reorder a list.

**Left for 2.4.** The Summary entry point is currently a plain row ("1 active /
All within limit"). Task 2.4 replaces it with the card showing the budgets
closest to their limits.

### 2.4 Dashboard integration ✅

- [x] Summary card showing the three budgets closest to their limits
- [x] Empty state pointing at budget creation
- [x] Over-budget called out with an `OVER` flag and the amount, in danger colour
- [x] `shared/budget-bar.component.ts` extracted so the card and the list cannot
      drift apart — a budget that read as comfortable on one screen and alarming
      on the other would be worse than no bar at all

**Tests** (12 added, 192 → 204)
- [x] Empty state; remaining amount; over-budget presented as a positive figure
      ("over by $25.00", never "over by -$25.00"); urgency ordering; the
      three-budget cap; the summarising link label and its pluralisation;
      budgets that have not started yet excluded
- [x] Bar component: fill proportion, colour, and its ARIA description
- [x] Browser-verified: `$150.00 left`, then `OVER · over by $25.00 · 1 budget
      over its limit` after overspending

**What it found.** The first over-budget test asserted against the whole page
and passed for the wrong reason — the `-$` it was checking for came from net
worth in a different card. Assertions are now scoped to the budget card via a
`budgetCardText()` helper. Worth remembering for Phase 3: the Summary screen has
several cards, and a page-wide `textContent` assertion proves very little.

Also: the Summary screen reaches `VaultService` through the sync indicator, and
`SecureStore` is provided at bootstrap rather than from the root injector, so
component tests for it must supply one.

---

## Phase 3 — Reports ✅

Goal: answer "where did it go, and is that normal?" — derived entirely from
transactions, so no new storage.

### 3.1 Aggregation layer ✅

- [x] `core/reports/aggregate.ts` — `spendByCategory`, `flowByMonth`,
      `netWorthOver`, `topPayees`, `totalsFor`. Pure, arbitrary ranges.
- [x] `core/util/dates.ts` — calendar helpers moved out of
      `TransactionsService` so a pure module can use them without reaching into
      a repository. `DateRange`, `monthsIn`, `endOfMonth` and friends now live
      in one place, and eight files import from there.

**Tests** (42 added, 207 → 249)
- [x] `dates.spec.ts` — local-calendar dates (a late-evening entry belongs to
      the day the user saw, not the UTC day), month listing across year
      boundaries, February in leap and common years, reversed ranges returning
      empty rather than looping
- [x] `aggregate.spec.ts` — one small fixture ledger whose numbers can be
      checked by hand, covering every aggregation: empty ranges, single
      transactions, uncategorised spending sorted last, blank payees ignored,
      history before the range still counting toward net worth, the final point
      clamped to the range end, and a zero-valued expense not dividing by zero

**Decisions.**

*Transfers are never income or expense.* Moving money between your own accounts
is neither earning nor spending it, and a report that counted them would make
someone look wildly richer and more profligate than they are. Every aggregation
enforces this, and `netWorthOver` is asserted to be identical with and without
the fixture's transfer.

*Empty months keep their bucket.* Dropping a month with no activity would
compress the chart and imply a continuity that did not happen.

*Net worth is cumulative, not windowed.* Net worth on a date is everything that
has ever happened up to it, so transactions before the range still count — only
the points shown are bounded by it.

*Blank payees are dropped from `topPayees`.* Lumping every unnamed expense under
`""` would invent a merchant that dwarfs the real ones.

### 3.2 Charts ✅

- [x] `core/reports/geometry.ts` — pure layout: `niceAxis`, `scale`,
      `horizontalBars`, `groupedColumns`, `linePoints`, `linePath`, `areaPath`,
      `barPath`, `nearestIndex`
- [x] `shared/charts/` — category bars, grouped flow columns, trend line
- [x] Validated palette in `global.scss` as `--viz-*` roles, light and dark
- [x] `chart-preview.spec.ts` — renders every chart in both themes to a
      standalone page (`CHART_CAPTURE=/tmp/charts.html npm run test:ci`); a
      no-op without the variable

**Forms chosen, and why not the obvious ones.**

*Bars, not a donut, for category spend.* The reader's job is ranking
magnitudes, and a donut makes close values nearly impossible to order. Long
category names also fit a horizontal layout, which matters on a phone.

*One colour for every category bar.* Categories have no natural order, so
shading them by size would double-encode the length the bar already shows and
spend the only free channel on information the chart is not short of.

*Grouped, not stacked, for income against expense.* They are not parts of a
whole; stacking would imply a total that means nothing. One axis, never two — a
second scale lets a chart invent a relationship the data does not contain.

*No legend on the net-worth line.* One series, so the card title already says
what is plotted; a box with a single swatch would only restate it.

**Colour was computed, not judged.** The two series hues are the reference
palette's slots 1 and 2, run through the validator against the surfaces the
charts actually render on — the card background, not the page — in both modes.
All six checks pass: worst-pair colourblind separation ΔE 24.7 light / 26.8 dark
against a floor of 8, and 3:1 contrast throughout.

**Tests** (61 added, 249 → 310)
- [x] Geometry: axis rounding to readable ticks, always including zero, negative
      domains, flat and empty series, bars scaled against the largest value,
      columns anchored to the baseline and capped in thickness, a lone reading
      placed mid-plot, path strings from known points, nearest-point lookup
- [x] Components: shapes reach the DOM, every value has a table twin, empty
      states say so rather than rendering a blank box, the legend is present for
      two series and absent for one, gridlines are solid, a zero rule appears
      only when data goes negative

**What looking at it found.** Two things no assertion had caught: the bars were
rounded at *both* ends, where the spec calls for a rounded data end and a square
baseline (a pill floating free of the axis loses the anchor that makes lengths
comparable), and category labels used the muted axis token, which sits around
2.9:1 on white. Both fixed — `barPath` draws the shape explicitly, and labels
now use a secondary-ink token. Worth repeating the lesson: the validator checks
colour, the tests check geometry, and neither of them can see the chart.

### 3.3 Reports screen ✅

- [x] `features/reports/reports.page.ts` at `/reports`, reached from the Summary
      screen's "Where it went" card
- [x] One filter row of range presets scoping every card beneath it
- [x] Totals, the three charts, and a top-payees list
- [x] "Show data" reveals the table twins that were already there for assistive
      technology
- [x] CSV export of the current view, via `core/reports/csv.ts` and a
      `FileExportService` that downloads on the web and hands the file to the
      share sheet on Android

**Tests** (25 added, 310 → 335; 7 end-to-end, 26 → 33)
- [x] CSV: quoting for commas, embedded quotes and line breaks; CRLF line
      endings; a header row alone when there is nothing to report; and formula
      injection neutralised — a note beginning `=` would otherwise execute when
      the file is opened
- [x] Ranges: every preset ends today rather than at a future month boundary,
      whole-month starts, year boundaries
- [x] Service: aggregation over the live ledger, currency following the
      accounts, re-aggregation when the range changes, deleted categories named
      rather than blank, net worth counting history from before the range
- [x] End-to-end: the empty state, three cards rendering, totals naming a
      shortfall as "overspent", top payees, the filter row scoping everything,
      the table twins revealing on request, and a real CSV download whose
      contents are asserted

**What looking at it found.** With a single month of history the net-worth card
drew one dot in an empty plot with its label stranded at the far edge — the
shape of a chart that failed to render rather than a ledger that is new. A lone
value is a number, not a trend, so the component now shows it as one:
"$5,049.31 · Sep 2026 · not enough history for a trend yet". `e2e/screenshot.spec.ts`
keeps that check repeatable (`REPORT_SHOTS=/tmp npx playwright test e2e/screenshot.spec.ts`),
and skips itself otherwise.

**Deferred deliberately.** Per-category drill-down. The category bars plus the
payee list answer "where did it go" without it, and a drill-down needs a
filtered transaction view that the Activity screen already provides.

---

## Phase 4 — Recurring transactions ✅

Goal: rent, salary and subscriptions appear without being typed monthly.

### 4.1 Rule model ✅

- [x] `RecurringRule` in `domain.ts` — a transaction template plus a schedule
      (interval + unit, optional end date, optional occurrence cap, and the
      occurrence dates the user has skipped)
- [x] Dexie `version(3)` adding `recurringRules`
- [x] `'recurringRules'` added to `ENTITY_NAMES`, from which `EntityName` and
      the merge transaction's scope are both derived

**The 2.1 repair held.** Adding budgets cost a bug — `merge` had a hardcoded
table list and threw `NotFoundError` for any entity not in it. Adding recurring
rules cost nothing: `ENTITY_NAMES` is the single source of truth, so the new
entity replicated, merged and stayed encrypted without a line of new code in the
sync engine. That is the return on fixing the cause rather than the symptom, and
it is now asserted rather than assumed.

**A rule is not a transaction.** It never appears in a balance. Transactions are
materialised from it, so history stays a flat log of what actually happened and
editing a rule tomorrow cannot silently rewrite what it produced last year.
`nextDue` is deliberately not stored: it is derived from the schedule and what
has already been materialised, and a cached copy would be one more thing for two
devices to disagree about.

**Tests** (6 added, 335 → 341)
- [x] A v2 database with budgets in it upgrades to v3 with every row intact
- [x] Rules move through put / remove / merge like any other entity
- [x] A rule replicates between devices and stays unreadable at the destination

**Also fixed: flaky tests.** Three dashboard tests failed on one run and passed
on the next. The cause was a fixed 60ms sleep waiting for a Dexie `liveQuery` —
long enough on an idle machine, not on a busy one. `core/testing/async.ts` now
polls a condition instead, so a test returns as soon as its data arrives and
fails only if it never does. The suite ran green four times consecutively
afterwards.

### 4.2 Materialiser ✅

- [x] `core/recurring/schedule.ts` — pure: `occurrenceAt`, `occurrencesUpTo`,
      `nextOccurrence`, `occurrenceId`
- [x] `core/recurring/materialiser.service.ts` — creates due transactions, and
      `skip` for an occurrence the user does not want
- [x] Runs before the first paint on app open, and after every sync

**Three things make it safe to run at any moment, on any device.**

*Derived identity.* A materialised transaction's id is `ruleId:date`, so two
devices running on the same morning produce the **same** id and last-writer-wins
collapses them into one row. A random id would give the user two rents — this is
the whole reason the task existed, and there is a two-device test for it.

*The log, not the table.* Before creating anything it asks whether that id has
*ever* existed. A transaction the user deleted left a tombstone and no row;
resurrecting it on every app open would be maddening. `LedgerService.hasHistory`
and `latestEntityIdWithPrefix` answer from the operation log.

*A bounded run.* A daily rule dated years back would otherwise produce thousands
of rows in one pass and stall the first launch. Each run creates at most 500 and
reports which rules have more to do.

**Also: occurrences are measured from the start date, never from the previous
one.** Stepping forward one at a time accumulates the month-length clamping — a
rule anchored to the 31st would land on the 28th in February and then stay on
the 28th forever. The clamping itself now lives in `addMonths` in
`util/dates.ts`, shared with the budget periods, which had the identical problem
and its own copy of the answer.

**Tests** (49 added, 341 → 390)
- [x] Schedule: every unit and interval, month-length clamping that does not
      drag the schedule, leap-day anchors, end dates, occurrence caps, skipped
      dates not earning a replacement, catch-up across a year, resume past a
      watermark, and a nonsensical interval returning nothing rather than looping
- [x] Materialiser: fields copied from the rule, transactions left uncleared
      (the rule says money was due, not that it moved), nothing before the start
      date, archived rules ignored, repeat runs creating nothing, a user's edit
      not overwritten, a deleted occurrence not resurrected, two devices
      converging on one transaction, bounded runs continuing where they left off,
      and skip removing an occurrence already created
- [x] Ledger: history surviving deletion, prefix high-water mark including
      deleted ids

**What it found.** The first bounded-run implementation could never catch up: it
asked for "the first 500 occurrences" every time, and since a schedule always
starts in the same place, that is a fixed answer — every run after the first
created nothing. `occurrencesUpTo` now takes a resume point, and the materialiser
reads it from the operation log.

### 4.3 Rule screens ✅

- [x] `core/repositories/recurring.service.ts` — live signals, validation,
      archive, delete, and `upcoming` sorted by next due date
- [x] `features/recurring/rules.page.ts` at `/recurring`, reached from the
      Activity screen's toolbar — standing instructions belong with the
      transactions they produce, not in Settings
- [x] `rule-editor.component.ts` — the transaction fields plus a schedule, with
      "ends: never / on a date / after N times"
- [x] Skip the next occurrence from the list

**The preview is the point of the editor.** "Every 1 month from the 31st" is
hard to picture and easy to get wrong, so the editor shows the next three dates
it would actually produce. That is where a user discovers February lands on the
28th, rather than finding out in March.

**Tests** (18 unit added, 390 → 408; 9 end-to-end, 33 → 42)
- [x] Service: validation (name, amount, interval, end before start, occurrence
      limit, transfer needing a distinct destination), negative amounts
      normalised rather than rejected, upcoming ordered by due date with
      finished rules sorted last, archive and delete
- [x] End-to-end: the empty state, cadence and next date, the schedule preview
      showing 31 January then 28 February, a due occurrence materialising on
      open, **no duplicate on a second open**, **a deleted occurrence staying
      deleted**, skipping moving the rule on, a skipped occurrence never
      recorded, and deleting a rule keeping the transactions it already made

**Two things the end-to-end run found.**

*A rule named "Rent" produced a transaction reading "Untitled".* The materialiser
copied `rule.payee`, which is usually blank — the name is what the user actually
called that money. It now falls back to the rule name.

*The sync indicator had no accessible name.* An icon-only button, invisible to a
screen reader. It now reports its state in words: "Synced — tap to sync now",
"Sync failed — tap to retry", and so on.

---

## Phase 5 — Multi-currency ✅

Goal: accounts in different currencies that still roll into one net worth.

### 5.1 Rate model and conversion ✅

- [x] `ExchangeRate` entity and Dexie `version(4)`, keyed `<base>:<quote>:<date>`
- [x] `Transaction.rate` / `rateDate` — optional, so no migration is needed and
      rows written before multi-currency simply do not carry them
- [x] `core/money/conversion.ts` — `convert`, `inReporting`, `rateFor`,
      `invertRate`, `sumInReporting`, all pure

**Decided: the rate is stored on the transaction.** Last year's totals then
never move. Converting at display time would mean a report that reads
differently on two afternoons because a rate drifted, and a ledger that rewrites
its own history is unsettling.

**A missing rate is not zero.** `inReporting` returns null rather than guessing,
and `sumInReporting` counts what it could not convert. A total that silently
omits the transactions it could not handle is worse than one that says it is
incomplete — the UI in 5.3 has to surface that count.

**Rates carry forward, never backward.** `rateFor` uses the quote for the day or
the most recent one before it, because markets close at weekends and a Saturday
purchase converts at Friday's rate. A later quote is never used: that would be
hindsight.

**Tests** (27 added, 408 → 435)
- [x] Conversion across different minor units — USD to JPY (no minor unit) and
      KWD (three places) in both directions
- [x] Rounding away from zero at a half, so an expense on a half is never
      quietly shrunk
- [x] Rates replicate like every other entity, with no new code in the engine

**What it found.** The half-rounding test failed for a real reason: binary
floating point cannot hold 1.005, so `100 × 1.005` evaluates to
100.49999999999999 and an exact half rounded the wrong way. Conversion now snaps
to nine decimal places before rounding — far below any precision a currency has,
and enough to restore the decimal value a person would have computed.

Schema assertions now compare against an exported `SCHEMA_VERSION` rather than a
literal, so a version bump stops breaking three unrelated tests.

### 5.2 Rate management and reporting currency ✅

- [x] `VaultSettings` entity and Dexie `version(5)` — one row, replicated
- [x] `RatesService` — quotes, pair summaries, lookup with inversion, and the
      reporting currency
- [x] `features/rates/rates.page.ts` at `/rates`, from Settings
- [x] A rate field in the transaction editor when the account is foreign,
      prefilled from the last known quote and showing what it converts to

**The reporting currency is vault-wide, not per-device.** Rates are stored on
transactions as "units of the reporting currency", so two devices disagreeing
about which currency that is would make every stored rate ambiguous. It is
therefore a replicated entity rather than a local preference, and changing it
warns that older figures stay quoted against the currency they were recorded in.

**No automatic rate fetch.** Every rate provider is a third party who would
learn which currencies this vault deals in — precisely the leak the rest of the
app avoids. Rates change slowly enough that typing one occasionally is a fair
trade. One quote is inverted rather than asking for both directions.

**The editor states the conversion in words.** "Worth $49.50 · 1 EUR = 1.1 USD"
is where a mistyped rate is caught, rather than in a total months later.

**Tests** (26 unit added, 435 → 461; 7 end-to-end, 42 → 49)
- [x] Service: reporting currency stored through the ledger, currency-code
      validation, a quote replacing rather than duplicating the same day,
      forward carry, inversion, pair summaries
- [x] Editor: no rate asked for in the reporting currency, prefill from the last
      known quote, the conversion shown, the rate stored on the transaction, and
      **no rate stored when none is needed** — carrying one would invite a
      future reader to apply it

**What it found.** The rate was only suggested when the account *changed*, so if
the default account was itself foreign the field sat empty beside a rate that
was already known. Accounts are listed by name, and "Euro account" sorts before
"Everyday" — so this was not a corner case. The suggestion now also runs when
the editor opens, reading the current value untracked so the initialising effect
cannot re-trigger itself.

Worth recording how it was found: the component tests all passed, and only the
browser disagreed. Instrumenting the running app — dumping the editor's computed
state into a data attribute — showed the account had never changed at all,
because it was already the default.

### 5.3 Conversion applied ✅

- [x] Reports — every aggregation converts using the rate each transaction
      carries, and `unconvertedIn` counts what it could not
- [x] Budgets — `spendDetail` converts to the budget's currency and reports
      what it left out
- [x] Net worth and account balances — a foreign balance converts at the latest
      known rate and is shown in both currencies (`€100.00 · ≈ $110.00`)
- [x] Activity totals and the Summary card
- [x] Every screen says what it excluded, in the currency it is missing

**The rule, everywhere: a transaction that cannot be converted is skipped and
counted, never added at face value.** Treating €45 as $45 would understate a
total in a way nobody would notice — the user would be told they are inside a
budget they have passed. So `netWorth` reports which currencies it left out,
budgets say how many transactions were not counted, and the reports header says
how many fell outside the total.

**An opening balance is not a dated event.** It is a standing figure, so it
converts at the latest rate known rather than one from a particular day —
unlike a transaction, which keeps the rate it was given.

**Tests** (8 unit added, 461 → 469; 2 end-to-end, 49 → 51)
- [x] Aggregations converting with per-transaction rates, leaving out what has
      none, and counting it
- [x] Net worth excluding an account whose currency has no rate
- [x] Reports expressed in the reporting currency rather than an account's
- [x] End-to-end: a €100 balance shown as `≈ $110.00` and rolled into a
      `$1,110.00` headline; and with no rate, a headline of `$1,000.00` beside
      "Excludes EUR"

**Two of my own expectations were wrong, not the code.** The top-payee test
assumed a converted €45 would outrank a $100 expense, and a reports test still
expected the first account's currency after the rule had deliberately changed to
the vault's reporting currency. Both corrected.

---

## Phase 6 — Release readiness

- [x] **6.1 Import / export** ✅ — CSV import and an encrypted backup, both
      reachable from Settings → Import and backup.

  **Import resolves the whole file before writing anything.** The user sees how
  many rows are ready, how many look like repeats, and how many could not be
  read — each named with its line. Importing is the one action that can add a
  thousand rows at once, and a half-succeeded import is far harder to undo than
  to prevent.

  **The CSV reader is written, not borrowed.** The input is a file from a bank
  whose conventions nobody controls, and the failure mode of getting it subtly
  wrong is a ledger full of shifted columns. RFC 4180 is small enough to
  implement exactly, and the tests cover what exports actually contain: quoted
  commas, doubled quotes, fields spanning lines, byte-order marks, accounting
  parentheses for negatives, trailing minus signs, thousands separators in both
  conventions, and the difference between "1,50" and "1,500".

  **Ambiguous dates are stated, not guessed.** 03/04 is two different days
  either side of the Atlantic, so the screen carries a day-first switch and
  re-reads the file when it changes rather than leaving counts from the previous
  setting on screen.

  **A backup is a snapshot, not the operation log.** The log is how devices
  reconcile; a backup answers "what did this ledger look like at this moment",
  and shipping years of superseded operations to answer it would dwarf the
  ledger. Restoring replays the snapshot as fresh operations, so a restored
  vault carries on syncing normally, and a row already newer locally is left
  alone — restoring an old backup should not undo work done since.

  **The file is encrypted with the vault key**, like anything sent to a sync
  destination. That has a consequence worth stating in the UI, and it is: the
  backup is the *data*, the recovery bundle is the *key*, and you need both.

  **Tests** (59 unit, 469 → 528; 6 end-to-end, 51 → 57) — including a real
  import through the browser with a quoted comma in a payee, a second import of
  the same file adding nothing, and a backup round-trip that survives deleting
  the transaction in between.

  **What the browser run found.** The failure message for a file that was not a
  backup read "Envelope truncated before header" — a sentence for a developer,
  not a person holding the wrong file. Base64 that will not decode, bytes that
  are not an envelope, and a wrong key now share one explanation, which is also
  the right call for not confirming anything to someone holding a file they
  should not have.
- [x] **6.2 Biometric unlock** ✅ — a fingerprint, face or device-credential
      check in front of the stored key, off by default and offered only where
      the device can actually do it.

  **What it is, precisely.** Not a second layer of encryption — the key is
  already in the hardware keystore. It is a presence check on whoever is holding
  the phone, because a key that survives a restart means a phone found unlocked
  is a ledger left open. The settings copy says exactly that rather than
  implying more.

  **A refused check leaves the vault locked, and the passphrase still opens
  it.** A convenience gate that could lock someone out of their own ledger would
  be a worse bargain than the one it improves on. Turning it on verifies once
  immediately, so a check that does not work cannot be switched on.

  Nothing changes on the web, where there is no stored key to protect: the
  browser build holds the key for one session and already asks every time.

  **Tests** (8 added, 537 → 545) — the check not asked for until enabled, a
  refusal leaving the vault locked, the passphrase still working afterwards, and
  the web build degrading to "unavailable" rather than throwing. The Android APK
  was rebuilt and carries `USE_BIOMETRIC`.
- [x] **6.3 Oplog compaction** ✅ — snapshots, so joining a long-lived vault no
      longer means replaying every batch ever written.

  **A snapshot is materially a batch of operations reconstructed from current
  state** — every entity, stamped with the clock value it last changed at. That
  is the whole trick: it can then be applied through the ordinary merge path,
  which means all the existing rules hold for free, including that a delete made
  *after* the snapshot is not undone by it. There is a test for exactly that.

  It is written once `SNAPSHOT_AFTER_OPERATIONS` (200) operations have
  accumulated past the last one, and applied only by a device that has nothing
  yet — a device already following the vault has the history, and re-applying
  would be work for nothing.

  **The operations are left in place.** A snapshot makes the download cheap, not
  the history disposable; actually removing what it covers needs a `delete` the
  adapters do not have. That remains open below.

  **Tests** (9 added, 528 → 537) — a snapshot written only past the threshold and
  not again until the next one, staying encrypted, a new device reaching the same
  ledger from far fewer objects, operations after the snapshot still applied, a
  post-snapshot delete not resurrected, and a device that already has the history
  ignoring it.

  **Pruning followed** (see below), which required one correctness change: a
  device now applies *any* snapshot it has not seen, not only its first. A
  device that was away while a snapshot was written and its operations pruned
  would otherwise never learn what happened in between — the operations are
  gone, and the snapshot is the only remaining record. There is a test for
  exactly that sequence.

  **Two real bugs found while testing.** Objects skipped because a snapshot
  covered them were not recorded as applied, so the *next* sync — which has no
  snapshot to apply, having just gained the history — saw them as unknown and
  downloaded every one. And a device that had just applied a snapshot
  immediately wrote its own, meaning every new device added a duplicate;
  applying one now records it as the snapshot this device knows about.
- [x] **Snapshot pruning** ✅ — `remove` added to the adapter contract, with
      `DELETE /v1/objects/{name}` on the Go server and the S3 and Git
      equivalents. Once a snapshot is written, the operations it covers and any
      older snapshot are deleted, so destination storage tracks the size of the
      ledger rather than the number of syncs.

  **The safety argument.** Deleting history is only sound because every device
  applies any snapshot it has not seen; whatever the pruned objects said, the
  snapshot says too. The test that matters is the one where a device syncs
  early, misses two hundred operations, and returns to find those batches gone —
  it still ends up with the same ledger.

  **Deletes are idempotent and never fail a sync.** A retried prune must not
  fail on its own earlier progress, and a destination that refuses deletes
  should leave a working but untidy vault rather than a broken one. Both are
  tested, the latter with an adapter that refuses every delete.

- [x] **6.4 Play Store signing and release** ✅ — signing wired to
      `keystore.properties` or the environment, and a workflow that tags to a
      release.

  **An absent key produces an unsigned build, not a failure.** A contributor who
  has just cloned the repository, and every CI job that is not a release, must
  be able to build the app. So `hasSigningConfig` decides whether a signing
  config exists at all, and the release build says plainly when it is unsigned.

  **`versionCode` comes from the workflow run number.** Play orders releases by
  it and refuses one it has seen, so the only property that matters is that it
  increases; `versionName` comes from the tag. Nothing in `build.gradle` needs
  editing to cut a release.

  **The workflow refuses to upload something unsigned.** An unsigned bundle is
  exactly what this build produces when the key is missing, and Play rejects it
  with a far less obvious message — so the workflow checks for a signature
  itself before going anywhere near the store.

  **Without the Play credentials it still builds, signs and attaches the
  bundle**, and warns rather than failing. The pipeline can be proved before it
  is trusted with the store.

  **Verified locally**: the unsigned fallback builds, a signed bundle carries
  `META-INF/UPLOAD.RSA`, and `DOCKET_VERSION_CODE=42 DOCKET_VERSION_NAME=1.2.3`
  reaches the manifest as `versionCode='42' versionName='1.2.3'`.

  **Not verified, and cannot be from here**: the upload itself. The first
  release has to go up through the Play Console by hand — the API adds releases
  to an app, it cannot create one — and the service account has to be invited
  and accepted there before it will accept anything. `docs/DEPLOYMENT.md` walks
  through both.
- [x] **6.5 E2E suite in CI** ✅ — Playwright, 26 tests, running the real Go
      sync server rather than a mock. `app/e2e/`, wired into CI as its own job.

  **What it found — three real bugs that every other check had passed.**

  1. **A duplicate router outlet swallowed taps.** `IonTabs` renders its own
     `ion-router-outlet`; `tabs.page.ts` declared a second one, which was
     projected on top as an empty absolutely-positioned layer. Every floating
     action button was unclickable. The unit tests never touch hit-testing, and
     the earlier CDP scripts called `element.click()`, which bypasses it — so a
     real finger was the first thing that would have hit this.
  2. **"Test connection" reported success with a wrong token.** `ServerAdapter.probe`
     only called `/v1/health`, which is unauthenticated by design. The one
     control whose entire job is catching a bad token before it becomes a silent
     background failure was not checking it. It now probes an authenticated
     listing as well.
  3. Assorted selector-level truths about Ionic worth recording: segment buttons
     and selects sit above their own shadow content, so the host must be clicked
     rather than the inner `role="tab"`/`role="button"` element; interpolated
     labels become properties, not attributes, so `[label="…"]` cannot find them;
     and `ion-title` is plain text, not a heading landmark.

  **Notes for writing more of these.** Ionic's page transitions are disabled for
  the run via `window.Ionic.config` in `e2e/fixtures.ts` — set before the bundle
  loads, so nothing in the app bends toward the tests. Screens are addressed by
  component selector (`app-accounts`) because Ionic keeps departed pages in the
  DOM. The sync spec reads the server's data directory directly, which is the
  only way to prove the zero-knowledge claim rather than assert it.

---

## Phase 7 — Account groups and credit cards

Accounts today are a flat list. This phase gives them a grouping, gives the
group a **type**, and uses that type to make credit cards behave like credit
cards — culminating in paying a card bill.

**The type lives on the group, not the account.** A group named "Cards" with
type `credit-card` says everything in it is a credit card; an account inherits
its behaviour from its group and an ungrouped account is `default`. The
alternative — a type on each account — was rejected because it puts the same
fact in as many places as there are cards, and the first time the two disagree
the app has to pick a winner.

**`AccountKind` stays cosmetic.** It already has a `card` value labelled
"Credit card", which is exactly the sort of overlap that rots. From this phase
on, `kind` picks the icon and the label and nothing else; every behavioural
question — is this a card, can it be paid, is a balance a debt — is answered by
the group's type. Two fields that both claim to answer "is this a credit card?"
is one field too many.

**A bill payment is an ordinary transfer.** Money leaves the current account and
lands on the card. The ledger already models that exactly, so 7.5 adds no
transaction field and no new kind: what it adds is knowing *how much* to pay and
a one-tap way to record it. A separate "payment" concept would be a second way
to spell a transfer, and every report would then have to know about both.

### 7.1 Schema and entity ✅

- [x] `AccountGroup` and `AccountGroupType` in `core/models/domain.ts`
- [x] `Account.groupId` — optional, following the `Transaction.rate` precedent,
      so existing rows need no migration and simply read as ungrouped
- [x] Dexie `version(6)`: an `accountGroups` table, and `groupId` added to the
      `accounts` indexes so "the accounts in this group" is one seek
- [x] `'accountGroups'` in `ENTITY_NAMES` / `EntityMap`

**Tests** (13 added, 552 → 565)
- [x] `docket-db.spec.ts` — a hand-built v5 database upgrades to v6 with
      accounts, transactions, budgets, settings, meta and oplog rows intact;
      a legacy account reads as ungrouped *and does not carry the key at all*;
      a fresh install gets all eleven tables; group and account indexes as
      specified; the accounts of a group come back by index
- [x] `ledger.service.spec.ts` — put / remove / merge / concurrent-edit
      resolution for groups, filing an account into one, and proof the ledger
      does not cascade a group deletion onto its accounts
- [x] `sync.service.spec.ts` — a group and an account's membership replicate,
      both encrypted; a deletion propagates without taking accounts with it;
      two devices that file the same account into different groups converge on
      one group rather than leaving it in both

**The prediction held.** Only `domain.ts` and `docket-db.ts` changed. Nothing in
`ledger.service.ts`, `sync.service.ts`, the crypto layer, the envelope or any
adapter needed a line — which is what 2.1's structural fix bought, and this is
the fourth entity to collect on it.

**Checked against a real browser, not just fake-indexeddb.** A v5 database was
built with raw IndexedDB in Chrome, seeded, and then opened by the built app:
it upgraded cleanly, all eleven stores appeared, `accounts` kept `name`, `kind`
and `archived` alongside the new `groupId`, and the legacy row came back byte
for byte with no `groupId` key. `fake-indexeddb` is a reimplementation, and the
whole point of the stub lesson below is that a reimplementation agrees with
whatever you wrote.

**Two fields could have answered "is this a credit card?"** `AccountKind`
already had a `card` value labelled "Credit card". Rather than leave two fields
racing to answer the same question, `AccountKind` is now documented as
presentation only — it picks the icon and the label — and the group's type is
the sole authority on behaviour.

### 7.2 Groups service and CRUD ✅

- [x] `AccountGroupsService` — live list ordered by `order` then name then id,
      save, archive, delete, reorder, move an account, `typeOf`/`isCreditCard`
- [x] Deleting a group leaves its accounts ungrouped rather than deleting them
- [x] Group editor: name, type, archived, with a note saying what the type does
- [x] Account editor gains a group picker, including an explicit "No group"
- [x] Groups screen at `/account-groups`, reached from the Accounts toolbar,
      with drag-to-reorder and per-group account counts

**Tests** (45 added, 565 → 610; plus 10 end-to-end, 59 → 69)
- [x] Unit: ordering and its tiebreaks, new groups landing at the bottom,
      reorder writing only what moved, archive keeping members, delete
      orphaning rather than cascading, membership, `typeOf` falling back to
      `default` for an unknown group, and `kind` having no say in it
- [x] Component: the group editor saves what was typed, keeps `order` and
      `createdAt` across an edit, and reports a failure rather than half-saving
- [x] Component: the account editor's picker files, unfiles, shows an account
      whose group was deleted elsewhere as ungrouped, and leaves the rest of
      the account untouched
- [x] e2e: create a group, file an account into it, delete the group and watch
      the account survive, and a group surviving a lock and unlock
- [x] e2e: `editor-layout.spec.ts` — every editor fills its modal

**The order has three keys, not one.** `order` is assigned per device, so two
devices that each add a group offline will often pick the same number. Without
a tiebreak the list would reshuffle on every sync depending on which row Dexie
happened to return first, so ties fall back to name and then to id — a total
order, and the same one everywhere.

**Deleting a group clears its members explicitly.** The ledger does not cascade,
which is right: a delete that could take accounts with it would be a frightening
thing to have in a financial app. But an absence does not replicate either, so
`remove` writes each member as an ordinary account edit before deleting the
group. Another device learns the accounts moved rather than inferring it.

**A dangling `groupId` is harmless by construction.** A group deleted on another
device arrives here as an absence, so `typeOf` falls back to `default` and the
account appears under "no group" rather than vanishing off the screen. The
picker resolves the same way, so opening such an account and saving it does not
write the dead id straight back.

**What it found: every editor in the app was collapsed.** Adding one row to the
account editor pushed its explanatory note off the bottom, which turned out not
to be about that row at all. An Angular component host is `display: inline`, so
`app-account-editor` never became a flex child of the modal's page wrapper, its
`ion-content` collapsed to a 56px stub, and everything past the first rows was
clipped into a scroll region that ended mid-screen.

The transaction editor — the most-used screen in the app — was rendering its
segment and **nothing else**: no amount, no account, no category, no payee, no
date. It was live on the deployed site. Every one of the 59 end-to-end tests
passed throughout, because Playwright's `fill()` types into an element whether
or not a human could see it, and `ion-content` reported the text as present.

The fix is five hosts made flex children in `global.scss`, with `flex: 1` rather
than `height: 100%` — the first attempt used the latter and pushed the "Delete
account" button, which is a *sibling* of the editor, off the bottom of the
sheet. `editor-layout.spec.ts` asserts the geometry directly and fails on all
five editors when the rule is removed.

### 7.3 Accounts screen grouped ✅

- [x] `core/accounts/sections.ts`, pure: grouping, per-section subtotals in the
      reporting currency, and the owed framing
- [x] Accounts list rendered by group with a subtotal on each heading, using the
      same missing-rate handling as net worth
- [x] Ungrouped accounts under a final "Not in a group" section, not a fake group
- [x] A `credit-card` group reads as money **owed**: a debt shows as a positive
      amount against the word "owed", and the subtotal is the total debt
- [x] Net worth is unchanged — a card debt already subtracts there

**Tests** (30 added, 610 → 640; plus 2 end-to-end, 69 → 71)
- [x] Unit: `displayBalance` both ways including a card in credit; grouping,
      group order, the ungrouped tail, an account with no `groupId` and one
      pointing at an unknown group, empty groups omitted, subtotals, the
      opening-balance fallback, credit vs debit framing, conversion, missing
      rates named once, and a foreign card debt converted before it is flipped
- [x] Component: headings and membership, ungrouped last, subtotals on screen,
      the owed framing, no danger colour on a card, danger kept for an overdrawn
      ordinary account, net worth unmoved by the flip, the excluded-currency
      note, a rate arriving, empty groups hidden, archived accounts excluded
- [x] e2e: a grouped screen with subtotals and net worth, and an account moving
      between groups from its editor

**The flip is display-only, and there is a test that says so.** A card's balance
is negative in the ledger and that is correct — net worth has to subtract it.
`displayBalance` flips the sign for the row and the subtotal only, so the screen
reads like a statement while the arithmetic underneath is untouched.

**An empty group is not shown.** The accounts screen answers "where is my
money"; a heading with nothing under it answers nothing. The group still exists
and is managed on its own screen.

**The ungrouped section has no group rather than a synthetic one.** An invented
"Other" group would turn up in the group picker and in the management screen,
where nobody put it.

**A card is never coloured red.** The first version coloured whatever displayed
negative, which meant a card in credit — the good case — turned red while a
£1,240 debt did not. Danger is now for an overdrawn ordinary account, and a card
section is left alone in both directions.

### 7.4 Card terms ✅

- [x] `creditLimit`, `statementDay`, `dueDay` on `Account`, all optional, all
      meaningless unless the account's group is `credit-card`
- [x] `core/cards/statement.ts`, pure: day-of-month clamping, the last statement
      to have closed, the due date that follows it, and available credit
- [x] Editor shows these fields only for an account in a credit-card group, and
      follows the picker live rather than needing a save and reopen
- [x] A card row reads "$3,760.00 available · due Sep 15", each half appearing
      only if its terms are recorded

**Tests** (38 added, 640 → 678; plus 2 end-to-end, 71 → 73)
- [x] Unit: clamping (31st in February, leap years, 2100), the last statement
      including the day itself and stepping back over a year boundary, due dates
      in the same month and the next, never on the closing day, clamped into a
      shorter month, and a swept property that a bill is never due before the
      statement it belongs to; available credit including over-limit and a card
      in credit; null when no limit is recorded
- [x] Component: the fields appear only for a credit-card group, not for a debit
      one, and follow the picker live; terms save; blank leaves them unset; a
      limit of zero and a day outside the calendar are ignored; the terms are
      cleared when an account stops being a card
- [x] e2e: a card carries its terms end to end, the fields are absent until the
      group makes it a card, and the terms survive a lock and unlock

**The due date is "the next one after", not a special case.** A card closing on
the 25th and due on the 15th is due next month; one closing on the 1st and due
on the 20th is due this month. Stating the rule as the next date carrying the
due day, strictly after the close, covers both — and cannot produce a bill due
before the statement exists, which a test sweeps a year of closings to check.

**A day past the end of a short month falls on that month's last day.** A card
closing on the 31st closes on the 28th in February rather than skipping the
cycle, and the editor says so under the fields.

**Terms are cleared when an account stops being a card.** A limit left behind on
a current account would be read as real by anything that later asks what credit
is available.

**"Unknown" and "nothing left" must not look the same.** `availableCredit`
returns null rather than zero when no limit is recorded, so a card with no limit
says nothing about available credit instead of implying it is exhausted.

### 7.5 Pay the bill ✅

- [x] `summariseStatement` in `core/cards/statement.ts`, pure: the closed
      statement balance, payments made since, what is left, and the balance today
- [x] `PayBillService` — summarise a card, and record a payment
- [x] "Pay" on a card row, opening a sheet: statement balance / full balance /
      another amount, a funding account, a date
- [x] A "Bills due" card on the Summary screen, shown only when something is due
      within a fortnight

**Tests** (57 added, 678 → 735; plus 2 end-to-end, 73 → 75)
- [x] Unit (statement): debts stated positive, the opening balance counted,
      spending after the close left off, spending *on* the closing day counted,
      payments since the close credited, an overpayment floored at nothing due
      while the credit survives in the balance, other accounts' transactions
      ignored, future-dated transactions ignored, an unpaid statement carried
      into the next cycle; `daysBetween` across months, years and both daylight
      saving changes; `isDueSoon` inside, outside, on the day, and overdue
- [x] Unit (service): a payment is an ordinary transfer, it settles the
      statement it was meant to, and it refuses nothing, a negative, a card
      paying itself, and a cross-currency payment — naming both currencies
- [x] Component: which accounts may fund a payment and which may not, the
      default choice, the three amounts, nonsense treated as nothing, and a
      refusal surfacing rather than appearing to succeed
- [x] Component (dashboard): nothing shown without cards, without terms, or
      without a balance; a due bill shown with what is left; archived cards left
      out; "due today", "due tomorrow", "due in 9 days"
- [x] e2e: pay a card from a current account and watch both balances move, the
      Pay button disappear, and the payment appear in the register as a transfer

**A payment is an ordinary transfer.** There is no payment kind and no new
field. A second way to spell a transfer would mean every report, every balance
and every adapter had to learn about both, and the ledger already models "money
leaves here and arrives there" exactly.

**Cross-currency payments are refused, not invented.** A transfer carries one
amount, so paying a dollar card from a euro account would need a rate — and a
rate chosen here is a number in the register that the bank never used. The
funding list only offers accounts in the card's currency, the service refuses
the rest by name, and the sheet says why when there is nothing to offer.

**Another credit card is never offered as a funding account.** Paying a card
with a card is not something this app models.

**The statement figure is what is *due*, not what is owed.** Spending since the
close belongs to the statement that has not closed yet; paying it early is a
choice, so it appears under "full balance" instead. An overpayment floors the
bill at nothing due rather than showing a negative one, and the credit shows up
in the balance where it belongs.

**The card only appears when a bill is actually due.** A summary card that
permanently says "nothing due" is one people stop reading.

---

## Known gaps

Real, currently unaddressed, and each one has a home above.

| Gap | Impact | Where it gets fixed |
| --- | --- | --- |
| ~~A long-lived vault re-downloads its whole history on a new device~~ | — | ✅ Closed in 6.3 (snapshots) |
| ~~Objects a snapshot covers are never removed~~ | — | ✅ Closed: `remove` on the adapter contract, `DELETE /v1/objects` on the server, and the S3 and Git equivalents |
| `MaterialiserService.run` writes up to 500 rows one at a time | Slow enough that a test had to cap it; a first launch catching up years would feel it | Open — batch the writes if it ever matters |
| ~~Git adapter has no integration test~~ | — | ✅ Closed: `git http-backend` in the e2e suite. **It found two bugs that made Git sync entirely non-functional** — see below |
| ~~S3 adapter has no integration test~~ | — | ✅ Closed: MinIO in Docker. Passed first time |
| `remove` is unproven against S3 and Git | Pruning is covered against the Go server and by unit tests, but the S3 and Git delete paths have not run against a real remote | Open. Needs a snapshot to trigger, which needs 200 operations — worth a seeded fixture rather than driving the UI |
| ~~A deleted transaction can come back if the app reloads immediately after~~ | — | ✅ Closed. **It was the test, not the app** — see "The flaky delete" below |
| The accounts list shows `kind` as its stored value | Cosmetic: a row reads "bank" rather than "Bank account" | Open, small. Now that `AccountKind` is documented as presentation, showing the raw enum is the one place that still contradicts it — the label belongs beside the icon it already picks |
| A loan has no "Pay" flow | A repayment is recorded by hand as a transfer, which works but is more typing | Open. The payment sheet is card-shaped ("statement balance", "bill"); generalising it to repayments is a small, deliberate piece of work |
| ~~Git sync to GitHub needs a CORS proxy on the web~~ | — | ✅ Addressed: `cors-proxy/` is a Cloudflare Worker to deploy in five minutes, documented in `docs/CORS_PROXY.md`. The browser limitation itself is not fixable — GitHub sends no `Access-Control-Allow-Origin` and answers the preflight with 405 — so the remaining options are the proxy, the Android app, the Go server or S3 |
| ~~The app ships the Angular and Capacitor default logos~~ | — | ✅ Closed: one source mark in `app/src/assets/icon/icon-glyph.svg`, every raster composed by `npm run icons` |
| Generated icons can go stale | If the mark is edited without re-running `npm run icons`, the rasters drift from their source | Open, deliberately unchecked: a byte-comparison in CI would depend on the exact Chrome and OS doing the rendering, so it would fail for reasons unrelated to the icon |
| No rate limiting on the server | A leaked token can be used to exhaust disk | Server hardening, unscheduled — quotas blunt it today |
| Single currency assumed in UI totals | Dashboard uses the first account's currency | Phase 5 |
| Category deletion leaves transactions uncategorised | Silent, no warning | Small fix, fold into 2.3 |
| ~~Deleting a category leaves it referenced in `Budget.categoryIds`~~ | — | ✅ Closed in 2.2 |
| `BudgetsService.statuses` and `ReportsService` read the whole transaction table | Fine for a personal ledger, wrong for a large one | Still open. Net worth genuinely needs the whole history, so a windowed query only helps the other aggregations; worth doing when a ledger large enough to notice exists |
| Reports have no per-category drill-down | Tapping a bar does nothing | Unscheduled; the Activity screen already filters by category |
| Android build needs JDK 21 | JDK 25 is rejected by this Gradle | Documented in `docs/DEPLOYMENT.md`; revisit on Gradle upgrade |

## Phase 8 — Accounts in totals

Settings → **Accounts in totals**: a switch per account deciding whether it is
part of net worth and the balance sheet. Everything else about the account is
untouched — its transactions, its register, its own balance on screen.

### 8.1 The setting ✅

- [x] `Account.excludedFromTotals`, optional
- [x] `core/accounts/totals.ts` — `countsInTotals`, the single place that decides
- [x] `AccountsService.counted`, `netWorthDetail.excluded`, `setCountedInTotals`
- [x] Section subtotals skip excluded accounts and report how many
- [x] A settings screen at `/settings/totals`, and Settings says "3 of 4 accounts"
- [x] The accounts screen marks an excluded row "not counted" and says how many
      the headline leaves out, with a link to change it

**Tests** (25 added, 735 → 760; plus 5 end-to-end, 75 → 80)
- [x] Unit: absent means counted, explicit false means counted, true means not
- [x] Unit (sections): an excluded account is still listed but not added in, is
      not reported as an unconverted currency, and is left out of what a card
      section says is owed
- [x] Component: the list, its groups, archived accounts kept out, switching off
      and on again, net worth moving, the account and its transactions left
      alone, and the change replicating as an ordinary account edit
- [x] e2e: default, switching off, the accounts and summary screens agreeing,
      an excluded account still recording transactions, and the choice
      surviving a lock and unlock

**The field is an exclusion, not an inclusion.** The absent value has to mean
"counted", or shipping this would silently empty every existing ledger's net
worth. A test says so in as many words.

**An excluded account is still shown, and still says so.** It keeps its row and
its balance, marked "not counted", and the header says how many are left out
with a link to the setting. A subtotal that quietly disagreed with the rows
above it would be worse than either number alone.

**Archived is not the same thing.** Archiving hides an account; excluding keeps
it on screen and out of the arithmetic. Archived accounts were already left out
of totals, and the screen says so rather than offering a switch that would not
mean anything.

### 8.2 Transfers are not expenses ✅

Asked directly: does paying a credit card book the expense twice? It does not,
and now there is a suite that will fail if that ever changes.

`core/accounts/no-double-count.spec.ts` drives the real services: spend on a
card, then pay the card from a current account, and assert that

- exactly two transactions exist, one expense and one transfer;
- the period totals count 200 of spending, not 400;
- exactly one transaction counts towards a budget;
- net worth is down by the purchase and unmoved by the payment;
- both balances move by the payment, in opposite directions;
- a period containing only the payment reports no spending at all.

The guarantee was already there — `totalsFor`, `countsTowards`, `spendByCategory`
and the month totals each skip transfers, and `signedFor` nets a transfer to
zero across the two accounts. What was missing was a test saying so from the
outside, in the terms someone would actually ask the question.

**One expectation of mine was wrong and worth keeping.** A payment made *before*
the statement closes is on that same statement, so the statement closes at
nothing owed rather than showing the purchase. Both arrangements — paid before
the close, and paid after it — now have a test.

---

## Phase 9 — Assets and liabilities

Credit card balances and loans are money **owed**, and the accounts screen now
says so: two halves, each totalled, with net worth explained as the difference
rather than merely asserted.

### 9.1 A loan is a group type ✅

- [x] `'loan'` added to `AccountGroupType`, with its own label, icon and note
- [x] `core/accounts/classification.ts` — `sideOfType`, `sideOf`, `readsAsOwed`
- [x] `AccountGroupsService.isLiability`

### 9.2 The balance sheet ✅

- [x] `AccountSection.side`, and `balanceSheet(sections)` → assets, liabilities, net
- [x] Accounts screen renders **Assets** then **Liabilities**, each with a total,
      groups nested underneath
- [x] Headline carries both figures beside net worth; liabilities in danger
      colour when there is a debt
- [x] Summary's net worth card reads "$14,200.00 held less $6,240.00 owed", only
      once something is owed
- [x] A loan reads as owed, exactly like a card
- [x] Liability accounts are not offered as a way to pay a card bill

**Tests** (25 added, 760 → 785; plus 2 end-to-end, 80 → 82)
- [x] Unit (classification): cards and loans are liabilities, ordinary and debit
      groups are not, ungrouped is an asset, `kind` has no say, and `readsAsOwed`
      is checked to be *exactly* the liability set so the two cannot disagree
- [x] Unit (sections): sides assigned, a loan read as owed, an overdrawn ordinary
      account staying an asset, and `balanceSheet` totalling each side, netting
      to the existing net worth figure, handling an empty ledger, a cleared card,
      and accounts excluded from totals
- [x] Component: the split, the totals, the net matching net worth, both halves
      named on screen, a loan shown as owed and not coloured, no liabilities half
      when nothing is owed, and Pay offered on a card but not a loan
- [x] e2e: cards and loans under Liabilities with cash under Assets, no minus
      signs on a debt, net worth unrestated, and a loan absent from the funding
      picker

**Classification is by what an account is, not by its balance.** A current
account overdrawn this week is an asset that happens to be negative; it does not
become a loan. A credit card paid off to zero is still a liability with nothing
on it. Classifying by balance would shuffle accounts between the two halves as
money came and went, which is not what a balance sheet does.

**Ungrouped is an asset, deliberately.** A balance appearing under "held" when
it should have been "owed" is visible and correctable; the reverse would quietly
overstate someone's debts.

**`readsAsOwed` is defined as the liability set, not alongside it.** The moment
"shows as owed" and "counts as a liability" could be edited apart, one of the
two screens would be lying. A test asserts they agree for every type.

**Net worth is unchanged.** It was always assets minus liabilities; showing both
halves explains the figure rather than restating it, and a test pins the two
together.

**What this deliberately did not add.** A loan is a liability shown as owed, but
it gets no Pay button: that sheet is written about a card's statement and bill,
and offering it for a loan would present a flow nobody designed for repayments.
Recording a repayment by hand as a transfer works exactly as it always did.
Generalising the sheet to loan repayments is a real follow-up, not a side effect.

## Phase 11 — Categories and subcategories

Categories have been seeded and never managed: there is no screen to add, rename
or remove one. `Category.parentId` has existed since v1, is indexed, and is read
by nothing — subcategories are modelled and unused.

**The transaction stores the leaf.** Filing a transaction under *Food → Lunch*
sets `categoryId` to Lunch. Storing both would be two fields that can disagree,
and storing only the parent would throw away the detail the subcategory exists
to record.

**Which means roll-up is part of this task, not a follow-up.** Budgets match on
exact `categoryId` and reports group by it, so without roll-up, adding a
subcategory would silently stop an existing budget counting a transaction and
split one category's spending into several rows. A budget on a parent counts its
children; a report groups children under their parent.

### 11.1 Model, ordering and roll-up ✅

- [x] `core/categories/tree.ts`, pure: `compareCategories`, `buildTree`,
      `rootIdOf`, `rootIds`, `descendantIds`, `withDescendants`
- [x] `CategoriesService`: the tree, parents, children, `pathOf`, and deleting a
      parent taking its subcategories with it
- [x] No stored position: categories sort by name. Asked for and declined —
      hand-ordering is a field to keep correct across devices, a drag handle on
      every row, and a reorder path in the log, for a list people read
      alphabetically anyway
- [x] Budgets expand their categories to cover subcategories; reports and the
      summary card roll subcategory spending up to the parent

**Tests** (43 added, 806 → 849)
- [x] Unit (tree): ordering by name with an id tiebreak, nesting, keeping kinds
      apart, promoting an orphan rather than dropping it, refusing to nest below
      one level, and each roll-up helper
- [x] Unit (service): the tree, parents, children, `pathOf`, deleting a parent
      taking its children, replicating every removal, and counting what a
      deletion would leave uncategorised
- [x] `rollup.spec.ts` — the guarantee this phase turns on, stated end to end:
      subcategory spending counts against a parent budget and appears as one
      report row, through the real `BudgetsService`

**One level, not a tree.** `parentId` points at a top-level category and nothing
points at a subcategory. Deeper nesting would mean every total had to decide how
far to roll up, and a personal ledger has no use for "Food → Eating out → Lunch
→ Tuesday". `buildTree` enforces it: anything pointing at a subcategory is
treated as top-level rather than trusted.

**An orphan is promoted, not dropped.** A subcategory whose parent was deleted
on another device appears at the top level. One on screen can be moved or
deleted; one that has silently vanished cannot.

**The roll-up is the point.** Before this, every transaction carried a top-level
category and budgets matched it exactly. The moment one is filed under
"Food → Lunch" an exact match stops seeing it: a budget under-counts and a
report splits one category into several rows, neither of which announces itself.
`rollup.spec.ts` keeps a test of the *old* behaviour — a budget on Food missing
Lunch without the expansion — because that is the assumption a reader would
otherwise carry.

### 11.2 Managing them ✅

- [x] Settings → **Income categories** and **Expense categories**, a route each
- [x] Each lists its categories by name with a subcategory count and the first
      few named, and deletes with a warning that says what goes
- [x] A **Subcategories** switch, vault-wide so two devices agree
- [x] The editor adds, renames and removes subcategories inline

### 11.3 Picking one ✅

- [x] The transaction editor opens a grid rather than walking a select
- [x] A category with subcategories expands in place; choosing one files the
      transaction under it and closes
- [x] Choosing the parent stays possible — plenty of spending is just
      "Transport", and the tap that chooses it also opens its children
- [x] The row reads "Groceries › Corner shop", so the choice is unambiguous

**Tests** (22 added, 849 → 871; plus 7 end-to-end, 84 → 91)
- [x] Component (picker): the grid's contents, choosing a parent opening its
      children, staying open afterwards, closing when there is nothing beneath,
      collapsing on a second tap, opening on an existing choice's parent, and
      the switch hiding the second level
- [x] Component (list): the kinds apart, counts and previews, the preview
      trimming, the switch hiding without deleting, archived kept apart
- [x] e2e: the two screens, adding a category, adding subcategories and seeing
      them previewed, the switch, filing a transaction under a subcategory, the
      full path on the row, subcategory spending appearing under its parent on
      the summary, and the deletion warning naming what it takes

**The switch hides, it does not delete.** Turning subcategories off leaves them
in the ledger and leaves the transactions filed against them counting towards
their parent. Turning a display preference into a data migration would be a
cruel thing to do to someone who only wanted a shorter list.

**Choosing a parent also opens it.** One tap does both, so the specific choice
is a second tap rather than a different gesture, and a category with nothing
underneath closes the sheet immediately.

**What the grid is for.** A select walks thirty names one at a time, and has
nowhere to put a second level. The grid puts a vault's categories on one screen,
which matters for the thing people do several times a day.

**A link inside a sheet is a trap.** The picker's pencil was a `routerLink` to
the management screen. Navigating unmounted the transaction editor that owns the
overlay — so the URL became `/settings/categories/expense` while the picker
stayed on top of it: a dead sheet over a page nobody could reach, and the
half-written transaction gone with it. It opens the manager *over* the picker
now, which is also the better answer to "I need a category that does not exist
yet": nothing is lost and the new category is offered the moment it is saved.
`CategoriesPage` takes its kind as an input when presented that way, and shows
Done instead of a back button.

**One bug worth recording.** The picker collapsed the moment it expanded:
choosing a parent emitted the id, which came straight back as `selected`, and an
effect that set the expansion unconditionally read that category's null parent
and closed what the tap had just opened. The effect now only ever opens. That is
the fourth time a signal-reading effect has undone something the user just did —
see the testing notes.

---

---

## Phase 10 — Starter accounts

A new vault now arrives with a group of each kind and accounts in every one:
Everyday (Cash, Current account), Savings, Credit cards, Debit cards, Loans.

`AccountGroupsService.seedIfEmpty` follows the precedent the categories seed
set — "a new vault starts with categories so the first transaction is one tap".
Until now you could not record anything at all without first creating an
account, which is a worse first minute than a few labelled empty shelves.

- [x] `STARTER_GROUPS`, one group per type, each with at least one account
- [x] Seeded from the vault screen alongside the categories, on creation only
- [x] Guarded on **both** tables being empty, so a device joining an existing
      vault and a ledger that predates groups are both left alone

**Every opening balance is zero.** A starter account is a labelled empty shelf.
Inventing a balance would put numbers in someone's ledger that they never
entered, and a financial record that starts out wrong is worse than one that
starts out bare.

**Tests** (13 added, 785 → 798; plus 2 end-to-end, 82 → 84)
- [x] Unit: a group of every type, every group holding an account, nothing
      ungrouped, zero balances, the reporting currency, all counted in totals,
      idempotent on a second run, skipped when accounts already exist, skipped
      when groups already exist, replicating as ordinary operations
- [x] e2e: a fresh vault showing both halves of the balance sheet with every
      starter group and account, no invented money, and the starters behaving
      like ordinary data when renamed

### What seeding found

Changing the starting state broke 23 end-to-end tests. Most were name
collisions and were mechanical. Three were not.

**Every cleared liability read "−$0.00 owed".** `displayBalance` negated a zero
balance into `-0`. The same bug had already been fixed in `statement.ts` and
not in `sections.ts` — the sort of thing that only shows up when a screen has a
liability account with nothing on it, which no test had until the seed created
five of them.

**The floating add button swallowed taps on the last row.** With a long enough
list, a row scrolls as far as it can and stops underneath the button, which then
intercepts every tap aimed at it — including "Pay" on a card, the one control
that screen exists for. Scrolling cannot help: the button is fixed. The content
now leaves 88px for it to sit over.

**An editor reset itself whenever the accounts changed.** The transaction
editor's effect read `accounts.active()` to default the account, so the effect
re-ran on *any* write to the accounts table — and that effect resets the whole
form. A sync landing, another tab, or the seed finishing would silently wipe a
half-written transaction: amount, payee, date, note, all of it, with nothing on
screen to say why.

Only `existing()` is tracked now; the rest runs `untracked`, and a second,
narrower effect fills in the default account once the list arrives — but only
while the field is still empty, so a user's choice is never overwritten. The
account editor had the same shape and got the same treatment. Two tests pin it:
typing survives an account arriving, and a new account that would sort first
does not steal the transaction.

This is the third time a signal-reading effect has quietly undone user input
(the pay-bill funding account was the first). **An `effect` that resets a form
must track only the thing that means "start again".**

---

---

## The flaky delete

`recurring.spec.ts` "a deleted occurrence stays deleted" failed about three runs
in eight for as long as it had existed. It looked like the worst kind of bug: on
a failing run the operation log held only the `put`, with no tombstone, and the
row was still in the table — a delete the user had asked for, lost.

It was not a bug in the app. It was two faults in the test, stacked so that each
hid the other.

**The assertion passed for the wrong reason.** The test tapped "Delete
transaction" and immediately asserted that no "Rent" heading remained, scoped by
role to `app-transactions`. While a modal is open, Ionic takes the page behind
it out of the accessibility tree, so `getByRole` there matches *nothing*. The
assertion was satisfied the moment the editor opened. Measured directly at that
point: the DOM still held the row (`h3` count 1) while the role query returned 0.

**So the reload raced the write.** With the assertion passing instantly, the
test reloaded while `LedgerService.remove` was still inside its IndexedDB
transaction. Probes placed in the ledger showed the order plainly — the test's
"about to reload" line printed *before* the row was deleted, every single run —
and when the reload won, the whole transaction went with it: no row removed, no
tombstone written, which is exactly the consistent, atomic outcome the operation
log is designed to give. Nothing was half-written. The write simply never
happened.

**The fix is one wait, and it is the honest one.** The editor closes only after
its write resolves, so waiting for the modal to close both makes the absence
assertion meaningful and guarantees the change reached the database.
`waitForEditorClosed` in `e2e/helpers.ts` carries that explanation, and the same
pattern was fixed in `data.spec.ts`, which deleted a transaction the same way.
Twelve consecutive runs of the previously flaky test now pass.

**Every probe was thrown away.** The diagnosis needed instrumentation inside
`LedgerService`, and that instrumentation changed what it measured — adding any
await before the reload made the test pass. Two earlier conclusions drawn from
single samples were wrong: that Phase 7.1 had introduced the failure (it had
not — the same test fails the same way three commits earlier), and that the
transaction was hanging (a probe whose anchor never matched, so the logs it
"proved" absent were never compiled in). Both were caught by going back and
measuring rather than by reasoning further.

---

## Adapter integration tests

`e2e/git-sync.spec.ts` and `e2e/s3-sync.spec.ts` drive the app against a real
Git remote and a real S3 store, and run as their own CI job.

Git uses `git http-backend` — the CGI program every Git host runs — wrapped in a
small Node server (`e2e/servers/git-http.mjs`) that adds the CORS headers a
public host would not. S3 uses MinIO in a container, which speaks the same API
as AWS, R2 and B2. Both skip cleanly where their dependency is missing.

**This closed a gap that was hiding two complete failures of the Git adapter.**
Both were invisible to unit tests, to the type checker and to the linter,
because a stub adapter agrees with whatever the code does:

1. **`Missing Buffer dependency`.** `isomorphic-git` is written against Node's
   `Buffer`, and Angular does not polyfill Node globals — so the adapter threw
   on its first real request. Git sync had never worked in a browser at all.
2. **`Could not find main`.** `clone` fails against an empty repository, which
   is exactly what someone creates when they make a repo for this and point the
   app at it. The adapter now asks for the remote's refs first and initialises a
   local history when there are none, letting the first push create the branch.

The S3 adapter passed on the first run, which is worth recording too: the value
of the exercise was not that everything was broken, but that nothing had been
checked.

## Testing notes

Things learned the hard way, worth not relearning:

- **Never sleep for a `liveQuery`.** Poll the condition (`core/testing/async.ts`).
  A fixed span passes on an idle machine and fails on a loaded one.
- **Scope every assertion to its screen.** Ionic keeps departed pages in the DOM,
  and the Summary screen has cards whose titles repeat elsewhere. A page-wide
  `textContent` check proves very little — one such assertion passed for entirely
  the wrong reason in 2.4.
- **`element.click()` is not a tap.** It bypasses hit-testing, which is why a
  duplicate router outlet made every floating action button unclickable without
  a single test noticing.
- **Look at the thing.** Colour can be validated by script and geometry by
  assertion; neither can see a stranded label or a chart that reads as broken.
  Both chart tasks found a real defect that way and only that way.
- **A stub agrees with whatever you wrote.** The Git adapter was unit-tested,
  typed and linted, and had never once worked. Anything that speaks a protocol
  needs to speak it to something that did not come from this repository.
- **An `effect` that resets a form must track only the thing that means "start
  again".** Three separate editors reset themselves whenever an unrelated signal
  they happened to read changed — silently discarding whatever had been typed.
  Read the trigger, then do the rest inside `untracked`.
- **A sheet must not navigate.** An Ionic overlay lives at the app root, so
  routing away destroys the component holding its state but leaves the overlay
  on screen — over whichever page loaded next. Open another sheet instead.
- **`surface()` and `tapAdd` take the topmost sheet.** With a sheet on a sheet,
  the first `ion-modal.show-modal` is the one furthest underneath, and typing
  into it reaches a form nobody can see.
- **A money figure appears more than once on a screen.** `toContainText('$1,000.00')`
  on a whole page matched an account's own row balance, not the headline it was
  meant to check — so the assertion passed before the switch had written
  anything, and the reload that followed lost the write. Scope a total to the
  element that shows it. This is the same failure as the delete below, in a
  different costume.
- **An open modal hides the page behind it from `getByRole`.** Ionic takes the
  page underneath out of the accessibility tree, so a role-scoped assertion that
  a row is *gone* passes the instant the modal opens — while the row is still in
  the DOM and still in the database. Before asserting an absence, or reloading,
  wait for the editor to close (`waitForEditorClosed`): that is also the signal
  the write has resolved.
- **A passing test is not a visible screen.** Every editor in the app rendered
  into a collapsed `ion-content` — the transaction editor showed its segment and
  no fields at all — through 59 green end-to-end tests, because `fill()` and
  `getByRole` reach an element whether or not it is on screen. Where a screen's
  *layout* is the thing that matters, assert geometry, and look at it.
- **A deployment is not a build.** The Pages workflow built and uploaded cleanly
  for weeks while hardcoding `--base-href /easy-docket/`. On the custom domain
  `docket.xiidea.net` the site serves from the root, so every asset URL 404'd
  and the page was an empty shell. The base path now comes from
  `actions/configure-pages` (`""` for a custom domain, `"/easy-docket"` for a
  project site). Green checkmarks say nothing about whether the site loads —
  open it.

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
