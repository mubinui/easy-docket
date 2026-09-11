import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { BudgetProgress, progressFor, staleCategoryIds } from '../budgets/spend';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { Budget } from '../models/domain';
import { LedgerService } from './ledger.service';
import { toIsoDate } from '../util/dates';

/** What a caller must supply to create a budget; the rest defaults. */
export type BudgetDraft = Pick<
  Budget,
  'id' | 'name' | 'categoryIds' | 'period' | 'amount' | 'currency' | 'startDate'
> &
  Partial<Budget>;

/** A budget together with its current period's progress and any broken references. */
export interface BudgetStatus {
  budget: Budget;
  /** Null before the budget's start date. */
  progress: BudgetProgress | null;
  /** Categories this budget names that have since been deleted. */
  staleCategoryIds: string[];
}

@Injectable({ providedIn: 'root' })
export class BudgetsService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly ledger = inject(LedgerService);

  /**
   * Sorted in memory rather than by index. A ledger has tens of budgets, not
   * thousands, so an index on `name` would buy nothing and would tie display
   * order to the schema — meaning a future reorder needed a migration.
   */
  readonly all = toSignal(
    from(
      liveQuery(async () =>
        (await this.db.budgets.toArray()).sort((a, b) => a.name.localeCompare(b.name)),
      ),
    ),
    { initialValue: [] as Budget[] },
  );

  readonly active = computed(() => this.all().filter((budget) => !budget.archived));

  /**
   * Progress for every active budget, recomputed whenever budgets, transactions
   * or categories change.
   *
   * The whole transaction table is read, as `AccountsService` does for balances.
   * That is fine for a personal ledger and wrong for a large one; see the known
   * gaps note in `task.md` rather than optimising speculatively here.
   */
  readonly statuses = toSignal(
    from(
      liveQuery(async () => {
        const [budgets, transactions, categories] = await Promise.all([
          this.db.budgets.toArray(),
          this.db.transactions.toArray(),
          this.db.categories.toArray(),
        ]);

        const known = new Set(categories.map((category) => category.id));
        const today = toIsoDate();

        return budgets
          .filter((budget) => !budget.archived)
          .map<BudgetStatus>((budget) => ({
            budget,
            progress: progressFor(budget, transactions, today),
            staleCategoryIds: staleCategoryIds(budget, known),
          }));
      }),
    ),
    { initialValue: [] as BudgetStatus[] },
  );

  /** Closest to its limit first — what the dashboard card wants to show. */
  readonly byUrgency = computed(() =>
    [...this.statuses()]
      .filter((status) => status.progress !== null)
      .sort((a, b) => (b.progress?.share ?? 0) - (a.progress?.share ?? 0)),
  );

  readonly overspent = computed(() => this.statuses().filter((s) => s.progress?.over));

  /** Budgets pointing at a deleted category, so the UI can prompt a fix. */
  readonly needingAttention = computed(() =>
    this.statuses().filter((status) => status.staleCategoryIds.length > 0),
  );

  byId(id: string): Budget | undefined {
    return this.all().find((budget) => budget.id === id);
  }

  async get(id: string): Promise<Budget | undefined> {
    return this.db.budgets.get(id);
  }

  async save(draft: BudgetDraft): Promise<Budget> {
    const budget = {
      rollover: false,
      archived: false,
      createdAt: Date.now(),
      updatedAt: '',
      ...draft,
      // Duplicates would double-count the same spending against one budget.
      categoryIds: [...new Set(draft.categoryIds)],
    } as Budget;

    assertValid(budget);
    return this.ledger.put('budgets', budget);
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    const budget = await this.get(id);
    if (!budget) return;
    await this.ledger.put('budgets', { ...budget, archived });
  }

  async remove(id: string): Promise<void> {
    await this.ledger.remove('budgets', id);
  }

  /**
   * Drop references to categories that no longer exist. Offered as an explicit
   * action rather than done automatically: only the user knows whether the right
   * repair is to forget the category or to recreate it.
   */
  async pruneStaleCategories(id: string): Promise<Budget | undefined> {
    const budget = await this.get(id);
    if (!budget) return undefined;

    const known = new Set((await this.db.categories.toArray()).map((category) => category.id));
    const kept = budget.categoryIds.filter((categoryId) => known.has(categoryId));
    if (kept.length === budget.categoryIds.length) return budget;
    if (kept.length === 0) {
      throw new Error('Every category this budget tracks has been deleted; edit or delete it');
    }

    return this.ledger.put('budgets', { ...budget, categoryIds: kept });
  }
}

function assertValid(budget: Budget): void {
  if (!budget.name.trim()) throw new Error('A budget needs a name');
  if (budget.amount <= 0) throw new Error('The budget amount must be greater than zero');
  if (budget.categoryIds.length === 0) throw new Error('Choose at least one category');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(budget.startDate)) throw new Error('Start date must be YYYY-MM-DD');
}
