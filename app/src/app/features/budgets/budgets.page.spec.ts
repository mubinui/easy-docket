import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { BudgetsService } from '../../core/repositories/budgets.service';
import { LedgerService } from '../../core/repositories/ledger.service';
import { toIsoDate } from '../../core/repositories/transactions.service';
import { aBudget, aCategory, aTransaction } from '../../core/testing/factories';
import { BudgetsPage } from './budgets.page';

let counter = 0;

/** Today, so budgets under test are inside their first period. */
const today = toIsoDate();
const monthStart = `${today.slice(0, 8)}01`;

/** liveQuery is asynchronous; let the signals settle before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

describe('BudgetsPage', () => {
  let fixture: ComponentFixture<BudgetsPage>;
  let page: BudgetsPage;
  let db: DocketDb;

  async function render(): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BudgetsPage],
      providers: [{ provide: DOCKET_DB, useValue: db }, provideRouter([])],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(BudgetsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    db = new DocketDb(`budgets-page-${counter++}`);
    await db.categories.put(aCategory({ id: 'cat-1', kind: 'expense' }));
  });

  it('invites the user to create one when there are none', async () => {
    await render();

    expect(page.statuses()).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('No budgets yet');
  });

  it('lists a budget with its progress', async () => {
    await db.budgets.put(aBudget({ name: 'Groceries', amount: 50_000, startDate: monthStart }));
    await db.transactions.put(aTransaction({ date: today, amount: 12_500, categoryId: 'cat-1' }));
    await render();

    expect(page.statuses()).toHaveLength(1);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Groceries');
    expect(text).toContain('left');
  });

  it('puts the budget nearest its limit first', async () => {
    await db.budgets.bulkPut([
      aBudget({ id: 'bud-a', name: 'Roomy', amount: 100_000, startDate: monthStart }),
      aBudget({ id: 'bud-b', name: 'Tight', amount: 10_000, startDate: monthStart }),
    ]);
    await db.transactions.put(aTransaction({ date: today, amount: 9_000, categoryId: 'cat-1' }));
    await render();

    expect(page.statuses().map((s) => s.budget.id)).toEqual(['bud-b', 'bud-a']);
  });

  it('marks an overspent budget in the danger colour', async () => {
    await db.budgets.put(aBudget({ amount: 10_000, startDate: monthStart }));
    await db.transactions.put(aTransaction({ date: today, amount: 15_000, categoryId: 'cat-1' }));
    await render();

    const [status] = page.statuses();
    expect(status.progress?.over).toBe(true);
    expect(page.barColour(true)).toContain('danger');
    expect(fixture.nativeElement.textContent).toContain('over by');
  });

  it('separates archived budgets from active ones', async () => {
    await db.budgets.bulkPut([
      aBudget({ id: 'bud-a', name: 'Active', startDate: monthStart }),
      aBudget({ id: 'bud-b', name: 'Retired', startDate: monthStart, archived: true }),
    ]);
    await render();

    expect(page.statuses().map((s) => s.budget.name)).toEqual(['Active']);
    expect(page.archived().map((b) => b.name)).toEqual(['Retired']);
  });

  describe('deleted categories', () => {
    it('warns when a budget references one', async () => {
      await db.budgets.put(
        aBudget({ categoryIds: ['cat-1', 'cat-gone'], startDate: monthStart }),
      );
      await render();

      expect(page.statuses()[0].staleCategoryIds).toEqual(['cat-gone']);
      expect(fixture.nativeElement.textContent).toContain('missing spending');
    });

    it('repairs the budget without opening the editor', async () => {
      await db.budgets.put(
        aBudget({ categoryIds: ['cat-1', 'cat-gone'], startDate: monthStart }),
      );
      await render();

      const event = new MouseEvent('click');
      await page.fix(page.statuses()[0], event);
      await settle();

      expect((await db.budgets.get('bud-1'))?.categoryIds).toEqual(['cat-1']);
      // The warning sits inside a tappable row; repairing must not also
      // open the editor behind it.
      expect(page.editorOpen()).toBe(false);
    });

    it('explains rather than emptying a budget with nothing left to track', async () => {
      await db.budgets.put(aBudget({ categoryIds: ['cat-gone'], startDate: monthStart }));
      await render();

      await page.fix(page.statuses()[0], new MouseEvent('click'));
      await settle();

      // Left untouched: the user decides whether to edit or delete it.
      expect((await db.budgets.get('bud-1'))?.categoryIds).toEqual(['cat-gone']);
    });
  });

  describe('the editor', () => {
    it('opens empty for a new budget', async () => {
      await render();
      page.create();

      expect(page.editorOpen()).toBe(true);
      expect(page.editing()).toBeNull();
    });

    it('opens with the chosen budget loaded', async () => {
      await db.budgets.put(aBudget({ startDate: monthStart }));
      await render();
      page.edit(page.statuses()[0].budget);

      expect(page.editing()?.id).toBe('bud-1');
    });

    it('archives from the editor', async () => {
      await db.budgets.put(aBudget({ startDate: monthStart }));
      await render();

      await page.toggleArchive(page.statuses()[0].budget);
      await settle();

      expect((await db.budgets.get('bud-1'))?.archived).toBe(true);
      expect(page.editorOpen()).toBe(false);
    });
  });
});
