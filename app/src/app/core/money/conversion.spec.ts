import { describe, expect, it } from 'vitest';
import { ExchangeRate } from '../models/domain';
import {
  convert,
  inReporting,
  invertRate,
  rateFor,
  rateId,
  sameCurrency,
  sumInReporting,
} from './conversion';

function aRate(overrides: Partial<ExchangeRate> = {}): ExchangeRate {
  return {
    id: rateId('EUR', 'USD', '2026-03-14'),
    base: 'EUR',
    quote: 'USD',
    rate: 1.1,
    date: '2026-03-14',
    source: 'manual',
    createdAt: 1_700_000_000_000,
    updatedAt: '',
    ...overrides,
  };
}

describe('rateId', () => {
  it('keys a quote by pair and day', () => {
    expect(rateId('eur', 'usd', '2026-03-14')).toBe('EUR:USD:2026-03-14');
  });
});

describe('sameCurrency', () => {
  it('ignores case', () => {
    expect(sameCurrency('usd', 'USD')).toBe(true);
    expect(sameCurrency('USD', 'EUR')).toBe(false);
  });
});

describe('convert', () => {
  it('applies the rate', () => {
    // €45.00 at 1.10 is $49.50.
    expect(convert(4_500, 1.1, 'EUR', 'USD')).toBe(4_950);
  });

  it('is the identity for the same currency, rate or not', () => {
    expect(convert(4_500, 999, 'USD', 'usd')).toBe(4_500);
  });

  it('rescales between currencies with different minor units', () => {
    // A yen has no minor unit: $45.00 at 150 yen to the dollar is ¥6,750,
    // which is 6750 minor units, not 675,000.
    expect(convert(4_500, 150, 'USD', 'JPY')).toBe(6_750);
    // And back again.
    expect(convert(6_750, 1 / 150, 'JPY', 'USD')).toBe(4_500);
  });

  it('handles a three-decimal currency', () => {
    // 10.000 KWD at 3.26 is 32.60 USD.
    expect(convert(10_000, 3.26, 'KWD', 'USD')).toBe(3_260);
  });

  it('rounds away from zero at the halfway point', () => {
    // 1.00 at 1.005 is 1.005, exactly between two cents. Rounding towards zero
    // would quietly shrink every expense that landed on a half.
    //
    // This also pins the floating-point defence: 100 × 1.005 evaluates to
    // 100.49999999999999 in binary, so without snapping the decimal value
    // first the exact half rounds the wrong way.
    expect(convert(100, 1.005, 'USD', 'EUR')).toBe(101);
    expect(convert(-100, 1.005, 'USD', 'EUR')).toBe(-101);
  });

  it('is not thrown off by rates that binary cannot hold exactly', () => {
    expect(convert(10_000, 1.1, 'EUR', 'USD')).toBe(11_000);
    expect(convert(3_300, 0.07, 'USD', 'EUR')).toBe(231);
    expect(convert(1, 2.675, 'USD', 'EUR')).toBe(3);
  });

  it('keeps the sign', () => {
    expect(convert(-4_500, 1.1, 'EUR', 'USD')).toBe(-4_950);
  });

  it('refuses a rate that cannot be one', () => {
    for (const rate of [0, -1, NaN, Infinity]) {
      expect(() => convert(100, rate, 'EUR', 'USD'), String(rate)).toThrow(/positive number/);
    }
  });
});

describe('inReporting', () => {
  it('passes through a transaction already in the reporting currency', () => {
    expect(inReporting({ amount: 4_500, currency: 'USD' }, 'USD')).toBe(4_500);
  });

  it('uses the rate the transaction carries', () => {
    expect(inReporting({ amount: 4_500, currency: 'EUR', rate: 1.1 }, 'USD')).toBe(4_950);
  });

  it('reports nothing rather than guessing when there is no rate', () => {
    // A total that silently omits what it could not convert is worse than one
    // that admits it is incomplete.
    expect(inReporting({ amount: 4_500, currency: 'EUR' }, 'USD')).toBeNull();
  });

  it('ignores a stored rate when no conversion is needed', () => {
    expect(inReporting({ amount: 4_500, currency: 'USD', rate: 99 }, 'USD')).toBe(4_500);
  });
});

describe('rateFor', () => {
  const rates = [
    aRate({ date: '2026-03-10', rate: 1.08 }),
    aRate({ date: '2026-03-14', rate: 1.1 }),
    aRate({ date: '2026-03-20', rate: 1.12 }),
    aRate({ base: 'GBP', date: '2026-03-14', rate: 1.27 }),
  ];

  it('finds the quote for the day', () => {
    expect(rateFor(rates, 'EUR', 'USD', '2026-03-14')?.rate).toBe(1.1);
  });

  it('carries the last known rate forward', () => {
    // Markets close at weekends; a Saturday purchase uses Friday's rate.
    expect(rateFor(rates, 'EUR', 'USD', '2026-03-16')?.rate).toBe(1.1);
  });

  it('never uses a later quote, which would be hindsight', () => {
    expect(rateFor(rates, 'EUR', 'USD', '2026-03-12')?.rate).toBe(1.08);
    expect(rateFor(rates, 'EUR', 'USD', '2026-03-01')).toBeNull();
  });

  it('keeps pairs apart', () => {
    expect(rateFor(rates, 'GBP', 'USD', '2026-03-20')?.rate).toBe(1.27);
  });

  it('has nothing to say about a currency against itself', () => {
    expect(rateFor(rates, 'USD', 'USD', '2026-03-14')).toBeNull();
  });

  it('reports nothing for a pair it has never seen', () => {
    expect(rateFor(rates, 'JPY', 'USD', '2026-03-14')).toBeNull();
  });
});

describe('invertRate', () => {
  it('describes the pair in the other direction', () => {
    expect(invertRate(1.25)).toBe(0.8);
  });

  it('refuses a rate that cannot be one', () => {
    expect(() => invertRate(0)).toThrow(/positive number/);
  });
});

describe('sumInReporting', () => {
  it('adds converted amounts', () => {
    const { total, unconverted } = sumInReporting(
      [
        { amount: 1_000, currency: 'USD' },
        { amount: 4_500, currency: 'EUR', rate: 1.1 },
      ],
      'USD',
    );

    expect(total).toBe(5_950);
    expect(unconverted).toBe(0);
  });

  it('counts what it could not convert instead of dropping it silently', () => {
    const { total, unconverted } = sumInReporting(
      [
        { amount: 1_000, currency: 'USD' },
        { amount: 4_500, currency: 'EUR' },
      ],
      'USD',
    );

    expect(total).toBe(1_000);
    expect(unconverted).toBe(1);
  });

  it('is zero for nothing at all', () => {
    expect(sumInReporting([], 'USD')).toEqual({ total: 0, unconverted: 0 });
  });
});
