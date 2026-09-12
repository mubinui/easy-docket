import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { rootIds } from '../categories/tree';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { Transaction } from '../models/domain';
import { inReporting } from '../money/conversion';
import { DateRange, currentMonth } from '../util/dates';
import { LedgerService } from './ledger.service';
import { CategoriesService } from './categories.service';
import { RatesService } from './rates.service';

/**
 * What a caller must supply to record a transaction. Everything else — note,
 * tags, cleared flag, timestamps — has a sensible default, so the common case
 * stays a short call.
 */
export type TransactionDraft = Pick<
  Transaction,
  'id' | 'kind' | 'amount' | 'currency' | 'accountId' | 'date'
> &
  Partial<Transaction>;

export interface TransactionFilter {
  range: DateRange;
  accountId: string | null;
  categoryId: string | null;
  search: string;
}

@Injectable({ providedIn: 'root' })
export class TransactionsService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly ledger = inject(LedgerService);
  private readonly rates = inject(RatesService);
  private readonly categories = inject(CategoriesService);

  /** The window the transactions screen is looking at; drives the live query. */
  readonly filter = signal<TransactionFilter>({
    range: currentMonth(),
    accountId: null,
    categoryId: null,
    search: '',
  });

  /**
   * Transactions for the active filter, newest first.
   *
   * The date range is applied by IndexedDB using the `date` index, so a vault
   * with years of history still only reads the month on screen. The remaining
   * predicates run in memory over that much smaller set.
   */
  readonly visible = toSignal(
    from(
      liveQuery(async () => {
        const { range, accountId, categoryId, search } = this.filter();
        const rows = await this.db.transactions
          .where('date')
          .between(range.from, range.to, true, true)
          .reverse()
          .sortBy('date');

        const needle = search.trim().toLowerCase();
        return rows.filter((txn) => {
          if (accountId && txn.accountId !== accountId && txn.counterAccountId !== accountId) {
            return false;
          }
          if (categoryId && txn.categoryId !== categoryId) return false;
          if (needle) {
            const haystack = `${txn.payee} ${txn.note} ${txn.tags.join(' ')}`.toLowerCase();
            if (!haystack.includes(needle)) return false;
          }
          return true;
        });
      }),
    ),
    { initialValue: [] as Transaction[] },
  );

  /**
   * Income and expense totals over the visible set, in the reporting currency.
   *
   * Transfers are excluded, and anything with no rate is counted rather than
   * added at face value: a month's total that treated €45 as $45 would be
   * wrong in a way nobody would notice.
   */
  readonly totals = computed(() => {
    const reporting = this.rates.reportingCurrency();
    let income = 0;
    let expense = 0;
    let unconverted = 0;

    for (const txn of this.visible()) {
      if (txn.kind === 'transfer') continue;

      const amount = inReporting(txn, reporting);
      if (amount === null) {
        unconverted++;
        continue;
      }
      if (txn.kind === 'income') income += amount;
      else expense += amount;
    }
    return { income, expense, net: income - expense, unconverted, currency: reporting };
  });

  /** Visible transactions grouped by day, for a sectioned list. */
  readonly byDay = computed(() => {
    const groups = new Map<string, Transaction[]>();
    for (const txn of this.visible()) {
      const bucket = groups.get(txn.date);
      if (bucket) bucket.push(txn);
      else groups.set(txn.date, [txn]);
    }
    return [...groups.entries()].map(([date, items]) => ({ date, items }));
  });

  /** Spend per category over the visible set, largest first, in the reporting currency. */
  readonly spendByCategory = computed(() => {
    const reporting = this.rates.reportingCurrency();
    const totals = new Map<string, number>();
    // Subcategory spending belongs to its parent on the summary card, the same
    // way it does in reports.
    const roots = rootIds(this.categories.all());

    for (const txn of this.visible()) {
      if (txn.kind !== 'expense') continue;

      const amount = inReporting(txn, reporting);
      if (amount === null) continue;

      const key = txn.categoryId !== null ? (roots.get(txn.categoryId) ?? txn.categoryId) : 'uncategorised';
      totals.set(key, (totals.get(key) ?? 0) + amount);
    }
    return [...totals.entries()]
      .map(([categoryId, amount]) => ({ categoryId, amount }))
      .sort((a, b) => b.amount - a.amount);
  });

  setRange(range: DateRange): void {
    this.filter.update((current) => ({ ...current, range }));
  }

  patchFilter(partial: Partial<TransactionFilter>): void {
    this.filter.update((current) => ({ ...current, ...partial }));
  }

  async get(id: string): Promise<Transaction | undefined> {
    return this.db.transactions.get(id);
  }

  async recentPayees(limit = 20): Promise<string[]> {
    const rows = await this.db.transactions.orderBy('date').reverse().limit(200).toArray();
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.payee) seen.add(row.payee);
      if (seen.size >= limit) break;
    }
    return [...seen];
  }

  async save(draft: TransactionDraft): Promise<Transaction> {
    const transaction = {
      counterAccountId: null,
      categoryId: null,
      note: '',
      tags: [],
      cleared: true,
      createdAt: Date.now(),
      updatedAt: '',
      ...draft,
      // Direction is carried by `kind`, so the stored amount is always positive.
      amount: Math.abs(draft.amount),
    } as Transaction;

    assertValid(transaction);
    return this.ledger.put('transactions', transaction);
  }

  async remove(id: string): Promise<void> {
    await this.ledger.remove('transactions', id);
  }
}

function assertValid(txn: Transaction): void {
  if (txn.amount <= 0) throw new Error('Amount must be greater than zero');
  if (!txn.accountId) throw new Error('An account is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(txn.date)) throw new Error('Date must be YYYY-MM-DD');

  if (txn.kind === 'transfer') {
    if (!txn.counterAccountId) throw new Error('A transfer needs a destination account');
    if (txn.counterAccountId === txn.accountId) {
      throw new Error('A transfer needs two different accounts');
    }
  }
}

