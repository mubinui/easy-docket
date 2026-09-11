import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { waitUntil } from '../testing/async';
import { anExchangeRate } from '../testing/factories';
import { LedgerService } from './ledger.service';
import { DEFAULT_REPORTING_CURRENCY, RatesService } from './rates.service';

let counter = 0;

async function makeService(): Promise<{ rates: RatesService; db: DocketDb }> {
  const db = new DocketDb(`rates-${counter++}`);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const injector = createEnvironmentInjector(
    [{ provide: DOCKET_DB, useValue: db }, LedgerService, RatesService],
    TestBed.inject(EnvironmentInjector),
  );
  await injector.get(LedgerService).initialise('aaaaaaaa');

  return { rates: injector.get(RatesService), db };
}

describe('RatesService', () => {
  let rates: RatesService;
  let db: DocketDb;

  beforeEach(async () => {
    ({ rates, db } = await makeService());
  });

  describe('reporting currency', () => {
    it('falls back to a default before one is chosen', () => {
      expect(rates.reportingCurrency()).toBe(DEFAULT_REPORTING_CURRENCY);
    });

    it('is stored through the ledger, so every device agrees', async () => {
      // Rates are quoted against this currency; two devices disagreeing about
      // it would make every stored rate ambiguous.
      await rates.setReportingCurrency('eur');
      await waitUntil(() => rates.reportingCurrency() === 'EUR');

      expect((await db.vaultSettings.get('vault'))?.reportingCurrency).toBe('EUR');
      expect(await db.oplog.count()).toBe(1);
    });

    it('rejects anything that is not a currency code', async () => {
      for (const code of ['', 'US', 'DOLLARS', '12$']) {
        await expect(rates.setReportingCurrency(code), code).rejects.toThrow(/currency code/);
      }
    });

    it('keeps the original creation time when changed', async () => {
      await rates.setReportingCurrency('EUR');
      const first = await db.vaultSettings.get('vault');

      await rates.setReportingCurrency('GBP');
      expect((await db.vaultSettings.get('vault'))?.createdAt).toBe(first?.createdAt);
    });
  });

  describe('saving a quote', () => {
    it('stores it keyed by pair and day', async () => {
      const saved = await rates.save({ base: 'eur', quote: 'usd', rate: 1.1, date: '2026-03-14' });

      expect(saved.id).toBe('EUR:USD:2026-03-14');
      expect(saved.base).toBe('EUR');
      expect(saved.source).toBe('manual');
    });

    it('replaces a quote for the same day rather than keeping the mistake', async () => {
      await rates.save({ base: 'EUR', quote: 'USD', rate: 1.1, date: '2026-03-14' });
      await rates.save({ base: 'EUR', quote: 'USD', rate: 1.09, date: '2026-03-14' });

      expect(await db.rates.count()).toBe(1);
      expect((await db.rates.get('EUR:USD:2026-03-14'))?.rate).toBe(1.09);
    });

    it('refuses a currency against itself', async () => {
      await expect(
        rates.save({ base: 'USD', quote: 'usd', rate: 1, date: '2026-03-14' }),
      ).rejects.toThrow(/worth one of itself/);
    });

    it('refuses a rate that cannot be one', async () => {
      for (const rate of [0, -1, NaN]) {
        await expect(
          rates.save({ base: 'EUR', quote: 'USD', rate, date: '2026-03-14' }),
          String(rate),
        ).rejects.toThrow(/positive number/);
      }
    });

    it('refuses a malformed date or code', async () => {
      await expect(
        rates.save({ base: 'EUR', quote: 'USD', rate: 1.1, date: '14/03/2026' }),
      ).rejects.toThrow(/YYYY-MM-DD/);
      await expect(
        rates.save({ base: 'EURO', quote: 'USD', rate: 1.1, date: '2026-03-14' }),
      ).rejects.toThrow(/currency code/);
    });
  });

  describe('looking up a rate', () => {
    beforeEach(async () => {
      await db.rates.bulkPut([
        anExchangeRate({ id: 'EUR:USD:2026-03-10', date: '2026-03-10', rate: 1.08 }),
        anExchangeRate({ id: 'EUR:USD:2026-03-14', date: '2026-03-14', rate: 1.1 }),
      ]);
      await waitUntil(() => rates.all().length === 2);
    });

    it('is one for the reporting currency against itself', () => {
      expect(rates.rateToReporting('USD', '2026-03-14')).toBe(1);
    });

    it('finds a direct quote', () => {
      expect(rates.rateToReporting('EUR', '2026-03-14')).toBe(1.1);
    });

    it('carries the last known rate forward', () => {
      expect(rates.rateToReporting('EUR', '2026-03-18')).toBe(1.1);
      expect(rates.rateToReporting('EUR', '2026-03-12')).toBe(1.08);
    });

    it('inverts a quote rather than asking for both directions', async () => {
      // A USD→GBP quote answers a GBP→USD question too.
      await db.rates.put(
        anExchangeRate({ id: 'USD:GBP:2026-03-14', base: 'USD', quote: 'GBP', rate: 0.8 }),
      );
      await waitUntil(() => rates.all().length === 3);

      await rates.setReportingCurrency('GBP');
      await waitUntil(() => rates.reportingCurrency() === 'GBP');

      expect(rates.rateToReporting('USD', '2026-03-14')).toBe(0.8);
      await rates.setReportingCurrency('USD');
      await waitUntil(() => rates.reportingCurrency() === 'USD');
      expect(rates.rateToReporting('GBP', '2026-03-14')).toBeCloseTo(1.25);
    });

    it('reports nothing when the pair is unknown', () => {
      expect(rates.rateToReporting('JPY', '2026-03-14')).toBeNull();
    });

    it('never uses a quote from after the date', () => {
      expect(rates.rateToReporting('EUR', '2026-03-01')).toBeNull();
    });
  });

  describe('the pair list', () => {
    it('shows one row per pair with its newest quote', async () => {
      await db.rates.bulkPut([
        anExchangeRate({ id: 'EUR:USD:2026-03-10', date: '2026-03-10', rate: 1.08 }),
        anExchangeRate({ id: 'EUR:USD:2026-03-14', date: '2026-03-14', rate: 1.1 }),
        anExchangeRate({ id: 'GBP:USD:2026-03-14', base: 'GBP', date: '2026-03-14', rate: 1.27 }),
      ]);
      await waitUntil(() => rates.pairs().length === 2);

      expect(rates.pairs()).toEqual([
        { base: 'EUR', quote: 'USD', rate: 1.1, date: '2026-03-14', count: 2 },
        { base: 'GBP', quote: 'USD', rate: 1.27, date: '2026-03-14', count: 1 },
      ]);
    });

    it('lists the history for one pair', async () => {
      await db.rates.bulkPut([
        anExchangeRate({ id: 'EUR:USD:2026-03-10', date: '2026-03-10', rate: 1.08 }),
        anExchangeRate({ id: 'EUR:USD:2026-03-14', date: '2026-03-14', rate: 1.1 }),
      ]);
      await waitUntil(() => rates.all().length === 2);

      expect(rates.history('EUR', 'USD').map((r) => r.date)).toEqual([
        '2026-03-14',
        '2026-03-10',
      ]);
    });
  });

  it('deletes a quote through the ledger', async () => {
    await rates.save({ base: 'EUR', quote: 'USD', rate: 1.1, date: '2026-03-14' });
    await rates.remove('EUR:USD:2026-03-14');

    expect(await db.rates.get('EUR:USD:2026-03-14')).toBeUndefined();
    expect((await db.oplog.toArray()).map((o) => o.op)).toEqual(['put', 'delete']);
  });
});
