import { Injectable, inject } from '@angular/core';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { Account, Minor, Transaction } from '../models/domain';
import { TransactionsService } from '../repositories/transactions.service';
import { toIsoDate } from '../util/dates';
import { StatementSummary, summariseStatement } from './statement';

export interface PayBillRequest {
  card: Account;
  from: Account;
  amount: Minor;
  date?: string;
  note?: string;
}

/**
 * Paying a credit card bill.
 *
 * A payment is an ordinary transfer: money leaves the funding account and
 * arrives on the card. There is deliberately no "payment" kind — a second way
 * to spell a transfer would mean every report, every balance and every adapter
 * had to learn about both, and the ledger already models this exactly.
 */
@Injectable({ providedIn: 'root' })
export class PayBillService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly transactions = inject(TransactionsService);

  /** The card's cycle as it stands, or null if it has no terms. */
  async summarise(card: Account, asOf = toIsoDate()): Promise<StatementSummary | null> {
    const forCard = await this.db.transactions
      .filter((txn) => txn.accountId === card.id || txn.counterAccountId === card.id)
      .toArray();
    return summariseStatement(card, forCard, asOf);
  }

  /**
   * Record a payment.
   *
   * Both accounts must share a currency. A cross-currency payment would need a
   * transfer that carries two amounts, which the ledger does not model — and
   * inventing a rate here would put a number in the register that the bank
   * never used.
   */
  async pay(request: PayBillRequest): Promise<Transaction> {
    const { card, from, amount } = request;

    if (amount <= 0) throw new Error('A payment has to be more than nothing');
    if (from.id === card.id) throw new Error('A card cannot pay its own bill');
    if (from.currency.toUpperCase() !== card.currency.toUpperCase()) {
      throw new Error(
        `${from.name} is in ${from.currency} and ${card.name} is in ${card.currency}. Pay from an account in the same currency.`,
      );
    }

    return this.transactions.save({
      id: crypto.randomUUID(),
      kind: 'transfer',
      amount,
      currency: card.currency,
      accountId: from.id,
      counterAccountId: card.id,
      categoryId: null,
      date: request.date ?? toIsoDate(),
      payee: card.name,
      note: request.note ?? '',
      cleared: true,
    });
  }
}
