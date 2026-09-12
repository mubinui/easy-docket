import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { LedgerService } from '../../core/repositories/ledger.service';
import { waitUntil } from '../../core/testing/async';
import { anAccount, anAccountGroup } from '../../core/testing/factories';
import { AccountEditorComponent } from './account-editor.component';

let counter = 0;

describe('AccountEditorComponent group picker', () => {
  let fixture: ComponentFixture<AccountEditorComponent>;
  let component: AccountEditorComponent;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`account-editor-${counter++}`);
    await db.accountGroups.bulkPut([
      anAccountGroup({ id: 'g-cards', name: 'Cards', type: 'credit-card', order: 0 }),
      anAccountGroup({ id: 'g-old', name: 'Retired', archived: true, order: 1 }),
    ]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AccountEditorComponent],
      providers: [{ provide: DOCKET_DB, useValue: db }],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(AccountEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await waitUntil(() => component.groups.all().length === 2);
    fixture.detectChanges();
  });

  it('offers the active groups and not the archived ones', () => {
    expect(component.groups.active().map((g) => g.name)).toEqual(['Cards']);
  });

  it('starts a new account ungrouped', () => {
    expect(component.groupId()).toBeNull();
  });

  it('files a new account into the chosen group', async () => {
    component.name.set('Visa');
    component.groupId.set('g-cards');
    await component.save();

    const [saved] = await db.accounts.toArray();
    expect(saved).toMatchObject({ name: 'Visa', groupId: 'g-cards' });
  });

  it('saves an ungrouped account with an explicit null rather than an absent field', async () => {
    component.name.set('Everyday');
    await component.save();

    const [saved] = await db.accounts.toArray();
    expect(saved.groupId).toBeNull();
  });

  it('loads an existing account with its group selected', () => {
    fixture.componentRef.setInput('existing', anAccount({ groupId: 'g-cards' }));
    fixture.detectChanges();

    expect(component.groupId()).toBe('g-cards');
  });

  it('shows an account whose group was deleted elsewhere as ungrouped', () => {
    // The picker cannot display a group this device has never seen, and leaving
    // the field blank-but-set would save the dangling id straight back.
    fixture.componentRef.setInput('existing', anAccount({ groupId: 'g-gone' }));
    fixture.detectChanges();

    expect(component.groupId()).toBeNull();
  });

  it('moves an account out of a group', async () => {
    const existing = anAccount({ id: 'a-1', groupId: 'g-cards' });
    await db.accounts.put(existing);
    fixture.componentRef.setInput('existing', existing);
    fixture.detectChanges();

    component.groupId.set(null);
    await component.save();

    expect((await db.accounts.get('a-1'))?.groupId).toBeNull();
  });

  it('leaves the rest of the account untouched when only the group changes', async () => {
    const existing = anAccount({ id: 'a-1', name: 'Visa', openingBalance: 12_345, kind: 'card' });
    await db.accounts.put(existing);
    fixture.componentRef.setInput('existing', existing);
    fixture.detectChanges();

    component.groupId.set('g-cards');
    await component.save();

    expect(await db.accounts.get('a-1')).toMatchObject({
      name: 'Visa',
      kind: 'card',
      openingBalance: 12_345,
      groupId: 'g-cards',
    });
  });
});

