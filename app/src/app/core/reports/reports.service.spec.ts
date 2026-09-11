import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { aCategory, aTransaction, anAccount } from '../testing/factories';
import { toIsoDate } from '../util/dates';
import { waitUntil } from '../testing/async';
import { ReportsService, rangeFor } from './reports.service';

let counter = 0;
/** Wait for a condition rather than a fixed span; see `core/testing/async.ts`. */
const settle = waitUntil;

async function makeService(): Promise<{ reports: ReportsService; db: DocketDb }> {
  const db = new DocketDb(`reports-${counter++}`);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const injector = createEnvironmentInjector(
    [{ provide: DOCKET_DB, useValue: db }, ReportsService],
    TestBed.inject(EnvironmentInjector),
  );
  return { reports: injector.get(ReportsService), db };
}

describe('rangeFor', () => {
  // A Wednesday in the middle of a month, so nothing depends on today's date.
  const today = new Date(2026, 4, 20); // 20 May 2026

  it('ends today rather than at a future month boundary', () => {
    // A report whose range runs into next week is describing nothing.
    for (const preset of ['quarter', 'half', 'twelve', 'year'] as const) {
      expect(rangeFor(preset, today).to).toBe('2026-05-20');
    }
  });

  it('covers the whole of the current month', () => {
    expect(rangeFor('month', today)).toEqual({ from: '2026-05-01', to: '2026-05-31' });
  });

  it('counts back whole months, starting from the first', () => {
    expect(rangeFor('quarter', today).from).toBe('2026-03-01');
    expect(rangeFor('half', today).from).toBe('2025-12-01');
    expect(rangeFor('twelve', today).from).toBe('2025-06-01');
  });

  it('starts the year range in January', () => {
    expect(rangeFor('year', today).from).toBe('2026-01-01');
  });

  it('crosses a year boundary correctly', () => {
    const january = new Date(2026, 0, 15);
    expect(rangeFor('quarter', january).from).toBe('2025-11-01');
  });
});

describe('ReportsService', () => {
  let reports: ReportsService;
  let db: DocketDb;

  const today = toIsoDate();

  beforeEach(async () => {
    ({ reports, db } = await makeService());
    await db.accounts.put(anAccount({ openingBalance: 100_000, currency: 'USD' }));
    await db.categories.put(aCategory({ id: 'cat-1', name: 'Groceries', kind: 'expense' }));
  });

  it('reports nothing to say on an empty ledger', async () => {
    // Nothing to wait for; the point is that it stays empty.
    await settle(() => reports.data().currency === 'USD');
    expect(reports.hasHistory()).toBe(false);
  });

  it('aggregates the current range', async () => {
    await db.transactions.bulkPut([
      aTransaction({ id: 't1', date: today, amount: 25_000, categoryId: 'cat-1' }),
      aTransaction({ id: 't2', date: today, kind: 'income', amount: 90_000, categoryId: null }),
    ]);
    await settle(() => reports.hasHistory());

    const data = reports.data();
    expect(reports.hasHistory()).toBe(true);
    expect(data.totals).toEqual({ income: 90_000, expense: 25_000, net: 65_000 });
    expect(data.categories).toHaveLength(1);
    expect(data.currency).toBe('USD');
  });

  it('follows the ledger currency', async () => {
    await db.accounts.clear();
    await db.accounts.put(anAccount({ currency: 'JPY' }));
    await settle(() => reports.data().currency === 'JPY');

    expect(reports.data().currency).toBe('JPY');
  });

  it('re-aggregates when the range changes', async () => {
    // Two months back: outside "this month", inside "last 3 months".
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setDate(15);
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    await db.transactions.put(
      aTransaction({ id: 't1', date: toIsoDate(twoMonthsAgo), amount: 5_000, categoryId: 'cat-1' }),
    );
    await settle(() => reports.hasHistory());

    expect(reports.data().totals.expense).toBe(0);

    reports.setPreset('quarter');
    expect(reports.data().totals.expense).toBe(5_000);
    expect(reports.data().categories).toHaveLength(1);
  });

  it('names categories, including ones that were deleted', async () => {
    expect(reports.nameFor(null)).toBe('Uncategorised');
    await settle(() => reports.categoryNames().size > 0);
    expect(reports.nameFor('cat-1')).toBe('Groceries');
    // A budget or a transaction can outlive the category it points at.
    expect(reports.nameFor('cat-gone')).toBe('Deleted category');
  });

  it('labels months readably', () => {
    expect(reports.labelFor('2026-03')).toMatch(/2026/);
  });

  it('includes history from before the range in net worth', async () => {
    const longAgo = '2020-01-15';
    await db.transactions.put(
      aTransaction({ id: 't1', date: longAgo, kind: 'income', amount: 50_000 }),
    );
    await settle(() => reports.hasHistory());

    // Opening 1,000.00 plus 500.00 earned in 2020, even though the range is
    // this month: net worth is cumulative.
    const points = reports.data().netWorth;
    expect(points[points.length - 1].amount).toBe(150_000);
  });
});
