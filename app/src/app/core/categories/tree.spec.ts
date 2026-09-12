import { describe, expect, it } from 'vitest';
import { aCategory } from '../testing/factories';
import {
  buildTree,
  byId,
  compareCategories,
  descendantIds,
  rootIdOf,
  withDescendants,
} from './tree';

/** A top-level category. */
function top(id: string, name: string, extra = {}) {
  return aCategory({ id, name, parentId: null, ...extra });
}

/** A subcategory of `parentId`. */
function sub(id: string, name: string, parentId: string, extra = {}) {
  return aCategory({ id, name, parentId, ...extra });
}

describe('compareCategories', () => {
  it('orders by name', () => {
    const zed = top('a', 'Zed');
    const abe = top('b', 'Abe');
    expect([zed, abe].sort(compareCategories).map((c) => c.name)).toEqual(['Abe', 'Zed']);
  });

  it('breaks a tie by id, so two devices agree', () => {
    // Two categories may legitimately share a name — one under Food, one under
    // Social Life. Without a second key their order would depend on whichever
    // row Dexie returned first.
    const first = top('a', 'Other');
    const second = top('b', 'Other');
    expect([second, first].sort(compareCategories).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('buildTree', () => {
  const CATEGORIES = [
    top('food', 'Food'),
    top('living', 'Living'),
    sub('lunch', 'Lunch', 'food'),
    sub('dinner', 'Dinner', 'food'),
    sub('rent', 'Rent', 'living'),
    aCategory({ id: 'salary', name: 'Salary', kind: 'income', parentId: null }),
  ];

  it('nests subcategories under their parent, each in order', () => {
    const tree = buildTree(CATEGORIES, 'expense');

    expect(tree.map((n) => n.category.name)).toEqual(['Food', 'Living']);
    expect(tree[0].children.map((c) => c.name)).toEqual(['Dinner', 'Lunch']);
    expect(tree[1].children.map((c) => c.name)).toEqual(['Rent']);
  });

  it('keeps the two kinds apart', () => {
    expect(buildTree(CATEGORIES, 'income').map((n) => n.category.name)).toEqual(['Salary']);
  });

  it('gives a childless category an empty list, not a missing one', () => {
    const tree = buildTree([top('a', 'Gift')], 'expense');
    expect(tree[0].children).toEqual([]);
  });

  it('promotes an orphan rather than dropping it', () => {
    // The parent was deleted on another device and the delete has arrived
    // before the child was moved. An orphan on screen can be dealt with; one
    // that silently vanished cannot.
    const tree = buildTree([sub('lunch', 'Lunch', 'gone')], 'expense');

    expect(tree.map((n) => n.category.name)).toEqual(['Lunch']);
  });

  it('refuses to nest below one level', () => {
    // Nothing in the model creates this, but a bad sync could. Two levels is
    // the contract every total is written against.
    const tree = buildTree(
      [top('food', 'Food'), sub('lunch', 'Lunch', 'food'), sub('tuesday', 'Tuesday', 'lunch')],
      'expense',
    );

    expect(tree.map((n) => n.category.name).sort()).toEqual(['Food', 'Tuesday']);
    expect(tree.find((n) => n.category.id === 'food')?.children.map((c) => c.name)).toEqual([
      'Lunch',
    ]);
  });

  it('takes every kind when none is named', () => {
    expect(buildTree(CATEGORIES)).toHaveLength(3);
  });
});

describe('rootIdOf', () => {
  const index = byId([
    top('food', 'Food'),
    sub('lunch', 'Lunch', 'food'),
    sub('orphan', 'Orphan', 'gone'),
  ]);

  it('rolls a subcategory up to its parent', () => {
    // The whole reason budgets and reports keep working when a subcategory is
    // introduced.
    expect(rootIdOf('lunch', index)).toBe('food');
  });

  it('leaves a top-level category alone', () => {
    expect(rootIdOf('food', index)).toBe('food');
  });

  it('leaves an uncategorised transaction alone', () => {
    expect(rootIdOf(null, index)).toBeNull();
  });

  it('reports what is recorded when the parent is unknown here', () => {
    // Guessing would be worse: the category exists, this device has just not
    // seen the parent yet.
    expect(rootIdOf('orphan', index)).toBe('orphan');
  });

  it('leaves an unknown category alone', () => {
    expect(rootIdOf('never-heard-of-it', index)).toBe('never-heard-of-it');
  });
});

describe('descendantIds', () => {
  const CATEGORIES = [
    top('food', 'Food'),
    sub('lunch', 'Lunch', 'food'),
    sub('dinner', 'Dinner', 'food'),
    top('living', 'Living'),
  ];

  it('lists the subcategories of a category', () => {
    expect(descendantIds('food', CATEGORIES).sort()).toEqual(['dinner', 'lunch']);
  });

  it('is empty for a category with none', () => {
    expect(descendantIds('living', CATEGORIES)).toEqual([]);
  });
});

describe('withDescendants', () => {
  const CATEGORIES = [
    top('food', 'Food'),
    sub('lunch', 'Lunch', 'food'),
    sub('dinner', 'Dinner', 'food'),
    top('living', 'Living'),
    sub('rent', 'Rent', 'living'),
  ];

  it('expands a parent to cover its children', () => {
    // A budget on "Food" has to count what was spent on "Food → Lunch".
    expect([...withDescendants(['food'], CATEGORIES)].sort()).toEqual(['dinner', 'food', 'lunch']);
  });

  it('leaves a subcategory selection alone', () => {
    expect([...withDescendants(['lunch'], CATEGORIES)]).toEqual(['lunch']);
  });

  it('expands several at once', () => {
    expect([...withDescendants(['food', 'living'], CATEGORIES)].sort()).toEqual([
      'dinner',
      'food',
      'living',
      'lunch',
      'rent',
    ]);
  });

  it('is empty for an empty selection', () => {
    expect([...withDescendants([], CATEGORIES)]).toEqual([]);
  });
});