describe('AccountEditorComponent card terms', () => {
  let fixture: ComponentFixture<AccountEditorComponent>;
  let component: AccountEditorComponent;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`card-editor-${counter++}`);
    await db.accountGroups.bulkPut([
      anAccountGroup({ id: 'g-cards', name: 'Cards', type: 'credit-card', order: 0 }),
      anAccountGroup({ id: 'g-day', name: 'Everyday', type: 'default', order: 1 }),
      anAccountGroup({ id: 'g-debit', name: 'Debit', type: 'debit-card', order: 2 }),
    ]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AccountEditorComponent],
      providers: [{ provide: DOCKET_DB, useValue: db }],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(AccountEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await waitUntil(() => component.groups.all().length === 3);
    fixture.detectChanges();
  });

  /**
   * Field presence is asked of the DOM, not of `textContent`: an `ion-input`
   * renders its label inside its shadow root, where a text search cannot see it.
   */
  function field(label: string): Element | null {
    return (fixture.nativeElement as HTMLElement).querySelector(`ion-input[label="${label}"]`);
  }

  it('hides the terms until the account is in a credit-card group', () => {
    expect(component.isCreditCard()).toBe(false);
    expect(field('Credit limit')).toBeNull();

    component.groupId.set('g-cards');
    fixture.detectChanges();

    expect(component.isCreditCard()).toBe(true);
    expect(field('Credit limit')).not.toBeNull();
    expect(field('Statement closes on day')).not.toBeNull();
    expect(field('Payment due on day')).not.toBeNull();
  });

  it('does not show them for a debit-card group', () => {
    // A debit card draws on money already held; it has no limit and no bill.
    component.groupId.set('g-debit');
    fixture.detectChanges();

    expect(component.isCreditCard()).toBe(false);
    expect(field('Credit limit')).toBeNull();
  });

  it('follows the picker without a save and reopen', () => {
    component.groupId.set('g-cards');
    fixture.detectChanges();
    expect(field('Credit limit')).not.toBeNull();

    component.groupId.set('g-day');
    fixture.detectChanges();
    expect(field('Credit limit')).toBeNull();
  });

  it('saves the terms that were typed', async () => {
    component.name.set('Visa');
    component.groupId.set('g-cards');
    component.creditLimit.set('5000.00');
    component.statementDay.set(25);
    component.dueDay.set(15);
    await component.save();

    const [saved] = await db.accounts.toArray();
    expect(saved).toMatchObject({ creditLimit: 500_000, statementDay: 25, dueDay: 15 });
  });

  it('leaves the terms unset when the fields are blank', async () => {
    component.name.set('Visa');
    component.groupId.set('g-cards');
    await component.save();

    const [saved] = await db.accounts.toArray();
    expect(saved.creditLimit).toBeUndefined();
    expect(saved.statementDay).toBeUndefined();
    expect(saved.dueDay).toBeUndefined();
  });

  it('ignores a limit of zero or less, which is not a limit', async () => {
    component.name.set('Visa');
    component.groupId.set('g-cards');
    component.creditLimit.set('0');
    await component.save();

    expect((await db.accounts.toArray())[0].creditLimit).toBeUndefined();
  });

  it('ignores a day outside the calendar', async () => {
    component.name.set('Visa');
    component.groupId.set('g-cards');
    component.statementDay.set(0);
    component.dueDay.set(32);
    await component.save();

    const [saved] = await db.accounts.toArray();
    expect(saved.statementDay).toBeUndefined();
    expect(saved.dueDay).toBeUndefined();
  });

  it('clears the terms when an account stops being a card', async () => {
    // A limit left behind on a current account would be read as real by
    // anything that asks what credit is available.
    const existing = anAccount({
      id: 'a-1',
      groupId: 'g-cards',
      creditLimit: 500_000,
      statementDay: 25,
      dueDay: 15,
    });
    await db.accounts.put(existing);
    fixture.componentRef.setInput('existing', existing);
    fixture.detectChanges();

    expect(component.creditLimit()).toBe('5000.00');
    expect(component.statementDay()).toBe(25);

    component.groupId.set('g-day');
    await component.save();

    const saved = await db.accounts.get('a-1');
    expect(saved?.groupId).toBe('g-day');
    expect(saved?.creditLimit).toBeUndefined();
    expect(saved?.statementDay).toBeUndefined();
    expect(saved?.dueDay).toBeUndefined();
  });

  it('loads an existing card\'s terms into the form', () => {
    fixture.componentRef.setInput(
      'existing',
      anAccount({ groupId: 'g-cards', creditLimit: 250_000, statementDay: 1, dueDay: 20 }),
    );
    fixture.detectChanges();

    expect(component.creditLimit()).toBe('2500.00');
    expect(component.statementDay()).toBe(1);
    expect(component.dueDay()).toBe(20);
  });
});
