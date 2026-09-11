import { describe, expect, it } from 'vitest';
import { csvFilename, escapeField, toCsv } from './csv';

describe('escapeField', () => {
  it('leaves an ordinary value alone', () => {
    expect(escapeField('Corner Shop')).toBe('Corner Shop');
    expect(escapeField(1234)).toBe('1234');
  });

  it('renders nothing for an absent value', () => {
    expect(escapeField(null)).toBe('');
    expect(escapeField(undefined)).toBe('');
    expect(escapeField('')).toBe('');
  });

  it('quotes a value containing a comma', () => {
    // Without this, every column after it shifts by one.
    expect(escapeField('Smith, Jones & Co')).toBe('"Smith, Jones & Co"');
  });

  it('doubles an embedded quote', () => {
    expect(escapeField('The "Old" Bakery')).toBe('"The ""Old"" Bakery"');
  });

  it('quotes a value spanning lines', () => {
    expect(escapeField('Line one\nLine two')).toBe('"Line one\nLine two"');
    expect(escapeField('Line one\r\nLine two')).toBe('"Line one\r\nLine two"');
  });

  it('neutralises anything a spreadsheet would read as a formula', () => {
    // A note beginning "=" would otherwise execute on open.
    expect(escapeField('=1+1')).toBe("'=1+1");
    expect(escapeField('+44 7700 900000')).toBe("'+44 7700 900000");
    expect(escapeField('-50')).toBe("'-50");
    expect(escapeField('@handle')).toBe("'@handle");
  });

  it('quotes a guarded value that also contains a comma', () => {
    expect(escapeField('=SUM(A1,A2)')).toBe('"\'=SUM(A1,A2)"');
  });
});

describe('toCsv', () => {
  it('writes a header row followed by the data', () => {
    const csv = toCsv({
      headers: ['Date', 'Payee', 'Amount'],
      rows: [['2026-01-15', 'Corner Shop', '12.34']],
    });

    expect(csv).toBe('Date,Payee,Amount\r\n2026-01-15,Corner Shop,12.34');
  });

  it('terminates lines with CRLF, as the format requires', () => {
    const csv = toCsv({ headers: ['A'], rows: [['1'], ['2']] });
    expect(csv.split('\r\n')).toEqual(['A', '1', '2']);
  });

  it('writes a header alone when there is nothing to report', () => {
    expect(toCsv({ headers: ['Date', 'Amount'], rows: [] })).toBe('Date,Amount');
  });

  it('survives a row full of awkward values', () => {
    const csv = toCsv({
      headers: ['Payee', 'Note'],
      rows: [['Smith, Jones', 'He said "hello"\nthen left']],
    });

    expect(csv).toBe('Payee,Note\r\n"Smith, Jones","He said ""hello""\nthen left"');
  });
});

describe('csvFilename', () => {
  it('builds a name that sorts by date', () => {
    expect(csvFilename('Transactions', { from: '2026-01-01', to: '2026-03-31' })).toBe(
      'transactions-2026-01-01-to-2026-03-31.csv',
    );
  });

  it('strips anything a filesystem might object to', () => {
    expect(csvFilename('Where it went!', { from: '2026-01-01', to: '2026-01-31' })).toBe(
      'where-it-went-2026-01-01-to-2026-01-31.csv',
    );
  });
});
