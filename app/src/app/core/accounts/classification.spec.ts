import { describe, expect, it } from 'vitest';
import { anAccount, anAccountGroup } from '../testing/factories';
import { readsAsOwed, sideOf, sideOfType } from './classification';

describe('sideOfType', () => {
  it('counts a credit card and a loan as money owed', () => {
    expect(sideOfType('credit-card')).toBe('liability');
    expect(sideOfType('loan')).toBe('liability');
  });

  it('counts everything else as money held', () => {
    expect(sideOfType('default')).toBe('asset');
    // A debit card draws on money already held, so it is not a debt.
    expect(sideOfType('debit-card')).toBe('asset');
  });
});

describe('sideOf', () => {
  it('takes the side from the account\'s group', () => {
    expect(sideOf(anAccount(), anAccountGroup({ type: 'loan' }))).toBe('liability');
    expect(sideOf(anAccount(), anAccountGroup({ type: 'default' }))).toBe('asset');
  });

  it('treats an ungrouped account as an asset', () => {
    expect(sideOf(anAccount(), null)).toBe('asset');
    expect(sideOf(anAccount(), undefined)).toBe('asset');
  });

  it('does not classify by balance', () => {
    // An overdrawn current account is an asset that happens to be negative; it
    // does not become a loan. A cleared credit card is still a liability.
    expect(sideOf(anAccount({ openingBalance: -500_00 }), anAccountGroup({ type: 'default' }))).toBe(
      'asset',
    );
    expect(sideOf(anAccount({ openingBalance: 0 }), anAccountGroup({ type: 'credit-card' }))).toBe(
      'liability',
    );
  });

  it('ignores the account kind', () => {
    // `kind` is presentation; the group decides.
    expect(sideOf(anAccount({ kind: 'card' }), null)).toBe('asset');
    expect(sideOf(anAccount({ kind: 'bank' }), anAccountGroup({ type: 'loan' }))).toBe('liability');
  });
});

describe('readsAsOwed', () => {
  it('is exactly the liabilities, so the two can never disagree', () => {
    for (const type of ['default', 'credit-card', 'debit-card', 'loan'] as const) {
      expect(readsAsOwed(type)).toBe(sideOfType(type) === 'liability');
    }
  });
});
