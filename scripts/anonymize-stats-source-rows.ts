/**
 * The rows of the anonymizer of the statistics-source fixtures
 * (anonymize-stats-source-fixtures.ts): how it reads and writes CSV, and how it
 * rewrites every row by the rules of the statistics-source evaluation, section 13.
 * Every player gets an invented id and an invented name, the same in every file;
 * the other providers' ids of the crosswalk are remapped; the personal and free-text
 * columns are blanked; no column is ever removed.
 */
import { createHash } from 'node:crypto';

/** A row of a file, read by column name. */
export type Row = (column: string) => string;

/** A CSV file: its header and its rows of fields. */
export type Table = Readonly<{ header: readonly string[]; rows: readonly (readonly string[])[] }>;

/** An invented player. */
type Person = Readonly<{ id: string; first: string; last: string }>;

/** How one column is rewritten, from its value and its original row. */
type Rewrite = (value: string, row: Row) => string;

/** A provider of the crosswalk whose ids are remapped. */
type Provider = 'nba_player_id' | 'fox_athlete_id' | 'yahoo_player_id';

const QUOTE = '"';
const NEWLINE = '\n';
const SPECIAL = /[",\n]/gu;
const NEEDS_QUOTES = /[",\n\r]/u;
const BIRTH_YEAR = /^(?<year>\d{4})-\d{2}-\d{2}T/u;
const GUID_FORM = /^(?<first>.{8})(?<second>.{4})(?<third>.{4})(?<fourth>.{4})(?<fifth>.{12})/u;
const FIRST_ATHLETE_ID = 9_000_001;
const FIRST_NBA_PLAYER_ID = 8_000_001;
const FIRST_FOX_ATHLETE_ID = 7_000_001;
const FIRST_YAHOO_PLAYER_ID = 6_000_001;
// Each other provider of the crosswalk gets its own remap, from its own invented range.
const PROVIDERS: ReadonlyMap<Provider, Readonly<{ first: number; prefix: string }>> = new Map([
  ['nba_player_id', { first: FIRST_NBA_PLAYER_ID, prefix: '' }],
  ['fox_athlete_id', { first: FIRST_FOX_ATHLETE_ID, prefix: '' }],
  ['yahoo_player_id', { first: FIRST_YAHOO_PLAYER_ID, prefix: 'nba.p.' }],
]);
// Invented names are spelled from these syllables: the first names cycle through
// theirs, the last names step through theirs by a stride prime to their count, so
// that no two players share both.
const FIRST_NAME_PARTS = [
  ['Ar', 'Bel', 'Cor', 'Dav', 'El', 'Fen', 'Gal', 'Har', 'Iv', 'Jor', 'Kel', 'Lor'],
  ['an', 'en', 'is', 'on', 'ic', 'ek', 'or', 'yn', 'el', 'im', 'as', 'us'],
];
const LAST_NAME_PARTS = [
  ['Bra', 'Cal', 'Dro', 'Fal', 'Gri', 'Hol', 'Kra', 'Lin', 'Mor', 'Nes', 'Pal', 'Ros'],
  ['ve', 'mo', 'ri', 'da', 'lo', 'ne', 'ka', 'tu', 'si', 'ba', 'ge', 'po'],
  ['n', 'r', 't', 's', 'k', 'l', 'm', 'd', 'x', 'th', 'ck', 'sh'],
];
const LAST_NAME_STRIDE = 1153;
// Each invented birth month lies wholly in or wholly out of US daylight time, so that
// the source's form, midnight in Los Angeles written in UTC, has one hour for it.
const BIRTH_MONTHS = ['01', '02', '12', '05', '06', '07', '08', '09'];
const WINTER_MONTHS: ReadonlySet<string> = new Set(['01', '02', '12']);
const DAYS_IN_EVERY_MONTH = 28;
const YEAR_SHIFTS = [-1, 0, 1];
const YEAR_DIGITS = 4;
const MONTH_DAY_START = 5;
const DATE_LENGTH = 10;
const TWO_DIGITS = 2;

/** Personal and free-text columns, blanked wherever they appear. */
const BLANKED: ReadonlySet<string> = new Set([
  'athlete_headshot_href',
  'headshot_href',
  'reason',
  'birth_city',
  'birth_state',
  'birth_country',
  'college_id',
  'height',
  'display_height',
  'weight',
  'display_weight',
]);

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

/** The bytes of a hash of `text`, from which invented values are drawn alike at every run. */
const bytesOf = (text: string): Buffer => createHash('sha256').update(text).digest();

/** A number written with two digits at least. */
const twoDigits = (value: number): string => String(value).padStart(TWO_DIGITS, '0');

/** The number of names that `parts` spell. */
const countOf = (parts: readonly (readonly string[])[]): number =>
  parts.reduce((count, syllables) => count * syllables.length, 1);

/** The `index`th name that `parts` spell, one syllable of each. */
function spelled(parts: readonly (readonly string[])[], index: number): string {
  let rest = index;
  return parts
    .map((syllables) => {
      const syllable = syllables[rest % syllables.length] ?? '';
      rest = Math.floor(rest / syllables.length);
      return syllable;
    })
    .join('');
}

/** The `index`th invented name, first and last, distinct from every other one. */
function inventedName(index: number): readonly [string, string] {
  const lastNames = countOf(LAST_NAME_PARTS);
  if (index >= lastNames) {
    throw new Error(`No invented name is left for player ${String(index)}.`);
  }
  return [
    spelled(FIRST_NAME_PARTS, index % countOf(FIRST_NAME_PARTS)),
    spelled(LAST_NAME_PARTS, (index * LAST_NAME_STRIDE) % lastNames),
  ];
}

/**
 * The invented players and the other providers' invented ids, each given in order of
 * first appearance, so that every file maps a real id to the same invented one.
 */
class Pseudonyms {
  readonly #people = new Map<string, Person>();
  readonly #providers = new Map<Provider, Map<string, string>>();

  /** The invented player of the real `athleteId`. */
  person(athleteId: string): Person {
    const index = this.#people.size;
    const [first, last] = inventedName(index);
    const person = this.#people.get(athleteId) ?? {
      id: String(FIRST_ATHLETE_ID + index),
      first,
      last,
    };
    this.#people.set(athleteId, person);
    return person;
  }

  /** The invented id, among `provider`'s, of its real `id`; an empty id stays empty. */
  provider(provider: Provider, id: string): string {
    const ids = this.#providers.get(provider) ?? new Map<string, string>();
    const { first = 0, prefix = '' } = PROVIDERS.get(provider) ?? {};
    const invented = ids.get(id) ?? `${prefix}${String(first + ids.size)}`;
    this.#providers.set(provider, ids.set(id, invented));
    return id === '' ? '' : invented;
  }
}

const fullName = ({ first, last }: Person): string => `${first} ${last}`;
const shortName = ({ first, last }: Person): string => `${first.charAt(0)}. ${last}`;

/** A guid drawn from the invented id, in the source's 36-character form. */
function guidOf({ id }: Person): string {
  const groups = GUID_FORM.exec(bytesOf(`guid ${id}`).toString('hex'))?.groups ?? {};
  return ['first', 'second', 'third', 'fourth', 'fifth'].map((part) => groups[part]).join('-');
}

/** An invented birth date in the source's form, within a year of the real one; none stays none. */
function birthDateOf({ id }: Person, real: string): string {
  const year = BIRTH_YEAR.exec(real)?.groups?.['year'];
  if (year === undefined) {
    return '';
  }
  const [monthPick = 0, dayPick = 0, shiftPick = 0] = bytesOf(`birth ${id}`);
  const month = BIRTH_MONTHS[monthPick % BIRTH_MONTHS.length] ?? '01';
  const shiftedYear = Number(year) + (YEAR_SHIFTS[shiftPick % YEAR_SHIFTS.length] ?? 0);
  const day = (dayPick % DAYS_IN_EVERY_MONTH) + 1;
  const hour = WINTER_MONTHS.has(month) ? '08' : '07';
  return `${String(shiftedYear)}-${month}-${twoDigits(day)}T${hour}:00Z`;
}

/** The month and day, `MM-DD`, of a date. */
const monthDay = (date: string): string => date.slice(MONTH_DAY_START, DATE_LENGTH);

/** The age on `day` of a player born on `birthDate`; none without a birth date. */
function ageOn(birthDate: string, day: string): string {
  if (birthDate === '') {
    return '';
  }
  const years = Number(day.slice(0, YEAR_DIGITS)) - Number(birthDate.slice(0, YEAR_DIGITS));
  return String(monthDay(day) < monthDay(birthDate) ? years - 1 : years);
}

/** How each person column is rewritten, a player's ages counted on `recordedOn`. */
function rewritesOf(people: Pseudonyms, recordedOn: string): ReadonlyMap<string, Rewrite> {
  const athlete = (row: Row): Person => people.person(row('athlete_id'));
  const named: Rewrite = (value, row) =>
    value === '' ? '' : fullName(people.person(row('espn_athlete_id')));
  const remapped =
    (provider: Provider): Rewrite =>
    (value) =>
      people.provider(provider, value);
  return new Map<string, Rewrite>([
    ['athlete_id', (value) => people.person(value).id],
    ['espn_athlete_id', (value) => (value === '' ? '' : people.person(value).id)],
    ...['athlete_display_name', 'full_name', 'display_name'].map(
      (column) => [column, (_: string, row: Row) => fullName(athlete(row))] as const,
    ),
    ...['athlete_short_name', 'short_name'].map(
      (column) => [column, (_: string, row: Row) => shortName(athlete(row))] as const,
    ),
    ...['player_name', 'espn_full_name', 'nba_player_name', 'fox_player', 'yahoo_player_name'].map(
      (column) => [column, named] as const,
    ),
    ...(['nba_player_id', 'fox_athlete_id', 'yahoo_player_id'] as const).map(
      (provider) => [provider, remapped(provider)] as const,
    ),
    ['first_name', (_, row) => athlete(row).first],
    ['last_name', (_, row) => athlete(row).last],
    ['slug', (_, row) => `${athlete(row).first}-${athlete(row).last}`.toLowerCase()],
    ['uid', (_, row) => `s:40~l:46~a:${athlete(row).id}`],
    ['guid', (_, row) => guidOf(athlete(row))],
    ['date_of_birth', (value, row) => birthDateOf(athlete(row), value)],
    ['age', (_, row) => ageOn(birthDateOf(athlete(row), row('date_of_birth')), recordedOn)],
    ['highlights', (value) => (value === '' ? '' : '[]')],
  ]);
}

/** Blanks a value. */
const blank: Rewrite = () => '';

/**
 * What rewrites the tables of one recording: every row anonymized, its header
 * unchanged, the same invented player for the same real one in every table, ages
 * counted on `recordedOn` (evaluation, section 13).
 */
export function anonymizer(recordedOn: string): (table: Table) => Table {
  const rewrites = rewritesOf(new Pseudonyms(), recordedOn);
  return ({ header, rows }) => {
    const read = readerOf(header);
    const byPlace = header.map((column) => (BLANKED.has(column) ? blank : rewrites.get(column)));
    return {
      header,
      rows: rows.map((fields) =>
        fields.map((value, place) => byPlace[place]?.(value, read(fields)) ?? value),
      ),
    };
  };
}
