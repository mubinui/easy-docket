import { describe, expect, it } from 'vitest';
import { Transaction } from '../models/domain';
import { aBudget, aTransaction } from '../testing/factories';
import { windowByIndex } from './period';
import { carriedInto, countsTowards, progressFor, spendIn, staleCategoryIds } from './spend';

/** A budget of 500.00 on "cat-1", running calendar months from January. */
const budget = aBudget({ amount: 50_000, categoryIds: ['cat-1'], startDate: '2026-01-01' });

let sequence = 0;
function expense(date: string, amount: number, categoryId: string | null = 'cat-1'): Transaction {
  return aTransaction({ id: `txn-${sequence++}`, date, amount, categoryId, kind: 'expense' });
}

describe('countsTowards', () => {
  it('counts an expense in one of the budget’s categories', () => {
    expect(countsTowards(budget, expense('2026-01-10', 1_000))).toBe(true);
  });

  it('ignores other categories and uncategorised spending', () => {
    expect(countsTowards(budget, expense('2026-01-10', 1_000, 'cat-2'))).toBe(false);
    expect(countsTowards(budget, expense('2026-01-10', 1_000, null))).toBe(false);
  });

  it('ignores income', () => {
    const income = aTransaction({ kind: 'income', categoryId: 'cat-1' });
    expect(countsTowards(budget, income)).toBe(false);
  });

  it('ignores transfers', () => {
    // Otherwise moving savings into the current account would blow the budget.
    const transfer = aTransaction({
      kind: 'transfer',
      categoryId: 'cat-1',
      counterAccountId: 'acc-2',
    });
    expect(countsTowards(budget, transfer)).toBe(false);
  });

  it('counts every category a budget names', () => {
    const wide = aBudget({ categoryIds: ['cat-1', 'cat-2'] });
    expect(countsTowards(wide, expense('2026-01-10', 1, 'cat-2'))).toBe(true);
  });
});

describe('spendIn', () => {
  const january = windowByIndex(budget, 0);

  it('sums matching transactions in the window', () => {
    const spent = spendIn(budget, january, [
      expense('2026-01-05', 1_200),
      expense('2026-01-20', 3_400),
    ]);
    expect(spent).toBe(4_600);
  });

  it('includes both boundary days', () => {
    expect(spendIn(budget, january, [expense('2026-01-01', 100), expense('2026-01-31', 200)])).toBe(
      300,
    );
  });

  it('excludes transactions outside the window', () => {
    expect(spendIn(budget, january, [expense('2025-12-31', 100), expense('2026-02-01', 200)])).toBe(
      0,
    );
  });

  it('is zero for an empty ledger', () => {
    expect(spendIn(budget, january, [])).toBe(0);
  });
});

describe('carriedInto', () => {
  it('carries nothing when rollover is off', () => {
    expect(carriedInto({ ...budget, rollover: false }, 3, [])).toBe(0);
  });

  it('carries nothing into the first period', () => {
    expect(carriedInto({ ...budget, rollover: true }, 0, [])).toBe(0);
  });

  it('accumulates unspent allowance across several periods', () => {
    const rolling = { ...budget, rollover: true };
    // Spend 100.00 of 500.00 in January, nothing in February.
    const ledger = [expense('2026-01-10', 10_000)];

    expect(carriedInto(rolling, 1, ledger)).toBe(40_000);
    expect(carriedInto(rolling, 2, ledger)).toBe(90_000);
    expect(carriedInto(rolling, 3, ledger)).toBe(140_000);
  });

  it('carries overspend forward as a deficit', () => {
    // A rollover that forgave overspending would flatter rather than inform.
    const rolling = { ...budget, rollover: true };
    const ledger = [expense('2026-01-10', 80_000)]; // 300.00 over

    expect(carriedInto(rolling, 1, ledger)).toBe(-30_000);
  });

  it('nets a surplus against a later deficit', () => {
    const rolling = { ...budget, rollover: true };
    const ledger = [expense('2026-01-10', 20_000), expense('2026-02-10', 70_000)];

    expect(carriedInto(rolling, 1, ledger)).toBe(30_000);
    expect(carriedInto(rolling, 2, ledger)).toBe(10_000);
  });
});

describe('progressFor', () => {
  it('returns nothing before the budget starts', () => {
    expect(progressFor(budget, [], '2025-12-31')).toBeNull();
  });

  it('reports an untouched budget', () => {
    const progress = progressFor(budget, [], '2026-01-15');
    expect(progress).toMatchObject({
      limit: 50_000,
      carried: 0,
      allowance: 50_000,
      spent: 0,
      remaining: 50_000,
      share: 0,
      over: false,
    });
  });

  it('reports partial spend', () => {
    const progress = progressFor(budget, [expense('2026-01-10', 12_500)], '2026-01-15');
    expect(progress).toMatchObject({ spent: 12_500, remaining: 37_500, share: 25, over: false });
  });

  it('flags an overspent budget with a negative remainder', () => {
    const progress = progressFor(budget, [expense('2026-01-10', 60_000)], '2026-01-15');
    expect(progress).toMatchObject({ spent: 60_000, remaining: -10_000, over: true });
    // The bar cannot exceed full, even though the spend does.
    expect(progress?.share).toBe(100);
  });

  it('spends exactly the limit without reporting it as over', () => {
    const progress = progressFor(budget, [expense('2026-01-10', 50_000)], '2026-01-15');
    expect(progress).toMatchObject({ remaining: 0, share: 100, over: false });
  });

  it('counts only the period being looked at', () => {
    const ledger = [expense('2026-01-10', 10_000), expense('2026-02-10', 20_000)];
    expect(progressFor(budget, ledger, '2026-01-15')?.spent).toBe(10_000);
    expect(progressFor(budget, ledger, '2026-02-15')?.spent).toBe(20_000);
  });

  it('adds carried surplus to the allowance', () => {
    const rolling = { ...budget, rollover: true };
    const ledger = [expense('2026-01-10', 10_000)];

    const february = progressFor(rolling, ledger, '2026-02-15');
    expect(february).toMatchObject({ limit: 50_000, carried: 40_000, allowance: 90_000 });
  });

  it('reduces the allowance after an overspent period', () => {
    const rolling = { ...budget, rollover: true };
    const ledger = [expense('2026-01-10', 70_000)];

    expect(progressFor(rolling, ledger, '2026-02-15')).toMatchObject({
      carried: -20_000,
      allowance: 30_000,
    });
  });

  it('treats an exhausted allowance as fully used rather than dividing by zero', () => {
    const rolling = { ...budget, rollover: true };
    // January overspends by exactly one period's worth, leaving nothing.
    const ledger = [expense('2026-01-10', 100_000)];

    const february = progressFor(rolling, ledger, '2026-02-15');
    expect(february?.allowance).toBe(0);
    expect(february?.share).toBe(100);
    expect(Number.isFinite(february!.share)).toBe(true);
  });
});

describe('staleCategoryIds', () => {
  it('finds references to categories that no longer exist', () => {
    const wide = aBudget({ categoryIds: ['cat-1', 'cat-gone'] });
    expect(staleCategoryIds(wide, new Set(['cat-1']))).toEqual(['cat-gone']);
  });

  it('is empty when every category is present', () => {
    expect(staleCategoryIds(budget, new Set(['cat-1', 'cat-2']))).toEqual([]);
  });
});
