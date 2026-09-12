import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { Account, Transaction } from '../models/domain';
import { AccountGroupsService } from '../repositories/account-groups.service';
import { toIsoDate } from '../util/dates';
import { StatementSummary, isDueSoon, summariseStatement } from './statement';

/**
 * How far ahead a bill counts as "due soon".
 *
 * Two weeks: long enough to act on a bill before it is late, short enough that
 * the summary is not permanently carrying a reminder about something a month
 * away, which people learn to ignore.
 */
export const DUE_SOON_DAYS = 14;

export interface CardBill {
  card: Account;
  summary: StatementSummary;
}

/**
 * Credit card bills across the vault.
 *
 * Reads the whole transaction table, like the other aggregates here — see the
 * gaps table. A card's statement genuinely needs history, since what is owed is
 * the accumulation of everything that has ever happened on it.
 */
@Injectable({ providedIn: 'root' })
export class CardBillsService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly groups = inject(AccountGroupsService);

  private readonly ledger = toSignal(
    from(
      liveQuery(async () => {
        const [accounts, transactions] = await Promise.all([
          this.db.accounts.toArray(),
          this.db.transactions.toArray(),
        ]);
        return { accounts, transactions };
      }),
    ),
    { initialValue: { accounts: [] as Account[], transactions: [] as Transaction[] } },
  );

  /** Every credit card that has terms, with its cycle worked out. */
  readonly bills = computed<CardBill[]>(() => {
    const { accounts, transactions } = this.ledger();
    const today = toIsoDate();

    return accounts
      .filter((account) => !account.archived && this.groups.isCreditCard(account))
      .map((card) => ({ card, summary: summariseStatement(card, transactions, today) }))
      .filter((bill): bill is CardBill => bill.summary !== null)
      .sort((a, b) => a.summary.dueOn.localeCompare(b.summary.dueOn));
  });

  /** The bills worth putting in front of someone today. */
  readonly dueSoon = computed(() =>
    this.bills().filter((bill) => isDueSoon(bill.summary, DUE_SOON_DAYS)),
  );
}
