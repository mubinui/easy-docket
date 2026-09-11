import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { aBudget, aCategory, aTransaction } from '../testing/factories';
import { BudgetsService } from './budgets.service';
import { LedgerService } from './ledger.service';
import { toIsoDate } from './transactions.service';

let counter = 0;

/**
 * The service is tested against a real database and the real ledger, because
 * the interesting part is the wiring — validation, deduplication and repair of
 * stale references. The arithmetic itself is covered by the pure suites.
 */
async function makeService(): Promise<{ budgets: BudgetsService; db: DocketDb; ledger: LedgerService }> {
  const db = new DocketDb(`budgets-${counter++}`);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const injector = createEnvironmentInjector(
    [{ provide: DOCKET_DB, useValue: db }, LedgerService, BudgetsService],
    TestBed.inject(EnvironmentInjector),
  );
  const ledger = injector.get(LedgerService);
  await ledger.initialise('aaaaaaaa');

  return { budgets: injector.get(BudgetsService), db, ledger };
}

/** Today, so that a budget under test is actually in its first period. */
const today = toIsoDate();
const thisMonth = today.slice(0, 8) + '01';

describe('BudgetsService', () => {
  let budgets: BudgetsService;
  let db: DocketDb;

  beforeEach(async () => {
    ({ budgets, db } = await makeService());
  });

  describe('save', () => {
    it('stores a budget through the ledger, so it replicates', async () => {
      const saved = await budgets.save(aBudget());

      expect(saved.updatedAt).not.toBe('');
      expect(await db.budgets.get('bud-1')).toEqual(saved);
      expect(await db.oplog.count()).toBe(1);
    });

    it('applies defaults', async () => {
      const saved = await budgets.save({
        id: 'bud-2',
        name: 'Transport',
        categoryIds: ['cat-1'],
        period: 'monthly',
        amount: 10_000,
        currency: 'USD',
        startDate: '2026-01-01',
      });

      expect(saved.rollover).toBe(false);
      expect(saved.archived).toBe(false);
      expect(saved.createdAt).toBeGreaterThan(0);
    });

    it('removes duplicate categories rather than double-counting them', async () => {
      const saved = await budgets.save(aBudget({ categoryIds: ['cat-1', 'cat-1', 'cat-2'] }));
      expect(saved.categoryIds).toEqual(['cat-1', 'cat-2']);
    });

    it('rejects a budget that cannot mean anything', async () => {
      await expect(budgets.save(aBudget({ name: '  ' }))).rejects.toThrow(/needs a name/);
      await expect(budgets.save(aBudget({ amount: 0 }))).rejects.toThrow(/greater than zero/);
      await expect(budgets.save(aBudget({ amount: -100 }))).rejects.toThrow(/greater than zero/);
      await expect(budgets.save(aBudget({ categoryIds: [] }))).rejects.toThrow(/at least one/);
      await expect(budgets.save(aBudget({ startDate: '01/2026' }))).rejects.toThrow(/YYYY-MM-DD/);
    });

    it('writes nothing when validation fails', async () => {
      await expect(budgets.save(aBudget({ amount: 0 }))).rejects.toThrow();
      expect(await db.budgets.count()).toBe(0);
      expect(await db.oplog.count()).toBe(0);
    });
  });

  describe('archive and delete', () => {
    it('archives without losing the budget', async () => {
      await budgets.save(aBudget());
      await budgets.setArchived('bud-1', true);

      expect((await db.budgets.get('bud-1'))?.archived).toBe(true);
    });

    it('ignores archiving something that is not there', async () => {
      await expect(budgets.setArchived('missing', true)).resolves.toBeUndefined();
    });

    it('deletes through the ledger, leaving a tombstone', async () => {
      await budgets.save(aBudget());
      await budgets.remove('bud-1');

      expect(await db.budgets.get('bud-1')).toBeUndefined();
      expect((await db.oplog.toArray()).map((o) => o.op)).toEqual(['put', 'delete']);
    });

    it('does not touch the transactions a budget was tracking', async () => {
      await db.transactions.put(aTransaction());
      await budgets.save(aBudget());
      await budgets.remove('bud-1');

      expect(await db.transactions.count()).toBe(1);
    });
  });

  describe('stale category references', () => {
    it('drops references to deleted categories on request', async () => {
      await db.categories.bulkPut([aCategory({ id: 'cat-1' }), aCategory({ id: 'cat-2' })]);
      await budgets.save(aBudget({ categoryIds: ['cat-1', 'cat-2'] }));

      await db.categories.delete('cat-2');
      const pruned = await budgets.pruneStaleCategories('bud-1');

      expect(pruned?.categoryIds).toEqual(['cat-1']);
    });

    it('leaves a healthy budget alone', async () => {
      await db.categories.put(aCategory({ id: 'cat-1' }));
      const saved = await budgets.save(aBudget({ categoryIds: ['cat-1'] }));

      const pruned = await budgets.pruneStaleCategories('bud-1');
      expect(pruned?.updatedAt).toBe(saved.updatedAt);
    });

    it('refuses to empty a budget entirely', async () => {
      // Pruning to nothing would leave a budget that silently tracks no
      // spending at all, which is worse than saying so.
      await budgets.save(aBudget({ categoryIds: ['cat-gone'] }));

      await expect(budgets.pruneStaleCategories('bud-1')).rejects.toThrow(/edit or delete it/);
    });

    it('ignores a budget that does not exist', async () => {
      await expect(budgets.pruneStaleCategories('missing')).resolves.toBeUndefined();
    });
  });

  describe('live status', () => {
    it('reports progress against the current period', async () => {
      await db.categories.put(aCategory({ id: 'cat-1' }));
      await budgets.save(aBudget({ startDate: thisMonth, amount: 50_000 }));
      await db.transactions.put(aTransaction({ date: today, amount: 12_500, categoryId: 'cat-1' }));

      // liveQuery is asynchronous; give the signal a turn to settle.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const [status] = budgets.statuses();
      expect(status?.progress).toMatchObject({ spent: 12_500, remaining: 37_500 });
      expect(status?.staleCategoryIds).toEqual([]);
    });

    it('surfaces a budget whose category was deleted', async () => {
      await budgets.save(aBudget({ startDate: thisMonth, categoryIds: ['cat-gone'] }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(budgets.needingAttention()).toHaveLength(1);
      expect(budgets.needingAttention()[0].staleCategoryIds).toEqual(['cat-gone']);
    });

    it('excludes archived budgets', async () => {
      await budgets.save(aBudget({ startDate: thisMonth, archived: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(budgets.statuses()).toHaveLength(0);
    });

    it('orders by how close each budget is to its limit', async () => {
      await db.categories.put(aCategory({ id: 'cat-1' }));
      await budgets.save(aBudget({ id: 'bud-a', name: 'A', startDate: thisMonth, amount: 100_000 }));
      await budgets.save(aBudget({ id: 'bud-b', name: 'B', startDate: thisMonth, amount: 10_000 }));
      await db.transactions.put(aTransaction({ date: today, amount: 9_000, categoryId: 'cat-1' }));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both see the same 90.00 of spend; the smaller budget is nearer its limit.
      expect(budgets.byUrgency().map((s) => s.budget.id)).toEqual(['bud-b', 'bud-a']);
      expect(budgets.overspent()).toHaveLength(0);
    });
  });
});
