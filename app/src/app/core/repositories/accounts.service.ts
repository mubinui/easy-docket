import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { inReporting, sameCurrency } from '../money/conversion';
import { Account } from '../models/domain';
import { signedFor } from '../util/money';
import { LedgerService } from './ledger.service';
import { RatesService } from './rates.service';

/**
 * Read and write access to accounts.
 *
 * Reads come from Dexie's `liveQuery`, which re-runs whenever the underlying
 * tables change — including changes written by a sync in another tab. Bridging
 * that to a signal means a screen showing balances updates itself after a pull
 * without any manual refresh plumbing.
 */
/** A balance converted at the latest known rate, with the usual rounding. */
function convertBalance(amount: number, rate: number, from: string, to: string): number {
  return inReporting({ amount, currency: from, rate }, to) ?? 0;
}

/** The fields a caller must supply; the rest default. */
export type AccountDraft = Pick<
  Account,
  'id' | 'name' | 'kind' | 'currency' | 'openingBalance'
> &
  Partial<Account>;

@Injectable({ providedIn: 'root' })
export class AccountsService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly ledger = inject(LedgerService);
  private readonly rates = inject(RatesService);

  readonly all = toSignal(from(liveQuery(() => this.db.accounts.orderBy('name').toArray())), {
    initialValue: [] as Account[],
  });

  readonly active = computed(() => this.all().filter((account) => !account.archived));

  /**
   * Current balance per account id.
   *
   * Recomputed from the whole transaction table rather than kept as a running
   * total on the account: a running total would be a second source of truth
   * that sync could desynchronise from the transactions that justify it.
   */
  readonly balances = toSignal(
    from(
      liveQuery(async () => {
        const [accounts, transactions] = await Promise.all([
          this.db.accounts.toArray(),
          this.db.transactions.toArray(),
        ]);

        const totals = new Map<string, number>(
          accounts.map((account) => [account.id, account.openingBalance]),
        );
        for (const txn of transactions) {
          for (const id of [txn.accountId, txn.counterAccountId]) {
            if (!id || !totals.has(id)) continue;
            totals.set(id, (totals.get(id) ?? 0) + signedFor(id, txn));
          }
        }
        return totals;
      }),
    ),
    { initialValue: new Map<string, number>() },
  );

  /**
   * Total across non-archived accounts, in the reporting currency.
   *
   * A balance is a standing figure rather than a dated event, so it converts at
   * the latest rate known. An account whose currency has no rate is left out
   * and counted in `unconverted` — adding €450 to a dollar total as if it were
   * $450 would be a plainly wrong number presented confidently.
   */
  readonly netWorth = computed(() => this.netWorthDetail().total);

  readonly netWorthDetail = computed(() => {
    const balances = this.balances();
    const reporting = this.rates.reportingCurrency();

    let total = 0;
    const unconverted: string[] = [];

    for (const account of this.active()) {
      const balance = balances.get(account.id) ?? 0;

      if (sameCurrency(account.currency, reporting)) {
        total += balance;
        continue;
      }

      const rate = this.rates.rateToReporting(account.currency);
      if (rate === null) {
        unconverted.push(account.currency);
        continue;
      }
      total += convertBalance(balance, rate, account.currency, reporting);
    }

    return { total, unconverted: [...new Set(unconverted)], currency: reporting };
  });

  byId(id: string): Account | undefined {
    return this.all().find((account) => account.id === id);
  }

  async get(id: string): Promise<Account | undefined> {
    return this.db.accounts.get(id);
  }

  async save(draft: AccountDraft): Promise<Account> {
    return this.ledger.put('accounts', {
      createdAt: Date.now(),
      updatedAt: '',
      ...draft,
    } as Account);
  }

  /**
   * Archiving is offered in the UI in preference to deletion: an account with
   * history cannot be removed without orphaning the transactions that reference it.
   */
  async setArchived(id: string, archived: boolean): Promise<void> {
    const account = await this.get(id);
    if (!account) return;
    await this.ledger.put('accounts', { ...account, archived });
  }

  /** Transactions that would be orphaned by deleting this account. */
  async transactionCount(id: string): Promise<number> {
    const [asSource, asDestination] = await Promise.all([
      this.db.transactions.where('accountId').equals(id).count(),
      this.db.transactions.filter((t) => t.counterAccountId === id).count(),
    ]);
    return asSource + asDestination;
  }

  async remove(id: string): Promise<void> {
    await this.ledger.remove('accounts', id);
  }
}
