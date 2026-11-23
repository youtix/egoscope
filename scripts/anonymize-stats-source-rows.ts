/**
 * The rows of the anonymizer of the statistics-source fixtures
 * (anonymize-stats-source-fixtures.ts): how it rewrites every row by the rules of
 * the statistics-source evaluation, section 13.
 * Every player gets an invented id and an invented name, the same in every file;
 * every team that is no franchise and no placeholder, such as an All-Star team named
 * after a real person, gets an invented name, the same in every file, its id kept;
 * the other providers' ids of the crosswalk are remapped; the personal and free-text
 * columns are blanked; no column is ever removed.
 */
import { createHash } from 'node:crypto';

import { readerOf } from './anonymize-stats-source-csv';

import type { Row, Table } from './anonymize-stats-source-csv';

/** An invented player. */
type Person = Readonly<{ id: string; first: string; last: string }>;

/** An invented team: its name, after "Team ", and its abbreviation. */
type Team = Readonly<{ name: string; abbreviation: string }>;

/** How one column is rewritten, from its value and its original row. */
type Rewrite = (value: string, row: Row) => string;

/** A provider of the crosswalk whose ids are remapped. */
type Provider = 'nba_player_id' | 'fox_athlete_id' | 'yahoo_player_id';

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

/** The ids of the 30 franchises, whose real team names stay (evaluation, section 13). */
export const FRANCHISE = /^(?:[1-9]|[12]\d|30)$/u;
/** The abbreviation of a team still to be determined, a placeholder that names nobody. */
const PLACEHOLDER = 'TBD';
/** The prefixes of the columns that describe a team, each with its `<prefix>id`. */
const TEAM_PREFIXES = ['team_', 'opponent_team_', 'home_', 'away_'];
const TEAM_ABBREVIATION_LENGTH = 3;
// The names of the other teams, such as the All-Star teams, can name real people:
// each such team gets one of these invented names, whose first three letters, its
// abbreviation, are no franchise's.
const TEAM_NAMES = [
  'Alder',
  'Birch',
  'Cedar',
  'Dogwood',
  'Elm',
  'Fir',
  'Ginkgo',
  'Hemlock',
  'Larch',
  'Maple',
  'Oak',
  'Poplar',
  'Spruce',
  'Teak',
  'Walnut',
  'Yew',
];

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

/** Blanks a value. */
const blank: Rewrite = () => '';

/** The column that names a row's player in the player files: a table without it holds no player. */
const PLAYER_COLUMN = 'athlete_id';

/**
 * How each column that describes the row's own player is rewritten, a player's ages
 * counted on `recordedOn`. These columns are rewritten only in the tables that carry
 * the player's `athlete_id`: elsewhere, as in the schedules, a column of the same name
 * (`uid`) describes a game and stays as recorded (evaluation, section 13). A row with
 * no player id invents no player: its player columns are blanked.
 */
function playerRewritesOf(people: Pseudonyms, recordedOn: string): ReadonlyMap<string, Rewrite> {
  const athlete = (row: Row): Person => people.person(row(PLAYER_COLUMN));
  const rewrites = new Map<string, Rewrite>([
    ...['athlete_display_name', 'full_name', 'display_name'].map(
      (column) => [column, (_: string, row: Row) => fullName(athlete(row))] as const,
    ),
    ...['athlete_short_name', 'short_name'].map(
      (column) => [column, (_: string, row: Row) => shortName(athlete(row))] as const,
    ),
    ['first_name', (_, row) => athlete(row).first],
    ['last_name', (_, row) => athlete(row).last],
    ['slug', (_, row) => `${athlete(row).first}-${athlete(row).last}`.toLowerCase()],
    ['uid', (_, row) => `s:40~l:46~a:${athlete(row).id}`],
    ['guid', (_, row) => guidOf(athlete(row))],
    ['date_of_birth', (value, row) => birthDateOf(athlete(row), value)],
    ['age', (_, row) => ageOn(birthDateOf(athlete(row), row('date_of_birth')), recordedOn)],
  ]);
  return new Map(
    Array.from(rewrites, ([column, rewrite]) => [
      column,
      (value: string, row: Row) => (row(PLAYER_COLUMN) === '' ? '' : rewrite(value, row)),
    ]),
  );
}

/** How each other column is rewritten: the ids of the players and of the other providers, the names of the crosswalk, the free text. */
function otherRewritesOf(people: Pseudonyms): ReadonlyMap<string, Rewrite> {
  const invented: Rewrite = (value) => (value === '' ? '' : people.person(value).id);
  const named: Rewrite = (value, row) => {
    const athleteId = row('espn_athlete_id');
    return value === '' || athleteId === '' ? '' : fullName(people.person(athleteId));
  };
  const remapped =
    (provider: Provider): Rewrite =>
    (value) =>
      people.provider(provider, value);
  return new Map<string, Rewrite>([
    [PLAYER_COLUMN, invented],
    ['espn_athlete_id', invented],
    ...['player_name', 'espn_full_name', 'nba_player_name', 'fox_player', 'yahoo_player_name'].map(
      (column) => [column, named] as const,
    ),
    ...(['nba_player_id', 'fox_athlete_id', 'yahoo_player_id'] as const).map(
      (provider) => [provider, remapped(provider)] as const,
    ),
    ['highlights', (value) => (value === '' ? '' : '[]')],
  ]);
}

