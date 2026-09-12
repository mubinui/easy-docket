import { describe, expect, it } from 'vitest';
import { anAccount } from '../testing/factories';
import { availableCredit, dayOfMonth, dueDateFor, hasCycle, lastStatementDate } from './statement';

describe('dayOfMonth', () => {
  it('builds an ordinary date', () => {
    expect(dayOfMonth(2026, 3, 15)).toBe('2026-03-15');
  });

  it('clamps a day past the end of a short month to its last day', () => {
    // A card closing on the 31st closes on the 28th in February, rather than
    // spilling into March and skipping a cycle.
    expect(dayOfMonth(2026, 2, 31)).toBe('2026-02-28');
    expect(dayOfMonth(2026, 4, 31)).toBe('2026-04-30');
  });

  it('knows a leap February', () => {
    expect(dayOfMonth(2028, 2, 31)).toBe('2028-02-29');
    expect(dayOfMonth(2100, 2, 30)).toBe('2100-02-28');
  });

  it('refuses to produce a day before the first', () => {
    expect(dayOfMonth(2026, 3, 0)).toBe('2026-03-01');
  });
});

describe('lastStatementDate', () => {
  it('is this month once the closing day has passed', () => {
    expect(lastStatementDate(5, '2026-03-20')).toBe('2026-03-05');
  });

  it('is today when today is the closing day', () => {
    // A statement closing today is closed, and what was spent today is on it.
    expect(lastStatementDate(20, '2026-03-20')).toBe('2026-03-20');
  });

  it('falls back to last month before the closing day arrives', () => {
    expect(lastStatementDate(25, '2026-03-10')).toBe('2026-02-25');
  });

  it('steps back across a year boundary', () => {
    expect(lastStatementDate(28, '2026-01-05')).toBe('2025-12-28');
  });

  it('clamps when the previous month is shorter than the closing day', () => {
    expect(lastStatementDate(30, '2026-03-10')).toBe('2026-02-28');
  });

  it('clamps in the current month too', () => {
    expect(lastStatementDate(31, '2026-02-28')).toBe('2026-02-28');
  });
});

describe('dueDateFor', () => {
  it('is the following month when the due day is earlier than the close', () => {
    // Closes on the 25th, due on the 15th: the 15th of next month.
    expect(dueDateFor(15, '2026-03-25')).toBe('2026-04-15');
  });

  it('is the same month when the due day is later than the close', () => {
    expect(dueDateFor(20, '2026-03-01')).toBe('2026-03-20');
  });

  it('is never the closing day itself', () => {
    // Same day means the next one, not zero days to pay.
    expect(dueDateFor(25, '2026-03-25')).toBe('2026-04-25');
  });

  it('crosses a year boundary', () => {
    expect(dueDateFor(10, '2026-12-28')).toBe('2027-01-10');
  });

  it('clamps a due day the next month cannot hold', () => {
    expect(dueDateFor(31, '2026-01-31')).toBe('2026-02-28');
  });

  it('is always after the statement it belongs to', () => {
    // The property that matters: a bill is never due before it exists.
    for (const close of ['2026-01-31', '2026-02-28', '2026-03-15', '2026-12-31']) {
      for (const due of [1, 5, 15, 28, 31]) {
        expect(dueDateFor(due, close) > close).toBe(true);
      }
    }
  });
});

describe('hasCycle', () => {
  it('needs both days to say anything', () => {
    expect(hasCycle(anAccount())).toBe(false);
    expect(hasCycle(anAccount({ statementDay: 25 }))).toBe(false);
    expect(hasCycle(anAccount({ dueDay: 15 }))).toBe(false);
    expect(hasCycle(anAccount({ statementDay: 25, dueDay: 15 }))).toBe(true);
  });
});

describe('availableCredit', () => {
  it('is the limit less what is owed', () => {
    expect(availableCredit(-1_240_00, 5_000_00)).toBe(3_760_00);
  });

  it('is the whole limit on an unused card', () => {
    expect(availableCredit(0, 5_000_00)).toBe(5_000_00);
  });

  it('goes negative on a card over its limit, rather than clamping', () => {
    // Showing 0 left would hide that the card is over, which is the one time
    // the number really matters.
    expect(availableCredit(-5_200_00, 5_000_00)).toBe(-200_00);
  });

  it('counts a credit balance as more than the limit', () => {
    expect(availableCredit(50_00, 5_000_00)).toBe(5_050_00);
  });

  it('is null when no limit is recorded', () => {
    // "Unknown" and "nothing left" must not look the same on screen.
    expect(availableCredit(-100_00, undefined)).toBeNull();
  });
});
