import { ExchangeRate, Minor, Transaction } from '../models/domain';
import { minorUnitExponent } from '../util/money';

/**
 * Converting between currencies.
 *
 * Two things make this less obvious than multiplying by a rate.
 *
 * Currencies do not share a minor unit. A yen has none, a dinar has three, and
 * most have two, so converting 45.00 USD to JPY is not `4500 × rate` — the
 * scale changes as well as the value. Every conversion goes through major
 * units and back.
 *
 * And a missing rate is not zero. A total that quietly omits the transactions
 * it could not convert is worse than one that says it is incomplete, so
 * conversion returns null rather than guessing, and callers are expected to
 * surface that.
 */

/** The identity a stored quote is keyed by, so the same day cannot be stored twice. */
export function rateId(base: string, quote: string, date: string): string {
  return `${base.toUpperCase()}:${quote.toUpperCase()}:${date}`;
}

/**
 * Convert an amount in minor units of `from` into minor units of `to`.
 *
 * `rate` is units of `to` per one unit of `from`.
 */
export function convert(amount: Minor, rate: number, from: string, to: string): Minor {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Exchange rate must be a positive number, got ${rate}`);
  }
  if (sameCurrency(from, to)) return amount;

  const scale = 10 ** (minorUnitExponent(to) - minorUnitExponent(from));
  // Rounded away from zero at the halfway point, so -0.5 becomes -1 rather
  // than 0: a rounding rule that pulls towards zero would quietly shrink
  // expenses and flatter the ledger.
  return roundHalfAwayFromZero(amount * rate * scale);
}

/**
 * Decimal places kept before the final rounding.
 *
 * Binary floating point cannot hold 1.005 exactly, so `100 × 1.005` evaluates
 * to 100.49999999999999 and an exact half rounds the wrong way. Snapping to
 * nine places first restores the decimal value a person would have computed,
 * and sits far below any precision a currency actually has.
 */
const PRECISION = 1e9;

/** Whether two currency codes mean the same currency. */
export function sameCurrency(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

/**
 * What a transaction is worth in the reporting currency.
 *
 * Uses the rate stored on the transaction — the one that applied when it
 * happened — and returns null when the transaction is in another currency and
 * carries no rate. That case is real: a ledger that predates multi-currency, or
 * a transaction recorded while no rate was known.
 */
export function inReporting(
  transaction: Pick<Transaction, 'amount' | 'currency' | 'rate'>,
  reporting: string,
): Minor | null {
  if (sameCurrency(transaction.currency, reporting)) return transaction.amount;
  if (transaction.rate === undefined) return null;

  return convert(transaction.amount, transaction.rate, transaction.currency, reporting);
}

/**
 * The rate to use for a date: the quote for that day, or the most recent one
 * before it.
 *
 * Carrying the last known rate forward is what a person does with a statement —
 * markets close at weekends, and a Saturday purchase is converted at Friday's
 * rate. A later quote is never used: that would be hindsight.
 */
export function rateFor(
  rates: readonly ExchangeRate[],
  base: string,
  quote: string,
  date: string,
): ExchangeRate | null {
  if (sameCurrency(base, quote)) return null;

  let best: ExchangeRate | null = null;
  for (const candidate of rates) {
    if (!sameCurrency(candidate.base, base) || !sameCurrency(candidate.quote, quote)) continue;
    if (candidate.date > date) continue;
    if (best === null || candidate.date > best.date) best = candidate;
  }
  return best;
}

/**
 * Invert a quote.
 *
 * A user who knows EUR/USD should not have to enter USD/EUR as well; one quote
 * describes the pair in both directions.
 */
export function invertRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Exchange rate must be a positive number, got ${rate}`);
  }
  return 1 / rate;
}

/** Sum amounts that may be in different currencies, reporting what could not be converted. */
export function sumInReporting(
  transactions: readonly Pick<Transaction, 'amount' | 'currency' | 'rate'>[],
  reporting: string,
): { total: Minor; unconverted: number } {
  let total = 0;
  let unconverted = 0;

  for (const transaction of transactions) {
    const converted = inReporting(transaction, reporting);
    if (converted === null) unconverted++;
    else total += converted;
  }
  return { total, unconverted };
}

function roundHalfAwayFromZero(value: number): number {
  const snapped = Math.round(value * PRECISION) / PRECISION;
  return snapped < 0 ? -Math.round(-snapped) : Math.round(snapped);
}
