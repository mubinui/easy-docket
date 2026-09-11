import { describe, expect, it } from 'vitest';
import {
  endOfMonth,
  formatMonth,
  monthKey,
  monthsIn,
  shiftMonth,
  startOfMonth,
  toIsoDate,
  within,
} from './dates';

describe('toIsoDate', () => {
  it('uses the local calendar, not UTC', () => {
    // Late evening local time falls on the *following* UTC day in much of the
    // world. A transaction recorded then belongs to the day the user saw.
    const lateEvening = new Date(2026, 0, 15, 23, 30);
    expect(toIsoDate(lateEvening)).toBe('2026-01-15');
  });

  it('handles the first and last day of a year', () => {
    expect(toIsoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(toIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('monthsIn', () => {
  it('lists every month in the range, inclusive', () => {
    expect(monthsIn({ from: '2026-01-15', to: '2026-04-02' })).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
  });

  it('returns a single month when the range sits inside one', () => {
    expect(monthsIn({ from: '2026-03-05', to: '2026-03-20' })).toEqual(['2026-03']);
  });

  it('crosses a year boundary', () => {
    expect(monthsIn({ from: '2026-11-10', to: '2027-02-01' })).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('is empty for a reversed range rather than looping forever', () => {
    expect(monthsIn({ from: '2026-05-01', to: '2026-01-01' })).toEqual([]);
  });
});

describe('month boundaries', () => {
  it('finds the end of a month, February included', () => {
    expect(endOfMonth('2026-02')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-04')).toBe('2026-04-30');
    expect(endOfMonth('2026-12')).toBe('2026-12-31');
  });

  it('finds the start of a month', () => {
    expect(startOfMonth('2026-07-19')).toBe('2026-07-01');
  });

  it('keys a date by month', () => {
    expect(monthKey('2026-07-19')).toBe('2026-07');
  });
});

describe('within', () => {
  const range = { from: '2026-03-01', to: '2026-03-31' };

  it('includes both ends', () => {
    expect(within('2026-03-01', range)).toBe(true);
    expect(within('2026-03-31', range)).toBe(true);
  });

  it('excludes the days either side', () => {
    expect(within('2026-02-28', range)).toBe(false);
    expect(within('2026-04-01', range)).toBe(false);
  });
});

describe('shiftMonth', () => {
  it('moves to the neighbouring calendar month', () => {
    expect(shiftMonth({ from: '2026-03-01', to: '2026-03-31' }, 1)).toEqual({
      from: '2026-04-01',
      to: '2026-04-30',
    });
    expect(shiftMonth({ from: '2026-03-01', to: '2026-03-31' }, -1)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('crosses a year boundary', () => {
    expect(shiftMonth({ from: '2026-01-01', to: '2026-01-31' }, -1).from).toBe('2025-12-01');
  });
});

describe('formatMonth', () => {
  it('renders a readable label', () => {
    expect(formatMonth('2026-03', 'en-US')).toBe('Mar 2026');
  });
});
