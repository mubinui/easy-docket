import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { Budget } from '../../core/models/domain';
import { BudgetsService } from '../../core/repositories/budgets.service';
import { LedgerService } from '../../core/repositories/ledger.service';
import { aBudget, aCategory } from '../../core/testing/factories';
import { BudgetEditorComponent } from './budget-editor.component';

let counter = 0;

describe('BudgetEditorComponent', () => {
  let fixture: ComponentFixture<BudgetEditorComponent>;
  let component: BudgetEditorComponent;
  let ref: ComponentRef<BudgetEditorComponent>;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`editor-${counter++}`);
    await db.categories.bulkPut([
      aCategory({ id: 'cat-1', name: 'Groceries', kind: 'expense' }),
      aCategory({ id: 'cat-2', name: 'Salary', kind: 'income' }),
    ]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BudgetEditorComponent],
      providers: [{ provide: DOCKET_DB, useValue: db }],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(BudgetEditorComponent);
    component = fixture.componentInstance;
    ref = fixture.componentRef;
    fixture.detectChanges();
  });

  describe('validation', () => {
    it('cannot be saved while empty', () => {
      expect(component.canSave()).toBe(false);
    });

    it('needs a name, an amount and a category', () => {
      component.name.set('Groceries');
      expect(component.canSave()).toBe(false);

      component.amount.set('250.00');
      expect(component.canSave()).toBe(false);

      component.categoryIds.set(['cat-1']);
      expect(component.canSave()).toBe(true);
    });

    it('treats whitespace as no name at all', () => {
      component.name.set('   ');
      component.amount.set('250.00');
      component.categoryIds.set(['cat-1']);
      expect(component.canSave()).toBe(false);
    });

    it('reports a non-positive amount rather than saving it', async () => {
      component.name.set('Groceries');
      component.amount.set('0');
      component.categoryIds.set(['cat-1']);

      await component.save();

      expect(component.error()).toMatch(/greater than zero/);
      expect(await db.budgets.count()).toBe(0);
    });

    it('reports an unparsable amount', async () => {
      component.name.set('Groceries');
      component.amount.set('two hundred');
      component.categoryIds.set(['cat-1']);

      await component.save();

      expect(component.error()).toMatch(/not a valid amount/);
      expect(await db.budgets.count()).toBe(0);
    });
  });

  describe('saving', () => {
    it('writes a budget in minor units', async () => {
      component.name.set('  Groceries  ');
      component.amount.set('250.50');
      component.categoryIds.set(['cat-1']);
      component.period.set('weekly');
      component.startDate.set('2026-03-02');
      component.rollover.set(true);

      await component.save();

      const [saved] = await db.budgets.toArray();
      expect(saved).toMatchObject({
        name: 'Groceries',
        amount: 25_050,
        categoryIds: ['cat-1'],
        period: 'weekly',
        startDate: '2026-03-02',
        rollover: true,
        archived: false,
      });
    });

    it('emits the saved budget', async () => {
      let emitted: Budget | null = null;
      component.saved.subscribe((budget) => (emitted = budget));

      component.name.set('Groceries');
      component.amount.set('100');
      component.categoryIds.set(['cat-1']);
      await component.save();

      expect(emitted).toMatchObject({ name: 'Groceries', amount: 10_000 });
    });
  });

  describe('editing an existing budget', () => {
    it('loads its values into the form', () => {
      ref.setInput(
        'existing',
        aBudget({ name: 'Rent', amount: 120_000, period: 'yearly', rollover: true }),
      );
      fixture.detectChanges();

      expect(component.name()).toBe('Rent');
      expect(component.amount()).toBe('1200.00');
      expect(component.period()).toBe('yearly');
      expect(component.rollover()).toBe(true);
    });

    it('updates in place rather than creating a second budget', async () => {
      ref.setInput('existing', aBudget({ id: 'bud-1', name: 'Rent' }));
      fixture.detectChanges();

      component.name.set('Rent and bills');
      await component.save();

      expect(await db.budgets.count()).toBe(1);
      expect((await db.budgets.get('bud-1'))?.name).toBe('Rent and bills');
    });
  });

  describe('category choices', () => {
    it('offers expense categories only', async () => {
      // The category list arrives through a Dexie liveQuery, so the signal
      // needs a turn of the event loop before it holds anything.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // A budget on an income category would have nothing to count.
      expect(component.categories.expense().map((c) => c.id)).toEqual(['cat-1']);
      expect(component.categories.all()).toHaveLength(2);
    });
  });

  describe('start-date hint', () => {
    it('says plainly what a mid-month start means', () => {
      component.period.set('monthly');
      component.startDate.set('2026-01-15');
      expect(component.anchorHint()).toContain('15th');
      expect(component.anchorHint()).toContain('14th');
    });

    it('recognises a calendar month', () => {
      component.period.set('monthly');
      component.startDate.set('2026-01-01');
      expect(component.anchorHint()).toContain('calendar months');
    });

    it('describes weekly and yearly periods', () => {
      component.period.set('weekly');
      expect(component.anchorHint()).toContain('seven-day');

      component.period.set('yearly');
      expect(component.anchorHint()).toContain('a year');
    });
  });
});
