import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { MemorySecureStore, SecureStore } from '../../core/keys/secure-store';
import { DocketDb } from '../../core/db/docket-db';
import { LedgerService } from '../../core/repositories/ledger.service';
import { toIsoDate } from '../../core/util/dates';
import {
  aBudget,
  aCategory,
  anAccount,
  anAccountGroup,
  aTransaction,
} from '../../core/testing/factories';
import { waitUntil } from '../../core/testing/async';
import { DashboardPage } from './dashboard.page';

let counter = 0;

const today = toIsoDate();
const monthStart = `${today.slice(0, 8)}01`;
/** Wait for a condition rather than a fixed span; see `core/testing/async.ts`. */
const settle = waitUntil;

/**
 * The Summary screen's budget card. The arithmetic behind it is tested in the
 * budgets suites; what matters here is which budgets it chooses to show and how
 * it describes them, because that is the only budget information many people
 * will look at day to day.
 */
describe('DashboardPage budget card', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let page: DashboardPage;
  let db: DocketDb;

  /** `expected` is how many budgets were seeded, so the wait watches something real. */
  async function render(expected = 0): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        { provide: DOCKET_DB, useValue: db },
        // The sync status indicator in the toolbar reaches VaultService, whose
        // SecureStore is supplied at bootstrap rather than from the root
        // injector — see main.ts.
        { provide: SecureStore, useClass: MemorySecureStore },
        provideRouter([]),
      ],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(DashboardPage);
    page = fixture.componentInstance;
    fixture.detectChanges();

    await settle(() => page.budgets.all().length >= expected);
    fixture.detectChanges();
  }

  /**
   * Text of the budget card alone. The Summary screen has several cards, and an
   * assertion against the whole page picks up net worth and recent activity —
   * which is how the first version of the over-budget test below fooled itself.
   */
  function budgetCardText(): string {
    const card = [...fixture.nativeElement.querySelectorAll('ion-card')].find((element) =>
      (element as HTMLElement).querySelector('ion-card-title')?.textContent?.includes('Budgets'),
    ) as HTMLElement | undefined;

    if (!card) throw new Error('no Budgets card on the summary screen');
    return card.textContent ?? '';
  }

  function budget(id: string, name: string, amount: number) {
    return aBudget({ id, name, amount, startDate: monthStart, categoryIds: ['cat-1'] });
  }

  beforeEach(async () => {
    db = new DocketDb(`dashboard-${counter++}`);
    await db.accounts.put(anAccount());
    await db.categories.put(aCategory({ id: 'cat-1', kind: 'expense' }));
  });

  it('points at budget creation when there are none', async () => {
    await render();

    expect(page.headline()).toHaveLength(0);
    expect(budgetCardText()).toContain('Set a spending limit');
  });

  it('shows a budget with what is left', async () => {
    await db.budgets.put(budget('bud-1', 'Groceries', 50_000));
    await db.transactions.put(aTransaction({ date: today, amount: 12_500, categoryId: 'cat-1' }));
    await render(1);

    const text = budgetCardText();
    expect(text).toContain('Groceries');
    expect(text).toContain('left');
    expect(page.headline()[0].progress?.remaining).toBe(37_500);
  });

  it('calls out an overspent budget rather than burying it', async () => {
    await db.budgets.put(budget('bud-1', 'Eating out', 10_000));
    await db.transactions.put(aTransaction({ date: today, amount: 12_210, categoryId: 'cat-1' }));
    await render(1);

    const text = budgetCardText();
    expect(text).toContain('OVER');
    expect(text).toContain('over by $22.10');
    // Shown as a positive figure: "over by -$22.10" would read as nonsense.
    expect(text).not.toContain('-$');
  });

  it('shows the budgets closest to their limits first', async () => {
    await db.budgets.bulkPut([
      budget('bud-roomy', 'Roomy', 100_000),
      budget('bud-tight', 'Tight', 10_000),
    ]);
    await db.transactions.put(aTransaction({ date: today, amount: 9_000, categoryId: 'cat-1' }));
    await render(2);

    expect(page.headline().map((s) => s.budget.name)).toEqual(['Tight', 'Roomy']);
  });

  it('shows at most three, so the card does not swamp the summary', async () => {
    await db.budgets.bulkPut(
      Array.from({ length: 5 }, (_, i) => budget(`bud-${i}`, `Budget ${i}`, 10_000 * (i + 1))),
    );
    await render(5);

    expect(page.budgetCount()).toBe(5);
    expect(page.headline()).toHaveLength(3);
    expect(page.viewAllLabel()).toBe('View all 5 budgets');
  });

  it('summarises the state instead of saying "view all" when everything fits', async () => {
    await db.budgets.put(budget('bud-1', 'Groceries', 50_000));
    await render(1);

    expect(page.viewAllLabel()).toBe('All budgets within their limits');
  });

  it('says how many are over when everything fits but some are breached', async () => {
    await db.budgets.put(budget('bud-1', 'Groceries', 10_000));
    await db.transactions.put(aTransaction({ date: today, amount: 15_000, categoryId: 'cat-1' }));
    await render(1);

    expect(page.viewAllLabel()).toBe('1 budget over its limit');
  });

  it('pluralises correctly', async () => {
    await db.budgets.bulkPut([budget('bud-a', 'A', 1_000), budget('bud-b', 'B', 1_000)]);
    await db.transactions.put(aTransaction({ date: today, amount: 5_000, categoryId: 'cat-1' }));
    await render(2);

    expect(page.overspentCount()).toBe(2);
    expect(page.viewAllLabel()).toBe('2 budgets over their limit');
  });

  it('ignores budgets that have not started yet', async () => {
    // A budget starting next year has no current period, so there is nothing
    // honest to show for it on a card about right now.
    await db.budgets.put(aBudget({ id: 'bud-future', startDate: '2099-01-01' }));
    await render(1);

    expect(page.headline()).toHaveLength(0);
    expect(budgetCardText()).toContain('Set a spending limit');
  });
});

