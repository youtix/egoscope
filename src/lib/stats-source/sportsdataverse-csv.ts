// The CSV reading of the SportsDataverse release files (statistics-source evaluation,
// sections 10 and 12): the splitter that reads a file chunk by chunk, so that no file
// is ever held whole in memory, and the reader that checks the columns a file must
// hold before it hands each row to the sink of that file.

/** A row of a file, read by column name. */
export type RowReader = (column: string) => string;

/**
 * What reads one file, row by row: the columns it needs, each row, which `add`
 * refuses when it cannot read it, and the result once every row has come.
 */
export type RowSink<T> = Readonly<{
  columns: readonly string[];
  add: (row: RowReader) => boolean;
  finish: () => T;
}>;

const QUOTE = '"';
const NEWLINE = '\n';
const SPECIAL = /[",\n]/gu;

/**
 * Splits CSV text, given chunk by chunk, into rows of fields: a quoted field may
 * hold separators, line breaks and doubled quotes (RFC 4180). Only the row in
 * progress is kept between chunks, so a file of any size streams through.
 */
export class CsvSplitter {
  #row: string[] = [];
  #field = '';
  #isQuoted = false;
  /** The last character read closed a quoted field, so a quote now is a doubled one. */
  #hasClosed = false;

  /** Reads `before`, then the special character `char`; true when it ends a row. */
  #take(char: string, before: string): boolean {
    const hasClosed = before === '' && this.#hasClosed;
    this.#hasClosed = false;
    this.#field += before;
    if (char === QUOTE || this.#isQuoted) {
      this.#quote(char, hasClosed);
      return false;
    }
    this.#row.push(this.#field);
    this.#field = '';
    return char === NEWLINE;
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

  /** The rows that `text` completes. */
  push(text: string): string[][] {
    const rows: string[][] = [];
    let start = 0;
    const special = new RegExp(SPECIAL);
    for (let match = special.exec(text); match !== null; match = special.exec(text)) {
      const end = match.index;
      if (this.#take(match[0], text.slice(start, end))) {
        rows.push(this.#row);
        this.#row = [];
      }
      start = end + 1;
    }
    this.#field += text.slice(start);
    this.#hasClosed &&= start === text.length;
    return rows;
  }

  /** The last row, when the file does not end with a line break. */
  end(): string[][] {
    if (this.#row.length === 0 && this.#field === '') {
      return [];
    }
    this.#row.push(this.#field);
    return [this.#row];
  }
}

/**
 * Feeds a sink the rows of a CSV file given chunk by chunk, once its header has
 * named every column the sink needs: a missing or renamed column, a row of another
 * width or a row the sink refuses makes the file unreadable (evaluation, section 10,
 * rule 11).
 */
export class CsvReader<T> {
  readonly #splitter = new CsvSplitter();
  readonly #sink: RowSink<T>;
  #places: ReadonlyMap<string, number> | null = null;
  #width = 0;
  #isReadable = true;

  /** A reader that feeds `sink`. */
  constructor(sink: RowSink<T>) {
    this.#sink = sink;
  }

  /** Reads each row while the file stays readable. */
  #feed(rows: readonly string[][]): boolean {
    for (const fields of rows) {
      this.#isReadable &&= this.#read(fields);
    }
    return this.#isReadable;
  }

  /** Reads the header, then each row of its width. */
  #read(fields: readonly string[]): boolean {
    const places = this.#places;
    if (places === null) {
      const header = new Map(fields.map((column, place) => [column, place]));
      this.#places = header;
      this.#width = fields.length;
      return this.#sink.columns.every((column) => header.has(column));
    }
    // The sink reads only the columns that the header was found to hold.
    return (
      fields.length === this.#width &&
      this.#sink.add((column) => fields[places.get(column) ?? this.#width] ?? '')
    );
  }

  /** Reads the rows that `text` completes; false once the file is unreadable. */
  push(text: string): boolean {
    return this.#feed(this.#splitter.push(text));
  }

  /** The sink's result, or nothing for an unreadable file. */
  end(): T | undefined {
    return this.#feed(this.#splitter.end()) && this.#places !== null
      ? this.#sink.finish()
      : undefined;
  }
}
