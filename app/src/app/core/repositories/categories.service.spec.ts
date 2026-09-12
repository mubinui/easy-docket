import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { waitUntil } from '../testing/async';
import { aCategory, aTransaction } from '../testing/factories';
import { CategoriesService } from './categories.service';
import { LedgerService } from './ledger.service';

let counter = 0;

describe('CategoriesService', () => {
  let categories: CategoriesService;
  let ledger: LedgerService;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`categories-${counter++}`);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DOCKET_DB, useValue: db }] });
    ledger = TestBed.inject(LedgerService);
    await ledger.initialise('aaaaaaaa');
    categories = TestBed.inject(CategoriesService);
  });

  async function seen(count: number): Promise<void> {
    await waitUntil(() => categories.all().length >= count);
  }

  /** Food with two subcategories, plus an unrelated top-level category. */
  async function seedTree(): Promise<void> {
    await db.categories.bulkPut([
      aCategory({ id: 'food', name: 'Food', kind: 'expense', parentId: null }),
      aCategory({ id: 'lunch', name: 'Lunch', kind: 'expense', parentId: 'food' }),
      aCategory({ id: 'dinner', name: 'Dinner', kind: 'expense', parentId: 'food' }),
      aCategory({ id: 'rent', name: 'Rent', kind: 'expense', parentId: null }),
      aCategory({ id: 'salary', name: 'Salary', kind: 'income', parentId: null }),
    ]);
    await seen(5);
  }

  describe('the tree', () => {
    it('nests subcategories under their parent', async () => {
      await seedTree();

      // Sorted by name, at both levels.
      const tree = categories.tree('expense');
      expect(tree.map((node) => node.category.name)).toEqual(['Food', 'Rent']);
      expect(tree[0].children.map((c) => c.name)).toEqual(['Dinner', 'Lunch']);
    });

    it('keeps income and expense apart', async () => {
      await seedTree();
      expect(categories.tree('income').map((n) => n.category.name)).toEqual(['Salary']);
    });

    it('offers only top-level categories as parents', async () => {
      await seedTree();
      expect(categories.parents('expense').map((c) => c.name)).toEqual(['Food', 'Rent']);
    });

    it('lists a category\'s subcategories by name', async () => {
      await seedTree();
      expect(categories.childrenOf('food').map((c) => c.name)).toEqual(['Dinner', 'Lunch']);
      expect(categories.childrenOf('rent')).toEqual([]);
    });

    it('leaves archived categories out', async () => {
      await db.categories.bulkPut([
        aCategory({ id: 'food', name: 'Food', kind: 'expense' }),
        aCategory({ id: 'old', name: 'Retired', kind: 'expense', archived: true }),
      ]);
      await seen(2);

      expect(categories.tree('expense').map((n) => n.category.name)).toEqual(['Food']);
    });
  });

  describe('naming', () => {
    it('shows a subcategory with its parent, so a row is unambiguous', async () => {
      await seedTree();
      expect(categories.pathOf('lunch')).toBe('Food › Lunch');
    });

    it('shows a top-level category on its own', async () => {
      await seedTree();
      expect(categories.pathOf('rent')).toBe('Rent');
    });

    it('is empty for nothing and for a category this device does not have', async () => {
      await seedTree();
      expect(categories.pathOf(null)).toBe('');
      expect(categories.pathOf('gone')).toBe('');
    });
  });

  describe('deleting', () => {
    it('takes the subcategories with the parent', async () => {
      // Leaving them behind would put categories on screen that the user
      // believes they deleted.
      await seedTree();
      await categories.remove('food');

      expect(await db.categories.get('food')).toBeUndefined();
      expect(await db.categories.get('lunch')).toBeUndefined();
      expect(await db.categories.get('dinner')).toBeUndefined();
    });

    it('leaves other categories alone', async () => {
      await seedTree();
      await categories.remove('food');

      expect(await db.categories.get('rent')).toBeDefined();
      expect(await db.categories.get('salary')).toBeDefined();
    });

    it('deletes a subcategory on its own', async () => {
      await seedTree();
      await categories.remove('lunch');

      expect(await db.categories.get('lunch')).toBeUndefined();
      expect(await db.categories.get('food')).toBeDefined();
      expect(await db.categories.get('dinner')).toBeDefined();
    });

    it('replicates every removal, so another device agrees', async () => {
      await seedTree();
      await categories.remove('food');

      const ops = (await ledger.allOperations()).filter((op) => op.op === 'delete');
      expect(ops.map((op) => op.entityId).sort()).toEqual(['dinner', 'food', 'lunch']);
    });

    it('counts the transactions a deletion would leave uncategorised', async () => {
      // Including the subcategories', which is the number that would surprise
      // someone deleting a parent.
      await seedTree();
      await db.transactions.bulkPut([
        aTransaction({ id: 't1', categoryId: 'food' }),
        aTransaction({ id: 't2', categoryId: 'lunch' }),
        aTransaction({ id: 't3', categoryId: 'rent' }),
      ]);

      expect(await categories.transactionCount('food')).toBe(2);
      expect(await categories.transactionCount('rent')).toBe(1);
    });
  });

  describe('seeding', () => {
    it('leaves them all top-level', async () => {
      await categories.seedIfEmpty();
      await seen(10);

      expect((await db.categories.toArray()).every((c) => c.parentId === null)).toBe(true);
    });
  });
});
