import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { spendByCategory } from '../reports/aggregate';
import { countsTowards, progressFor } from '../budgets/spend';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { BudgetsService } from '../repositories/budgets.service';
import { LedgerService } from '../repositories/ledger.service';
import { waitUntil } from '../testing/async';
import { aBudget, aCategory, aTransaction } from '../testing/factories';
import { toIsoDate } from '../util/dates';
import { rootIds, withDescendants } from './tree';

let counter = 0;

/**
 * A subcategory must not hide spending from the totals that already existed.
 *
 * This is the risk the whole roll-up exists to answer: before subcategories,
 * every transaction carried a top-level category, and budgets and reports
 * matched on it exactly. The moment someone files a transaction under
 * "Food → Lunch", an exact match stops seeing it — a budget quietly under-counts
 * and a report splits one category into several rows. Neither failure announces
 * itself.
 */
const FOOD = aCategory({ id: 'food', name: 'Food', kind: 'expense', parentId: null });
const LUNCH = aCategory({ id: 'lunch', name: 'Lunch', kind: 'expense', parentId: 'food' });
const DINNER = aCategory({ id: 'dinner', name: 'Dinner', kind: 'expense', parentId: 'food' });
const RENT = aCategory({ id: 'rent', name: 'Rent', kind: 'expense', parentId: null });
const CATEGORIES = [FOOD, LUNCH, DINNER, RENT];

function spend(id: string, amount: number, categoryId: string | null, date = '2026-03-10') {
  return aTransaction({ id, kind: 'expense', amount, categoryId, date });
}

describe('a subcategory rolls up to its parent', () => {
  describe('in reports', () => {
    const RANGE = { from: '2026-03-01', to: '2026-03-31' };

    it('counts subcategory spending against the parent', () => {
      const rows = spendByCategory(
        [spend('t1', 100_00, 'food'), spend('t2', 40_00, 'lunch'), spend('t3', 25_00, 'dinner')],
        RANGE,
        'USD',
        rootIds(CATEGORIES),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ categoryId: 'food', amount: 165_00, count: 3 });
    });

    it('keeps other categories separate', () => {
      const rows = spendByCategory(
        [spend('t1', 40_00, 'lunch'), spend('t2', 900_00, 'rent')],
        RANGE,
        'USD',
        rootIds(CATEGORIES),
      );

      expect(rows.map((r) => [r.categoryId, r.amount])).toEqual([
        ['rent', 900_00],
        ['food', 40_00],
      ]);
    });

    it('leaves the rows unrolled when no map is given', () => {
      // A drill-down into one category wants its subcategories apart.
      const rows = spendByCategory(
        [spend('t1', 40_00, 'lunch'), spend('t2', 25_00, 'dinner')],
        RANGE,
        'USD',
      );

      expect(rows.map((r) => r.categoryId).sort()).toEqual(['dinner', 'lunch']);
    });

    it('leaves uncategorised spending uncategorised', () => {
      const rows = spendByCategory([spend('t1', 10_00, null)], RANGE, 'USD', rootIds(CATEGORIES));
      expect(rows[0].categoryId).toBeNull();
    });
  });

  describe('in budgets', () => {
    const budget = aBudget({ id: 'b1', categoryIds: ['food'], amount: 500_00 });
    const covered = withDescendants(budget.categoryIds, CATEGORIES);

    it('counts a transaction filed under a subcategory', () => {
      expect(countsTowards(budget, spend('t1', 40_00, 'lunch'), covered)).toBe(true);
    });

    it('still counts one filed under the parent itself', () => {
      expect(countsTowards(budget, spend('t1', 40_00, 'food'), covered)).toBe(true);
    });

    it('does not count an unrelated category', () => {
      expect(countsTowards(budget, spend('t1', 900_00, 'rent'), covered)).toBe(false);
    });

    it('would have missed it without the expansion — the bug this prevents', () => {
      // Left here deliberately: it is the behaviour a reader would otherwise
      // assume is still correct.
      expect(countsTowards(budget, spend('t1', 40_00, 'lunch'))).toBe(false);
    });

    it('adds up parent and subcategory spending together', () => {
      const progress = progressFor(
        budget,
        [spend('t1', 100_00, 'food'), spend('t2', 40_00, 'lunch'), spend('t3', 900_00, 'rent')],
        '2026-03-15',
        covered,
      );

      expect(progress?.spent).toBe(140_00);
    });
  });

  describe('through the real budgets service', () => {
    let db: DocketDb;

    // Inside the budget's current period, or `progressFor` reports a window
    // that contains none of these.
    const today = toIsoDate();
    const monthStart = `${today.slice(0, 8)}01`;

    beforeEach(async () => {
      db = new DocketDb(`rollup-${counter++}`);
      await db.categories.bulkPut(CATEGORIES);
      await db.budgets.put(aBudget({ id: 'b1', categoryIds: ['food'], amount: 500_00,
        startDate: monthStart, period: 'monthly' }));
      await db.transactions.bulkPut([
        spend('t1', 100_00, 'food', today),
        spend('t2', 40_00, 'lunch', today),
        spend('t3', 900_00, 'rent', today),
      ]);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: DOCKET_DB, useValue: db }] });
      await TestBed.inject(LedgerService).initialise('aaaaaaaa');
    });

    it('expands the budget to its subcategories without being asked', async () => {
      const budgets = TestBed.inject(BudgetsService);
      await waitUntil(() => budgets.statuses().length === 1);

      const [status] = budgets.statuses();
      // 100 on the parent and 40 on the subcategory; the 900 of rent is not
      // this budget's business.
      expect(status.progress?.spent).toBe(140_00);
    });
  });
});
