import { Budget, BudgetPeriod } from '../models/domain';
import { addDays, addMonths, daysInMonth as monthLength } from '../util/dates';

/**
 * Budget period arithmetic.
 *
 * Every window is anchored to the budget's `startDate` rather than to the
 * calendar. A monthly budget started on the 15th runs the 15th to the 14th,
 * because that is what someone paid on the 15th actually means by "this month".
 *
 * The awkward part is short months. A budget started on the 31st has no 31st to
 * land on in February, so the window starts on the last day the month has. That
 * clamping is handled in exactly one place — `windowStart` — and every other
 * boundary falls out of it, because a window always ends the day before the
 * next one begins.
 */
export interface BudgetWindow {
  /** Inclusive first day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  to: string;
  /** 0 for the first period, 1 for the next, and so on. */
  index: number;
}

type Anchor = Pick<Budget, 'period' | 'startDate'>;

interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

export function parseDate(date: string): Ymd {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${date}"`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatDate({ year, month, day }: Ymd): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return monthLength(year, month);
}

/**
 * The day a given period begins. Index may be negative; callers clamp.
 *
 * The month-length clamping lives in `addMonths`, shared with the recurring
 * schedule: a budget anchored to the 31st and a rule anchored to the 31st have
 * exactly the same problem in February, and it should have one answer.
 */
export function windowStart(anchor: Anchor, index: number): string {
  if (anchor.period === 'weekly') {
    return addDays(anchor.startDate, index * 7);
  }
  return addMonths(anchor.startDate, anchor.period === 'monthly' ? index : index * 12);
}

/**
 * The window containing `date`, or `null` when the budget had not started yet.
 *
 * The index is found by estimate-then-correct rather than by a closed-form
 * expression. The correction loop runs at most once or twice, and it is
 * obviously right, which matters more here than saving a few operations: a
 * closed form has to re-derive the clamping that `windowStart` already does.
 */
export function windowFor(anchor: Anchor, date: string): BudgetWindow | null {
  if (date < anchor.startDate) return null;

  let index = estimateIndex(anchor, date);
  while (index > 0 && windowStart(anchor, index) > date) index--;
  while (windowStart(anchor, index + 1) <= date) index++;

  return windowByIndex(anchor, index);
}

export function windowByIndex(anchor: Anchor, index: number): BudgetWindow {
  const from = windowStart(anchor, index);
  return { from, to: dayBefore(windowStart(anchor, index + 1)), index };
}

/** How many whole periods have elapsed between two dates; negative before the start. */
export function periodIndexFor(anchor: Anchor, date: string): number | null {
  return windowFor(anchor, date)?.index ?? null;
}

/** Human label for a window, used by the budget list and the reports screen. */
export function describeWindow(period: BudgetPeriod, window: BudgetWindow): string {
  const from = new Date(`${window.from}T00:00:00`);
  const to = new Date(`${window.to}T00:00:00`);

  if (period === 'yearly' && from.getMonth() === 0 && from.getDate() === 1) {
    return String(from.getFullYear());
  }
  const sameYear = from.getFullYear() === to.getFullYear();
  const short: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

  return `${from.toLocaleDateString(undefined, short)} – ${to.toLocaleDateString(undefined, {
    ...short,
    year: sameYear ? undefined : 'numeric',
  })}`;
}

function estimateIndex(anchor: Anchor, date: string): number {
  const start = parseDate(anchor.startDate);
  const target = parseDate(date);

  if (anchor.period === 'weekly') {
    const days = Math.floor((utc(target) - utc(start)) / 86_400_000);
    return Math.floor(days / 7);
  }
  const months = (target.year - start.year) * 12 + (target.month - start.month);
  return anchor.period === 'monthly' ? months : Math.floor(months / 12);
}

function dayBefore(date: string): string {
  return addDays(date, -1);
}

/** UTC milliseconds, used only for day counting, never for display. */
function utc({ year, month, day }: Ymd): number {
  return Date.UTC(year, month - 1, day);
}
