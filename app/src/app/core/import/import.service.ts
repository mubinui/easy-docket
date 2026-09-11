import { Injectable, inject } from '@angular/core';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { Category, Transaction } from '../models/domain';
import { CategoriesService } from '../repositories/categories.service';
import { LedgerService } from '../repositories/ledger.service';
import { RatesService } from '../repositories/rates.service';
import { ImportPlan, PlannedRow, duplicateKey } from './csv-import';

export interface ImportResult {
  imported: number;
  skipped: number;
  /** Categories created because the file named ones the ledger did not have. */
  categoriesCreated: string[];
}

/**
 * Writing a planned import into the ledger.
 *
 * Separate from the planner so that resolving a file and changing the ledger
 * are distinct steps: the user sees the whole plan, including what will be
 * skipped, before anything is written.
 */
@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly ledger = inject(LedgerService);
  private readonly categories = inject(CategoriesService);
  private readonly rates = inject(RatesService);

  /** Keys for everything already recorded, so the planner can spot repeats. */
  async existingKeys(): Promise<Set<string>> {
    const transactions = await this.db.transactions.toArray();
    return new Set(
      transactions.map((txn) => duplicateKey(txn.date, txn.amount, txn.payee)),
    );
  }

  /**
   * Write the rows a plan marked ready.
   *
   * Duplicates and failures are skipped unless `includeDuplicates` says
   * otherwise — a second import of the same statement should be a no-op, which
   * is the whole point of detecting them.
   */
  async apply(
    plan: ImportPlan,
    options: { accountId: string; currency: string; includeDuplicates?: boolean },
  ): Promise<ImportResult> {
    const categoriesByName = new Map(
      this.categories.all().map((category) => [category.name.toLowerCase(), category]),
    );
    const created: string[] = [];

    let imported = 0;
    let skipped = 0;

    for (const row of plan.rows) {
      if (!shouldImport(row, options.includeDuplicates ?? false)) {
        skipped++;
        continue;
      }

      const planned = row.transaction!;
      let categoryId: string | null = null;

      if (planned.categoryName) {
        const existing = categoriesByName.get(planned.categoryName.toLowerCase());
        if (existing) {
          categoryId = existing.id;
        } else {
          // The file named a category this ledger does not have. Creating it is
          // less surprising than dropping the only classification the user had.
          const category = await this.categories.save({
            id: crypto.randomUUID(),
            name: planned.categoryName,
            kind: planned.kind === 'income' ? 'income' : 'expense',
          });
          categoriesByName.set(planned.categoryName.toLowerCase(), category as Category);
          created.push(category.name);
          categoryId = category.id;
        }
      }

      await this.ledger.put('transactions', this.toTransaction(planned, categoryId, options));
      imported++;
    }

    return { imported, skipped, categoriesCreated: created };
  }

  private toTransaction(
    planned: ImportPlan['rows'][number]['transaction'] & object,
    categoryId: string | null,
    options: { accountId: string; currency: string },
  ): Transaction {
    const reporting = this.rates.reportingCurrency();
    const rate =
      options.currency.toUpperCase() === reporting.toUpperCase()
        ? null
        : this.rates.rateToReporting(options.currency, planned.date);

    return {
      id: crypto.randomUUID(),
      kind: planned.kind,
      amount: planned.amount,
      currency: options.currency,
      accountId: options.accountId,
      counterAccountId: null,
      categoryId,
      date: planned.date,
      payee: planned.payee,
      note: planned.note,
      tags: [],
      // Imported from a statement, so it has already happened.
      cleared: true,
      ...(rate !== null ? { rate, rateDate: planned.date } : {}),
      createdAt: Date.now(),
      updatedAt: '',
    };
  }
}

function shouldImport(row: PlannedRow, includeDuplicates: boolean): boolean {
  if (!row.transaction) return false;
  return !row.duplicate || includeDuplicates;
}
