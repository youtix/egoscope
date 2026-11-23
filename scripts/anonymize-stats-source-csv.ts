/**
 * The CSV of the anonymizer of the statistics-source fixtures
 * (anonymize-stats-source-fixtures.ts): how it reads and writes the release files.
 */

/** A row of a file, read by column name. */
export type Row = (column: string) => string;

/** A CSV file: its header and its rows of fields. */
export type Table = Readonly<{ header: readonly string[]; rows: readonly (readonly string[])[] }>;

const QUOTE = '"';
const NEWLINE = '\n';
const SPECIAL = /[",\n]/gu;
const NEEDS_QUOTES = /[",\n\r]/u;

/**
 * Splits CSV text into rows of fields: a quoted field may hold separators, line
 * breaks and doubled quotes (RFC 4180).
 */
class CsvSplitter {
  readonly #rows: string[][] = [];
  #row: string[] = [];
  #field = '';
  #isQuoted = false;
  /** The last character read closed a quoted field, so a quote now is a doubled one. */
  #hasClosed = false;

  /** Reads `before`, then the special character `char`. */
  #take(char: string, before: string): void {
    const hasClosed = before === '' && this.#hasClosed;
    this.#hasClosed = false;
    this.#field += before;
    if (char === QUOTE || this.#isQuoted) {
      this.#quote(char, hasClosed);
      return;
    }
    this.#row.push(this.#field);
    this.#field = '';
    if (char !== NEWLINE) {
      return;
    }
    this.#rows.push(this.#row);
    this.#row = [];
  }

  /** Reads a quote, or a separator or line break inside a quoted field. */
  #quote(char: string, hasClosed: boolean): void {
    if (!this.#isQuoted) {
      this.#field += hasClosed ? QUOTE : '';
      this.#isQuoted = true;
    } else if (char === QUOTE) {
      this.#isQuoted = false;
      this.#hasClosed = true;
    } else {
      this.#field += char;
    }
  }

  /** The rows of `text`, the last one included when no line break ends it. */
  split(text: string): string[][] {
    let start = 0;
    const special = new RegExp(SPECIAL);
    for (let match = special.exec(text); match !== null; match = special.exec(text)) {
      this.#take(match[0], text.slice(start, match.index));
      start = match.index + 1;
    }
    this.#field += text.slice(start);
    const isLastRowOpen = this.#row.length > 0 || this.#field !== '';
    return isLastRowOpen ? [...this.#rows, [...this.#row, this.#field]] : this.#rows;
  }
}

/** Splits a whole CSV text into rows of fields (RFC 4180). */
export const parseCsv = (text: string): string[][] => new CsvSplitter().split(text);

/** A field as CSV writes it, quoted only when it needs it. */
const written = (field: string): string =>
  NEEDS_QUOTES.test(field) ? `"${field.replaceAll(QUOTE, '""')}"` : field;

/** Writes rows of fields as CSV, quoting only the fields that need it. */
export function writeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((fields) => `${fields.map((field) => written(field)).join(',')}\n`).join('');
}

/** A reader of a row's fields by the columns of `header`. */
export function readerOf(header: readonly string[]): (fields: readonly string[]) => Row {
  const places = new Map(header.map((column, place) => [column, place]));
  return (fields) => (column) => fields[places.get(column) ?? fields.length] ?? '';
}
