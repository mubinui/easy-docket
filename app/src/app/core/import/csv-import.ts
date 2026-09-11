import { Minor, TransactionKind } from '../models/domain';
import { minorUnitExponent } from '../util/money';
import { normaliseHeader } from './csv-parse';

/**
 * Turning a bank's CSV into transactions.
 *
 * The work is done as a *plan* rather than as a write: every row is resolved,
 * checked and classified first, and nothing reaches the ledger until the user
 * has seen what will happen. Importing is the one operation that can add a
 * thousand rows at once, and an import that half-succeeded would be far harder
 * to undo than to prevent.
 */

export interface ColumnMapping {
  date: number;
  amount: number;
  payee: number | null;
  note: number | null;
  category: number | null;
}

export interface ImportOptions {
  accountId: string;
  currency: string;
  /** Interpret ambiguous slash dates as day-first (13/01) rather than month-first. */
  dayFirst: boolean;
  /** Dates and amounts already in the ledger, for spotting repeats. */
  existing?: ReadonlySet<string>;
}

export interface PlannedTransaction {
  date: string;
  amount: Minor;
  kind: TransactionKind;
  payee: string;
  note: string;
  categoryName: string;
}

export interface PlannedRow {
  /** 1-based line in the file, counting the header. */
  line: number;
  transaction?: PlannedTransaction;
  /** Why this row cannot be imported. */
  error?: string;
  /** Already in the ledger, so imported only if the user insists. */
  duplicate?: boolean;
}

export interface ImportPlan {
  rows: PlannedRow[];
  ready: number;
  duplicates: number;
  failed: number;
}

/** Header names worth guessing at, in the order they are preferred. */
const HEADER_HINTS: Record<keyof ColumnMapping, string[]> = {
  date: ['date', 'transactiondate', 'posteddate', 'valuedate', 'when'],
  amount: ['amount', 'value', 'debitcredit', 'sum', 'total'],
  payee: ['payee', 'description', 'details', 'merchant', 'name', 'narrative', 'reference'],
  note: ['note', 'notes', 'memo', 'comment'],
  category: ['category', 'type', 'class'],
};

/**
 * Guess which column is which from the header row.
 *
 * A guess, explicitly: the result is shown to the user to correct, because bank
 * exports label things in ways no list can anticipate and a silently wrong
 * guess is worse than no guess at all.
 */
export function detectColumns(headers: readonly string[]): ColumnMapping {
  const normalised = headers.map(normaliseHeader);

  const find = (hints: string[]): number | null => {
    for (const hint of hints) {
      const exact = normalised.indexOf(hint);
      if (exact !== -1) return exact;
    }
    for (const hint of hints) {
      const partial = normalised.findIndex((header) => header.includes(hint));
      if (partial !== -1) return partial;
    }
    return null;
  };

  return {
    date: find(HEADER_HINTS.date) ?? 0,
    amount: find(HEADER_HINTS.amount) ?? 1,
    payee: find(HEADER_HINTS.payee),
    note: find(HEADER_HINTS.note),
    category: find(HEADER_HINTS.category),
  };
}

/** The key a duplicate is recognised by: same day, same amount, same payee. */
export function duplicateKey(date: string, amount: Minor, payee: string): string {
  return `${date}|${amount}|${payee.trim().toLowerCase()}`;
}

/** Resolve every row without writing anything. */
export function planImport(
  rows: readonly (readonly string[])[],
  mapping: ColumnMapping,
  options: ImportOptions,
): ImportPlan {
  const plan: PlannedRow[] = [];
  const seen = new Set<string>(options.existing ?? []);

  rows.forEach((row, index) => {
    // +2: the header is line 1, and rows are zero-based.
    const line = index + 2;

    const rawDate = row[mapping.date] ?? '';
    const rawAmount = row[mapping.amount] ?? '';
    if (rawDate.trim() === '' && rawAmount.trim() === '') return; // blank line

    const date = parseDate(rawDate, options.dayFirst);
    if (date === null) {
      plan.push({ line, error: `Could not read the date "${rawDate.trim()}"` });
      return;
    }

    const amount = parseAmountCell(rawAmount, options.currency);
    if (amount === null) {
      plan.push({ line, error: `Could not read the amount "${rawAmount.trim()}"` });
      return;
    }
    if (amount === 0) {
      plan.push({ line, error: 'The amount is zero' });
      return;
    }

    const payee = (mapping.payee !== null ? (row[mapping.payee] ?? '') : '').trim();
    const transaction: PlannedTransaction = {
      date,
      // Direction is carried by `kind`, as everywhere else in the ledger.
      amount: Math.abs(amount),
      kind: amount < 0 ? 'expense' : 'income',
      payee,
      note: (mapping.note !== null ? (row[mapping.note] ?? '') : '').trim(),
      categoryName: (mapping.category !== null ? (row[mapping.category] ?? '') : '').trim(),
    };

    const key = duplicateKey(date, transaction.amount, payee);
    const duplicate = seen.has(key);
    seen.add(key);

    plan.push({ line, transaction, duplicate });
  });

  return {
    rows: plan,
    ready: plan.filter((row) => row.transaction && !row.duplicate).length,
    duplicates: plan.filter((row) => row.duplicate).length,
    failed: plan.filter((row) => row.error).length,
  };
}

/**
 * Read a date cell.
 *
 * ISO is taken as written. A slash or dot format is ambiguous — 03/04 is two
 * different days either side of the Atlantic — so the caller states which
 * convention the file uses rather than this guessing and being wrong twice a
 * month.
 */
export function parseDate(value: string, dayFirst: boolean): string | null {
  const text = value.trim();
  if (text === '') return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return assemble(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(text);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    const year = normaliseYear(Number(parts[3]));

    // A value above 12 can only be a day, whichever convention the file uses.
    const day = dayFirst || first > 12 ? first : second;
    const month = dayFirst || first > 12 ? second : first;
    return assemble(year, month, day);
  }

  return null;
}

/**
 * Read an amount cell.
 *
 * Handles what bank exports actually contain: currency symbols, thousands
 * separators, a trailing or leading minus, and accounting parentheses for
 * negatives. Returns minor units, signed.
 */
export function parseAmountCell(value: string, currency: string): Minor | null {
  let text = value.trim();
  if (text === '') return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1);
  }

  // Strip anything that is not part of the number: symbols, codes, spaces.
  text = text.replace(/[^\d,.\-]/g, '').trim();
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  if (text === '') return null;

  const separators = text.replace(/\d/g, '');
  let normalised = text;

  if (separators.includes(',') && separators.includes('.')) {
    // Whichever appears last is the decimal point; the other groups thousands.
    const decimal = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    normalised = text.split(grouping).join('').replace(decimal, '.');
  } else if (separators.includes(',')) {
    // A lone comma is a decimal point when it is followed by one or two digits,
    // and a thousands separator otherwise: "1,50" is one-fifty, "1,500" is not.
    const after = text.length - text.lastIndexOf(',') - 1;
    normalised = after === 3 ? text.split(',').join('') : text.replace(',', '.');
  }

  const parsed = Number(normalised);
  if (!Number.isFinite(parsed)) return null;

  const scaled = Math.round(parsed * 10 ** minorUnitExponent(currency));
  return negative ? -scaled : scaled;
}

function assemble(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject a day the month does not have, rather than rolling into the next.
  if (day > new Date(year, month, 0).getDate()) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normaliseYear(year: number): number {
  if (year >= 100) return year;
  // A two-digit year in a personal ledger is this century until proven otherwise.
  return year + (year <= 68 ? 2000 : 1900);
}
