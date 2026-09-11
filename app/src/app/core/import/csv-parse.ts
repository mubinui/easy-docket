/**
 * A CSV reader.
 *
 * Written rather than taken from a library because the input is a file the user
 * chose, from a bank whose export conventions nobody controls, and the failure
 * mode of getting it subtly wrong is a ledger full of shifted columns. RFC 4180
 * is small enough to implement exactly: fields may be quoted, a quote inside a
 * quoted field is doubled, and a quoted field may span lines.
 */

/** Rows of fields, with blank trailing lines dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  // A byte-order mark survives many exports and would otherwise become part of
  // the first header, so "Date" arrives as "﻿Date" and matches nothing.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = '';
    started = false;
  };
  const endRow = () => {
    endField();
    // A trailing newline should not invent an empty final row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      // A doubled quote is a literal one; a single quote ends the field.
      if (input[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    switch (char) {
      case '"':
        // Only opens a quoted field at the start of one; a stray quote
        // mid-field is data, which is what a naive splitter gets wrong.
        if (!started && field === '') quoted = true;
        else field += char;
        started = true;
        break;
      case ',':
        endField();
        break;
      case '\r':
        if (input[i + 1] === '\n') i++;
        endRow();
        break;
      case '\n':
        endRow();
        break;
      default:
        field += char;
        started = true;
    }
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Header names normalised for matching: lower case, letters and digits only. */
export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}