/**
 * Whether the team that the columns of `prefix` describe in `row` gets an invented
 * name: a team with an id that is no franchise's, and that is no placeholder.
 */
function isInventedTeam(prefix: string, row: Row): boolean {
  const id = row(`${prefix}id`);
  return id !== '' && !FRANCHISE.test(id) && row(`${prefix}abbreviation`) !== PLACEHOLDER;
}

/** The invented teams, each given in order of first appearance, the same in every table. */
class Teams {
  readonly #teams = new Map<string, Team>();

  /** The invented team of the real team `id`. */
  team(id: string): Team {
    const known = this.#teams.get(id);
    if (known !== undefined) {
      return known;
    }
    const name = TEAM_NAMES[this.#teams.size];
    if (name === undefined) {
      throw new Error(`No invented name is left for team ${id}.`);
    }
    const team = { name, abbreviation: name.slice(0, TEAM_ABBREVIATION_LENGTH).toUpperCase() };
    this.#teams.set(id, team);
    return team;
  }
}

/** A logo address whose file, named after the real abbreviation, is named after the invented one. */
function logoOf({ abbreviation }: Team, address: string): string {
  const folderEnd = address.lastIndexOf('/') + 1;
  const extensionStart = address.lastIndexOf('.');
  return extensionStart < folderEnd
    ? address
    : `${address.slice(0, folderEnd)}${abbreviation.toLowerCase()}${address.slice(extensionStart)}`;
}

/** How each column that names a team is rewritten, from the invented team. */
const TEAM_COLUMNS: ReadonlyMap<string, (team: Team, value: string) => string> = new Map([
  ...['name', 'location', 'display_name', 'short_display_name'].map(
    (suffix) => [suffix, ({ name }: Team) => `Team ${name}`] as const,
  ),
  ['slug', ({ name }) => `team-${name.toLowerCase()}`],
  ['abbreviation', ({ abbreviation }) => abbreviation],
  ['logo', logoOf],
  ['logo_dark', logoOf],
]);

/**
 * How each column that names a team is rewritten: a team that is no franchise and no
 * placeholder, such as an All-Star team named after a real person, gets its invented
 * name in every such column, its id kept; any other team stays as recorded.
 */
function teamRewritesOf(teams: Teams): ReadonlyMap<string, Rewrite> {
  return new Map(
    TEAM_PREFIXES.flatMap((prefix) =>
      Array.from(TEAM_COLUMNS, ([suffix, rewrite]) => [
        `${prefix}${suffix}`,
        (value: string, row: Row) =>
          isInventedTeam(prefix, row) ? rewrite(teams.team(row(`${prefix}id`)), value) : value,
      ]),
    ),
  );
}

/** The recorded values of the columns of `table` that name a team, split by whether the team gets an invented name. */
function teamValuesOf({ header, rows }: Table): Readonly<{ invented: string[]; kept: string[] }> {
  const read = readerOf(header);
  const columns = TEAM_PREFIXES.flatMap((prefix) =>
    Array.from(TEAM_COLUMNS.keys(), (suffix) => [prefix, `${prefix}${suffix}`] as const),
  ).filter(([, column]) => header.includes(column));
  const values = { invented: [] as string[], kept: [] as string[] };
  for (const fields of rows) {
    const row = read(fields);
    for (const [prefix, column] of columns) {
      values[isInventedTeam(prefix, row) ? 'invented' : 'kept'].push(row(column));
    }
  }
  return values;
}

/**
 * The real names that the anonymizer replaces, for its final scan: the recorded
 * values, in `tables`, of the columns that name a team that gets an invented name,
 * except those that a kept team bears too, as a franchise does under a stray id.
 */
export function teamNamesOf(tables: readonly Table[]): readonly string[] {
  const values = tables.map((table) => teamValuesOf(table));
  const names = new Set(values.flatMap(({ invented }) => invented));
  const keptNames = values.flatMap(({ kept }) => kept);
  for (const name of keptNames) {
    names.delete(name);
  }
  return [...names];
}

/**
 * What rewrites the tables of one recording: every row anonymized, its header
 * unchanged, the same invented player and team for the same real one in every table,
 * ages counted on `recordedOn` (evaluation, section 13).
 */
export function anonymizer(recordedOn: string): (table: Table) => Table {
  const people = new Pseudonyms();
  const playerRewrites = playerRewritesOf(people, recordedOn);
  const teamRewrites = teamRewritesOf(new Teams());
  const otherRewrites = otherRewritesOf(people);
  return ({ header, rows }) => {
    const read = readerOf(header);
    const hasPlayers = header.includes(PLAYER_COLUMN);
    const rewriteOf = (column: string): Rewrite | undefined =>
      (hasPlayers ? playerRewrites.get(column) : undefined) ??
      teamRewrites.get(column) ??
      otherRewrites.get(column);
    const byPlace = header.map((column) => (BLANKED.has(column) ? blank : rewriteOf(column)));
    return {
      header,
      rows: rows.map((fields) =>
        fields.map((value, place) => byPlace[place]?.(value, read(fields)) ?? value),
      ),
    };
  };
}
