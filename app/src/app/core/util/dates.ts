/**
 * Calendar arithmetic for the ledger.
 *
 * Ledger dates are `YYYY-MM-DD` strings in the user's *local* calendar, never
 * timestamps. A transaction recorded at 11pm on the 30th belongs to the 30th
 * regardless of what UTC thinks, and a month boundary is where the user's
 * calendar says it is. Keeping dates as strings makes that the default rather
 * than something to remember.
 *
 * These live apart from any service so the reporting layer — which is pure —
 * can use them without reaching into a repository.
 */

/** Inclusive date range, both ends `YYYY-MM-DD`. */
export interface DateRange {
  from: string;
  to: string;
}

/** `YYYY-MM-DD` for a date in the local calendar, not UTC. */
export function toIsoDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** The calendar month containing `today`. */
export function currentMonth(today = new Date()): DateRange {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: toIsoDate(first), to: toIsoDate(last) };
}

/** The calendar month `delta` months away from the one a range starts in. */
export function shiftMonth(range: DateRange, delta: number): DateRange {
  const anchor = new Date(`${range.from}T00:00:00`);
  return currentMonth(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));
}

/** `YYYY-MM` — the bucket key for monthly reporting. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Every `YYYY-MM` from the range's first month to its last, inclusive. */
export function monthsIn(range: DateRange): string[] {
  if (range.to < range.from) return [];

  const months: string[] = [];
  let year = Number(range.from.slice(0, 4));
  let month = Number(range.from.slice(5, 7));
  const last = monthKey(range.to);

  // Bounded rather than `while (true)`: a malformed range should not hang the
  // reports screen, and a century of months is far past anything meaningful.
  for (let guard = 0; guard < 1_200; guard++) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= last) break;

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Last day of the month a date falls in, as `YYYY-MM-DD`. */
export function endOfMonth(monthOrDate: string): string {
  const year = Number(monthOrDate.slice(0, 4));
  const month = Number(monthOrDate.slice(5, 7));
  return toIsoDate(new Date(year, month, 0));
}

/** First day of the month a date falls in. */
export function startOfMonth(monthOrDate: string): string {
  return `${monthOrDate.slice(0, 7)}-01`;
}

/** Whether a date falls inside an inclusive range. */
export function within(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** A short, human label for a `YYYY-MM` bucket. */
export function formatMonth(month: string, locale?: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, {
    month: 'short',
    year: 'numeric',
  });
}
