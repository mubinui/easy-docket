import { describe, expect, it } from 'vitest';
import { anAccount, aTransaction } from '../testing/factories';
import {
  availableCredit,
  dayOfMonth,
  daysBetween,
  dueDateFor,
  hasCycle,
  isDueSoon,
  lastStatementDate,
  summariseStatement,
} from './statement';

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

describe('daysBetween', () => {
  it('counts whole days forward', () => {
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14);
  });

  it('crosses a month and a year', () => {
    expect(daysBetween('2026-02-26', '2026-03-02')).toBe(4);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('is zero for the same day and negative backwards', () => {
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
    expect(daysBetween('2026-03-10', '2026-03-01')).toBe(-9);
  });

  it('is unmoved by a daylight saving change', () => {
    // Computed in UTC precisely so a 23- or 25-hour local day cannot round to
    // the wrong number of days.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});

describe('summariseStatement', () => {
  /** A card closing on the 25th, due on the 15th. */
  function card(overrides = {}) {
    return anAccount({
      id: 'a-visa',
      name: 'Visa',
      openingBalance: 0,
      statementDay: 25,
      dueDay: 15,
      ...overrides,
    });
  }

  /** Spending on the card: an expense leaves the account. */
  function spend(date: string, amount: number, id = `s-${date}-${amount}`) {
    return aTransaction({ id, kind: 'expense', amount, accountId: 'a-visa', date });
  }

  /** A payment onto the card: a transfer arriving from somewhere else. */
  function pay(date: string, amount: number, id = `p-${date}-${amount}`) {
    return aTransaction({
      id,
      kind: 'transfer',
      amount,
      accountId: 'a-current',
      counterAccountId: 'a-visa',
      date,
    });
  }

  it('is null without terms to summarise', () => {
    expect(summariseStatement(anAccount(), [], '2026-03-30')).toBeNull();
    expect(summariseStatement(anAccount({ statementDay: 25 }), [], '2026-03-30')).toBeNull();
  });

  it('reports the cycle dates', () => {
    const summary = summariseStatement(card(), [], '2026-03-30')!;
    expect(summary.closedOn).toBe('2026-03-25');
    expect(summary.dueOn).toBe('2026-04-15');
  });

  it('states a debt as a positive amount owed', () => {
    const summary = summariseStatement(card(), [spend('2026-03-10', 1_240_00)], '2026-03-30')!;
    expect(summary.statementBalance).toBe(1_240_00);
    expect(summary.currentBalance).toBe(1_240_00);
  });

  it('counts the opening balance', () => {
    const summary = summariseStatement(card({ openingBalance: -500_00 }), [], '2026-03-30')!;
    expect(summary.statementBalance).toBe(500_00);
  });

  it('leaves spending after the close off the statement', () => {
    // This month's shopping belongs to the statement that has not closed yet.
    const summary = summariseStatement(
      card(),
      [spend('2026-03-10', 100_00), spend('2026-03-28', 40_00)],
      '2026-03-30',
    )!;

    expect(summary.statementBalance).toBe(100_00);
    expect(summary.currentBalance).toBe(140_00);
    expect(summary.remaining).toBe(100_00);
  });

  it('counts spending on the closing day itself', () => {
    const summary = summariseStatement(card(), [spend('2026-03-25', 60_00)], '2026-03-30')!;
    expect(summary.statementBalance).toBe(60_00);
  });

  it('credits a payment made since the close', () => {
    const summary = summariseStatement(
      card(),
      [spend('2026-03-10', 100_00), pay('2026-03-27', 30_00)],
      '2026-03-30',
    )!;

    expect(summary.statementBalance).toBe(100_00);
    expect(summary.paidSince).toBe(30_00);
    expect(summary.remaining).toBe(70_00);
    expect(summary.currentBalance).toBe(70_00);
  });

  it('leaves nothing due once the statement is paid in full', () => {
    const summary = summariseStatement(
      card(),
      [spend('2026-03-10', 100_00), pay('2026-03-27', 100_00)],
      '2026-03-30',
    )!;

    expect(summary.remaining).toBe(0);
  });

  it('floors an overpayment at nothing due rather than a negative bill', () => {
    const summary = summariseStatement(
      card(),
      [spend('2026-03-10', 100_00), pay('2026-03-27', 150_00)],
      '2026-03-30',
    )!;

    expect(summary.remaining).toBe(0);
    // The credit is not lost — it shows up in the balance.
    expect(summary.currentBalance).toBe(-50_00);
  });

  it('does not treat spending since the close as a payment', () => {
    const summary = summariseStatement(
      card(),
      [spend('2026-03-10', 100_00), spend('2026-03-28', 40_00)],
      '2026-03-30',
    )!;

    expect(summary.paidSince).toBe(0);
  });

  it('ignores transactions belonging to other accounts', () => {
    const elsewhere = aTransaction({
      id: 'other',
      kind: 'expense',
      amount: 999_00,
      accountId: 'a-current',
      date: '2026-03-10',
    });

    const summary = summariseStatement(card(), [spend('2026-03-10', 100_00), elsewhere], '2026-03-30')!;
    expect(summary.statementBalance).toBe(100_00);
  });

  it('ignores anything dated after today', () => {
    // A future-dated transaction is a plan, not a debt.
    const summary = summariseStatement(card(), [spend('2026-04-10', 500_00)], '2026-03-30')!;
    expect(summary.currentBalance).toBe(0);
    // And a nothing balance is 0, not -0, which would format as "−$0.00".
    expect(Object.is(summary.currentBalance, -0)).toBe(false);
  });

  it('carries an unpaid statement into the next cycle', () => {
    // Nothing paid in March; by the 26th the March statement has closed and
    // February's spending is part of it.
    const summary = summariseStatement(
      card(),
      [spend('2026-02-10', 100_00), spend('2026-03-10', 40_00)],
      '2026-03-26',
    )!;

    expect(summary.closedOn).toBe('2026-03-25');
    expect(summary.statementBalance).toBe(140_00);
  });
});

describe('isDueSoon', () => {
  const base = {
    closedOn: '2026-03-25',
    dueOn: '2026-04-15',
    statementBalance: 100_00,
    paidSince: 0,
    remaining: 100_00,
    currentBalance: 100_00,
  };

  it('is true inside the window', () => {
    expect(isDueSoon(base, 14, '2026-04-05')).toBe(true);
  });

  it('is false while the due date is further off than the window', () => {
    expect(isDueSoon(base, 14, '2026-03-26')).toBe(false);
  });

  it('is true on the due date itself', () => {
    expect(isDueSoon(base, 14, '2026-04-15')).toBe(true);
  });

  it('is false once the due date has passed', () => {
    // An overdue bill is a different message from a bill due soon, and saying
    // "due in −3 days" would be worse than saying nothing.
    expect(isDueSoon(base, 14, '2026-04-16')).toBe(false);
  });

  it('is false when there is nothing left to pay', () => {
    expect(isDueSoon({ ...base, remaining: 0 }, 14, '2026-04-14')).toBe(false);
  });
});
