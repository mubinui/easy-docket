/**
 * The currencies offered in the pickers, and the one a new vault starts with.
 *
 * Any three-letter code works throughout the app; this list is what the
 * pickers show, not what the ledger accepts.
 */
export interface CurrencyInfo {
  readonly code: string;
  readonly symbol: string;
  readonly name: string;
}

/**
 * The offered set, with the symbol and name the picker shows beside each code.
 *
 * Written out rather than read from `Intl` so the picker reads the same on
 * every device: `Intl` spells these differently per locale, and a list that
 * reorders or renames itself depending on the browser is not a list anyone can
 * learn the shape of.
 */
export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'Pound Sterling' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
];

export const COMMON_CURRENCIES: readonly string[] = CURRENCIES.map((entry) => entry.code);

const BY_CODE = new Map(CURRENCIES.map((entry) => [entry.code, entry]));

/**
 * The symbol and name to show for a code.
 *
 * Codes from outside the offered set reach this: the rates screen lists every
 * currency the vault's accounts are held in, which is whatever was typed. Those
 * fall back to `Intl`, and then to the bare code, so an unrecognised currency
 * renders as itself rather than as a blank tile.
 */
export function currencyInfo(code: string): CurrencyInfo {
  const normalised = code.toUpperCase();
  const known = BY_CODE.get(normalised);
  if (known) return known;

  return { code: normalised, symbol: symbolFor(normalised), name: nameFor(normalised) };
}

function symbolFor(code: string): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

function nameFor(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? '';
  } catch {
    return '';
  }
}

/**
 * Where a region's money is guessed from, for the initial suggestion only.
 *
 * Deliberately short. There is no standard API from a locale to a currency, and
 * a wrong guess someone has to correct is a smaller annoyance than a long table
 * nobody maintains. Everything here is a currency the pickers already offer.
 */
const BY_REGION: Record<string, string> = {
  BD: 'BDT',
  IN: 'INR',
  GB: 'GBP',
  US: 'USD',
  AU: 'AUD',
  CA: 'CAD',
  JP: 'JPY',
  SG: 'SGD',
  AE: 'AED',
  // The euro area members most likely to show up.
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  AT: 'EUR',
  BE: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
};

/**
 * A first guess at the currency this device's owner thinks in.
 *
 * Only a suggestion: the vault screen shows it as a choice rather than applying
 * it silently, because getting this wrong and finding out later, after a month
 * of transactions, is expensive to undo.
 */
export function guessCurrency(locale?: string): string {
  const tag = locale ?? (typeof navigator === 'undefined' ? undefined : navigator.language);
  if (!tag) return 'USD';

  // `en-BD` and `bn-BD` both mean Bangladesh; the region is what matters.
  const region = tag.split('-').find((part) => /^[A-Z]{2}$/.test(part));
  return (region && BY_REGION[region]) || 'USD';
}