/**
 * The bills-due card.
 *
 * Scoped to that card alone, for the same reason as the budget card above: the
 * Summary screen has several, and a page-wide assertion proves very little.
 */
describe('DashboardPage bills due', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let page: DashboardPage;
  let db: DocketDb;

  /** A due day a few days out, so the bill lands inside the two-week window. */
  function inDays(days: number): number {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.getDate();
  }

  beforeEach(async () => {
    db = new DocketDb(`bills-${counter++}`);
    await db.accountGroups.bulkPut([
      anAccountGroup({ id: 'g-cards', name: 'Cards', type: 'credit-card' }),
      anAccountGroup({ id: 'g-day', name: 'Everyday', type: 'default' }),
    ]);
  });

  async function render(cards = 0): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [
        { provide: DOCKET_DB, useValue: db },
        { provide: SecureStore, useClass: MemorySecureStore },
        provideRouter([]),
      ],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(DashboardPage);
    page = fixture.componentInstance;
    fixture.detectChanges();

    await settle(() => page.accounts.all().length >= cards);
    fixture.detectChanges();
  }

  function billsCard(): HTMLElement | null {
    const cards = [...(fixture.nativeElement as HTMLElement).querySelectorAll('ion-card')];
    return (cards.find((card) => card.textContent?.includes('Bills due')) as HTMLElement) ?? null;
  }

  it('says nothing at all when there are no cards', async () => {
    await db.accounts.put(anAccount({ id: 'a-1', groupId: 'g-day' }));
    await render(1);

    expect(page.cards.dueSoon()).toEqual([]);
    expect(billsCard()).toBeNull();
  });

  it('says nothing when a card has no terms', async () => {
    await db.accounts.put(
      anAccount({ id: 'a-visa', groupId: 'g-cards', openingBalance: -100_00 }),
    );
    await render(1);

    expect(page.cards.bills()).toEqual([]);
    expect(billsCard()).toBeNull();
  });

  it('says nothing when a card owes nothing', async () => {
    await db.accounts.put(
      anAccount({
        id: 'a-visa',
        groupId: 'g-cards',
        openingBalance: 0,
        statementDay: inDays(-20),
        dueDay: inDays(3),
      }),
    );
    await render(1);

    expect(page.cards.dueSoon()).toEqual([]);
    expect(billsCard()).toBeNull();
  });

  it('shows a bill that is due soon, with what is left to pay', async () => {
    await db.accounts.put(
      anAccount({
        id: 'a-visa',
        name: 'Visa',
        groupId: 'g-cards',
        openingBalance: -1_240_00,
        statementDay: inDays(-20),
        dueDay: inDays(3),
      }),
    );
    await render(1);
    await settle(() => page.cards.dueSoon().length === 1);
    fixture.detectChanges();

    const card = billsCard();
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('Visa');
    expect(card!.textContent).toContain('$1,240.00');
  });

  it('leaves out an archived card', async () => {
    await db.accounts.put(
      anAccount({
        id: 'a-visa',
        groupId: 'g-cards',
        archived: true,
        openingBalance: -100_00,
        statementDay: inDays(-20),
        dueDay: inDays(3),
      }),
    );
    await render(1);

    expect(page.cards.dueSoon()).toEqual([]);
  });

  describe('describing when', () => {
    it('counts the days rather than printing a date', async () => {
      await render();
      const future = new Date();
      future.setDate(future.getDate() + 9);
      const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;

      expect(page.dueIn(iso)).toBe('due in 9 days');
    });

    it('says today and tomorrow in words', async () => {
      await render();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const iso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

      expect(page.dueIn(toIsoDate())).toBe('due today');
      expect(page.dueIn(iso)).toBe('due tomorrow');
    });
  });
});
