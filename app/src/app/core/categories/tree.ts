import { Category, CategoryKind } from '../models/domain';

/**
 * Arranging categories, and rolling a subcategory up to its parent.
 *
 * Pure and away from Angular, because the roll-up is the part that budgets and
 * reports depend on and it is far easier to state as a function of a list than
 * to chase through a screen.
 */

/** A top-level category with its subcategories, in display order. */
export interface CategoryNode {
  category: Category;
  children: Category[];
}

/**
 * Sibling order: by name, then by id.
 *
 * Categories are not hand-ordered — there is no position to store and nothing
 * to drag. The id is a tiebreak rather than decoration: two categories may
 * legitimately share a name (one under Food, one under Social Life), and
 * without a second key their order would depend on whichever row Dexie happened
 * to return first, which can differ between devices.
 */
export function compareCategories(a: Category, b: Category): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Group a flat list into top-level categories and their subcategories.
 *
 * A subcategory whose parent is missing — deleted on another device, not yet
 * synced — is promoted to the top level rather than dropped. An orphan on
 * screen can be moved or deleted; an orphan that has silently vanished cannot.
 */
export function buildTree(categories: readonly Category[], kind?: CategoryKind): CategoryNode[] {
  const scope = kind ? categories.filter((c) => c.kind === kind) : [...categories];
  const byId = new Map(scope.map((c) => [c.id, c]));

  const roots: Category[] = [];
  const children = new Map<string, Category[]>();

  for (const category of scope) {
    const parent = category.parentId ? byId.get(category.parentId) : undefined;
    // A subcategory of a subcategory is not a thing this model has, so anything
    // pointing at one is treated as top-level.
    if (!parent || parent.parentId !== null) {
      roots.push(category);
      continue;
    }
    const bucket = children.get(parent.id);
    if (bucket) bucket.push(category);
    else children.set(parent.id, [category]);
  }

  return roots
    .sort(compareCategories)
    .map((category) => ({
      category,
      children: (children.get(category.id) ?? []).sort(compareCategories),
    }));
}

/**
 * The top-level category a transaction's category belongs to.
 *
 * This is the roll-up every total depends on: a budget on "Food" has to count a
 * transaction filed under "Food → Lunch", and a report that split one category
 * across its subcategories would be answering a question nobody asked.
 *
 * Returns the id unchanged when it is already top-level, or when the parent is
 * unknown here — an unknown parent is a category this device has not seen yet,
 * and guessing would be worse than reporting what is actually recorded.
 */
export function rootIdOf(
  categoryId: string | null,
  categories: ReadonlyMap<string, Category>,
): string | null {
  if (categoryId === null) return null;
  const category = categories.get(categoryId);
  if (!category?.parentId) return categoryId;
  return categories.has(category.parentId) ? category.parentId : categoryId;
}

/** Index a list by id, for the roll-up above. */
export function byId(categories: readonly Category[]): Map<string, Category> {
  return new Map(categories.map((category) => [category.id, category]));
}

/**
 * A category and every subcategory of it.
 *
 * What a budget on a parent actually covers, and what has to be dealt with
 * before the parent can be deleted.
 */
export function descendantIds(
  categoryId: string,
  categories: readonly Category[],
): string[] {
  return categories.filter((c) => c.parentId === categoryId).map((c) => c.id);
}

/**
 * Expand a set of category ids to include every subcategory of each.
 *
 * Used where a selection means "this category" but the transactions are filed
 * against its children — a budget, most obviously.
 */
export function withDescendants(
  ids: readonly string[],
  categories: readonly Category[],
): Set<string> {
  const wanted = new Set(ids);
  for (const category of categories) {
    if (category.parentId && wanted.has(category.parentId)) wanted.add(category.id);
  }
  return wanted;
}

/**
 * A map from every category id to the top-level category it rolls up to.
 *
 * Built once and handed to the aggregates, which would otherwise have to walk
 * the category list for every transaction.
 */
export function rootIds(categories: readonly Category[]): Map<string, string> {
  const index = byId(categories);
  const roots = new Map<string, string>();
  for (const category of categories) {
    roots.set(category.id, rootIdOf(category.id, index) ?? category.id);
  }
  return roots;
}
