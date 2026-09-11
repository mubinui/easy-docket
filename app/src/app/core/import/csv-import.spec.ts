import { describe, expect, it } from 'vitest';
import { normaliseHeader, parseCsv } from './csv-parse';
import {
  ColumnMapping,
  detectColumns,
  duplicateKey,
  parseAmountCell,
  parseDate,
  planImport,
} from './csv-import';

describe('parseCsv', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a quoted comma inside its field', () => {
    // The failure this prevents: every column after it shifting by one.
    expect(parseCsv('name,amount\n"Smith, Jones",10')).toEqual([
      ['name', 'amount'],
      ['Smith, Jones', '10'],
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([['a'], ['He said "hi"']]);
  });

  it('allows a quoted field to span lines', () => {
    expect(parseCsv('a,b\n"line one\nline two",2')).toEqual([
      ['a', 'b'],
      ['line one\nline two', '2'],
    ]);
  });

  it('handles CRLF endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not invent a row from a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toHaveLength(2);
  });

  it('treats a stray quote mid-field as data', () => {
    expect(parseCsv(`a\n5" pipe`)).toEqual([['a'], ['5" pipe']]);
  });

  it('strips a byte-order mark from the first header', () => {
    // Otherwise "Date" arrives as "﻿Date" and matches nothing.
    expect(parseCsv('﻿Date,Amount\n2026-01-01,5')[0][0]).toBe('Date');
  });

  it('keeps empty fields', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('reads nothing from nothing', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('normaliseHeader', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(normaliseHeader(' Transaction Date ')).toBe('transactiondate');
    expect(normaliseHeader('Amount (GBP)')).toBe('amountgbp');
  });
});

describe('detectColumns', () => {
  it('finds the obvious names', () => {
    expect(detectColumns(['Date', 'Amount', 'Payee', 'Notes', 'Category'])).toEqual({
      date: 0,
      amount: 1,
      payee: 2,
      note: 3,
      category: 4,
    });
  });

  it('recognises the names banks actually use', () => {
    const mapping = detectColumns(['Posted Date', 'Description', 'Value']);
    expect(mapping.date).toBe(0);
    expect(mapping.payee).toBe(1);
    expect(mapping.amount).toBe(2);
  });

  it('leaves optional columns unmapped rather than guessing wildly', () => {
    const mapping = detectColumns(['Date', 'Amount']);
    expect(mapping.payee).toBeNull();
    expect(mapping.category).toBeNull();
  });

  it('falls back to the first two columns when nothing matches', () => {
    // A guess the user is shown and can correct, not a silent decision.
    expect(detectColumns(['Col1', 'Col2'])).toMatchObject({ date: 0, amount: 1 });
  });
});

describe('parseDate', () => {
  it('takes ISO as written', () => {
    expect(parseDate('2026-03-14', false)).toBe('2026-03-14');
    expect(parseDate('2026-3-4', false)).toBe('2026-03-04');
  });

  it('respects the stated convention for ambiguous dates', () => {
    // 03/04 is two different days either side of the Atlantic.
    expect(parseDate('03/04/2026', true)).toBe('2026-04-03');
    expect(parseDate('03/04/2026', false)).toBe('2026-03-04');
  });

  it('resolves an unambiguous date whichever convention is stated', () => {
    expect(parseDate('25/12/2026', false)).toBe('2026-12-25');
  });

  it('accepts dots and dashes as separators', () => {
    expect(parseDate('14.03.2026', true)).toBe('2026-03-14');
    expect(parseDate('14-03-2026', true)).toBe('2026-03-14');
  });

  it('expands a two-digit year', () => {
    expect(parseDate('14/03/26', true)).toBe('2026-03-14');
    expect(parseDate('14/03/99', true)).toBe('1999-03-14');
  });

  it('rejects a day the month does not have', () => {
    // Rolling into the next month would silently misdate the transaction.
    expect(parseDate('31/02/2026', true)).toBeNull();
    expect(parseDate('2026-02-30', false)).toBeNull();
  });

  it('rejects what it cannot read', () => {
    for (const value of ['', 'yesterday', '14 March', '2026/13/01']) {
      expect(parseDate(value, true), value).toBeNull();
    }
  });
});

