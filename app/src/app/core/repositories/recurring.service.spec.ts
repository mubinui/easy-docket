import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { waitUntil } from '../testing/async';
import { aRecurringRule } from '../testing/factories';
import { toIsoDate } from '../util/dates';
import { LedgerService } from './ledger.service';
import { RecurringService } from './recurring.service';

let counter = 0;

async function makeService(): Promise<{ recurring: RecurringService; db: DocketDb }> {
  const db = new DocketDb(`recurring-${counter++}`);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const injector = createEnvironmentInjector(
    [{ provide: DOCKET_DB, useValue: db }, LedgerService, RecurringService],
    TestBed.inject(EnvironmentInjector),
  );
  await injector.get(LedgerService).initialise('aaaaaaaa');

  return { recurring: injector.get(RecurringService), db };
}

/** A rule whose next occurrence is genuinely in the future. */
function futureRule(overrides = {}) {
  const start = new Date();
  start.setDate(start.getDate() - 1);
  return aRecurringRule({ startDate: toIsoDate(start), ...overrides });
}

describe('RecurringService', () => {
  let recurring: RecurringService;
  let db: DocketDb;

  beforeEach(async () => {
    ({ recurring, db } = await makeService());
  });

  describe('save', () => {
    it('stores a rule through the ledger, so it replicates', async () => {
      const saved = await recurring.save(aRecurringRule());

      expect(saved.updatedAt).not.toBe('');
      expect(await db.recurringRules.get('rule-1')).toEqual(saved);
      expect(await db.oplog.count()).toBe(1);
    });

    it('applies defaults', async () => {
      const saved = await recurring.save({
        id: 'rule-2',
        name: 'Salary',
        kind: 'income',
        amount: 300_000,
        currency: 'USD',
        accountId: 'acc-1',
        interval: 1,
        unit: 'month',
        startDate: '2026-01-25',
      });

      expect(saved.endDate).toBeNull();
      expect(saved.maxOccurrences).toBeNull();
      expect(saved.skipped).toEqual([]);
      expect(saved.archived).toBe(false);
    });

    it('rejects a rule that cannot mean anything', async () => {
      await expect(recurring.save(aRecurringRule({ name: ' ' }))).rejects.toThrow(/needs a name/);
      await expect(recurring.save(aRecurringRule({ amount: 0 }))).rejects.toThrow(/greater than zero/);
      await expect(recurring.save(aRecurringRule({ interval: 0 }))).rejects.toThrow(/at least one/);
      await expect(recurring.save(aRecurringRule({ accountId: '' }))).rejects.toThrow(/account/);
      await expect(recurring.save(aRecurringRule({ startDate: '15/01' }))).rejects.toThrow(/YYYY-MM-DD/);
    });

    it('rejects an end date before the start', async () => {
      await expect(
        recurring.save(aRecurringRule({ startDate: '2026-06-01', endDate: '2026-01-01' })),
      ).rejects.toThrow(/cannot be before/);
    });

    it('rejects an occurrence limit below one', async () => {
      await expect(recurring.save(aRecurringRule({ maxOccurrences: 0 }))).rejects.toThrow(
        /at least one/,
      );
    });

    it('rejects a transfer without a destination', async () => {
      await expect(
        recurring.save(aRecurringRule({ kind: 'transfer', counterAccountId: null })),
      ).rejects.toThrow(/destination account/);
      await expect(
        recurring.save(aRecurringRule({ kind: 'transfer', counterAccountId: 'acc-1' })),
      ).rejects.toThrow(/two different accounts/);
    });

    it('normalises a negative amount rather than rejecting it', async () => {
      // Direction is carried by `kind`, so the stored amount is always positive
      // — the same rule the transaction editor follows.
      const saved = await recurring.save(aRecurringRule({ amount: -12_000 }));
      expect(saved.amount).toBe(12_000);
    });

    it('writes nothing when validation fails', async () => {
      await expect(recurring.save(aRecurringRule({ amount: 0 }))).rejects.toThrow();
      expect(await db.recurringRules.count()).toBe(0);
    });
  });

  describe('upcoming', () => {
    it('orders rules by when they next fall due', async () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 2);
      const later = new Date();
      later.setDate(later.getDate() + 20);

      await recurring.save(
        aRecurringRule({ id: 'r-later', name: 'Later', startDate: toIsoDate(later), unit: 'year' }),
      );
      await recurring.save(
        aRecurringRule({ id: 'r-soon', name: 'Soon', startDate: toIsoDate(soon), unit: 'year' }),
      );

      await waitUntil(() => recurring.upcoming().length === 2);
      expect(recurring.upcoming().map((s) => s.rule.id)).toEqual(['r-soon', 'r-later']);
    });

    it('sorts a finished rule last rather than first', async () => {
      // A null next-date must not sort above everything that still has one.
      await recurring.save(futureRule({ id: 'r-live', name: 'Live' }));
      await recurring.save(
        aRecurringRule({ id: 'r-done', name: 'Done', startDate: '2020-01-01', maxOccurrences: 1 }),
      );

      await waitUntil(() => recurring.upcoming().length === 2);
      const order = recurring.upcoming();
      expect(order[0].rule.id).toBe('r-live');
      expect(order[1].next).toBeNull();
    });

    it('excludes archived rules', async () => {
      await recurring.save(futureRule({ archived: true }));
      await waitUntil(() => recurring.all().length === 1);

      expect(recurring.upcoming()).toHaveLength(0);
      expect(recurring.archived()).toHaveLength(1);
    });
  });

  describe('preview', () => {
    it('lists the next few occurrences', () => {
      const rule = aRecurringRule({ startDate: '2026-01-15', unit: 'month' });
      expect(recurring.preview(rule, 3, '2026-01-20')).toEqual([
        '2026-02-15',
        '2026-03-15',
        '2026-04-15',
      ]);
    });

    it('stops early when the rule finishes', () => {
      const rule = aRecurringRule({ startDate: '2026-01-15', maxOccurrences: 2 });
      expect(recurring.preview(rule, 5, '2026-01-01')).toEqual(['2026-01-15', '2026-02-15']);
    });
  });

  describe('archive and delete', () => {
    it('archives without losing the rule', async () => {
      await recurring.save(aRecurringRule());
      await recurring.setArchived('rule-1', true);

      expect((await db.recurringRules.get('rule-1'))?.archived).toBe(true);
    });

    it('deletes through the ledger, leaving a tombstone', async () => {
      await recurring.save(aRecurringRule());
      await recurring.remove('rule-1');

      expect(await db.recurringRules.get('rule-1')).toBeUndefined();
      expect((await db.oplog.toArray()).map((o) => o.op)).toEqual(['put', 'delete']);
    });

    it('ignores archiving something that is not there', async () => {
      await expect(recurring.setArchived('missing', true)).resolves.toBeUndefined();
    });
  });
});
