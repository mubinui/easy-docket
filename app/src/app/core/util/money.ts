/**
 * Money handling.
 *
 * Amounts are integers in the currency's minor unit. Storing 12.34 as the
 * number 1234 rather than the float 12.34 removes an entire category of bug
 * from a ledger: sums stay exact, and a balance never drifts by a cent after a
 * few hundred transactions.
 */
import { Minor } from '../models/domain';

/** Currencies whose minor unit is not 1/100. */
const EXPONENTS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
  JOD: 3,
};

export function minorUnitExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Parse user input ("12.34", "1 234,56", "-5") into minor units. */
export function parseAmount(input: string, currency = 'USD'): Minor {
  const exponent = minorUnitExponent(currency);
  const cleaned = input.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) {
    throw new Error(`"${input}" is not a valid amount`);
  }

  const negative = cleaned.startsWith('-');
  const [whole, fraction = ''] = cleaned.replace('-', '').split('.');
  // Pad or truncate the fraction to the currency's precision, so "1.999" in a
  // two-decimal currency becomes 199 rather than silently rounding to 200.
  const scaled = `${whole || '0'}${fraction.padEnd(exponent, '0').slice(0, exponent)}`;
  const value = Number(scaled);
  if (!Number.isSafeInteger(value)) throw new Error(`"${input}" is out of range`);

  return negative ? -value : value;
}

/** Render minor units as a plain decimal string, without a currency symbol. */
export function formatAmount(amount: Minor, currency = 'USD'): string {
  const exponent = minorUnitExponent(currency);
  const negative = amount < 0;
  const digits = String(Math.abs(amount)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent) || '0';
  const fraction = exponent ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Localised, symbol-bearing rendering for display. */
export function formatMoney(amount: Minor, currency = 'USD', locale?: string): string {
  const exponent = minorUnitExponent(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(amount / 10 ** exponent);
  } catch {
    // An unknown or malformed currency code must not blank out the UI.
    return `${formatAmount(amount, currency)} ${currency}`;
  }
}

/** Signed effect of a transaction on a given account's balance. */
export function signedFor(
  accountId: string,
  txn: { kind: string; amount: Minor; accountId: string; counterAccountId: string | null },
): Minor {
  if (txn.kind === 'income') return txn.accountId === accountId ? txn.amount : 0;
  if (txn.kind === 'expense') return txn.accountId === accountId ? -txn.amount : 0;
  // Transfer: leaves the source, arrives at the destination.
  if (txn.accountId === accountId) return -txn.amount;
  if (txn.counterAccountId === accountId) return txn.amount;
  return 0;
}
