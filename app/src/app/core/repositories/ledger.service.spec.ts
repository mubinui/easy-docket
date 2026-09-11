import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { Operation } from '../models/oplog';
import { encodeHlc } from '../util/hlc';
import { aBudget, aRecurringRule, anAccount, aTransaction } from '../testing/factories';
import { LedgerService } from './ledger.service';

/**
 * Each test gets its own IndexedDB database so suites cannot observe each
 * other's rows, and two `LedgerService` instances can stand in for two devices
 * replicating the same vault.
 */
let dbCounter = 0;

/**
 * Stamps are built relative to the real clock: the HLC deliberately rejects
 * anything more than an hour in the future, so hard-coded far-future fixtures
 * would trip the drift guard rather than test what they mean to.
 */
function stampAt(offsetMs: number, device = 'bbbbbbbb'): string {
  return encodeHlc({ physical: Date.now() + offsetMs, counter: 0 }, device);
}

async function makeLedger(device: string): Promise<{ ledger: LedgerService; db: DocketDb }> {
  const db = new DocketDb(`test-${device}-${dbCounter++}`);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [LedgerService, { provide: DOCKET_DB, useValue: db }],
  });
  const ledger = TestBed.inject(LedgerService);
  await ledger.initialise(device);
  return { ledger, db };
}

