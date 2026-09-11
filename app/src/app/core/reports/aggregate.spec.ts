import { describe, expect, it } from 'vitest';
import { Account, Transaction } from '../models/domain';
import { anAccount, aTransaction } from '../testing/factories';
import {
  flowByMonth,
  netWorthOver,
  spendByCategory,
  topPayees,
  totalsFor,
} from './aggregate';

/**
 * One fixture ledger, used by every suite below.
 *
 * Small enough to hold in your head and check the expected numbers by hand,
 * which is the only way a test of arithmetic is worth anything: January earns
 * 3,000 and spends 450; February earns nothing and spends 200; March is
 * deliberately empty; and there is a transfer that must never appear in any
 * income or expense figure.
 */
let sequence = 0;
const txn = (over: Partial<Transaction>): Transaction =>
  aTransaction({ id: `txn-${sequence++}`, ...over });

const LEDGER: Transaction[] = [
  txn({ date: '2026-01-05', kind: 'income', amount: 300_000, payee: 'Employer', categoryId: 'inc' }),
  txn({ date: '2026-01-10', kind: 'expense', amount: 25_000, payee: 'Supermarket', categoryId: 'food' }),
  txn({ date: '2026-01-18', kind: 'expense', amount: 15_000, payee: 'Supermarket', categoryId: 'food' }),
  txn({ date: '2026-01-25', kind: 'expense', amount: 5_000, payee: 'Bus company', categoryId: 'transport' }),
  txn({ date: '2026-02-08', kind: 'expense', amount: 18_000, payee: 'Supermarket', categoryId: 'food' }),
  txn({ date: '2026-02-14', kind: 'expense', amount: 2_000, payee: '', categoryId: null }),
  // Moving savings around: not income, not expenditure, not net worth.
  txn({
    date: '2026-02-20',
    kind: 'transfer',
    amount: 100_000,
    accountId: 'acc-1',
    counterAccountId: 'acc-2',
    categoryId: null,
    payee: 'To savings',
  }),
];

const ACCOUNTS: Account[] = [
  anAccount({ id: 'acc-1', openingBalance: 50_000 }),
  anAccount({ id: 'acc-2', openingBalance: 25_000 }),
];

const Q1 = { from: '2026-01-01', to: '2026-03-31' };
const JANUARY = { from: '2026-01-01', to: '2026-01-31' };
const EMPTY_MONTH = { from: '2026-03-01', to: '2026-03-31' };

describe('spendByCategory', () => {
  it('totals each category, largest first', () => {
    expect(spendByCategory(LEDGER, JANUARY)).toEqual([
      { categoryId: 'food', amount: 40_000, count: 2, share: 89 },
      { categoryId: 'transport', amount: 5_000, count: 1, share: 11 },
    ]);
  });

  it('excludes income', () => {
    const categories = spendByCategory(LEDGER, JANUARY).map((row) => row.categoryId);
    expect(categories).not.toContain('inc');
  });

  it('excludes transfers', () => {
    const total = spendByCategory(LEDGER, Q1).reduce((sum, row) => sum + row.amount, 0);
    // 45,000 in January plus 20,000 in February; the 100,000 transfer is absent.
    expect(total).toBe(65_000);
  });

  it('keeps uncategorised spending, and sorts it last', () => {
    const rows = spendByCategory(LEDGER, { from: '2026-02-01', to: '2026-02-28' });
    expect(rows).toEqual([
      { categoryId: 'food', amount: 18_000, count: 1, share: 90 },
      { categoryId: null, amount: 2_000, count: 1, share: 10 },
    ]);
  });

  it('is empty for a month with no spending', () => {
    expect(spendByCategory(LEDGER, EMPTY_MONTH)).toEqual([]);
  });

  it('is empty for an empty ledger', () => {
    expect(spendByCategory([], Q1)).toEqual([]);
  });

  it('handles a single transaction', () => {
    const single = [txn({ date: '2026-05-01', kind: 'expense', amount: 1_234, categoryId: 'food' })];
    expect(spendByCategory(single, { from: '2026-05-01', to: '2026-05-31' })).toEqual([
      { categoryId: 'food', amount: 1_234, count: 1, share: 100 },
    ]);
  });

  it('does not divide by zero when every expense is zero-valued', () => {
    const odd = [txn({ date: '2026-05-01', kind: 'expense', amount: 0, categoryId: 'food' })];
    const [row] = spendByCategory(odd, { from: '2026-05-01', to: '2026-05-31' });
    expect(row.share).toBe(0);
    expect(Number.isFinite(row.share)).toBe(true);
  });
});

