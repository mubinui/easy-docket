import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { invertRate, rateFor, rateId, sameCurrency } from '../money/conversion';
import { ExchangeRate } from '../models/domain';
import { toIsoDate } from '../util/dates';
import { LedgerService } from './ledger.service';

/** The currency used when a vault has never set one. */
export const DEFAULT_REPORTING_CURRENCY = 'USD';

export interface RateDraft {
  base: string;
  quote: string;
  rate: number;
  date: string;
  source?: ExchangeRate['source'];
}

/** The newest quote held for a pair, for the rates list. */
export interface PairSummary {
  base: string;
  quote: string;
  rate: number;
  date: string;
  /** How many quotes are held for this pair in total. */
  count: number;
}

@Injectable({ providedIn: 'root' })
export class RatesService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly ledger = inject(LedgerService);

  readonly all = toSignal(
    from(liveQuery(() => this.db.rates.orderBy('date').reverse().toArray())),
    { initialValue: [] as ExchangeRate[] },
  );

  private readonly settings = toSignal(
    from(liveQuery(() => this.db.vaultSettings.get('vault'))),
    { initialValue: undefined },
  );

  /**
   * The currency totals are expressed in.
   *
   * Vault-wide rather than per-device: rates are stored on transactions as
   * units of *this* currency, so two devices disagreeing about it would make
   * every stored rate ambiguous.
   */
  readonly reportingCurrency = computed(
    () => this.settings()?.reportingCurrency ?? DEFAULT_REPORTING_CURRENCY,
  );

  /** One row per pair, newest quote first — what the rates screen lists. */
  readonly pairs = computed<PairSummary[]>(() => {
    const newest = new Map<string, PairSummary>();

    for (const rate of this.all()) {
      const key = `${rate.base}:${rate.quote}`;
      const existing = newest.get(key);

      if (!existing) {
        // Built explicitly rather than spread: a summary is the four fields the
        // list shows, not a rate row wearing an extra property.
        newest.set(key, {
          base: rate.base,
          quote: rate.quote,
          rate: rate.rate,
          date: rate.date,
          count: 1,
        });
      } else {
        existing.count++;
        if (rate.date > existing.date) {
          existing.rate = rate.rate;
          existing.date = rate.date;
        }
      }
    }

    return [...newest.values()].sort(
      (a, b) => a.base.localeCompare(b.base) || a.quote.localeCompare(b.quote),
    );
  });

  /** The rate to use for a pair on a date, carrying the last known one forward. */
  lookup(base: string, quote: string, date = toIsoDate()): ExchangeRate | null {
    return rateFor(this.all(), base, quote, date);
  }

  /** The rate to use against the reporting currency, as a plain number. */
  rateToReporting(base: string, date = toIsoDate()): number | null {
    const reporting = this.reportingCurrency();
    if (sameCurrency(base, reporting)) return 1;

    const direct = this.lookup(base, reporting, date);
    if (direct) return direct.rate;

    // One quote describes a pair in both directions, so a USD→EUR rate answers
    // a EUR→USD question too. Asking the user to enter both would be busywork.
    const reverse = this.lookup(reporting, base, date);
    return reverse ? invertRate(reverse.rate) : null;
  }

  async setReportingCurrency(currency: string): Promise<void> {
    const code = currency.trim().toUpperCase();
    assertCurrency(code);

    const existing = await this.db.vaultSettings.get('vault');
    await this.ledger.put('vaultSettings', {
      id: 'vault',
      reportingCurrency: code,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: '',
    });
  }

  /**
   * Store a quote. Re-entering the same pair and day replaces it, since a day
   * has one rate and a correction should not leave the mistake behind.
   */
  async save(draft: RateDraft): Promise<ExchangeRate> {
    const base = draft.base.trim().toUpperCase();
    const quote = draft.quote.trim().toUpperCase();

    assertCurrency(base);
    assertCurrency(quote);
    if (sameCurrency(base, quote)) {
      throw new Error('A currency is always worth one of itself');
    }
    if (!Number.isFinite(draft.rate) || draft.rate <= 0) {
      throw new Error('The rate must be a positive number');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
      throw new Error('Date must be YYYY-MM-DD');
    }

    const id = rateId(base, quote, draft.date);
    const existing = await this.db.rates.get(id);

    return this.ledger.put('rates', {
      id,
      base,
      quote,
      rate: draft.rate,
      date: draft.date,
      source: draft.source ?? 'manual',
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: '',
    });
  }

  async remove(id: string): Promise<void> {
    await this.ledger.remove('rates', id);
  }

  /** Every quote held for one pair, newest first. */
  history(base: string, quote: string): ExchangeRate[] {
    return this.all().filter(
      (rate) => sameCurrency(rate.base, base) && sameCurrency(rate.quote, quote),
    );
  }
}

function assertCurrency(code: string): void {
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`"${code}" is not a three-letter currency code`);
  }
}
