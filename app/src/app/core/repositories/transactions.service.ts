import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { Transaction } from '../models/domain';
import { LedgerService } from './ledger.service';

/** Inclusive date range in `YYYY-MM-DD` form. */
export interface DateRange {
  from: string;
  to: string;
}

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

  /** Income and expense totals over the visible set; transfers are excluded. */
  readonly totals = computed(() => {
    let income = 0;
    let expense = 0;
    for (const txn of this.visible()) {
      if (txn.kind === 'income') income += txn.amount;
      else if (txn.kind === 'expense') expense += txn.amount;
    }
    return { income, expense, net: income - expense };
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

  /** Spend per category over the visible set, largest first. */
  readonly spendByCategory = computed(() => {
    const totals = new Map<string, number>();
    for (const txn of this.visible()) {
      if (txn.kind !== 'expense') continue;
      const key = txn.categoryId ?? 'uncategorised';
      totals.set(key, (totals.get(key) ?? 0) + txn.amount);
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

/** `YYYY-MM-DD` for a date in the *local* calendar, not UTC. */
export function toIsoDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function currentMonth(today = new Date()): DateRange {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: toIsoDate(first), to: toIsoDate(last) };
}

export function shiftMonth(range: DateRange, delta: number): DateRange {
  const anchor = new Date(`${range.from}T00:00:00`);
  return currentMonth(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));
}
