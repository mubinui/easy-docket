import { describe, expect, it } from 'vitest';
import { COMMON_CURRENCIES, guessCurrency } from './currencies';

describe('guessCurrency', () => {
  it('reads the region, not the language', () => {
    // `en-BD` and `bn-BD` are the same country with different languages.
    expect(guessCurrency('en-BD')).toBe('BDT');
    expect(guessCurrency('bn-BD')).toBe('BDT');
  });

  it('knows a few of the places people are', () => {
    expect(guessCurrency('en-GB')).toBe('GBP');
    expect(guessCurrency('en-US')).toBe('USD');
    expect(guessCurrency('hi-IN')).toBe('INR');
    expect(guessCurrency('de-DE')).toBe('EUR');
  });

  it('handles a tag with a script in the middle', () => {
    expect(guessCurrency('zh-Hant-SG')).toBe('SGD');
  });

  it('falls back to dollars for a region it does not know', () => {
    // A wrong guess someone corrects is better than a long table nobody
    // maintains.
    expect(guessCurrency('en-ZW')).toBe('USD');
  });

  it('falls back when there is no region at all', () => {
    expect(guessCurrency('en')).toBe('USD');
    expect(guessCurrency('')).toBe('USD');
  });

  it('only ever guesses something the pickers offer', () => {
    for (const tag of ['en-BD', 'en-GB', 'hi-IN', 'de-DE', 'ja-JP', 'en-ZW', 'en']) {
      expect(COMMON_CURRENCIES).toContain(guessCurrency(tag));
    }
  });
});
