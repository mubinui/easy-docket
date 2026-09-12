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
