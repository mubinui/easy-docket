/**
 * CSV serialisation.
 *
 * Exported ledger data goes into other people's spreadsheets, so the escaping
 * has to be right rather than nearly right. A payee containing a comma, a note
 * containing a quote, or an address spanning two lines must all survive the
 * round trip — otherwise a single transaction silently shifts every column
 * after it, and the user finds out months later.
 *
 * RFC 4180: fields containing a comma, a double quote or a line break are
 * wrapped in double quotes, and a literal quote inside is doubled.
 */

export type CsvValue = string | number | null | undefined;

export interface CsvTable {
  headers: string[];
  rows: CsvValue[][];
}

/** Quote a single field if, and only if, it needs it. */
export function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return '';

  const text = String(value);
  // A leading separator-like character can be interpreted as a formula by
  // spreadsheet software. Prefixing a quote is the conventional defence and is
  // invisible once the cell is read as text.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  if (!/[",\r\n]/.test(guarded)) return guarded;
  return `"${guarded.split('"').join('""')}"`;
}

/** Serialise a table. Lines are CRLF-terminated, as the spec requires. */
export function toCsv(table: CsvTable): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map(escapeField).join(','));
  return lines.join('\r\n');
}

/** A filename that sorts chronologically and is safe on every filesystem. */
export function csvFilename(prefix: string, range: { from: string; to: string }): string {
  const safe = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${safe}-${range.from}-to-${range.to}.csv`;
}
