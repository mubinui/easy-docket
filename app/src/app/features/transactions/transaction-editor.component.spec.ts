import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { AccountsService } from '../../core/repositories/accounts.service';
import { LedgerService } from '../../core/repositories/ledger.service';
import { RatesService } from '../../core/repositories/rates.service';
import { waitUntil } from '../../core/testing/async';
import { aCategory, anAccount, anExchangeRate } from '../../core/testing/factories';
import { toIsoDate } from '../../core/util/dates';
import { TransactionEditorComponent } from './transaction-editor.component';

let counter = 0;
const TODAY = toIsoDate();

describe('TransactionEditorComponent currency handling', () => {
  let fixture: ComponentFixture<TransactionEditorComponent>;
  let component: TransactionEditorComponent;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`txn-editor-${counter++}`);
    await db.accounts.bulkPut([
      anAccount({ id: 'acc-usd', name: 'Everyday', currency: 'USD' }),
      anAccount({ id: 'acc-eur', name: 'Euro account', currency: 'EUR' }),
    ]);
    await db.categories.put(aCategory({ id: 'cat-1', kind: 'expense' }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TransactionEditorComponent],
      providers: [{ provide: DOCKET_DB, useValue: db }],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(TransactionEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    await waitUntil(() => TestBed.inject(RatesService).reportingCurrency() === 'USD');
  });

  it('asks for no rate when the account is in the reporting currency', async () => {
    await waitUntil(() => component.accounts.active().length === 2);
    component.setAccount('acc-usd');

    expect(component.currency()).toBe('USD');
    expect(component.needsRate()).toBe(false);
  });

  it('asks for a rate when the account is in another currency', async () => {
    await waitUntil(() => component.accounts.active().length === 2);
    component.setAccount('acc-eur');

    expect(component.currency()).toBe('EUR');
    expect(component.needsRate()).toBe(true);
  });

  it('prefills the last known rate for that currency', async () => {
    await db.rates.put(anExchangeRate({ id: `EUR:USD:${TODAY}`, date: TODAY, rate: 1.25 }));
    const rates = TestBed.inject(RatesService);
    await waitUntil(() => rates.all().length === 1);
    await waitUntil(() => component.accounts.active().length === 2);

    component.setAccount('acc-eur');

    expect(component.rate()).toBe('1.25');
  });

  it('shows what the rate makes the amount worth', async () => {
    await waitUntil(() => component.accounts.active().length === 2);
    component.setAccount('acc-eur');
    component.amount.set('40.00');
    component.rate.set('1.25');

    expect(component.converted()).toBe('$50.00');
  });

  it('suggests a rate on open when the default account is itself foreign', async () => {
    // Accounts are listed by name, so a foreign account can be the default one
    // — in which case the field would otherwise sit empty beside a rate that
    // was already known.
    await db.accounts.clear();
    await db.accounts.put(anAccount({ id: 'acc-eur', name: 'Euro account', currency: 'EUR' }));
    await db.rates.put(anExchangeRate({ id: `EUR:USD:${TODAY}`, date: TODAY, rate: 1.25 }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TransactionEditorComponent],
      providers: [{ provide: DOCKET_DB, useValue: db }],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    const opened = TestBed.createComponent(TransactionEditorComponent);
    opened.detectChanges();

    await waitUntil(() => opened.componentInstance.rate() === '1.25');
    expect(opened.componentInstance.needsRate()).toBe(true);
  });

  it('leaves the rate alone when one is already entered', async () => {
    await db.rates.put(anExchangeRate({ id: `EUR:USD:${TODAY}`, date: TODAY, rate: 1.25 }));
    await waitUntil(() => TestBed.inject(RatesService).all().length === 1);
    await waitUntil(() => component.accounts.active().length === 2);

    component.rate.set('1.10');
    component.setAccount('acc-eur');

    expect(component.rate()).toBe('1.10');
  });

  it('stores the rate on the transaction it was entered for', async () => {
    await waitUntil(() => component.accounts.active().length === 2);
    component.setAccount('acc-eur');
    component.amount.set('45.00');
    component.rate.set('1.1');
    component.payee.set('Paris café');

    await component.save();

    const [txn] = await db.transactions.toArray();
    expect(txn.currency).toBe('EUR');
    expect(txn.amount).toBe(4_500);
    expect(txn.rate).toBe(1.1);
    expect(txn.rateDate).toBe(TODAY);
  });

  it('stores no rate for a transaction already in the reporting currency', async () => {
    // Carrying one would invite a future reader to apply it.
    await waitUntil(() => component.accounts.active().length === 2);
    component.setAccount('acc-usd');
    component.amount.set('10.00');
    component.rate.set('99');

    await component.save();

    const [txn] = await db.transactions.toArray();
    expect(txn.rate).toBeUndefined();
    expect(txn.rateDate).toBeUndefined();
  });

  describe('while the sheet is open', () => {
    /**
     * The account list is a live query. Anything that writes an account — a
     * sync pulling one down, another tab, the starter seed finishing — makes it
     * emit again. None of that may disturb a half-written transaction.
     */
    it('keeps what has been typed when the accounts change underneath', async () => {
      const fixture = TestBed.createComponent(TransactionEditorComponent);
      const editor = fixture.componentInstance;
      fixture.detectChanges();
      await waitUntil(() => editor.accountId() !== null);

      editor.amount.set('45.00');
      editor.payee.set('Corner Shop');
      editor.note.set('half written');
      editor.date.set('2026-03-10');

      await TestBed.inject(LedgerService).put('accounts', anAccount({ id: 'acc-new', name: 'Aardvark' }));
      await waitUntil(() => TestBed.inject(AccountsService).all().length >= 2);
      fixture.detectChanges();

      expect(editor.amount()).toBe('45.00');
      expect(editor.payee()).toBe('Corner Shop');
      expect(editor.note()).toBe('half written');
      expect(editor.date()).toBe('2026-03-10');
    });

    it('keeps the account the user chose, even if a new one would sort first', async () => {
      const fixture = TestBed.createComponent(TransactionEditorComponent);
      const editor = fixture.componentInstance;
      fixture.detectChanges();
      await waitUntil(() => editor.accountId() !== null);

      const chosen = editor.accountId();
      // "Aardvark" sorts before anything already there, so a re-default would
      // move the transaction to an account the user never picked.
      await TestBed.inject(LedgerService).put('accounts', anAccount({ id: 'acc-new', name: 'Aardvark' }));
      await waitUntil(() => TestBed.inject(AccountsService).all().length >= 2);
      fixture.detectChanges();

      expect(editor.accountId()).toBe(chosen);
    });
  });
});
