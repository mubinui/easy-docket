import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { LedgerService } from '../../core/repositories/ledger.service';
import { anAccountGroup } from '../../core/testing/factories';
import { GroupEditorComponent } from './group-editor.component';

let counter = 0;

describe('GroupEditorComponent', () => {
  let fixture: ComponentFixture<GroupEditorComponent>;
  let component: GroupEditorComponent;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`group-editor-${counter++}`);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [GroupEditorComponent],
      providers: [{ provide: DOCKET_DB, useValue: db }],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(GroupEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('validation', () => {
    it('cannot be saved without a name', () => {
      expect(component.canSave()).toBe(false);

      component.name.set('Cards');
      expect(component.canSave()).toBe(true);
    });

    it('treats whitespace as no name at all', () => {
      component.name.set('   ');
      expect(component.canSave()).toBe(false);
    });
  });

  describe('saving', () => {
    it('writes what was typed, and defaults the type to plain', async () => {
      component.name.set('  Savings  ');
      await component.save();

      const [saved] = await db.accountGroups.toArray();
      expect(saved).toMatchObject({ name: 'Savings', type: 'default', archived: false });
    });

    it('records the chosen type', async () => {
      component.name.set('Cards');
      component.type.set('credit-card');
      await component.save();

      const [saved] = await db.accountGroups.toArray();
      expect(saved.type).toBe('credit-card');
      expect(saved.icon).toBe('card-outline');
    });

    it('explains what the chosen type will do', () => {
      // The note is the only warning a user gets that picking "Credit card"
      // changes how every balance in the group reads.
      component.type.set('default');
      expect(component.typeNote()).toContain('money you hold');

      component.type.set('credit-card');
      expect(component.typeNote()).toContain('owed');
    });

    it('keeps a group in place when edited, rather than sending it to the bottom', async () => {
      // `order` is not an editable field, so an edit must carry the existing one
      // forward — otherwise renaming a group would silently reorder the screen.
      const existing = anAccountGroup({ id: 'g-1', name: 'Cards', order: 3, createdAt: 99 });
      await db.accountGroups.put(existing);

      fixture.componentRef.setInput('existing', existing);
      fixture.detectChanges();

      component.name.set('Plastic');
      await component.save();

      expect(await db.accountGroups.get('g-1')).toMatchObject({
        name: 'Plastic',
        order: 3,
        createdAt: 99,
      });
      expect(await db.accountGroups.count()).toBe(1);
    });

    it('loads an existing group into the form', () => {
      const existing = anAccountGroup({ name: 'Cards', type: 'credit-card', archived: true });
      fixture.componentRef.setInput('existing', existing);
      fixture.detectChanges();

      expect(component.name()).toBe('Cards');
      expect(component.type()).toBe('credit-card');
      expect(component.archived()).toBe(true);
    });

    it('produces an operation, so the group replicates', async () => {
      component.name.set('Cards');
      await component.save();

      const ops = await TestBed.inject(LedgerService).allOperations();
      expect(ops).toMatchObject([{ entity: 'accountGroups', op: 'put' }]);
    });

    it('leaves the group alone and reports a failure rather than half-saving', async () => {
      const groups = TestBed.inject(AccountGroupsService);
      groups.save = () => Promise.reject(new Error('disk full'));

      component.name.set('Cards');
      await component.save();

      expect(component.error()).toBe('disk full');
      expect(await db.accountGroups.count()).toBe(0);
    });
  });
});