describe('parseAmountCell', () => {
  it('reads a plain amount', () => {
    expect(parseAmountCell('45.00', 'USD')).toBe(4_500);
    expect(parseAmountCell('45', 'USD')).toBe(4_500);
  });

  it('keeps the sign', () => {
    expect(parseAmountCell('-45.00', 'USD')).toBe(-4_500);
  });

  it('reads accounting parentheses as negative', () => {
    expect(parseAmountCell('(45.00)', 'USD')).toBe(-4_500);
  });

  it('reads a trailing minus, as some exports write it', () => {
    expect(parseAmountCell('45.00-', 'USD')).toBe(-4_500);
  });

  it('strips currency symbols and codes', () => {
    expect(parseAmountCell('$45.00', 'USD')).toBe(4_500);
    expect(parseAmountCell('45.00 USD', 'USD')).toBe(4_500);
    expect(parseAmountCell('£1,234.56', 'GBP')).toBe(123_456);
  });

  it('handles thousands separators in either convention', () => {
    expect(parseAmountCell('1,234.56', 'USD')).toBe(123_456);
    expect(parseAmountCell('1.234,56', 'EUR')).toBe(123_456);
  });

  it('tells a decimal comma from a thousands comma', () => {
    // "1,50" is one-fifty; "1,500" is fifteen hundred.
    expect(parseAmountCell('1,50', 'EUR')).toBe(150);
    expect(parseAmountCell('1,500', 'EUR')).toBe(150_000);
  });

  it('respects the currency’s minor unit', () => {
    expect(parseAmountCell('1500', 'JPY')).toBe(1_500);
    expect(parseAmountCell('1.234', 'KWD')).toBe(1_234);
  });

  it('rejects what it cannot read', () => {
    for (const value of ['', 'n/a', '--']) {
      expect(parseAmountCell(value, 'USD'), value).toBeNull();
    }
  });
});

describe('planImport', () => {
  const mapping: ColumnMapping = { date: 0, amount: 1, payee: 2, note: null, category: null };
  const options = { accountId: 'acc-1', currency: 'USD', dayFirst: false };

  it('turns rows into transactions', () => {
    const plan = planImport(
      [
        ['2026-01-05', '-25.00', 'Supermarket'],
        ['2026-01-06', '1200.00', 'Salary'],
      ],
      mapping,
      options,
    );

    expect(plan.ready).toBe(2);
    expect(plan.rows[0].transaction).toMatchObject({
      date: '2026-01-05',
      amount: 2_500,
      kind: 'expense',
      payee: 'Supermarket',
    });
    // Direction comes from the sign; the stored amount is positive.
    expect(plan.rows[1].transaction).toMatchObject({ kind: 'income', amount: 120_000 });
  });

  it('reports the line a bad row came from', () => {
    const plan = planImport([['nonsense', '-25.00', 'X']], mapping, options);

    // Line 2: the header is line 1.
    expect(plan.rows[0]).toMatchObject({ line: 2 });
    expect(plan.rows[0].error).toMatch(/Could not read the date/);
    expect(plan.failed).toBe(1);
  });

  it('rejects a zero amount rather than importing a meaningless row', () => {
    const plan = planImport([['2026-01-05', '0.00', 'X']], mapping, options);
    expect(plan.rows[0].error).toMatch(/zero/);
  });

  it('skips blank lines without calling them failures', () => {
    const plan = planImport([['', '', ''], ['2026-01-05', '-5.00', 'X']], mapping, options);

    expect(plan.rows).toHaveLength(1);
    expect(plan.failed).toBe(0);
  });

  it('flags a row already in the ledger', () => {
    const existing = new Set([duplicateKey('2026-01-05', 2_500, 'Supermarket')]);
    const plan = planImport([['2026-01-05', '-25.00', 'Supermarket']], mapping, {
      ...options,
      existing,
    });

    expect(plan.rows[0].duplicate).toBe(true);
    expect(plan.ready).toBe(0);
    expect(plan.duplicates).toBe(1);
  });

  it('flags a repeat within the file itself', () => {
    const plan = planImport(
      [
        ['2026-01-05', '-25.00', 'Supermarket'],
        ['2026-01-05', '-25.00', 'Supermarket'],
      ],
      mapping,
      options,
    );

    expect(plan.ready).toBe(1);
    expect(plan.duplicates).toBe(1);
  });

  it('does not treat a different amount on the same day as a repeat', () => {
    const plan = planImport(
      [
        ['2026-01-05', '-25.00', 'Supermarket'],
        ['2026-01-05', '-12.00', 'Supermarket'],
      ],
      mapping,
      options,
    );

    expect(plan.ready).toBe(2);
    expect(plan.duplicates).toBe(0);
  });

  it('carries optional columns when they are mapped', () => {
    const plan = planImport(
      [['2026-01-05', '-25.00', 'Shop', 'weekly shop', 'Groceries']],
      { date: 0, amount: 1, payee: 2, note: 3, category: 4 },
      options,
    );

    expect(plan.rows[0].transaction).toMatchObject({
      note: 'weekly shop',
      categoryName: 'Groceries',
    });
  });

  it('copes with a file of nothing but failures', () => {
    const plan = planImport([['x', 'y', 'z']], mapping, options);
    expect(plan).toMatchObject({ ready: 0, duplicates: 0, failed: 1 });
  });
});
