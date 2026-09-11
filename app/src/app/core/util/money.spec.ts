import { describe, expect, it } from 'vitest';
import { formatAmount, formatMoney, parseAmount, signedFor } from './money';

describe('parseAmount', () => {
  it('parses decimal input into minor units', () => {
    expect(parseAmount('12.34')).toBe(1234);
    expect(parseAmount('0.05')).toBe(5);
    expect(parseAmount('7')).toBe(700);
    expect(parseAmount('-3.50')).toBe(-350);
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseAmount('12,34')).toBe(1234);
  });

  it('ignores spaces used as digit grouping', () => {
    expect(parseAmount('1 234.56')).toBe(123456);
  });

  it('truncates rather than rounds excess precision', () => {
    // Rounding up would invent money the user never typed.
    expect(parseAmount('1.999')).toBe(199);
  });

  it('honours currencies with no minor unit', () => {
    expect(parseAmount('1500', 'JPY')).toBe(1500);
    expect(parseAmount('1500.75', 'JPY')).toBe(1500);
  });

  it('honours three-decimal currencies', () => {
    expect(parseAmount('1.234', 'KWD')).toBe(1234);
  });

  it('rejects input that is not a number', () => {
    for (const input of ['', 'abc', '1.2.3', '$5', '1e5']) {
      expect(() => parseAmount(input), input).toThrow();
    }
  });
});

describe('formatAmount', () => {
  it('renders minor units back to a decimal string', () => {
    expect(formatAmount(1234)).toBe('12.34');
    expect(formatAmount(5)).toBe('0.05');
    expect(formatAmount(0)).toBe('0.00');
    expect(formatAmount(-350)).toBe('-3.50');
    expect(formatAmount(1500, 'JPY')).toBe('1500');
  });

  it('round-trips with parseAmount', () => {
    for (const value of [0, 1, 99, 100, 123456, -4200]) {
      expect(parseAmount(formatAmount(value))).toBe(value);
    }
  });
});

describe('formatMoney', () => {
  it('renders a localised, symbol-bearing string', () => {
    expect(formatMoney(123456, 'USD', 'en-US')).toBe('$1,234.56');
  });

  it('falls back rather than throwing on an unknown currency', () => {
    expect(formatMoney(1234, 'XYZZY', 'en-US')).toContain('XYZZY');
  });
});

describe('signedFor', () => {
  const base = { amount: 1000, accountId: 'a', counterAccountId: null as string | null };

  it('adds income and subtracts expense', () => {
    expect(signedFor('a', { ...base, kind: 'income' })).toBe(1000);
    expect(signedFor('a', { ...base, kind: 'expense' })).toBe(-1000);
  });

  it('moves money between both sides of a transfer', () => {
    const transfer = { ...base, kind: 'transfer', counterAccountId: 'b' };
    expect(signedFor('a', transfer)).toBe(-1000);
    expect(signedFor('b', transfer)).toBe(1000);
    // A transfer nets to zero across the whole ledger.
    expect(signedFor('a', transfer) + signedFor('b', transfer)).toBe(0);
  });

  it('ignores transactions belonging to other accounts', () => {
    expect(signedFor('z', { ...base, kind: 'expense' })).toBe(0);
  });
});
