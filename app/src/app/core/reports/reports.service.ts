import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { rootIds } from '../categories/tree';
import { DOCKET_DB } from '../db/db.token';
import { RatesService } from '../repositories/rates.service';
import { DocketDb } from '../db/docket-db';
import { Account, Category, Transaction } from '../models/domain';
import { DateRange, currentMonth, formatMonth, toIsoDate } from '../util/dates';
import {
  CategoryTotal,
  MonthlyFlow,
  NetWorthPoint,
  PayeeTotal,
  flowByMonth,
  netWorthOver,
  spendByCategory,
  topPayees,
  totalsFor,
  unconvertedIn,
} from './aggregate';

/** The ranges offered in the reports filter row. */
export type RangePreset = 'month' | 'quarter' | 'half' | 'year' | 'twelve';

export interface RangeOption {
  id: RangePreset;
  label: string;
}

export const RANGE_OPTIONS: readonly RangeOption[] = [
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'Last 3 months' },
  { id: 'half', label: 'Last 6 months' },
  { id: 'twelve', label: 'Last 12 months' },
  { id: 'year', label: 'This year' },
];

/** Everything the reports screen draws, for one range. */
export interface ReportData {
  range: DateRange;
  categories: CategoryTotal[];
  flow: MonthlyFlow[];
  netWorth: NetWorthPoint[];
  payees: PayeeTotal[];
  totals: { income: number; expense: number; net: number };
  currency: string;
  /** Transactions in the range with no rate to the reporting currency. */
  unconverted: number;
}

/**
 * Reporting data for the current range.
 *
 * The whole transaction table is read, as the balances and budgets do. Net
 * worth genuinely needs it — the figure on any date is everything that ever
 * happened up to it — and for a personal ledger the rest is not worth a second
 * access pattern. The cost is recorded in `task.md` rather than pre-emptively
 * optimised away.
 */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly rates = inject(RatesService);

  readonly preset = signal<RangePreset>('month');

  readonly range = computed(() => rangeFor(this.preset()));

  private readonly ledger = toSignal(
    from(
      liveQuery(async () => {
        const [transactions, accounts, categories] = await Promise.all([
          this.db.transactions.toArray(),
          this.db.accounts.toArray(),
          this.db.categories.toArray(),
        ]);
        return { transactions, accounts, categories };
      }),
    ),
    {
      initialValue: {
        transactions: [] as Transaction[],
        accounts: [] as Account[],
        categories: [] as Category[],
      },
    },
  );

  readonly categoryNames = computed(
    () => new Map(this.ledger().categories.map((category) => [category.id, category.name])),
  );

  readonly data = computed<ReportData>(() => {
    const { transactions, accounts, categories } = this.ledger();
    const range = this.range();
    const reporting = this.rates.reportingCurrency();

    return {
      range,
      // Rolled up: spending filed under "Food → Lunch" belongs to Food here.
      // A report that split one category across its subcategories would answer
      // a question nobody asked.
      categories: spendByCategory(transactions, range, reporting, rootIds(categories)),
      flow: flowByMonth(transactions, range, reporting),
      netWorth: netWorthOver(accounts, transactions, range, reporting, (currency) =>
        this.rates.rateToReporting(currency),
      ),
      payees: topPayees(transactions, range, reporting, 8),
      totals: totalsFor(transactions, range, reporting),
      currency: reporting,
      unconverted: unconvertedIn(transactions, range, reporting),
    };
  });

  /** Whether there is anything at all to report on. */
  readonly hasHistory = computed(() => this.ledger().transactions.length > 0);

  nameFor(categoryId: string | null): string {
    if (categoryId === null) return 'Uncategorised';
    return this.categoryNames().get(categoryId) ?? 'Deleted category';
  }

  labelFor(month: string): string {
    return formatMonth(month);
  }

  setPreset(preset: RangePreset): void {
    this.preset.set(preset);
  }
}

/** Ranges end today rather than at a month boundary: a report about the future is noise. */
export function rangeFor(preset: RangePreset, today = new Date()): DateRange {
  const to = toIsoDate(today);

  switch (preset) {
    case 'month':
      return currentMonth(today);
    case 'quarter':
      return { from: monthsBack(today, 2), to };
    case 'half':
      return { from: monthsBack(today, 5), to };
    case 'twelve':
      return { from: monthsBack(today, 11), to };
    case 'year':
      return { from: `${today.getFullYear()}-01-01`, to };
  }
}

/** The first day of the month `count` months before the given date. */
function monthsBack(today: Date, count: number): string {
  return toIsoDate(new Date(today.getFullYear(), today.getMonth() - count, 1));
}
