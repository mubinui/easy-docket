import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { AccountsService } from '../../core/repositories/accounts.service';
import { LedgerService } from '../../core/repositories/ledger.service';
import { waitUntil } from '../../core/testing/async';
import { anAccount, anAccountGroup, aTransaction } from '../../core/testing/factories';
import { PayBillService } from '../../core/cards/pay-bill.service';
import { PayBillComponent } from './pay-bill.component';

let counter = 0;

describe('PayBillComponent', () => {
  let fixture: ComponentFixture<PayBillComponent>;
  let component: PayBillComponent;
  let db: DocketDb;

  const card = anAccount({
    id: 'a-visa',
    name: 'Visa',
    currency: 'USD',
    groupId: 'g-cards',
    openingBalance: 0,
    statementDay: 25,
    dueDay: 15,
  });

  beforeEach(async () => {
    db = new DocketDb(`pay-bill-cmp-${counter++}`);
    await db.accountGroups.bulkPut([
      anAccountGroup({ id: 'g-cards', name: 'Cards', type: 'credit-card' }),
      anAccountGroup({ id: 'g-day', name: 'Everyday', type: 'default' }),
    ]);
    await db.accounts.bulkPut([
      card,
      anAccount({ id: 'a-current', name: 'Current', currency: 'USD', groupId: 'g-day' }),
      anAccount({ id: 'a-savings', name: 'Savings', currency: 'USD', groupId: null }),
      anAccount({ id: 'a-euro', name: 'Euros', currency: 'EUR', groupId: null }),
      anAccount({ id: 'a-amex', name: 'Amex', currency: 'USD', groupId: 'g-cards' }),
    ]);
  });

  async function open(spend: number, since = 0): Promise<void> {
    if (spend) {
      await db.transactions.put(
        aTransaction({ id: 't-spend', kind: 'expense', amount: spend, accountId: 'a-visa', date: '2026-01-02' }),
      );
    }
    if (since) {
      await db.transactions.put(
        aTransaction({
          id: 't-since',
          kind: 'transfer',
          amount: since,
          accountId: 'a-current',
          counterAccountId: 'a-visa',
          date: '2026-01-03',
        }),
      );
    }

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PayBillComponent],
      providers: [{ provide: DOCKET_DB, useValue: db }],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(PayBillComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('card', card);
    fixture.detectChanges();

    // Both the statement (a promise) and the accounts (a liveQuery) have to
    // have arrived before the component says anything meaningful.
    const accounts = TestBed.inject(AccountsService);
    await waitUntil(() => component.summary() !== null && accounts.all().length === 5);
    fixture.detectChanges();
  }

  describe('choosing where the money comes from', () => {
    it('offers ordinary accounts in the card\'s currency', async () => {
      await open(0);
      expect(component.fundingAccounts().map((a) => a.id).sort()).toEqual([
        'a-current',
        'a-savings',
      ]);
    });

    it('never offers another credit card', async () => {
      // Paying a card with a card is not something this app models.
      await open(0);
      expect(component.fundingAccounts().map((a) => a.id)).not.toContain('a-amex');
    });

    it('never offers the card itself', async () => {
      await open(0);
      expect(component.fundingAccounts().map((a) => a.id)).not.toContain('a-visa');
    });

    it('never offers an account in another currency', async () => {
      await open(0);
      expect(component.fundingAccounts().map((a) => a.id)).not.toContain('a-euro');
    });

    it('picks the first one so the common case is one tap', async () => {
      await open(0);
      expect(component.fromId()).toBe('a-current');
    });
  });

  describe('choosing an amount', () => {
    it('starts on the statement balance when there is one', async () => {
      await open(100_00);
      expect(component.choice()).toBe('statement');
      expect(component.amount()).toBe(100_00);
    });

    it('starts on the full balance when no statement is outstanding', async () => {
      // Offering "statement balance" of nothing would be a dead option.
      await open(0);
      expect(component.choice()).toBe('full');
    });

    it('offers the whole current balance', async () => {
      await open(100_00);
      await waitUntil(() => component.currentOwed() === 100_00);

      component.choice.set('full');
      expect(component.amount()).toBe(100_00);
    });

    it('subtracts a payment already made from the statement figure', async () => {
      await open(100_00, 30_00);
      expect(component.summary()?.remaining).toBe(70_00);
      expect(component.amount()).toBe(70_00);
    });

    it('takes a typed amount', async () => {
      await open(100_00);
      component.choice.set('custom');
      component.custom.set('42.50');
      expect(component.amount()).toBe(42_50);
    });

    it('treats nonsense as nothing rather than throwing', async () => {
      await open(100_00);
      component.choice.set('custom');
      component.custom.set('not a number');
      expect(component.amount()).toBe(0);
      expect(component.canPay()).toBe(false);
    });

    it('cannot pay nothing', async () => {
      await open(0);
      expect(component.amount()).toBe(0);
      expect(component.canPay()).toBe(false);
    });
  });

  describe('paying', () => {
    it('records a transfer from the chosen account onto the card', async () => {
      await open(100_00);
      component.date.set('2026-02-01');
      await component.pay();

      const payment = (await db.transactions.toArray()).find((t) => t.kind === 'transfer');
      expect(payment).toMatchObject({
        amount: 100_00,
        accountId: 'a-current',
        counterAccountId: 'a-visa',
        date: '2026-02-01',
      });
    });

    it('settles the bill it was opened for', async () => {
      await open(100_00);
      await component.pay();

      const payments = await db.transactions.filter((t) => t.kind === 'transfer').toArray();
      expect(payments).toHaveLength(1);
      expect(payments[0].amount).toBe(100_00);
    });

    it('reports a refusal rather than half-paying', async () => {
      await open(100_00);
      component.choice.set('custom');
      component.custom.set('10.00');

      // A card that cannot legally be paid from the chosen account: the service
      // refuses, and the screen has to say so rather than appear to succeed.
      const bills = TestBed.inject(PayBillService);
      bills.pay = () => Promise.reject(new Error('nope'));
      await component.pay();

      expect(component.error()).toBe('nope');
      expect(await db.transactions.filter((t) => t.kind === 'transfer').count()).toBe(0);
    });
  });

  describe('saying when it is due', () => {
    it('reads as a date, not as a stored string', async () => {
      await open(100_00);
      // The month's abbreviation is the locale's business ("Sep" or "Sept"),
      // so the assertion is about order and content, not spelling.
      expect(component.when('2026-09-20', 'en-GB')).toMatch(/^20 Sept?$/);
      expect(component.when('2026-09-20', 'en-US')).toMatch(/^Sept? 20$/);
      expect(component.when('2026-09-20')).not.toContain('2026');
    });
  });
});
