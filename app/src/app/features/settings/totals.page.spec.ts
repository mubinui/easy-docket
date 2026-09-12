import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { AccountsService } from '../../core/repositories/accounts.service';
import { LedgerService } from '../../core/repositories/ledger.service';
import { waitUntil } from '../../core/testing/async';
import { anAccount, anAccountGroup } from '../../core/testing/factories';
import { TotalsSettingsPage } from './totals.page';

let counter = 0;

describe('TotalsSettingsPage', () => {
  let fixture: ComponentFixture<TotalsSettingsPage>;
  let page: TotalsSettingsPage;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`totals-${counter++}`);
    await db.accountGroups.put(anAccountGroup({ id: 'g-day', name: 'Everyday', type: 'default' }));
  });

  async function render(accounts = 0): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TotalsSettingsPage],
      providers: [{ provide: DOCKET_DB, useValue: db }, provideRouter([])],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(TotalsSettingsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();

    await waitUntil(() => page.accounts.all().length >= accounts);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('invites nothing when there are no accounts', async () => {
    await render();
    expect(text()).toContain('No accounts yet');
  });

  it('lists every active account with its group and its state', async () => {
    await db.accounts.bulkPut([
      anAccount({ id: 'a-1', name: 'Current', groupId: 'g-day' }),
      anAccount({ id: 'a-2', name: 'Shared', groupId: null, excludedFromTotals: true }),
    ]);
    await render(2);

    expect(page.rows().map((r) => [r.account.name, r.counted, r.group])).toEqual([
      ['Current', true, 'Everyday'],
      ['Shared', false, 'Not in a group'],
    ]);
  });

  it('shows an account with the field absent as counted', async () => {
    await db.accounts.put(anAccount({ id: 'a-1', name: 'Old' }));
    await render(1);

    expect(page.rows()[0].counted).toBe(true);
  });

  it('keeps archived accounts out of the switches', async () => {
    await db.accounts.bulkPut([
      anAccount({ id: 'a-1', name: 'Live' }),
      anAccount({ id: 'a-2', name: 'Closed', archived: true }),
    ]);
    await render(2);

    expect(page.rows().map((r) => r.account.name)).toEqual(['Live']);
    expect(page.archived().map((a) => a.name)).toEqual(['Closed']);
  });

  describe('switching an account off', () => {
    async function toggle(id: string, checked: boolean): Promise<void> {
      const row = page.rows().find((r) => r.account.id === id)!;
      await page.setCounted(row.account, new CustomEvent('ionChange', { detail: { checked } }));
    }

    it('writes the exclusion, and net worth drops by that balance', async () => {
      await db.accounts.bulkPut([
        anAccount({ id: 'a-1', name: 'Current', openingBalance: 1_000_00 }),
        anAccount({ id: 'a-2', name: 'Shared', openingBalance: 500_00 }),
      ]);
      await render(2);
      await waitUntil(() => page.accounts.netWorth() === 1_500_00);

      await toggle('a-2', false);

      expect((await db.accounts.get('a-2'))?.excludedFromTotals).toBe(true);
      await waitUntil(() => page.accounts.netWorth() === 1_000_00);
    });

    it('switches one back on again', async () => {
      await db.accounts.put(
        anAccount({ id: 'a-1', openingBalance: 500_00, excludedFromTotals: true }),
      );
      await render(1);
      await waitUntil(() => page.accounts.counted().length === 0);

      await toggle('a-1', true);

      expect((await db.accounts.get('a-1'))?.excludedFromTotals).toBe(false);
      await waitUntil(() => page.accounts.netWorth() === 500_00);
    });

    it('leaves the account and its transactions completely alone', async () => {
      // Excluding is a reporting choice, not a deletion.
      await db.accounts.put(
        anAccount({ id: 'a-1', name: 'Shared', openingBalance: 500_00, kind: 'bank' }),
      );
      await render(1);

      await toggle('a-1', false);

      expect(await db.accounts.get('a-1')).toMatchObject({
        name: 'Shared',
        openingBalance: 500_00,
        kind: 'bank',
      });
      expect(page.accounts.active()).toHaveLength(1);
    });

    it('replicates as an ordinary account edit', async () => {
      await db.accounts.put(anAccount({ id: 'a-1' }));
      await render(1);

      await toggle('a-1', false);

      const ops = await TestBed.inject(LedgerService).allOperations();
      expect(ops).toMatchObject([{ entity: 'accounts', entityId: 'a-1', op: 'put' }]);
    });

    it('counts how many are left out', async () => {
      await db.accounts.bulkPut([
        anAccount({ id: 'a-1', openingBalance: 100_00 }),
        anAccount({ id: 'a-2', openingBalance: 100_00, excludedFromTotals: true }),
      ]);
      await render(2);

      const accounts = TestBed.inject(AccountsService);
      await waitUntil(() => accounts.netWorthDetail().excluded === 1);
      expect(accounts.netWorthDetail().total).toBe(100_00);
    });
  });
});
