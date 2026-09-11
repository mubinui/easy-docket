import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { RecurringRule } from '../models/domain';
import { nextOccurrence, occurrencesUpTo } from '../recurring/schedule';
import { toIsoDate } from '../util/dates';
import { LedgerService } from './ledger.service';

/** What a caller must supply to create a rule; the rest defaults. */
export type RecurringDraft = Pick<
  RecurringRule,
  'id' | 'name' | 'kind' | 'amount' | 'currency' | 'accountId' | 'interval' | 'unit' | 'startDate'
> &
  Partial<RecurringRule>;

/** A rule together with when it next falls due. */
export interface RuleStatus {
  rule: RecurringRule;
  /** Null once the rule has finished. */
  next: string | null;
}

@Injectable({ providedIn: 'root' })
export class RecurringService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly ledger = inject(LedgerService);

  readonly all = toSignal(
    from(
      liveQuery(async () =>
        (await this.db.recurringRules.toArray()).sort((a, b) => a.name.localeCompare(b.name)),
      ),
    ),
    { initialValue: [] as RecurringRule[] },
  );

  readonly active = computed(() => this.all().filter((rule) => !rule.archived));
  readonly archived = computed(() => this.all().filter((rule) => rule.archived));

  /**
   * Active rules with their next due date, soonest first.
   *
   * Derived rather than stored: a cached `nextDue` would be one more thing for
   * two devices to disagree about, and computing it is integer date arithmetic.
   */
  readonly upcoming = computed<RuleStatus[]>(() => {
    const today = toIsoDate();

    return this.active()
      .map((rule) => ({ rule, next: nextOccurrence(rule, today) }))
      .sort((a, b) => {
        // A finished rule has no next date and sorts last rather than first.
        if (a.next === null) return b.next === null ? 0 : 1;
        if (b.next === null) return -1;
        return a.next.localeCompare(b.next);
      });
  });

  byId(id: string): RecurringRule | undefined {
    return this.all().find((rule) => rule.id === id);
  }

  async get(id: string): Promise<RecurringRule | undefined> {
    return this.db.recurringRules.get(id);
  }

  /** The next few occurrences of a rule, for the editor's preview. */
  preview(rule: RecurringRule, count = 3, from = toIsoDate()): string[] {
    const dates: string[] = [];
    let cursor = from;

    for (let i = 0; i < count; i++) {
      const next = nextOccurrence(rule, cursor);
      if (next === null) break;
      dates.push(next);
      cursor = next;
    }
    return dates;
  }

  /** How many occurrences a rule has already produced, for the list subtitle. */
  countSoFar(rule: RecurringRule): number {
    return occurrencesUpTo(rule, toIsoDate(), 1_000).length;
  }

  async save(draft: RecurringDraft): Promise<RecurringRule> {
    const rule = {
      counterAccountId: null,
      categoryId: null,
      payee: '',
      note: '',
      tags: [],
      endDate: null,
      maxOccurrences: null,
      skipped: [],
      archived: false,
      createdAt: Date.now(),
      updatedAt: '',
      ...draft,
      amount: Math.abs(draft.amount),
    } as RecurringRule;

    assertValid(rule);
    return this.ledger.put('recurringRules', rule);
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    const rule = await this.get(id);
    if (!rule) return;
    await this.ledger.put('recurringRules', { ...rule, archived });
  }

  /**
   * Delete a rule. The transactions it already produced are left alone: they
   * are a record of money that moved, and a standing order ending does not
   * unmake the payments it made.
   */
  async remove(id: string): Promise<void> {
    await this.ledger.remove('recurringRules', id);
  }
}

function assertValid(rule: RecurringRule): void {
  if (!rule.name.trim()) throw new Error('A rule needs a name');
  if (rule.amount <= 0) throw new Error('The amount must be greater than zero');
  if (!rule.accountId) throw new Error('An account is required');
  if (rule.interval < 1) throw new Error('The interval must be at least one');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate)) throw new Error('Start date must be YYYY-MM-DD');

  if (rule.endDate !== null && rule.endDate < rule.startDate) {
    throw new Error('The end date cannot be before the start date');
  }
  if (rule.maxOccurrences !== null && rule.maxOccurrences < 1) {
    throw new Error('The occurrence limit must be at least one');
  }
  if (rule.kind === 'transfer') {
    if (!rule.counterAccountId) throw new Error('A transfer needs a destination account');
    if (rule.counterAccountId === rule.accountId) {
      throw new Error('A transfer needs two different accounts');
    }
  }
}
