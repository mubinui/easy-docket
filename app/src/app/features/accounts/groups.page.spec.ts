import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { LedgerService } from '../../core/repositories/ledger.service';
import { waitUntil } from '../../core/testing/async';
import { anAccount, anAccountGroup } from '../../core/testing/factories';
import { AccountGroupsPage } from './groups.page';

let counter = 0;

describe('AccountGroupsPage', () => {
  let fixture: ComponentFixture<AccountGroupsPage>;
  let page: AccountGroupsPage;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`groups-page-${counter++}`);
  });

  /** `expected` is how many groups were seeded, so the wait watches something real. */
  async function render(expected = 0): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AccountGroupsPage],
      providers: [{ provide: DOCKET_DB, useValue: db }, provideRouter([])],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(AccountGroupsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();

    await waitUntil(() => page.groups.all().length >= expected);
    fixture.detectChanges();
  }

  /** Scope assertions to this screen; Ionic leaves departed pages in the DOM. */
  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('invites the first group when there are none', async () => {
    await render();
    expect(text()).toContain('No groups yet');
  });

  it('lists groups in their chosen order, not insertion order', async () => {
    await db.accountGroups.bulkPut([
      anAccountGroup({ id: 'g-1', name: 'Zed', order: 2 }),
      anAccountGroup({ id: 'g-2', name: 'Abe', order: 0 }),
      anAccountGroup({ id: 'g-3', name: 'Mid', order: 1 }),
    ]);
    await render(3);

    expect(page.groups.active().map((g) => g.name)).toEqual(['Abe', 'Mid', 'Zed']);
  });

  it('names the type in plain words, not the stored value', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-1', type: 'credit-card' }));
    await render(1);

    expect(page.labelFor(page.groups.active()[0])).toBe('Credit card');
    expect(text()).toContain('Credit card');
    expect(text()).not.toContain('credit-card');
  });

  it('counts the accounts in each group, singular and plural', async () => {
    await db.accountGroups.bulkPut([
      anAccountGroup({ id: 'g-1', name: 'One', order: 0 }),
      anAccountGroup({ id: 'g-2', name: 'Many', order: 1 }),
      anAccountGroup({ id: 'g-3', name: 'None', order: 2 }),
    ]);
    await db.accounts.bulkPut([
      anAccount({ id: 'a-1', groupId: 'g-1' }),
      anAccount({ id: 'a-2', groupId: 'g-2' }),
      anAccount({ id: 'a-3', groupId: 'g-2' }),
    ]);
    await render(3);
    await waitUntil(() => page.groups.accountsIn('g-2').length === 2);

    const [one, many, none] = page.groups.active();
    expect(page.countIn(one)).toBe('1 account');
    expect(page.countIn(many)).toBe('2 accounts');
    expect(page.countIn(none)).toBe('0 accounts');
  });

  it('separates archived groups from active ones', async () => {
    await db.accountGroups.bulkPut([
      anAccountGroup({ id: 'g-1', name: 'Current', archived: false }),
      anAccountGroup({ id: 'g-2', name: 'Retired', archived: true }),
    ]);
    await render(2);

    expect(page.groups.active().map((g) => g.name)).toEqual(['Current']);
    expect(page.archived().map((g) => g.name)).toEqual(['Retired']);
  });

  it('persists a reorder', async () => {
    await db.accountGroups.bulkPut([
      anAccountGroup({ id: 'g-1', name: 'A', order: 0 }),
      anAccountGroup({ id: 'g-2', name: 'B', order: 1 }),
      anAccountGroup({ id: 'g-3', name: 'C', order: 2 }),
    ]);
    await render(3);

    let completed = false;
    await page.reorder({
      detail: { from: 0, to: 2, complete: () => (completed = true) },
    } as unknown as CustomEvent<never>);

    // The list must be released immediately or the row snaps back visibly.
    expect(completed).toBe(true);
    await waitUntil(() => page.groups.active().map((g) => g.name).join() === 'B,C,A');
  });

  it('opens the editor empty for a new group and loaded for an existing one', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-1', name: 'Cards' }));
    await render(1);

    page.create();
    expect(page.editorOpen()).toBe(true);
    expect(page.editing()).toBeNull();

    page.edit(page.groups.active()[0]);
    expect(page.editing()?.name).toBe('Cards');

    page.close();
    expect(page.editorOpen()).toBe(false);
    expect(page.editing()).toBeNull();
  });

  it('deletes a group without deleting its accounts', async () => {
    await db.accountGroups.put(anAccountGroup({ id: 'g-1' }));
    await db.accounts.put(anAccount({ id: 'a-1', groupId: 'g-1' }));
    await render(1);
    await waitUntil(() => page.groups.accountsIn('g-1').length === 1);

    await TestBed.inject(AccountGroupsService).remove('g-1');

    expect(await db.accountGroups.count()).toBe(0);
    expect((await db.accounts.get('a-1'))?.groupId).toBeNull();
  });
});
