import { Account, Minor, Transaction } from '../models/domain';
import { addMonths, daysInMonth, toIsoDate } from '../util/dates';
import { signedFor } from '../util/money';

/**
 * When a card's statement closes and when the bill falls due.
 *
 * Pure, and separate from any service, because the awkward parts are all
 * calendar arithmetic: a statement day of 31 has to mean "the last day" in
 * February, and a due day earlier in the month than the closing day means the
 * following month, not a date in the past.
 */

/** A day-of-month, clamped to a month that may be shorter than it. */
export function dayOfMonth(year: number, month: number, day: number): string {
  const clamped = Math.min(Math.max(day, 1), daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

function parts(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${date}"`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * The most recent statement to have closed on or before `asOf`.
 *
 * "Closed" matters: spending after this date belongs to the statement still
 * open, and is not part of the bill now due.
 */
export function lastStatementDate(statementDay: number, asOf = toIsoDate()): string {
  const { year, month } = parts(asOf);
  const thisMonth = dayOfMonth(year, month, statementDay);
  return thisMonth <= asOf ? thisMonth : statementClose(statementDay, addMonths(thisMonth, -1));
}

/** The statement closing in the month containing `date`. */
function statementClose(statementDay: number, date: string): string {
  const { year, month } = parts(date);
  return dayOfMonth(year, month, statementDay);
}

/**
 * When a statement that closed on `statementDate` must be paid.
 *
 * The next date carrying `dueDay`, strictly after the close. A card that closes
 * on the 25th and is due on the 15th is due the following month; one that
 * closes on the 1st and is due on the 20th is due the same month. Stating it as
 * "the next one after" covers both without a special case, and cannot produce a
 * due date in the past.
 */
export function dueDateFor(dueDay: number, statementDate: string): string {
  const { year, month } = parts(statementDate);
  const sameMonth = dayOfMonth(year, month, dueDay);
  if (sameMonth > statementDate) return sameMonth;

  const next = addMonths(statementDate, 1);
  const { year: nextYear, month: nextMonth } = parts(next);
  return dayOfMonth(nextYear, nextMonth, dueDay);
}

/** Whether an account carries enough terms to say anything about its cycle. */
export function hasCycle(account: Account): boolean {
  return typeof account.statementDay === 'number' && typeof account.dueDay === 'number';
}

/**
 * How much of the limit is still available.
 *
 * `balance` is the ledger balance, so a debt is negative; the limit is a
 * positive number. Null when no limit is recorded, because "unknown" and
 * "nothing left" must not look the same on screen.
 */
export function availableCredit(balance: Minor, creditLimit: Minor | undefined): Minor | null {
  if (typeof creditLimit !== 'number') return null;
  return creditLimit + balance;
}

/**
 * What a card's bill looks like right now.
 *
 * Amounts are stated as debts: positive means money is owed, which is the
 * opposite sign to the ledger balance and the same sign as a paper statement.
 */
export interface StatementSummary {
  /** The day the statement closed. */
  closedOn: string;
  /** The day it has to be paid by. */
  dueOn: string;
  /** Owed as at the close — the figure printed on the statement. */
  statementBalance: Minor;
  /** Money paid onto the card since the close. */
  paidSince: Minor;
  /**
   * What is left of that statement to pay.
   *
   * Floored at zero: overpaying leaves nothing due rather than a negative bill,
   * and the credit shows up in the balance where it belongs.
   */
  remaining: Minor;
  /**
   * Owed right now, spending since the close included.
   *
   * Deliberately not what is due: this month's shopping is on the statement
   * that has not closed yet, and paying it early is a choice rather than an
   * obligation.
   */
  currentBalance: Minor;
}

/**
 * The ledger's sign, flipped to "owed".
 *
 * `-0` is normalised away: negating a zero balance produces it, and a card with
 * nothing on it would otherwise format as "−$0.00".
 */
function owed(balance: Minor): Minor {
  return balance === 0 ? 0 : -balance;
}

/** Balance of an account on a date, opening balance included. */
function balanceAsOf(account: Account, transactions: readonly Transaction[], date: string): Minor {
  let total = account.openingBalance;
  for (const txn of transactions) {
    if (txn.date > date) continue;
    total += signedFor(account.id, txn);
  }
  return total;
}

/**
 * Summarise a card's cycle, or null when it has no terms to summarise.
 *
 * `transactions` may be the whole ledger; only the ones touching this account
 * count, which `signedFor` already decides.
 */
export function summariseStatement(
  account: Account,
  transactions: readonly Transaction[],
  asOf = toIsoDate(),
): StatementSummary | null {
  if (!hasCycle(account)) return null;

  const closedOn = lastStatementDate(account.statementDay!, asOf);
  const dueOn = dueDateFor(account.dueDay!, closedOn);

  // Negated on the way out: the ledger holds a debt as a negative balance, and
  // everything below this line talks about what is owed.
  const statementBalance = owed(balanceAsOf(account, transactions, closedOn));
  const currentBalance = owed(balanceAsOf(account, transactions, asOf));

  let paidSince = 0;
  for (const txn of transactions) {
    if (txn.date <= closedOn || txn.date > asOf) continue;
    const effect = signedFor(account.id, txn);
    // Money arriving on the card is a payment; spending is not.
    if (effect > 0) paidSince += effect;
  }

  return {
    closedOn,
    dueOn,
    statementBalance,
    paidSince,
    remaining: Math.max(statementBalance - paidSince, 0),
    currentBalance,
  };
}

/** Whether a bill is due within `days`, and still owing. */
export function isDueSoon(summary: StatementSummary, days: number, asOf = toIsoDate()): boolean {
  if (summary.remaining <= 0) return false;
  return summary.dueOn >= asOf && daysBetween(asOf, summary.dueOn) <= days;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}
