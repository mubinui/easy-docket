import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { MemorySecureStore, SecureStore } from '../../core/keys/secure-store';
import { LedgerService } from '../../core/repositories/ledger.service';
import { waitUntil } from '../../core/testing/async';
import { anAccount, anAccountGroup, anExchangeRate } from '../../core/testing/factories';
import { AccountsPage } from './accounts.page';

let counter = 0;

describe('AccountsPage grouping', () => {
  let fixture: ComponentFixture<AccountsPage>;
  let page: AccountsPage;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`accounts-page-${counter++}`);
  });

  async function render(accounts = 0, groups = 0): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AccountsPage],
      providers: [
        { provide: DOCKET_DB, useValue: db },
        // The header carries the sync status chip, which reaches the vault.
        { provide: SecureStore, useClass: MemorySecureStore },
        provideRouter([]),
      ],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(AccountsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();

    await waitUntil(
      () => page.accounts.all().length >= accounts && page.groups.all().length >= groups,
    );
    fixture.detectChanges();
  }

  /** Scope to this screen: Ionic leaves departed pages in the DOM. */
  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('shows nothing but an invitation when there are no accounts', async () => {
    await render();
    expect(page.sections()).toEqual([]);
    expect(text()).toContain('No accounts yet');
  });

  it('heads each group and lists its accounts under it', async () => {
    await db.accountGroups.bulkPut([
      anAccountGroup({ id: 'g-cards', name: 'Cards', type: 'credit-card', order: 0 }),
      anAccountGroup({ id: 'g-day', name: 'Everyday', type: 'default', order: 1 }),
    ]);
    await db.accounts.bulkPut([
      anAccount({ id: 'a-visa', name: 'Visa', groupId: 'g-cards', openingBalance: -1_240_00 }),
      anAccount({ id: 'a-cash', name: 'Current', groupId: 'g-day', openingBalance: 4_100_00 }),
    ]);
    await render(2, 2);

    expect(page.sections().map((s) => s.group?.name)).toEqual(['Cards', 'Everyday']);
    expect(text()).toContain('Cards');
    expect(text()).toContain('Visa');
  });

  it('puts ungrouped accounts last, under a heading that is not a group name', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-cards', name: 'Cards' }));
    await db.accounts.bulkPut([
      anAccount({ id: 'a-loose', name: 'Shoebox', groupId: null }),
      anAccount({ id: 'a-visa', name: 'Visa', groupId: 'g-cards' }),
    ]);
    await render(2, 1);

    const last = page.sections().at(-1);
    expect(last?.group).toBeNull();
    expect(last?.accounts.map((a) => a.name)).toEqual(['Shoebox']);
    expect(text()).toContain('Not in a group');
  });

  it('subtotals each group in the reporting currency', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-day', name: 'Everyday', type: 'default' }));
    await db.accounts.bulkPut([
      anAccount({ id: 'a-1', groupId: 'g-day', openingBalance: 300_00 }),
      anAccount({ id: 'a-2', groupId: 'g-day', openingBalance: 125_50 }),
    ]);
    await render(2, 1);

    expect(page.sections()[0].subtotal).toBe(425_50);
    expect(text()).toContain('$425.50');
  });

  it('reads a credit-card group as money owed', async () => {
    await db.accountGroups.put(
      anAccountGroup({ id: 'g-cards', name: 'Cards', type: 'credit-card' }),
    );
    await db.accounts.bulkPut([
      anAccount({ id: 'a-visa', name: 'Visa', groupId: 'g-cards', openingBalance: -1_240_00 }),
      anAccount({ id: 'a-amex', name: 'Amex', groupId: 'g-cards', openingBalance: -310_00 }),
    ]);
    await render(2, 1);

    const [cards] = page.sections();
    expect(cards.owed).toBe(true);
    expect(cards.subtotal).toBe(1_550_00);

    // The row shows the debt as a positive amount, the way a statement does.
    // Addressed by name: accounts are listed alphabetically, so Amex is first.
    const visa = cards.accounts.find((a) => a.name === 'Visa')!;
    expect(page.shown(visa, cards)).toBe(1_240_00);
    expect(text()).toContain('owed');
    expect(text()).not.toContain('-$1,240.00');
    expect(text()).not.toContain('−$1,240.00');
  });

  it('does not colour a card balance as a danger', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-cards', type: 'credit-card' }));
    await db.accounts.put(
      anAccount({ id: 'a-visa', groupId: 'g-cards', openingBalance: -1_240_00 }),
    );
    await render(1, 1);

    const [cards] = page.sections();
    expect(page.alarming(cards.accounts[0], cards)).toBe(false);
  });

  it('still colours an overdrawn ordinary account', async () => {
    await db.accounts.put(anAccount({ id: 'a-1', groupId: null, openingBalance: -25_00 }));
    await render(1);

    const [loose] = page.sections();
    expect(page.alarming(loose.accounts[0], loose)).toBe(true);
  });

  it('leaves net worth alone when a debt is flipped for display', async () => {
    // The whole point of flipping only the display: the ledger still subtracts.
    await db.accountGroups.put(anAccountGroup({ id: 'g-cards', type: 'credit-card' }));
    await db.accounts.bulkPut([
      anAccount({ id: 'a-visa', groupId: 'g-cards', openingBalance: -1_240_00 }),
      anAccount({ id: 'a-cash', groupId: null, openingBalance: 4_100_00 }),
    ]);
    await render(2, 1);

    await waitUntil(() => page.accounts.netWorth() !== 0);
    expect(page.accounts.netWorth()).toBe(2_860_00);
  });

  it('says which currency a subtotal leaves out', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-1', name: 'Mixed', type: 'default' }));
    await db.accounts.bulkPut([
      anAccount({ id: 'a-usd', currency: 'USD', groupId: 'g-1', openingBalance: 100_00 }),
      anAccount({ id: 'a-gbp', currency: 'GBP', groupId: 'g-1', openingBalance: 999_00 }),
    ]);
    await render(2, 1);

    expect(page.sections()[0].unconverted).toEqual(['GBP']);
    expect(page.sections()[0].subtotal).toBe(100_00);
    expect(text()).toContain('Subtotal excludes GBP');
  });

  it('includes a foreign balance once a rate exists', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-1', type: 'default' }));
    await db.accounts.bulkPut([
      anAccount({ id: 'a-usd', currency: 'USD', groupId: 'g-1', openingBalance: 100_00 }),
      anAccount({ id: 'a-eur', currency: 'EUR', groupId: 'g-1', openingBalance: 100_00 }),
    ]);
    await db.rates.put(
      anExchangeRate({ id: 'EUR:USD:2026-01-01', base: 'EUR', quote: 'USD', rate: 1.1 }),
    );
    await render(2, 1);

    await waitUntil(() => page.sections()[0]?.unconverted.length === 0);
    expect(page.sections()[0].subtotal).toBe(210_00);
  });

  it('hides an empty group rather than heading nothing', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-empty', name: 'Unused' }));
    await db.accounts.put(anAccount({ id: 'a-1', groupId: null }));
    await render(1, 1);

    expect(page.sections().map((s) => s.group?.name)).toEqual([undefined]);
    expect(text()).not.toContain('Unused');
  });

  it('keeps archived accounts out of the sections and in their own list', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-1', name: 'Cards' }));
    await db.accounts.bulkPut([
      anAccount({ id: 'a-live', name: 'Visa', groupId: 'g-1' }),
      anAccount({ id: 'a-old', name: 'Closed card', groupId: 'g-1', archived: true }),
    ]);
    await render(2, 1);

    expect(page.sections()[0].accounts.map((a) => a.id)).toEqual(['a-live']);
    expect(page.archived().map((a) => a.id)).toEqual(['a-old']);
  });

  describe('card terms on the row', () => {
    async function renderCard(overrides: Record<string, unknown>): Promise<void> {
      await db.accountGroups.put(
        anAccountGroup({ id: 'g-cards', name: 'Cards', type: 'credit-card' }),
      );
      await db.accounts.put(
        anAccount({ id: 'a-visa', name: 'Visa', groupId: 'g-cards', ...overrides }),
      );
      await render(1, 1);
    }

    function visa() {
      const section = page.sections()[0];
      return { account: section.accounts[0], section };
    }

    it('shows what credit is left', async () => {
      await renderCard({ openingBalance: -1_240_00, creditLimit: 5_000_00 });

      const { account, section } = visa();
      expect(page.subtitle(account, section)).toContain('$3,760.00 available');
      expect(text()).toContain('$3,760.00 available');
    });

    it('says nothing about credit when no limit is recorded', async () => {
      // A card with no limit must not imply one.
      await renderCard({ openingBalance: -1_240_00 });

      const { account, section } = visa();
      expect(page.subtitle(account, section)).not.toContain('available');
    });

    it('shows when the bill is due', async () => {
      await renderCard({ statementDay: 25, dueDay: 15 });

      // The order of day and month is the viewer's locale's business, so the
      // assertion only insists that both are there.
      const { account, section } = visa();
      expect(page.subtitle(account, section)).toMatch(/due (\d+ \w+|\w+ \d+)/);
    });

    it('needs both days before it says anything about a due date', async () => {
      await renderCard({ statementDay: 25 });

      const { account, section } = visa();
      expect(page.subtitle(account, section)).not.toContain('due');
    });

    it('shows both together', async () => {
      await renderCard({ openingBalance: -100_00, creditLimit: 1_000_00, statementDay: 1, dueDay: 20 });

      const { account, section } = visa();
      expect(page.subtitle(account, section)).toMatch(/\$900\.00 available · due /);
    });

    it('falls back to the account kind when a card has no terms at all', async () => {
      await renderCard({ kind: 'card' });

      const { account, section } = visa();
      expect(page.subtitle(account, section)).toBe('card');
    });

    it('leaves an ordinary account showing its kind', async () => {
      await db.accounts.put(anAccount({ id: 'a-1', kind: 'bank', groupId: null }));
      await render(1);

      const section = page.sections()[0];
      expect(page.subtitle(section.accounts[0], section)).toBe('bank');
    });
  });
});
