import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { CategoryNode, buildTree, compareCategories, descendantIds } from '../categories/tree';
import { Category, CategoryKind } from '../models/domain';
import { DEFAULT_REPORTING_CURRENCY } from './rates.service';
import { LedgerService } from './ledger.service';

/** The categories a new vault starts with, so the first transaction is one tap. */
const STARTER_CATEGORIES: ReadonlyArray<
  Pick<Category, 'name' | 'kind' | 'icon' | 'colour'>
> = [
  { name: 'Salary', kind: 'income', icon: 'wallet-outline', colour: '#2dd36f' },
  { name: 'Other income', kind: 'income', icon: 'trending-up-outline', colour: '#2dd36f' },
  { name: 'Groceries', kind: 'expense', icon: 'basket-outline', colour: '#ffc409' },
  { name: 'Eating out', kind: 'expense', icon: 'restaurant-outline', colour: '#ff6b35' },
  { name: 'Transport', kind: 'expense', icon: 'bus-outline', colour: '#3dc2ff' },
  { name: 'Housing', kind: 'expense', icon: 'home-outline', colour: '#5260ff' },
  { name: 'Utilities', kind: 'expense', icon: 'flash-outline', colour: '#3880ff' },
  { name: 'Health', kind: 'expense', icon: 'medkit-outline', colour: '#eb445a' },
  { name: 'Entertainment', kind: 'expense', icon: 'film-outline', colour: '#c04df9' },
  { name: 'Other', kind: 'expense', icon: 'ellipsis-horizontal-outline', colour: '#92949c' },
];

/** The fields a caller must supply; the rest default. */
export type CategoryDraft = Pick<Category, 'id' | 'name' | 'kind'> & Partial<Category>;

@Injectable({ providedIn: 'root' })
export class CategoriesService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly ledger = inject(LedgerService);

  readonly all = toSignal(from(liveQuery(() => this.db.categories.orderBy('name').toArray())), {
    initialValue: [] as Category[],
  });

  readonly active = computed(() => this.all().filter((category) => !category.archived));

  private readonly settings = toSignal(from(liveQuery(() => this.db.vaultSettings.get('vault'))), {
    initialValue: undefined,
  });

  /**
   * Whether the second level is offered at all.
   *
   * Vault-wide, so two devices agree about how deep the list goes, and on by
   * default — a vault written before the setting existed keeps behaving the way
   * it did.
   */
  readonly subcategoriesEnabled = computed(() => this.settings()?.subcategories !== false);

  /**
   * Turn the second level on or off.
   *
   * Nothing is deleted either way. Subcategories stay in the ledger and the
   * transactions filed against them keep counting towards their parent; they
   * simply stop being offered. Turning a display preference into a data
   * migration would be a cruel thing to do to someone who wanted a shorter list.
   */
  async setSubcategoriesEnabled(enabled: boolean): Promise<void> {
    const existing = await this.db.vaultSettings.get('vault');
    await this.ledger.put('vaultSettings', {
      reportingCurrency: DEFAULT_REPORTING_CURRENCY,
      ...existing,
      id: 'vault',
      subcategories: enabled,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: '',
    });
  }
  readonly income = computed(() => this.active().filter((c) => c.kind === 'income'));
  readonly expense = computed(() => this.active().filter((c) => c.kind === 'expense'));

  forKind(kind: CategoryKind): Category[] {
    return kind === 'income' ? this.income() : this.expense();
  }

  /** Top-level categories of a kind, each with its subcategories, in order. */
  tree(kind: CategoryKind): CategoryNode[] {
    return buildTree(this.active(), kind);
  }

  /** Top-level categories of a kind — what a subcategory can be filed under. */
  parents(kind: CategoryKind): Category[] {
    return this.active()
      .filter((category) => category.kind === kind && category.parentId === null)
      .sort(compareCategories);
  }

  /** The subcategories of a category, in order. */
  childrenOf(categoryId: string): Category[] {
    return this.active()
      .filter((category) => category.parentId === categoryId)
      .sort(compareCategories);
  }

  /**
   * The full name of a category: "Food → Lunch" for a subcategory, "Food" for a
   * top-level one. What a register row shows, so a transaction's category is
   * unambiguous without opening it.
   */
  pathOf(id: string | null): string {
    const category = this.byId(id);
    if (!category) return '';
    const parent = this.byId(category.parentId);
    return parent ? `${parent.name} › ${category.name}` : category.name;
  }

  byId(id: string | null): Category | undefined {
    return id ? this.all().find((category) => category.id === id) : undefined;
  }

  async save(draft: CategoryDraft): Promise<Category> {
    return this.ledger.put('categories', {
      parentId: null,
      archived: false,
      createdAt: Date.now(),
      updatedAt: '',
      ...draft,
    } as Category);
  }

  /**
   * Delete a category.
   *
   * A subcategory goes on its own. A top-level category takes its subcategories
   * with it — they cannot outlive their parent as anything meaningful, and
   * leaving them behind as orphans would put categories on screen that the user
   * believes they deleted.
   *
   * Transactions already filed against any of them keep their `categoryId` and
   * read as uncategorised. That is the existing behaviour for a deleted
   * category, and the alternative — rewriting history to say a purchase was
   * something else — is worse.
   */
  async remove(id: string): Promise<void> {
    for (const childId of descendantIds(id, this.all())) {
      await this.ledger.remove('categories', childId);
    }
    await this.ledger.remove('categories', id);
  }

  /** How many transactions would be left uncategorised by deleting this. */
  async transactionCount(id: string): Promise<number> {
    const ids = new Set([id, ...descendantIds(id, this.all())]);
    return this.db.transactions.filter((txn) => txn.categoryId !== null && ids.has(txn.categoryId)).count();
  }

  /**
   * Seed a new vault. Guarded on the table being empty rather than a flag, so a
   * device that joins an existing vault and syncs categories down does not end
   * up with a duplicate set.
   */
  async seedIfEmpty(): Promise<void> {
    if ((await this.db.categories.count()) > 0) return;

    for (const starter of STARTER_CATEGORIES) {
      await this.save({ id: crypto.randomUUID(), ...starter });
    }
  }
}