describe('flowByMonth', () => {
  it('buckets income and expense by month', () => {
    expect(flowByMonth(LEDGER, Q1)).toEqual([
      { month: '2026-01', income: 300_000, expense: 45_000, net: 255_000 },
      { month: '2026-02', income: 0, expense: 20_000, net: -20_000 },
      { month: '2026-03', income: 0, expense: 0, net: 0 },
    ]);
  });

  it('keeps a month with no activity rather than closing the gap', () => {
    // Dropping March would compress the chart and imply a continuity that did
    // not happen.
    const months = flowByMonth(LEDGER, Q1).map((row) => row.month);
    expect(months).toContain('2026-03');
  });

  it('reports a negative net for a month that spent more than it earned', () => {
    const february = flowByMonth(LEDGER, Q1).find((row) => row.month === '2026-02');
    expect(february?.net).toBeLessThan(0);
  });

  it('excludes transfers from both sides', () => {
    const february = flowByMonth(LEDGER, Q1).find((row) => row.month === '2026-02');
    expect(february?.income).toBe(0);
    expect(february?.expense).toBe(20_000);
  });

  it('ignores transactions outside the range', () => {
    expect(flowByMonth(LEDGER, JANUARY)).toHaveLength(1);
  });

  it('is a row of zeroes for an empty ledger', () => {
    expect(flowByMonth([], JANUARY)).toEqual([
      { month: '2026-01', income: 0, expense: 0, net: 0 },
    ]);
  });
});

describe('netWorthOver', () => {
  it('starts from the accounts’ opening balances', () => {
    const points = netWorthOver(ACCOUNTS, [], JANUARY);
    expect(points).toEqual([{ date: '2026-01-31', amount: 75_000 }]);
  });

  it('accumulates across months', () => {
    expect(netWorthOver(ACCOUNTS, LEDGER, Q1)).toEqual([
      // 75,000 + 300,000 earned − 45,000 spent
      { date: '2026-01-31', amount: 330_000 },
      // carried forward, less February's 20,000
      { date: '2026-02-28', amount: 310_000 },
      // March has no activity, so the line holds flat rather than resetting
      { date: '2026-03-31', amount: 310_000 },
    ]);
  });

  it('is unmoved by a transfer', () => {
    const withoutTransfer = LEDGER.filter((t) => t.kind !== 'transfer');
    expect(netWorthOver(ACCOUNTS, LEDGER, Q1)).toEqual(
      netWorthOver(ACCOUNTS, withoutTransfer, Q1),
    );
  });

  it('counts history from before the range', () => {
    // Net worth on a date is everything that ever happened up to it, not just
    // what happened inside the window being charted.
    const points = netWorthOver(ACCOUNTS, LEDGER, { from: '2026-02-01', to: '2026-02-28' });
    expect(points).toEqual([{ date: '2026-02-28', amount: 310_000 }]);
  });

  it('clamps the final point to the end of the range', () => {
    const points = netWorthOver(ACCOUNTS, LEDGER, { from: '2026-01-01', to: '2026-01-20' });
    // By the 20th: 75,000 opening + 300,000 earned − 25,000 − 15,000. The
    // 5,000 bus fare on the 25th has not happened yet.
    expect(points).toEqual([{ date: '2026-01-20', amount: 335_000 }]);
  });

  it('handles no accounts at all', () => {
    expect(netWorthOver([], [], JANUARY)).toEqual([{ date: '2026-01-31', amount: 0 }]);
  });
});

describe('topPayees', () => {
  it('ranks payees by what they were paid', () => {
    expect(topPayees(LEDGER, Q1)).toEqual([
      { payee: 'Supermarket', amount: 58_000, count: 3 },
      { payee: 'Bus company', amount: 5_000, count: 1 },
    ]);
  });

  it('ignores blank payees rather than inventing a merchant', () => {
    const payees = topPayees(LEDGER, Q1).map((row) => row.payee);
    expect(payees).not.toContain('');
  });

  it('excludes income and transfers', () => {
    const payees = topPayees(LEDGER, Q1).map((row) => row.payee);
    expect(payees).not.toContain('Employer');
    expect(payees).not.toContain('To savings');
  });

  it('respects the limit', () => {
    expect(topPayees(LEDGER, Q1, 1)).toHaveLength(1);
  });

  it('is empty for a range with no spending', () => {
    expect(topPayees(LEDGER, EMPTY_MONTH)).toEqual([]);
  });
});

describe('totalsFor', () => {
  it('sums a range, transfers excluded', () => {
    expect(totalsFor(LEDGER, Q1)).toEqual({
      income: 300_000,
      expense: 65_000,
      net: 235_000,
    });
  });

  it('is all zeroes for an empty range', () => {
    expect(totalsFor(LEDGER, EMPTY_MONTH)).toEqual({ income: 0, expense: 0, net: 0 });
  });

  it('agrees with flowByMonth', () => {
    const monthly = flowByMonth(LEDGER, Q1);
    const summed = monthly.reduce(
      (acc, row) => ({ income: acc.income + row.income, expense: acc.expense + row.expense }),
      { income: 0, expense: 0 },
    );
    const totals = totalsFor(LEDGER, Q1);

    expect(summed.income).toBe(totals.income);
    expect(summed.expense).toBe(totals.expense);
  });
});
