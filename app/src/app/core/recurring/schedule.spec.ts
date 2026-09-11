import { describe, expect, it } from 'vitest';
import { aRecurringRule } from '../testing/factories';
import {
  nextOccurrence,
  occurrenceAt,
  occurrenceId,
  occurrencesUpTo,
  parseOccurrenceId,
} from './schedule';

const monthly = aRecurringRule({ startDate: '2026-01-15', interval: 1, unit: 'month' });

describe('occurrenceAt', () => {
  it('counts from the start date', () => {
    expect(occurrenceAt(monthly, 0)).toBe('2026-01-15');
    expect(occurrenceAt(monthly, 1)).toBe('2026-02-15');
    expect(occurrenceAt(monthly, 12)).toBe('2027-01-15');
  });

  it('honours an interval greater than one', () => {
    const fortnightly = { ...monthly, interval: 2, unit: 'week' as const };
    expect(occurrenceAt(fortnightly, 1)).toBe('2026-01-29');

    const quarterly = { ...monthly, interval: 3, unit: 'month' as const };
    expect(occurrenceAt(quarterly, 2)).toBe('2026-07-15');
  });

  it('handles every unit', () => {
    expect(occurrenceAt({ ...monthly, unit: 'day' }, 10)).toBe('2026-01-25');
    expect(occurrenceAt({ ...monthly, unit: 'week' }, 2)).toBe('2026-01-29');
    expect(occurrenceAt({ ...monthly, unit: 'year' }, 2)).toBe('2028-01-15');
  });

  it('clamps to the length of a short month', () => {
    const endOfMonth = { ...monthly, startDate: '2026-01-31' };
    expect(occurrenceAt(endOfMonth, 1)).toBe('2026-02-28');
  });

  it('does not let one short month drag the whole schedule', () => {
    // Stepping from the previous occurrence would pin it to the 28th forever.
    // Every occurrence is measured from the start date instead.
    const endOfMonth = { ...monthly, startDate: '2026-01-31' };
    expect(occurrenceAt(endOfMonth, 2)).toBe('2026-03-31');
    expect(occurrenceAt(endOfMonth, 3)).toBe('2026-04-30');
    expect(occurrenceAt(endOfMonth, 4)).toBe('2026-05-31');
  });

  it('handles a leap-day anchor', () => {
    const leap = { ...monthly, startDate: '2028-02-29', unit: 'year' as const };
    expect(occurrenceAt(leap, 1)).toBe('2029-02-28');
    expect(occurrenceAt(leap, 4)).toBe('2032-02-29');
  });
});

describe('occurrencesUpTo', () => {
  it('lists everything due so far', () => {
    expect(occurrencesUpTo(monthly, '2026-04-01')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('includes an occurrence falling exactly on the date', () => {
    expect(occurrencesUpTo(monthly, '2026-02-15')).toContain('2026-02-15');
  });

  it('is empty before the rule begins', () => {
    expect(occurrencesUpTo(monthly, '2025-12-31')).toEqual([]);
  });

  it('catches up after months unopened', () => {
    // The app being closed does not mean the rent was not due.
    expect(occurrencesUpTo(monthly, '2027-01-14')).toHaveLength(12);
  });

  it('stops at the end date', () => {
    const ending = { ...monthly, endDate: '2026-03-20' };
    expect(occurrencesUpTo(ending, '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('stops at the occurrence cap', () => {
    const capped = { ...monthly, maxOccurrences: 3 };
    expect(occurrencesUpTo(capped, '2026-12-31')).toHaveLength(3);
  });

  it('omits skipped dates', () => {
    const withSkip = { ...monthly, skipped: ['2026-02-15'] };
    expect(occurrencesUpTo(withSkip, '2026-04-01')).toEqual(['2026-01-15', '2026-03-15']);
  });

  it('does not hand back a skipped occurrence at the end of a capped run', () => {
    // "Twelve payments" counts what was scheduled; skipping one does not earn
    // another at the end.
    const capped = { ...monthly, maxOccurrences: 3, skipped: ['2026-02-15'] };
    expect(occurrencesUpTo(capped, '2026-12-31')).toEqual(['2026-01-15', '2026-03-15']);
  });

  it('refuses to run away on a nonsensical interval', () => {
    expect(occurrencesUpTo({ ...monthly, interval: 0 }, '2030-01-01')).toEqual([]);
    expect(occurrencesUpTo({ ...monthly, interval: -1 }, '2030-01-01')).toEqual([]);
  });

  it('resumes past a date already dealt with', () => {
    // Without this a bounded run would hand back the same first batch every
    // time: the schedule always starts in the same place.
    expect(occurrencesUpTo(monthly, '2026-05-01', 500, '2026-02-15')).toEqual([
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('does not count stepped-over occurrences against the limit', () => {
    const daily = { ...monthly, unit: 'day' as const, startDate: '2026-01-01' };
    const batch = occurrencesUpTo(daily, '2026-12-31', 5, '2026-06-30');

    expect(batch).toHaveLength(5);
    expect(batch[0]).toBe('2026-07-01');
  });

  it('returns nothing once everything is behind the resume point', () => {
    expect(occurrencesUpTo(monthly, '2026-03-01', 500, '2026-03-01')).toEqual([]);
  });

  it('is bounded, so a decade of daily history cannot hang the app', () => {
    const daily = { ...monthly, unit: 'day' as const, startDate: '2015-01-01' };
    const dates = occurrencesUpTo(daily, '2026-01-01', 500);

    expect(dates).toHaveLength(500);
    expect(dates[0]).toBe('2015-01-01');
  });
});

describe('nextOccurrence', () => {
  it('finds the next one due', () => {
    expect(nextOccurrence(monthly, '2026-02-01')).toBe('2026-02-15');
    expect(nextOccurrence(monthly, '2026-02-15')).toBe('2026-03-15');
  });

  it('looks past a skipped date', () => {
    const withSkip = { ...monthly, skipped: ['2026-02-15'] };
    expect(nextOccurrence(withSkip, '2026-02-01')).toBe('2026-03-15');
  });

  it('reports nothing once the rule is finished', () => {
    expect(nextOccurrence({ ...monthly, endDate: '2026-03-01' }, '2026-04-01')).toBeNull();
    expect(nextOccurrence({ ...monthly, maxOccurrences: 2 }, '2026-05-01')).toBeNull();
  });

  it('points at the first occurrence before a rule has started', () => {
    expect(nextOccurrence(monthly, '2025-06-01')).toBe('2026-01-15');
  });
});

describe('occurrenceId', () => {
  it('is derived from the rule and the date, never random', () => {
    // Two devices materialising the same morning must produce the same id, or
    // last-writer-wins cannot collapse them and the user pays rent twice.
    expect(occurrenceId('rule-1', '2026-02-15')).toBe('rule-1:2026-02-15');
    expect(occurrenceId('rule-1', '2026-02-15')).toBe(occurrenceId('rule-1', '2026-02-15'));
  });

  it('round-trips', () => {
    expect(parseOccurrenceId('rule-1:2026-02-15')).toEqual({
      ruleId: 'rule-1',
      date: '2026-02-15',
    });
  });

  it('copes with a rule id containing a colon', () => {
    const id = occurrenceId('a:b:c', '2026-02-15');
    expect(parseOccurrenceId(id)).toEqual({ ruleId: 'a:b:c', date: '2026-02-15' });
  });

  it('recognises an id that no rule produced', () => {
    expect(parseOccurrenceId('txn-1')).toBeNull();
    expect(parseOccurrenceId('rule-1:not-a-date')).toBeNull();
  });
});
