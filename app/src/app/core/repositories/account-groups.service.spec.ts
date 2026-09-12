import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { waitUntil } from '../testing/async';
import { anAccount, anAccountGroup } from '../testing/factories';
import { AccountGroupsService, compareGroups } from './account-groups.service';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';

let counter = 0;

describe('AccountGroupsService', () => {
  let groups: AccountGroupsService;
  let accounts: AccountsService;
  let ledger: LedgerService;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`groups-${counter++}`);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DOCKET_DB, useValue: db }] });

    ledger = TestBed.inject(LedgerService);
    await ledger.initialise('aaaaaaaa');
    groups = TestBed.inject(AccountGroupsService);
    accounts = TestBed.inject(AccountsService);
  });

  /** Reading a signal subscribes it; the rows arrive on the next microtask. */
  async function seen(count: number): Promise<void> {
    await waitUntil(() => groups.all().length >= count);
  }

  async function seenAccounts(count: number): Promise<void> {
    await waitUntil(() => accounts.all().length >= count);
  }

  describe('ordering', () => {
    it('lists groups by their position, not by name or insertion', async () => {
      await groups.save(anAccountGroup({ id: 'g-c', name: 'Cards', order: 2 }));
      await groups.save(anAccountGroup({ id: 'g-a', name: 'Savings', order: 0 }));
      await groups.save(anAccountGroup({ id: 'g-b', name: 'Joint', order: 1 }));
      await seen(3);

      expect(groups.ordered().map((g) => g.id)).toEqual(['g-a', 'g-b', 'g-c']);
    });

    it('breaks a tie by name so two devices agree on the order', () => {
      // `order` is assigned per device, so colliding numbers are normal rather
      // than exceptional. Without a tiebreak the list would shuffle on sync.
      const zed = anAccountGroup({ id: 'g-1', name: 'Zed', order: 0 });
      const abe = anAccountGroup({ id: 'g-2', name: 'Abe', order: 0 });

      expect([zed, abe].sort(compareGroups).map((g) => g.name)).toEqual(['Abe', 'Zed']);
      expect([abe, zed].sort(compareGroups).map((g) => g.name)).toEqual(['Abe', 'Zed']);
    });

    it('breaks an exact tie by id, so the order is total', () => {
      const first = anAccountGroup({ id: 'g-1', name: 'Cards', order: 0 });
      const second = anAccountGroup({ id: 'g-2', name: 'Cards', order: 0 });

      expect([second, first].sort(compareGroups).map((g) => g.id)).toEqual(['g-1', 'g-2']);
    });

    it('puts a new group at the bottom', async () => {
      await groups.save(anAccountGroup({ id: 'g-1', name: 'Cards', order: 5 }));
      await seen(1);

      const added = await groups.save({ id: 'g-2', name: 'Savings', type: 'default' });
      expect(added.order).toBe(6);
    });

    it('starts the first group at zero', async () => {
      const added = await groups.save({ id: 'g-1', name: 'Cards', type: 'credit-card' });
      expect(added.order).toBe(0);
    });

    it('rewrites only the groups whose position actually moved', async () => {
      await groups.save(anAccountGroup({ id: 'g-1', name: 'A', order: 0 }));
      await groups.save(anAccountGroup({ id: 'g-2', name: 'B', order: 1 }));
      await groups.save(anAccountGroup({ id: 'g-3', name: 'C', order: 2 }));
      await seen(3);

      const before = (await ledger.allOperations()).length;
      await groups.reorder(['g-1', 'g-3', 'g-2']);
      const after = await ledger.allOperations();

      // g-1 keeps position 0 and must not be written again.
      expect(after.length - before).toBe(2);
      expect((await db.accountGroups.get('g-3'))?.order).toBe(1);
      expect((await db.accountGroups.get('g-2'))?.order).toBe(2);
    });
  });

  describe('archiving', () => {
    it('hides an archived group from the active list but keeps it', async () => {
      await groups.save(anAccountGroup({ id: 'g-1' }));
      await seen(1);

      await groups.setArchived('g-1', true);
      await waitUntil(() => groups.active().length === 0);

      expect(groups.all()).toHaveLength(1);
    });

    it('leaves the accounts of an archived group alone', async () => {
      await groups.save(anAccountGroup({ id: 'g-1' }));
      await accounts.save(anAccount({ id: 'a-1', groupId: 'g-1' }));
      await seen(1);

      await groups.setArchived('g-1', true);

      expect((await db.accounts.get('a-1'))?.groupId).toBe('g-1');
    });
  });

  describe('deleting', () => {
    it('leaves the accounts behind, ungrouped', async () => {
      await groups.save(anAccountGroup({ id: 'g-1' }));
      await accounts.save(anAccount({ id: 'a-1', name: 'Visa', groupId: 'g-1' }));
      await accounts.save(anAccount({ id: 'a-2', name: 'Amex', groupId: 'g-1' }));
      await seen(1);
      await seenAccounts(2);

      await groups.remove('g-1');

      expect(await db.accountGroups.get('g-1')).toBeUndefined();
      expect(await db.accounts.count()).toBe(2);
      expect((await db.accounts.get('a-1'))?.groupId).toBeNull();
      expect((await db.accounts.get('a-2'))?.groupId).toBeNull();
    });

    it('clears the members explicitly, so another device learns they moved', async () => {
      // An absence does not replicate. Clearing the account is an ordinary edit
      // that does.
      await groups.save(anAccountGroup({ id: 'g-1' }));
      await accounts.save(anAccount({ id: 'a-1', groupId: 'g-1' }));
      await seen(1);
      await seenAccounts(1);

      await groups.remove('g-1');

      const ops = await ledger.allOperations();
      expect(ops).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entity: 'accounts', entityId: 'a-1', op: 'put' }),
          expect.objectContaining({ entity: 'accountGroups', entityId: 'g-1', op: 'delete' }),
        ]),
      );
    });

    it('does not touch accounts in other groups', async () => {
      await groups.save(anAccountGroup({ id: 'g-1' }));
      await groups.save(anAccountGroup({ id: 'g-2' }));
      await accounts.save(anAccount({ id: 'a-1', groupId: 'g-1' }));
      await accounts.save(anAccount({ id: 'a-2', groupId: 'g-2' }));
      await seen(2);
      await seenAccounts(2);

      await groups.remove('g-1');

      expect((await db.accounts.get('a-2'))?.groupId).toBe('g-2');
    });
  });

  describe('membership', () => {
    it('lists the accounts in a group', async () => {
      await groups.save(anAccountGroup({ id: 'g-1' }));
      await accounts.save(anAccount({ id: 'a-1', name: 'Visa', groupId: 'g-1' }));
      await accounts.save(anAccount({ id: 'a-2', name: 'Everyday', groupId: null }));
      await seen(1);
      await seenAccounts(2);

      expect(groups.accountsIn('g-1').map((a) => a.id)).toEqual(['a-1']);
    });

    it('counts an account with no group as ungrouped', async () => {
      await accounts.save(anAccount({ id: 'a-1', groupId: null }));
      await accounts.save(anAccount({ id: 'a-2' }));
      await seenAccounts(2);

      expect(groups.ungrouped().map((a) => a.id).sort()).toEqual(['a-1', 'a-2']);
    });

    it('counts an account pointing at an unknown group as ungrouped', async () => {
      // A group deleted on another device arrives here as an absence. The
      // account must still appear somewhere rather than vanishing off the list.
      await accounts.save(anAccount({ id: 'a-1', groupId: 'g-gone' }));
      await seenAccounts(1);

      expect(groups.ungrouped().map((a) => a.id)).toEqual(['a-1']);
    });

    it('moves an account between groups', async () => {
      await groups.save(anAccountGroup({ id: 'g-1' }));
      await groups.save(anAccountGroup({ id: 'g-2' }));
      await accounts.save(anAccount({ id: 'a-1', groupId: 'g-1' }));
      await seen(2);
      await seenAccounts(1);

      await groups.moveAccount('a-1', 'g-2');
      expect((await db.accounts.get('a-1'))?.groupId).toBe('g-2');

      await groups.moveAccount('a-1', null);
      expect((await db.accounts.get('a-1'))?.groupId).toBeNull();
    });

    it('does not write an account that is already where it is being moved', async () => {
      await groups.save(anAccountGroup({ id: 'g-1' }));
      await accounts.save(anAccount({ id: 'a-1', groupId: 'g-1' }));
      await seenAccounts(1);

      const before = (await ledger.allOperations()).length;
      await groups.moveAccount('a-1', 'g-1');
      expect(await ledger.allOperations()).toHaveLength(before);
    });

    it('treats a missing groupId and an explicit null as the same place', async () => {
      await accounts.save(anAccount({ id: 'a-1' }));
      await seenAccounts(1);

      const before = (await ledger.allOperations()).length;
      await groups.moveAccount('a-1', null);
      expect(await ledger.allOperations()).toHaveLength(before);
    });
  });

  describe('what an account is', () => {
    it('takes its type from its group', async () => {
      await groups.save(anAccountGroup({ id: 'g-cards', type: 'credit-card' }));
      await groups.save(anAccountGroup({ id: 'g-debit', type: 'debit-card' }));
      await seen(2);

      expect(groups.typeOf(anAccount({ groupId: 'g-cards' }))).toBe('credit-card');
      expect(groups.typeOf(anAccount({ groupId: 'g-debit' }))).toBe('debit-card');
      expect(groups.isCreditCard(anAccount({ groupId: 'g-cards' }))).toBe(true);
      expect(groups.isCreditCard(anAccount({ groupId: 'g-debit' }))).toBe(false);
    });

    it('is default when ungrouped, or when the group is unknown here', async () => {
      await seen(0);

      expect(groups.typeOf(anAccount({ groupId: null }))).toBe('default');
      expect(groups.typeOf(anAccount())).toBe('default');
      expect(groups.typeOf(anAccount({ groupId: 'g-gone' }))).toBe('default');
    });

    it('ignores the account kind entirely', async () => {
      // `kind` is presentation. An account of kind 'card' filed nowhere is not
      // a credit card, and a 'bank' account in a credit-card group is.
      await groups.save(anAccountGroup({ id: 'g-cards', type: 'credit-card' }));
      await seen(1);

      expect(groups.isCreditCard(anAccount({ kind: 'card', groupId: null }))).toBe(false);
      expect(groups.isCreditCard(anAccount({ kind: 'bank', groupId: 'g-cards' }))).toBe(true);
    });
  });

  describe('seeding a new vault', () => {
    it('creates a group of every type', async () => {
      await groups.seedIfEmpty();
      await seen(5);

      expect(groups.ordered().map((g) => [g.name, g.type])).toEqual([
        ['Everyday', 'default'],
        ['Savings', 'default'],
        ['Credit cards', 'credit-card'],
        ['Debit cards', 'debit-card'],
        ['Loans', 'loan'],
      ]);
    });

    it('puts at least one account in every group', async () => {
      await groups.seedIfEmpty();
      await seen(5);
      await seenAccounts(6);

      for (const group of groups.ordered()) {
        expect(groups.accountsIn(group.id).length).toBeGreaterThan(0);
      }
      expect(groups.ungrouped()).toEqual([]);
    });

    it('leaves every starter account empty', async () => {
      // A starter account is a labelled empty shelf. Inventing a balance would
      // put numbers in someone's ledger that they never entered.
      await groups.seedIfEmpty();
      await seenAccounts(6);

      const accounts = await db.accounts.toArray();
      expect(accounts.map((a) => a.openingBalance)).toEqual(accounts.map(() => 0));
    });

    it('gives them the reporting currency, so they add up straight away', async () => {
      await groups.seedIfEmpty();
      await seenAccounts(6);

      const accounts = await db.accounts.toArray();
      expect(new Set(accounts.map((a) => a.currency))).toEqual(new Set(['USD']));
    });

    it('counts them all towards totals', async () => {
      await groups.seedIfEmpty();
      await seenAccounts(6);

      expect(accounts.counted()).toHaveLength(6);
      expect(accounts.netWorth()).toBe(0);
    });

    it('does nothing the second time it runs', async () => {
      await groups.seedIfEmpty();
      await seen(5);

      await groups.seedIfEmpty();
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(await db.accountGroups.count()).toBe(5);
      expect(await db.accounts.count()).toBe(6);
    });

    it('does nothing for a ledger that already has accounts but no groups', async () => {
      // Someone who has been using the app since before groups existed. Five
      // invented accounts appearing beside their real ones would be alarming.
      await accounts.save(anAccount({ id: 'a-real', name: 'My account' }));
      await seenAccounts(1);

      await groups.seedIfEmpty();

      expect(await db.accountGroups.count()).toBe(0);
      expect(await db.accounts.count()).toBe(1);
    });

    it('does nothing for a device joining a vault that already has groups', async () => {
      await groups.save(anAccountGroup({ id: 'g-synced' }));
      await seen(1);

      await groups.seedIfEmpty();

      expect(await db.accountGroups.count()).toBe(1);
      expect(await db.accounts.count()).toBe(0);
    });

    it('replicates as ordinary operations', async () => {
      await groups.seedIfEmpty();
      await seen(5);

      const ops = await ledger.allOperations();
      expect(ops.filter((o) => o.entity === 'accountGroups')).toHaveLength(5);
      expect(ops.filter((o) => o.entity === 'accounts')).toHaveLength(6);
      expect(ops.every((o) => o.op === 'put')).toBe(true);
    });

    it('splits into the two halves of the balance sheet', async () => {
      await groups.seedIfEmpty();
      await seen(5);

      const liabilities = groups.ordered().filter((g) => groups.isLiability(
        anAccount({ groupId: g.id }),
      ));
      expect(liabilities.map((g) => g.name)).toEqual(['Credit cards', 'Loans']);
    });
  });
});
