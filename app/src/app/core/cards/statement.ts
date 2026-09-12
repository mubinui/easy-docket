import { Account, Minor } from '../models/domain';
import { addMonths, daysInMonth, toIsoDate } from '../util/dates';

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
