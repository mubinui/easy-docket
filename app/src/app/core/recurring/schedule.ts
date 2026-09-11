import { RecurringRule } from '../models/domain';
import { addDays, addMonths } from '../util/dates';

/**
 * When a recurring rule falls due.
 *
 * Pure: given a rule and a date, say which occurrences exist. Nothing here
 * touches the database, which matters because the answer has to be identical on
 * every device — two phones that materialise the same month must produce the
 * same dates, or the ledger gains duplicate rent.
 */

/** How many new occurrences one materialisation run will create. */
export const MAX_OCCURRENCES_PER_RUN = 500;

/**
 * Hard bound on how far the generator will walk looking for new occurrences.
 *
 * Catching up means stepping over everything already materialised, so the scan
 * has to reach further than the run's output. 25,000 is roughly 68 years of a
 * daily rule — past any real schedule, and cheap, since each step is integer
 * date arithmetic with no database access.
 */
const MAX_SCAN = 25_000;

type Schedule = Pick<
  RecurringRule,
  'interval' | 'unit' | 'startDate' | 'endDate' | 'maxOccurrences' | 'skipped'
>;

/**
 * The date of the nth occurrence, counting from zero.
 *
 * Every occurrence is measured from `startDate` rather than from the one
 * before it. Stepping forward one at a time would accumulate the month-length
 * clamping: a rule anchored to the 31st would land on the 28th in February and
 * then stay on the 28th forever, which is not what the user set up.
 */
export function occurrenceAt(schedule: Schedule, index: number): string {
  const step = schedule.interval * index;

  switch (schedule.unit) {
    case 'day':
      return addDays(schedule.startDate, step);
    case 'week':
      return addDays(schedule.startDate, step * 7);
    case 'month':
      return addMonths(schedule.startDate, step);
    case 'year':
      return addMonths(schedule.startDate, step * 12);
  }
}

/** Whether the schedule can produce anything at or after a given index. */
function withinLimits(schedule: Schedule, index: number, date: string): boolean {
  if (schedule.maxOccurrences !== null && index >= schedule.maxOccurrences) return false;
  if (schedule.endDate !== null && date > schedule.endDate) return false;
  return true;
}

/**
 * Occurrences from the rule's start up to and including `asOf`.
 *
 * `after` resumes a catch-up: occurrences on or before it are stepped over
 * without counting against the limit. Without it a bounded run would hand back
 * the same first batch every time and never make progress — the schedule always
 * starts at the same place, so "the first 500" is a fixed answer.
 *
 * Skipped dates are omitted from the result but still consume their place in
 * the schedule: a rule capped at twelve payments with one skipped produces
 * eleven, not twelve. "Twelve payments" counts what was scheduled, and skipping
 * one does not earn another at the end.
 */
export function occurrencesUpTo(
  schedule: Schedule,
  asOf: string,
  limit = MAX_OCCURRENCES_PER_RUN,
  after: string | null = null,
): string[] {
  if (schedule.interval < 1 || limit < 1) return [];

  const skipped = new Set(schedule.skipped);
  const dates: string[] = [];

  for (let index = 0; index < MAX_SCAN; index++) {
    const date = occurrenceAt(schedule, index);
    if (date > asOf) break;
    if (!withinLimits(schedule, index, date)) break;

    if (after !== null && date <= after) continue;
    if (skipped.has(date)) continue;

    dates.push(date);
    if (dates.length >= limit) break;
  }

  return dates;
}

/**
 * The next occurrence strictly after `asOf`, or null when the rule is finished.
 *
 * Used by the rule list to say "next: 1 March" without materialising anything.
 */
export function nextOccurrence(schedule: Schedule, asOf: string): string | null {
  if (schedule.interval < 1) return null;
  const skipped = new Set(schedule.skipped);

  for (let index = 0; index < MAX_OCCURRENCES_PER_RUN; index++) {
    const date = occurrenceAt(schedule, index);
    if (!withinLimits(schedule, index, date)) return null;
    if (date > asOf && !skipped.has(date)) return date;
  }
  return null;
}

/**
 * The identity a materialised transaction carries.
 *
 * Derived from the rule and the occurrence date rather than random, so two
 * devices that both run the materialiser on the same morning produce the *same*
 * transaction id. Last-writer-wins then collapses them into one row instead of
 * leaving the user paying rent twice.
 */
export function occurrenceId(ruleId: string, date: string): string {
  return `${ruleId}:${date}`;
}

/** Whether a transaction id was produced by a rule, and which occurrence. */
export function parseOccurrenceId(id: string): { ruleId: string; date: string } | null {
  const match = /^(.+):(\d{4}-\d{2}-\d{2})$/.exec(id);
  return match ? { ruleId: match[1], date: match[2] } : null;
}
