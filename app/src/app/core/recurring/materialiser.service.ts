import { Injectable, inject } from '@angular/core';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { RecurringRule, Transaction } from '../models/domain';
import { LedgerService } from '../repositories/ledger.service';
import { toIsoDate } from '../util/dates';
import {
  MAX_OCCURRENCES_PER_RUN,
  occurrenceId,
  occurrencesUpTo,
  parseOccurrenceId,
} from './schedule';

export interface MaterialisationResult {
  created: number;
  /** Rules that hit the per-run cap and have more to catch up on next time. */
  incomplete: string[];
}

/**
 * Turns recurring rules into ordinary transactions.
 *
 * Runs on app open and after a sync, and has to be safe to run at any moment,
 * any number of times, on any number of devices. Three things make that true:
 *
 *  1. **Derived identity.** A materialised transaction's id is the rule id and
 *     the occurrence date, so two devices that both run on the same morning
 *     produce the *same* id and last-writer-wins collapses them into one row.
 *     A random id would give the user two rents.
 *
 *  2. **The log, not the table.** Before creating anything it asks whether that
 *     id has *ever* existed. A transaction the user deleted left a tombstone,
 *     and resurrecting it every time the app opened would be maddening.
 *
 *  3. **A bounded run.** A daily rule dated years back would otherwise produce
 *     thousands of rows in one pass and stall the first launch. Each run is
 *     capped and the remainder is caught up next time.
 */
@Injectable({ providedIn: 'root' })
export class MaterialiserService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly ledger = inject(LedgerService);

  /**
   * `limit` is the most occurrences one run will create. It is a parameter so a
   * test can exercise resumption without writing a thousand rows to prove a
   * rule that holds at any size.
   */
  async run(
    asOf = toIsoDate(),
    limit = MAX_OCCURRENCES_PER_RUN,
  ): Promise<MaterialisationResult> {
    const rules = await this.db.recurringRules.filter((rule) => !rule.archived).toArray();

    let created = 0;
    const incomplete: string[] = [];

    for (const rule of rules) {
      // Resume past whatever this rule has already produced. Occurrence ids
      // sort by date, so the highest one is the furthest the rule has reached —
      // and it comes from the log, so a deleted occurrence still counts.
      const furthest = await this.ledger.latestEntityIdWithPrefix(
        'transactions',
        `${rule.id}:`,
      );
      const after = furthest ? (parseOccurrenceId(furthest)?.date ?? null) : null;

      const due = occurrencesUpTo(rule, asOf, limit, after);
      if (due.length === limit) incomplete.push(rule.id);

      for (const date of due) {
        const id = occurrenceId(rule.id, date);
        // A gap can still exist behind the watermark — an occurrence deleted
        // and re-skipped, or one merged from another device — so each is
        // checked rather than assumed new.
        if (await this.ledger.hasHistory('transactions', id)) continue;

        await this.ledger.put('transactions', toTransaction(rule, id, date));
        created++;
      }
    }

    return { created, incomplete };
  }

  /**
   * Mark an occurrence as skipped, and remove it if it was already created.
   *
   * Recorded on the rule rather than as a deleted transaction so that it
   * replicates as an ordinary edit and survives on a device that had not yet
   * materialised the occurrence at all.
   */
  async skip(ruleId: string, date: string): Promise<void> {
    const rule = await this.db.recurringRules.get(ruleId);
    if (!rule || rule.skipped.includes(date)) return;

    await this.ledger.put('recurringRules', {
      ...rule,
      skipped: [...rule.skipped, date].sort(),
    });

    const id = occurrenceId(ruleId, date);
    if (await this.db.transactions.get(id)) {
      await this.ledger.remove('transactions', id);
    }
  }
}

/** Build the transaction an occurrence stands for. */
function toTransaction(rule: RecurringRule, id: string, date: string): Transaction {
  return {
    id,
    kind: rule.kind,
    amount: rule.amount,
    currency: rule.currency,
    accountId: rule.accountId,
    counterAccountId: rule.counterAccountId,
    categoryId: rule.categoryId,
    date,
    // A rule named "Rent" with no payee should read as "Rent" in the ledger,
    // not as "Untitled". The name is what the user called this money.
    payee: rule.payee.trim() || rule.name,
    note: rule.note,
    tags: rule.tags,
    // Not cleared: the rule says the money was due, not that it has moved.
    // The user confirms it against their statement like any other transaction.
    cleared: false,
    createdAt: Date.now(),
    updatedAt: '',
  };
}
