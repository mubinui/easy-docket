import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { LedgerService } from '../repositories/ledger.service';
import { anAccount, aTransaction } from '../testing/factories';
import { PayBillService } from './pay-bill.service';

let counter = 0;

describe('PayBillService', () => {
  let pay: PayBillService;
  let db: DocketDb;

  const card = anAccount({
    id: 'a-visa',
    name: 'Visa',
    currency: 'USD',
    openingBalance: 0,
    statementDay: 25,
    dueDay: 15,
  });
  const current = anAccount({ id: 'a-current', name: 'Current', currency: 'USD' });

  beforeEach(async () => {
    db = new DocketDb(`pay-bill-${counter++}`);
    await db.accounts.bulkPut([card, current]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DOCKET_DB, useValue: db }] });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');
    pay = TestBed.inject(PayBillService);
  });

  describe('summarising', () => {
    it('reads the card from the database', async () => {
      await db.transactions.put(
        aTransaction({ id: 't-1', kind: 'expense', amount: 100_00, accountId: 'a-visa', date: '2026-03-10' }),
      );

      const summary = await pay.summarise(card, '2026-03-30');
      expect(summary?.statementBalance).toBe(100_00);
      expect(summary?.dueOn).toBe('2026-04-15');
    });

    it('includes payments arriving on the card', async () => {
      await db.transactions.bulkPut([
        aTransaction({ id: 't-1', kind: 'expense', amount: 100_00, accountId: 'a-visa', date: '2026-03-10' }),
        aTransaction({
          id: 't-2',
          kind: 'transfer',
          amount: 40_00,
          accountId: 'a-current',
          counterAccountId: 'a-visa',
          date: '2026-03-27',
        }),
      ]);

      const summary = await pay.summarise(card, '2026-03-30');
      expect(summary?.paidSince).toBe(40_00);
      expect(summary?.remaining).toBe(60_00);
    });

    it('is null for a card with no terms', async () => {
      expect(await pay.summarise(anAccount({ id: 'a-plain' }), '2026-03-30')).toBeNull();
    });
  });

  describe('paying', () => {
    it('records an ordinary transfer, not a new kind of thing', async () => {
      const payment = await pay.pay({ card, from: current, amount: 100_00, date: '2026-04-01' });

      expect(payment).toMatchObject({
        kind: 'transfer',
        amount: 100_00,
        accountId: 'a-current',
        counterAccountId: 'a-visa',
        currency: 'USD',
        date: '2026-04-01',
        payee: 'Visa',
      });
      expect(await db.transactions.count()).toBe(1);
    });

    it('moves both balances and leaves net worth alone', async () => {
      await pay.pay({ card, from: current, amount: 100_00, date: '2026-04-01' });

      const summary = await pay.summarise(card, '2026-04-02');
      // The card is 100 better off; the money came from somewhere.
      expect(summary?.currentBalance).toBe(-100_00);

      const [txn] = await db.transactions.toArray();
      expect(txn.accountId).toBe('a-current');
      expect(txn.counterAccountId).toBe('a-visa');
    });

    it('settles the statement it was meant to settle', async () => {
      await db.transactions.put(
        aTransaction({ id: 't-1', kind: 'expense', amount: 100_00, accountId: 'a-visa', date: '2026-03-10' }),
      );

      const before = await pay.summarise(card, '2026-03-30');
      await pay.pay({ card, from: current, amount: before!.remaining, date: '2026-03-30' });

      const after = await pay.summarise(card, '2026-03-30');
      expect(after?.remaining).toBe(0);
    });

    it('refuses a payment of nothing', async () => {
      await expect(pay.pay({ card, from: current, amount: 0 })).rejects.toThrow(
        /more than nothing/,
      );
      expect(await db.transactions.count()).toBe(0);
    });

    it('refuses a negative payment', async () => {
      await expect(pay.pay({ card, from: current, amount: -50_00 })).rejects.toThrow();
      expect(await db.transactions.count()).toBe(0);
    });

    it('refuses to pay a card from itself', async () => {
      await expect(pay.pay({ card, from: card, amount: 50_00 })).rejects.toThrow(
        /its own bill/,
      );
      expect(await db.transactions.count()).toBe(0);
    });

    it('refuses a cross-currency payment, and says which currencies', async () => {
      // A transfer carries one amount; paying a dollar card from a euro account
      // would need a rate this code has no business inventing.
      const euros = anAccount({ id: 'a-eur', name: 'Euro account', currency: 'EUR' });

      await expect(pay.pay({ card, from: euros, amount: 50_00 })).rejects.toThrow(/EUR.*USD/s);
      expect(await db.transactions.count()).toBe(0);
    });

    it('defaults to today when no date is given', async () => {
      const payment = await pay.pay({ card, from: current, amount: 10_00 });
      expect(payment.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('replicates like any other transaction', async () => {
      await pay.pay({ card, from: current, amount: 10_00 });

      const ops = await TestBed.inject(LedgerService).allOperations();
      expect(ops).toMatchObject([{ entity: 'transactions', op: 'put' }]);
    });
  });
});
