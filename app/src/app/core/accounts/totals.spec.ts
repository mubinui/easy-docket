import { describe, expect, it } from 'vitest';
import { anAccount } from '../testing/factories';
import { countsInTotals } from './totals';

describe('countsInTotals', () => {
  it('counts an account written before the setting existed', () => {
    // The absent field has to mean "counted", or turning this feature on would
    // silently empty everyone's net worth.
    expect(countsInTotals(anAccount())).toBe(true);
  });

  it('counts an account explicitly included', () => {
    expect(countsInTotals(anAccount({ excludedFromTotals: false }))).toBe(true);
  });

  it('leaves out an account explicitly excluded', () => {
    expect(countsInTotals(anAccount({ excludedFromTotals: true }))).toBe(false);
  });
});
