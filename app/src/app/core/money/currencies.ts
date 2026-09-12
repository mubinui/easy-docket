/**
 * The currencies offered in the pickers, and the one a new vault starts with.
 *
 * Any three-letter code works throughout the app — this list is what the
 * selects show, not what the ledger accepts.
 */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'BDT',
  'AUD',
  'CAD',
  'JPY',
  'SGD',
  'AED',
] as const;

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
 * it silently, because getting this wrong and finding out later — after a
 * month of transactions — is expensive to undo.
 */
export function guessCurrency(locale?: string): string {
  const tag = locale ?? (typeof navigator === 'undefined' ? undefined : navigator.language);
  if (!tag) return 'USD';

  // `en-BD` and `bn-BD` both mean Bangladesh; the region is what matters.
  const region = tag.split('-').find((part) => /^[A-Z]{2}$/.test(part));
  return (region && BY_REGION[region]) || 'USD';
}
