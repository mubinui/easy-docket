import { Account, Minor, Transaction } from '../models/domain';
import { DateRange, monthKey, monthsIn, within } from '../util/dates';

/**
 * Reporting aggregations.
 *
 * Pure functions over plain arrays: no database, no signals, no rendering. A
 * report is a claim about someone's money, so the arithmetic is the part worth
 * being able to state and test in isolation. Charts are a presentation of these
 * results and have no business recomputing any of it.
 *
 * One rule runs through all of them: **transfers are not income or expense.**
 * Moving money between your own accounts is not earning or spending it, and a
 * report that counted transfers would make a person look wildly richer and more
 * profligate than they are.
 */

export interface CategoryTotal {
  /** Null for spending with no category assigned. */
  categoryId: string | null;
  amount: Minor;
  /** Share of the period's total spend, 0-100, rounded. */
  share: number;
  count: number;
}

export interface MonthlyFlow {
  /** `YYYY-MM`. */
  month: string;
  income: Minor;
  expense: Minor;
  /** `income - expense`; negative in a month that spent more than it earned. */
  net: Minor;
}

export interface NetWorthPoint {
  /** Last day of the month, or the range's end for the final point. */
  date: string;
  amount: Minor;
}

export interface PayeeTotal {
  payee: string;
  amount: Minor;
  count: number;
}

/** Spending per category over a range, largest first. */
export function spendByCategory(
  transactions: readonly Transaction[],
  range: DateRange,
): CategoryTotal[] {
  const totals = new Map<string | null, { amount: Minor; count: number }>();

  for (const transaction of transactions) {
    if (transaction.kind !== 'expense' || !within(transaction.date, range)) continue;

    const key = transaction.categoryId;
    const entry = totals.get(key) ?? { amount: 0, count: 0 };
    entry.amount += transaction.amount;
    entry.count += 1;
    totals.set(key, entry);
  }

  const total = [...totals.values()].reduce((sum, entry) => sum + entry.amount, 0);

  return [...totals.entries()]
    .map(([categoryId, entry]) => ({
      categoryId,
      amount: entry.amount,
      count: entry.count,
      // Guarding the divisor rather than the caller: a range whose only
      // expenses are zero-value is odd but not a reason to render NaN.
      share: total > 0 ? Math.round((entry.amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount || collate(a.categoryId, b.categoryId));
}

/**
 * Income and expense per month across a range.
 *
 * Every month in the range gets a bucket, including those with no activity at
 * all. A chart that silently skipped an empty month would compress the gap and
 * imply a continuity that did not happen.
 */
export function flowByMonth(
  transactions: readonly Transaction[],
  range: DateRange,
): MonthlyFlow[] {
  const buckets = new Map<string, MonthlyFlow>(
    monthsIn(range).map((month) => [month, { month, income: 0, expense: 0, net: 0 }]),
  );

  for (const transaction of transactions) {
    if (!within(transaction.date, range)) continue;
    const bucket = buckets.get(monthKey(transaction.date));
    if (!bucket) continue;

    if (transaction.kind === 'income') bucket.income += transaction.amount;
    else if (transaction.kind === 'expense') bucket.expense += transaction.amount;
  }

  for (const bucket of buckets.values()) {
    bucket.net = bucket.income - bucket.expense;
  }
  return [...buckets.values()];
}

/**
 * Net worth at the end of each month in a range.
 *
 * Cumulative, so transactions before the range still count: net worth on a date
 * is everything that has ever happened up to it, not just what happened inside
 * the window being charted. Transfers contribute nothing, since they leave one
 * account and arrive in another.
 */
export function netWorthOver(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  range: DateRange,
): NetWorthPoint[] {
  const opening = accounts.reduce((sum, account) => sum + account.openingBalance, 0);

  // One pass, in date order, rather than re-scanning the ledger per month.
  const ordered = [...transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const points: NetWorthPoint[] = [];
  let running = opening;
  let index = 0;

  for (const month of monthsIn(range)) {
    const cutoff = lastDayOf(month, range);
    while (index < ordered.length && ordered[index].date <= cutoff) {
      running += delta(ordered[index]);
      index++;
    }
    points.push({ date: cutoff, amount: running });
  }

  return points;
}

/** The payees the most money went to over a range, largest first. */
export function topPayees(
  transactions: readonly Transaction[],
  range: DateRange,
  limit = 10,
): PayeeTotal[] {
  const totals = new Map<string, PayeeTotal>();

  for (const transaction of transactions) {
    if (transaction.kind !== 'expense' || !within(transaction.date, range)) continue;

    const payee = transaction.payee.trim();
    // An unnamed payee is not a payee; lumping every blank one together under
    // "" would invent a merchant that dwarfs the real ones.
    if (!payee) continue;

    const entry = totals.get(payee) ?? { payee, amount: 0, count: 0 };
    entry.amount += transaction.amount;
    entry.count += 1;
    totals.set(payee, entry);
  }

  return [...totals.values()]
    .sort((a, b) => b.amount - a.amount || a.payee.localeCompare(b.payee))
    .slice(0, limit);
}

/** Totals for a range, with transfers excluded from both sides. */
export function totalsFor(
  transactions: readonly Transaction[],
  range: DateRange,
): { income: Minor; expense: Minor; net: Minor } {
  let income = 0;
  let expense = 0;

  for (const transaction of transactions) {
    if (!within(transaction.date, range)) continue;
    if (transaction.kind === 'income') income += transaction.amount;
    else if (transaction.kind === 'expense') expense += transaction.amount;
  }
  return { income, expense, net: income - expense };
}

/** Effect of one transaction on total net worth. Transfers net to zero. */
function delta(transaction: Transaction): Minor {
  if (transaction.kind === 'income') return transaction.amount;
  if (transaction.kind === 'expense') return -transaction.amount;
  return 0;
}

/** The last day of a month, clamped to the range so the final point is honest. */
function lastDayOf(month: string, range: DateRange): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;

  return end > range.to ? range.to : end;
}

/** Stable ordering for equal amounts, with uncategorised last. */
function collate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}