describe('LedgerService', () => {
  let ledger: LedgerService;
  let db: DocketDb;

  beforeEach(async () => {
    ({ ledger, db } = await makeLedger('aaaaaaaa'));
  });

  it('refuses to write before the clock has been restored', async () => {
    // A service resolved without `initialise()` has no clock, and writing
    // anyway would risk reusing a stamp after a restart.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [LedgerService, { provide: DOCKET_DB, useValue: db }],
    });
    const uninitialised = TestBed.inject(LedgerService);

    await expect(uninitialised.put('accounts', anAccount())).rejects.toThrow(/initialise/);
  });

  it('stamps a written entity and records a matching operation', async () => {
    const saved = await ledger.put('accounts', anAccount());

    expect(saved.updatedAt).not.toBe('');
    expect(await db.accounts.get('acc-1')).toEqual(saved);

    const ops = await ledger.allOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      entity: 'accounts',
      entityId: 'acc-1',
      op: 'put',
      device: 'aaaaaaaa',
      synced: 0,
    });
  });

  it('orders successive writes monotonically', async () => {
    const first = await ledger.put('accounts', anAccount());
    const second = await ledger.put('accounts', { ...anAccount(), name: 'Renamed' });
    expect(second.updatedAt > first.updatedAt).toBe(true);
  });

  it('keeps a tombstone when an entity is deleted', async () => {
    await ledger.put('transactions', aTransaction());
    await ledger.remove('transactions', 'txn-1');

    expect(await db.transactions.get('txn-1')).toBeUndefined();
    const ops = await ledger.allOperations();
    expect(ops.map((o) => o.op)).toEqual(['put', 'delete']);
  });

  it('survives a restart without reusing a clock stamp', async () => {
    const before = await ledger.put('accounts', anAccount());

    // Simulate a cold start against the same database file.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [LedgerService, { provide: DOCKET_DB, useValue: db }],
    });
    const restarted = TestBed.inject(LedgerService);
    await restarted.initialise('aaaaaaaa');

    const after = await restarted.put('accounts', { ...anAccount(), name: 'After restart' });
    expect(after.updatedAt > before.updatedAt).toBe(true);
  });

  describe('pending work', () => {
    it('reports unsynced operations and clears them once pushed', async () => {
      await ledger.put('accounts', anAccount());
      await ledger.put('transactions', aTransaction());

      const pending = await ledger.pendingOperations();
      expect(pending).toHaveLength(2);
      expect(pending.map((o) => o.hlc)).toEqual([...pending.map((o) => o.hlc)].sort());

      await ledger.markSynced(pending.map((o) => o.hlc));
      expect(await ledger.pendingOperations()).toHaveLength(0);
    });
  });

  describe('budgets', () => {
    /**
     * Budgets were added in schema v2 and deliberately reuse the generic entity
     * path. These tests exist to prove that: if any of them needed a change in
     * `LedgerService`, the abstraction would have leaked.
     */
    it('records a budget like any other entity', async () => {
      const saved = await ledger.put('budgets', aBudget());

      expect(saved.updatedAt).not.toBe('');
      expect(await db.budgets.get('bud-1')).toEqual(saved);
      expect(await ledger.allOperations()).toMatchObject([{ entity: 'budgets', op: 'put' }]);
    });

    it('tombstones a deleted budget', async () => {
      await ledger.put('budgets', aBudget());
      await ledger.remove('budgets', 'bud-1');

      expect(await db.budgets.get('bud-1')).toBeUndefined();
      expect((await ledger.allOperations()).map((o) => o.op)).toEqual(['put', 'delete']);
    });

    it('merges a budget from another device', async () => {
      const applied = await ledger.merge([
        {
          hlc: stampAt(-1_000),
          entity: 'budgets',
          entityId: 'bud-9',
          op: 'put',
          value: aBudget({ id: 'bud-9', name: 'Holiday fund', amount: 120_000 }),
          device: 'bbbbbbbb',
        },
      ]);

      expect(applied).toBe(1);
      expect((await db.budgets.get('bud-9'))?.name).toBe('Holiday fund');
    });

    it('resolves concurrent budget edits by clock, like every other entity', async () => {
      const older = {
        hlc: stampAt(-20_000),
        entity: 'budgets' as const,
        entityId: 'bud-9',
        op: 'put' as const,
        value: aBudget({ id: 'bud-9', amount: 10_000 }),
        device: 'bbbbbbbb',
      };
      const newer = { ...older, hlc: stampAt(-10_000), value: aBudget({ id: 'bud-9', amount: 99_000 }) };

      await ledger.merge([newer, older]);
      expect((await db.budgets.get('bud-9'))?.amount).toBe(99_000);
    });

    it('keeps budget history separate from other entities sharing an id', async () => {
      // Entity identity is (entity, entityId); an account and a budget may
      // legitimately carry the same id without colliding in the log.
      await ledger.put('accounts', anAccount({ id: 'shared-id' }));
      await ledger.put('budgets', aBudget({ id: 'shared-id' }));

      expect(await db.accounts.get('shared-id')).toBeDefined();
      expect(await db.budgets.get('shared-id')).toBeDefined();

      await ledger.remove('budgets', 'shared-id');
      expect(await db.accounts.get('shared-id')).toBeDefined();
      expect(await db.budgets.get('shared-id')).toBeUndefined();
    });
  });

  describe('recurring rules', () => {
    /**
     * The second entity added since the sync engine was written. Task 2.1 found
     * that `merge` had a hardcoded table list and replaced it with an iteration
     * over `ENTITY_NAMES`; these tests are the check that the repair held.
     */
    it('records a rule like any other entity', async () => {
      const saved = await ledger.put('recurringRules', aRecurringRule());

      expect(await db.recurringRules.get('rule-1')).toEqual(saved);
      expect(await ledger.allOperations()).toMatchObject([{ entity: 'recurringRules' }]);
    });

    it('merges a rule from another device without any new code path', async () => {
      const applied = await ledger.merge([
        {
          hlc: stampAt(-1_000),
          entity: 'recurringRules',
          entityId: 'rule-9',
          op: 'put',
          value: aRecurringRule({ id: 'rule-9', name: 'Salary' }),
          device: 'bbbbbbbb',
        },
      ]);

      expect(applied).toBe(1);
      expect((await db.recurringRules.get('rule-9'))?.name).toBe('Salary');
    });

    it('tombstones a deleted rule', async () => {
      await ledger.put('recurringRules', aRecurringRule());
      await ledger.remove('recurringRules', 'rule-1');

      expect(await db.recurringRules.get('rule-1')).toBeUndefined();
      expect((await ledger.allOperations()).map((o) => o.op)).toEqual(['put', 'delete']);
    });
  });

  describe('entity history', () => {
    it('remembers an entity that was created and then deleted', async () => {
      // The table forgets; the log does not. The recurring materialiser depends
      // on the difference, or a deleted occurrence would reappear every open.
      await ledger.put('transactions', aTransaction({ id: 'txn-9' }));
      await ledger.remove('transactions', 'txn-9');

      expect(await db.transactions.get('txn-9')).toBeUndefined();
      expect(await ledger.hasHistory('transactions', 'txn-9')).toBe(true);
      expect(await ledger.hasHistory('transactions', 'never-existed')).toBe(false);
    });

    it('finds the highest id carrying a prefix', async () => {
      for (const date of ['2026-01-15', '2026-03-15', '2026-02-15']) {
        await ledger.put('transactions', aTransaction({ id: `rule-1:${date}`, date }));
      }
      await ledger.put('transactions', aTransaction({ id: 'rule-2:2026-09-01' }));

      expect(await ledger.latestEntityIdWithPrefix('transactions', 'rule-1:')).toBe(
        'rule-1:2026-03-15',
      );
    });

    it('counts a deleted id towards the high-water mark', async () => {
      await ledger.put('transactions', aTransaction({ id: 'rule-1:2026-01-15' }));
      await ledger.put('transactions', aTransaction({ id: 'rule-1:2026-02-15' }));
      await ledger.remove('transactions', 'rule-1:2026-02-15');

      expect(await ledger.latestEntityIdWithPrefix('transactions', 'rule-1:')).toBe(
        'rule-1:2026-02-15',
      );
    });

    it('reports nothing for a prefix no entity uses', async () => {
      expect(await ledger.latestEntityIdWithPrefix('transactions', 'rule-9:')).toBeNull();
    });
  });

  describe('merging remote operations', () => {
    function remoteOp(over: Partial<Operation> = {}): Operation {
      return {
        hlc: stampAt(-1_000),
        entity: 'accounts',
        entityId: 'acc-9',
        op: 'put',
        value: anAccount({ id: 'acc-9', name: 'From other device' }),
        device: 'bbbbbbbb',
        ...over,
      };
    }

    it('applies an operation from another device', async () => {
      expect(await ledger.merge([remoteOp()])).toBe(1);
      expect((await db.accounts.get('acc-9'))?.name).toBe('From other device');
    });

    it('is idempotent, so re-pulling the same batch changes nothing', async () => {
      const op = remoteOp();
      expect(await ledger.merge([op])).toBe(1);
      expect(await ledger.merge([op])).toBe(0);
      expect(await db.accounts.count()).toBe(1);
    });

    it('lets the newer stamp win regardless of arrival order', async () => {
      const older = remoteOp({
        hlc: stampAt(-20_000),
        value: anAccount({ id: 'acc-9', name: 'Older' }),
      });
      const newer = remoteOp({
        hlc: stampAt(-10_000),
        value: anAccount({ id: 'acc-9', name: 'Newer' }),
      });

      await ledger.merge([newer, older]);
      expect((await db.accounts.get('acc-9'))?.name).toBe('Newer');

      // And the other way round, on a fresh device.
      const other = await makeLedger('cccccccc');
      await other.ledger.merge([older, newer]);
      expect((await other.db.accounts.get('acc-9'))?.name).toBe('Newer');
    });

    it('does not resurrect an entity deleted after the incoming write', async () => {
      await ledger.merge([
        remoteOp({ hlc: stampAt(-30_000) }),
        remoteOp({ hlc: stampAt(-10_000), op: 'delete', value: undefined }),
      ]);
      expect(await db.accounts.get('acc-9')).toBeUndefined();

      // A straggling older `put` arrives late from a device that was offline.
      const applied = await ledger.merge([
        remoteOp({ hlc: stampAt(-20_000, 'dddddddd'), device: 'dddddddd' }),
      ]);
      expect(applied).toBe(0);
      expect(await db.accounts.get('acc-9')).toBeUndefined();
    });

    it('ignores a malformed put rather than storing undefined', async () => {
      const applied = await ledger.merge([remoteOp({ op: 'put', value: undefined })]);
      expect(applied).toBe(0);
      expect(await db.accounts.count()).toBe(0);
    });

    it('marks merged operations as already synced', async () => {
      await ledger.merge([remoteOp()]);
      expect(await ledger.pendingOperations()).toHaveLength(0);
    });

    it('advances the local clock past anything it has seen', async () => {
      const remoteStamp = stampAt(5_000);
      ledger.observeStamps([remoteStamp]);
      const local = await ledger.put('accounts', anAccount());
      expect(local.updatedAt > remoteStamp).toBe(true);
    });

    it('converges when two devices exchange edits both ways', async () => {
      const a = await makeLedger('aaaaaaaa');
      const b = await makeLedger('bbbbbbbb');

      const fromA = await a.ledger.put('transactions', aTransaction({ payee: 'From A' }));
      const fromB = await b.ledger.put(
        'transactions',
        aTransaction({ id: 'txn-2', payee: 'From B' }),
      );

      await a.ledger.merge(await b.ledger.pendingOperations());
      await b.ledger.merge(await a.ledger.pendingOperations());

      const inA = await a.db.transactions.orderBy('id').toArray();
      const inB = await b.db.transactions.orderBy('id').toArray();
      expect(inA).toEqual(inB);
      expect(inA.map((t) => t.payee)).toEqual(['From A', 'From B']);
      expect([fromA.updatedAt, fromB.updatedAt].every(Boolean)).toBe(true);
    });
  });
});
