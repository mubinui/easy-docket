import { describe, expect, it } from 'vitest';
import { Budget } from '../models/domain';
import {
  daysInMonth,
  describeWindow,
  formatDate,
  parseDate,
  windowByIndex,
  windowFor,
  windowStart,
} from './period';

type Anchor = Pick<Budget, 'period' | 'startDate'>;

const monthly = (startDate: string): Anchor => ({ period: 'monthly', startDate });
const weekly = (startDate: string): Anchor => ({ period: 'weekly', startDate });
const yearly = (startDate: string): Anchor => ({ period: 'yearly', startDate });

describe('date helpers', () => {
  it('round-trips a date', () => {
    expect(formatDate(parseDate('2026-02-09'))).toBe('2026-02-09');
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    for (const input of ['', '2026-2-9', '09/02/2026', 'yesterday']) {
      expect(() => parseDate(input), input).toThrow(/YYYY-MM-DD/);
    }
  });

  it('knows how long each month is, leap years included', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29); // leap
    expect(daysInMonth(2100, 2)).toBe(28); // centurial, not a leap year
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('windowFor', () => {
  it('returns nothing before the budget starts', () => {
    expect(windowFor(monthly('2026-03-01'), '2026-02-28')).toBeNull();
  });

  it('includes the start date itself', () => {
    expect(windowFor(monthly('2026-03-01'), '2026-03-01')).toMatchObject({
      from: '2026-03-01',
      index: 0,
    });
  });

  describe('monthly', () => {
    it('runs calendar months when it starts on the 1st', () => {
      expect(windowFor(monthly('2026-01-01'), '2026-01-31')).toMatchObject({
        from: '2026-01-01',
        to: '2026-01-31',
        index: 0,
      });
      expect(windowFor(monthly('2026-01-01'), '2026-02-01')).toMatchObject({
        from: '2026-02-01',
        to: '2026-02-28',
        index: 1,
      });
    });

    it('anchors to the start day rather than the calendar', () => {
      // Someone paid on the 15th means the 15th to the 14th by "this month".
      const anchor = monthly('2026-01-15');
      expect(windowFor(anchor, '2026-01-15')).toMatchObject({ from: '2026-01-15', to: '2026-02-14' });
      expect(windowFor(anchor, '2026-02-14')).toMatchObject({ from: '2026-01-15', index: 0 });
      expect(windowFor(anchor, '2026-02-15')).toMatchObject({ from: '2026-02-15', index: 1 });
    });

    it('falls back to the last day in months too short for the start day', () => {
      const anchor = monthly('2026-01-31');

      // February has no 31st, so the window opens on the 28th.
      expect(windowStart(anchor, 1)).toBe('2026-02-28');
      // Which means January's window runs right up to the 27th.
      expect(windowFor(anchor, '2026-02-27')).toMatchObject({
        from: '2026-01-31',
        to: '2026-02-27',
        index: 0,
      });
      expect(windowFor(anchor, '2026-02-28')).toMatchObject({ from: '2026-02-28', index: 1 });
      // And March gets its 31st back: clamping is per month, not sticky.
      expect(windowStart(anchor, 2)).toBe('2026-03-31');
    });

    it('handles a 29 February start in a non-leap year', () => {
      const anchor = monthly('2028-02-29');
      expect(windowStart(anchor, 12)).toBe('2029-02-28');
    });

    it('crosses a year boundary', () => {
      expect(windowFor(monthly('2026-11-10'), '2027-01-09')).toMatchObject({
        from: '2026-12-10',
        to: '2027-01-09',
        index: 1,
      });
    });

    it('is consistent across many periods', () => {
      const anchor = monthly('2026-01-31');
      for (let index = 0; index < 36; index++) {
        const window = windowByIndex(anchor, index);
        // Windows must tile the timeline: no gaps, no overlaps.
        expect(window.to >= window.from).toBe(true);
        expect(windowFor(anchor, window.from)?.index).toBe(index);
        expect(windowFor(anchor, window.to)?.index).toBe(index);
      }
    });
  });

  describe('weekly', () => {
    it('runs seven-day blocks from the start date', () => {
      const anchor = weekly('2026-03-02'); // a Monday
      expect(windowFor(anchor, '2026-03-08')).toMatchObject({
        from: '2026-03-02',
        to: '2026-03-08',
        index: 0,
      });
      expect(windowFor(anchor, '2026-03-09')).toMatchObject({
        from: '2026-03-09',
        to: '2026-03-15',
        index: 1,
      });
    });

    it('crosses a month and a year boundary', () => {
      expect(windowFor(weekly('2026-12-28'), '2027-01-03')).toMatchObject({
        from: '2026-12-28',
        to: '2027-01-03',
        index: 0,
      });
    });

    it('is unaffected by daylight saving transitions', () => {
      // Late March shifts the clock in much of the northern hemisphere; a week
      // must stay seven dates regardless.
      const anchor = weekly('2026-03-23');
      const window = windowByIndex(anchor, 0);
      expect(window).toMatchObject({ from: '2026-03-23', to: '2026-03-29' });
      expect(windowByIndex(anchor, 1).from).toBe('2026-03-30');
    });
  });

  describe('yearly', () => {
    it('runs a year from the start date', () => {
      const anchor = yearly('2026-04-06'); // a tax year, as it happens
      expect(windowFor(anchor, '2027-04-05')).toMatchObject({
        from: '2026-04-06',
        to: '2027-04-05',
        index: 0,
      });
      expect(windowFor(anchor, '2027-04-06')).toMatchObject({ index: 1 });
    });

    it('handles a leap-day start', () => {
      const anchor = yearly('2028-02-29');
      expect(windowStart(anchor, 1)).toBe('2029-02-28');
      expect(windowFor(anchor, '2029-02-27')).toMatchObject({ index: 0 });
    });
  });
});

describe('describeWindow', () => {
  it('names a calendar year by its number alone', () => {
    expect(describeWindow('yearly', windowByIndex(yearly('2026-01-01'), 0))).toBe('2026');
  });

  it('shows a range for anything else', () => {
    const label = describeWindow('monthly', windowByIndex(monthly('2026-01-15'), 0));
    expect(label).toContain('–');
  });
});
