import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { LedgerService } from '../repositories/ledger.service';
import { aRecurringRule } from '../testing/factories';
import { MaterialiserService } from './materialiser.service';
import { occurrenceId } from './schedule';

let counter = 0;

interface Device {
  materialiser: MaterialiserService;
  ledger: LedgerService;
  db: DocketDb;
}

async function makeDevice(deviceId = 'aaaaaaaa', db?: DocketDb): Promise<Device> {
  const database = db ?? new DocketDb(`materialiser-${counter++}`);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const injector = createEnvironmentInjector(
    [{ provide: DOCKET_DB, useValue: database }, LedgerService, MaterialiserService],
    TestBed.inject(EnvironmentInjector),
  );
  const ledger = injector.get(LedgerService);
  await ledger.initialise(deviceId);

  return { materialiser: injector.get(MaterialiserService), ledger, db: database };
}

/** A monthly rule from mid-January. */
const RULE = aRecurringRule({ startDate: '2026-01-15', interval: 1, unit: 'month' });

describe('MaterialiserService', () => {
  let device: Device;

  beforeEach(async () => {
    device = await makeDevice();
  });

  it('creates a transaction for each occurrence due', async () => {
    await device.db.recurringRules.put(RULE);

    const result = await device.materialiser.run('2026-03-20');

    expect(result.created).toBe(3);
    expect(await device.db.transactions.count()).toBe(3);
    const dates = (await device.db.transactions.toArray()).map((t) => t.date).sort();
    expect(dates).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('copies the rule onto the transaction', async () => {
    await device.db.recurringRules.put(RULE);
    await device.materialiser.run('2026-01-20');

    const [txn] = await device.db.transactions.toArray();
    expect(txn).toMatchObject({
      kind: 'expense',
      amount: 120_000,
      accountId: 'acc-1',
      categoryId: 'cat-1',
      payee: 'Landlord',
      date: '2026-01-15',
    });
  });

  it('leaves the transaction uncleared', async () => {
    // The rule says the money was due, not that it has moved; the user
    // confirms it against a statement like anything else.
    await device.db.recurringRules.put(RULE);
    await device.materialiser.run('2026-01-20');

    const [txn] = await device.db.transactions.toArray();
    expect(txn.cleared).toBe(false);
  });

  it('creates nothing before the rule starts', async () => {
    await device.db.recurringRules.put(RULE);
    expect((await device.materialiser.run('2025-12-31')).created).toBe(0);
  });

  it('ignores an archived rule', async () => {
    await device.db.recurringRules.put({ ...RULE, archived: true });
    expect((await device.materialiser.run('2026-06-01')).created).toBe(0);
  });

  it('catches up after months unopened', async () => {
    await device.db.recurringRules.put(RULE);
    const result = await device.materialiser.run('2027-01-14');

    expect(result.created).toBe(12);
    expect(result.incomplete).toEqual([]);
  });

  describe('running more than once', () => {
    it('creates nothing the second time', async () => {
      await device.db.recurringRules.put(RULE);
      await device.materialiser.run('2026-03-20');

      const second = await device.materialiser.run('2026-03-20');

      expect(second.created).toBe(0);
      expect(await device.db.transactions.count()).toBe(3);
    });

    it('creates only what has newly fallen due', async () => {
      await device.db.recurringRules.put(RULE);
      await device.materialiser.run('2026-02-20');

      expect((await device.materialiser.run('2026-03-20')).created).toBe(1);
      expect(await device.db.transactions.count()).toBe(3);
    });

    it('does not resurrect a transaction the user deleted', async () => {
      // The table is empty either way; the operation log is what remembers.
      await device.db.recurringRules.put(RULE);
      await device.materialiser.run('2026-01-20');
      await device.ledger.remove('transactions', occurrenceId(RULE.id, '2026-01-15'));

      const again = await device.materialiser.run('2026-01-20');

      expect(again.created).toBe(0);
      expect(await device.db.transactions.count()).toBe(0);
    });

    it('does not overwrite an edit the user made', async () => {
      await device.db.recurringRules.put(RULE);
      await device.materialiser.run('2026-01-20');

      const id = occurrenceId(RULE.id, '2026-01-15');
      const edited = await device.db.transactions.get(id);
      await device.ledger.put('transactions', { ...edited!, amount: 99_900, cleared: true });

      await device.materialiser.run('2026-01-20');

      expect((await device.db.transactions.get(id))?.amount).toBe(99_900);
    });
  });

  describe('two devices', () => {
    it('converge on one transaction, not two', async () => {
      // The whole reason occurrence ids are derived rather than random.
      const alice = await makeDevice('aaaaaaaa');
      const bob = await makeDevice('bbbbbbbb');

      await alice.db.recurringRules.put(RULE);
      await bob.db.recurringRules.put(RULE);

      await alice.materialiser.run('2026-01-20');
      await bob.materialiser.run('2026-01-20');

      // Each created its own copy locally; both carry the same id.
      const [fromAlice] = await alice.db.transactions.toArray();
      const [fromBob] = await bob.db.transactions.toArray();
      expect(fromAlice.id).toBe(fromBob.id);

      // Exchanging operations therefore yields one row, not two.
      await alice.ledger.merge(await bob.ledger.pendingOperations());
      expect(await alice.db.transactions.count()).toBe(1);
    });
  });

  describe('bounded runs', () => {
    it('stops at the cap and says there is more to do', async () => {
      // A daily rule dated years back would otherwise stall the first launch.
      await device.db.recurringRules.put({
        ...RULE,
        unit: 'day',
        startDate: '2015-01-01',
      });

      const result = await device.materialiser.run('2026-01-01');

      expect(result.created).toBe(500);
      expect(result.incomplete).toEqual(['rule-1']);
    });

    it('continues where it left off on the next run', async () => {
      await device.db.recurringRules.put({ ...RULE, unit: 'day', startDate: '2015-01-01' });

      await device.materialiser.run('2026-01-01');
      const second = await device.materialiser.run('2026-01-01');

      expect(second.created).toBe(500);
      expect(await device.db.transactions.count()).toBe(1_000);
    });
  });

  describe('skipping', () => {
    it('records the skip on the rule, so it replicates', async () => {
      await device.db.recurringRules.put(RULE);
      await device.materialiser.skip('rule-1', '2026-02-15');

      expect((await device.db.recurringRules.get('rule-1'))?.skipped).toEqual(['2026-02-15']);
    });

    it('stops the occurrence being created', async () => {
      await device.db.recurringRules.put(RULE);
      await device.materialiser.skip('rule-1', '2026-02-15');

      await device.materialiser.run('2026-03-20');

      const dates = (await device.db.transactions.toArray()).map((t) => t.date).sort();
      expect(dates).toEqual(['2026-01-15', '2026-03-15']);
    });

    it('removes an occurrence that was already created', async () => {
      await device.db.recurringRules.put(RULE);
      await device.materialiser.run('2026-03-20');

      await device.materialiser.skip('rule-1', '2026-02-15');

      expect(await device.db.transactions.get(occurrenceId('rule-1', '2026-02-15'))).toBeUndefined();
      expect(await device.db.transactions.count()).toBe(2);
    });

    it('is idempotent', async () => {
      await device.db.recurringRules.put(RULE);
      await device.materialiser.skip('rule-1', '2026-02-15');
      await device.materialiser.skip('rule-1', '2026-02-15');

      expect((await device.db.recurringRules.get('rule-1'))?.skipped).toEqual(['2026-02-15']);
    });

    it('ignores a rule that is not there', async () => {
      await expect(device.materialiser.skip('missing', '2026-02-15')).resolves.toBeUndefined();
    });
  });
});
