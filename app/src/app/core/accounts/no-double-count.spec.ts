import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { totalsFor } from '../reports/aggregate';
import { countsTowards } from '../budgets/spend';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { AccountsService } from '../repositories/accounts.service';
import { LedgerService } from '../repositories/ledger.service';
import { PayBillService } from '../cards/pay-bill.service';
import { waitUntil } from '../testing/async';
import { aBudget, aCategory, anAccount, anAccountGroup } from '../testing/factories';
import { Transaction } from '../models/domain';

let counter = 0;

/**
 * Paying a credit card must not look like spending twice.
 *
 * Buying something on a card is the expense. Paying the card afterwards moves
 * money between two accounts the user already owns — it is not a second
 * purchase, and nothing that adds up spending may count it. This suite states
 * that end to end, over the real services, because it is the kind of guarantee
 * that is easy to break from a long way away.
 */
describe('a card payment is not a second expense', () => {
  let db: DocketDb;
  let accounts: AccountsService;
  let bills: PayBillService;

  const CARD = anAccount({
    id: 'a-visa',
    name: 'Visa',
    currency: 'USD',
    groupId: 'g-cards',
    openingBalance: 0,
    statementDay: 25,
    dueDay: 15,
  });
  const CURRENT = anAccount({
    id: 'a-current',
    name: 'Current',
    currency: 'USD',
    openingBalance: 1_000_00,
  });

  beforeEach(async () => {
    db = new DocketDb(`double-${counter++}`);
    await db.accountGroups.put(anAccountGroup({ id: 'g-cards', type: 'credit-card' }));
    await db.accounts.bulkPut([CARD, CURRENT]);
    await db.categories.put(aCategory({ id: 'cat-shopping', name: 'Shopping', kind: 'expense' }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DOCKET_DB, useValue: db }] });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');
    accounts = TestBed.inject(AccountsService);
    bills = TestBed.inject(PayBillService);
  });

  /** Spend 200 on the card, then pay the card off in full from the current account. */
  async function spendThenPay(): Promise<Transaction[]> {
    const ledger = TestBed.inject(LedgerService);
    await ledger.put('transactions', {
      id: 't-shop',
      kind: 'expense',
      amount: 200_00,
      currency: 'USD',
      accountId: 'a-visa',
      counterAccountId: null,
      categoryId: 'cat-shopping',
      date: '2026-03-10',
      payee: 'Shop',
      note: '',
      tags: [],
      cleared: true,
      createdAt: 1,
      updatedAt: '',
    });

    await bills.pay({ card: CARD, from: CURRENT, amount: 200_00, date: '2026-03-12' });
    return db.transactions.toArray();
  }

  it('records exactly two transactions: one expense and one transfer', async () => {
    const all = await spendThenPay();

    expect(all).toHaveLength(2);
    expect(all.filter((t) => t.kind === 'expense')).toHaveLength(1);
    expect(all.filter((t) => t.kind === 'transfer')).toHaveLength(1);
  });

  it('counts the spending once in the period totals', async () => {
    const all = await spendThenPay();
    const totals = totalsFor(all, { from: '2026-03-01', to: '2026-03-31' }, 'USD');

    // 200 spent, not 400. The payment is not spending.
    expect(totals.expense).toBe(200_00);
    expect(totals.income).toBe(0);
  });

  it('counts the spending once against a budget', async () => {
    const all = await spendThenPay();
    const budget = aBudget({ id: 'b-1', categoryIds: ['cat-shopping'], amount: 500_00 });

    const counted = all.filter((txn) => countsTowards(budget, txn));
    expect(counted).toHaveLength(1);
    expect(counted[0].id).toBe('t-shop');
  });

  it('leaves net worth down by the purchase and not by the payment', async () => {
    await spendThenPay();
    await waitUntil(() => accounts.balances().size === 2);
    await waitUntil(() => accounts.netWorth() !== 0);

    // Started with 1,000 and a clear card; spent 200. Paying the card moved
    // money between two accounts, so it changes nothing here.
    expect(accounts.netWorth()).toBe(800_00);
  });

  it('moves both balances by the payment, in opposite directions', async () => {
    await spendThenPay();
    await waitUntil(() => accounts.balances().size === 2);

    const balances = accounts.balances();
    // The card is clear again; the money came out of the current account.
    expect(balances.get('a-visa')).toBe(0);
    expect(balances.get('a-current')).toBe(800_00);
  });

  it('settles the card statement rather than adding to it', async () => {
    await spendThenPay();

    // Both the purchase and the payment fall before the 25th, so they are on
    // the same statement and it closes at nothing owed — which is the point:
    // the payment cancelled the purchase instead of compounding it.
    const summary = await bills.summarise(CARD, '2026-03-30');
    expect(summary?.closedOn).toBe('2026-03-25');
    expect(summary?.statementBalance).toBe(0);
    expect(summary?.remaining).toBe(0);
    expect(summary?.currentBalance).toBe(0);
  });

  it('credits a payment made after the statement closed', async () => {
    // The other arrangement: the purchase is billed, then paid next month. The
    // statement still shows 200 — that is what was owed on the day — and the
    // payment is credited against it rather than counted as spending.
    const ledger = TestBed.inject(LedgerService);
    await ledger.put('transactions', {
      id: 't-shop',
      kind: 'expense',
      amount: 200_00,
      currency: 'USD',
      accountId: 'a-visa',
      counterAccountId: null,
      categoryId: 'cat-shopping',
      date: '2026-03-10',
      payee: 'Shop',
      note: '',
      tags: [],
      cleared: true,
      createdAt: 1,
      updatedAt: '',
    });
    await bills.pay({ card: CARD, from: CURRENT, amount: 200_00, date: '2026-03-28' });

    const summary = await bills.summarise(CARD, '2026-03-30');
    expect(summary?.statementBalance).toBe(200_00);
    expect(summary?.paidSince).toBe(200_00);
    expect(summary?.remaining).toBe(0);
    expect(summary?.currentBalance).toBe(0);

    const all = await db.transactions.toArray();
    expect(totalsFor(all, { from: '2026-03-01', to: '2026-03-31' }, 'USD').expense).toBe(200_00);
  });

  it('holds even when the payment is the only thing in the period', async () => {
    // A month containing a payment and no purchases is a month with no
    // spending, not a month that spent the payment.
    await spendThenPay();
    const all = await db.transactions.toArray();

    const april = totalsFor(all, { from: '2026-03-11', to: '2026-03-31' }, 'USD');
    expect(april.expense).toBe(0);
    expect(april.income).toBe(0);
  });
});
