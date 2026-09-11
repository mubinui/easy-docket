import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { Category, CategoryKind } from '../models/domain';
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
  readonly income = computed(() => this.active().filter((c) => c.kind === 'income'));
  readonly expense = computed(() => this.active().filter((c) => c.kind === 'expense'));

  forKind(kind: CategoryKind): Category[] {
    return kind === 'income' ? this.income() : this.expense();
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

  async remove(id: string): Promise<void> {
    await this.ledger.remove('categories', id);
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
