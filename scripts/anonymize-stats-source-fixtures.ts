/**
 * Turns SportsDataverse release files, downloaded from the addresses that the
 * statistics service sheet documents, into the recorded fixtures of the
 * statistics-source adapter (data/fixtures/stats-source/recorded/), by the rules of
 * the statistics-source evaluation, section 13: it keeps the rows that the tests
 * need, gives every player an invented id and an invented name, the same in every
 * file, remaps the other providers' ids of the crosswalk, blanks the personal and
 * free-text columns and never removes a column. Its last step scans every file it
 * wrote for the real names of the originals and for headshot addresses: on any
 * match, it removes every file it wrote and fails. The originals hold real names, so
 * keep them outside the repository:
 * `bun scripts/anonymize-stats-source-fixtures.ts <originals folder> [<output folder>]`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'prettier';

import { anonymizer, parseCsv, readerOf, writeCsv } from './anonymize-stats-source-rows';

import type { Row, Table } from './anonymize-stats-source-rows';

/** The rows to keep of a box-score file: those of `days`, and every row of its first traded player. */
type BoxSelection = Readonly<{ file: string; days: readonly string[]; keepsTraded: boolean }>;

/** The rows to keep of a schedule, besides the games of the kept box scores. */
type ScheduleSelection = Readonly<{ file: string; isKept: (row: Row) => boolean }>;

/** What to record: box-score and schedule rows, and the player and crosswalk files, of which the kept players' rows stay. */
export type RecordingPlan = Readonly<{
  boxScores: readonly BoxSelection[];
  schedules: readonly ScheduleSelection[];
  players: readonly string[];
  crosswalks: readonly string[];
}>;

/** A file the final scan found real names or headshot addresses in, and how many. */
type Match = Readonly<{ file: string; count: number }>;

/** What a run did: the files it wrote, or the files in which the final scan found a match. */
export type AnonymizeResult =
  | Readonly<{ ok: true; written: readonly string[] }>
  | Readonly<{ ok: false; matches: readonly Match[] }>;

/** The rows kept so far, the originals read, and the games and players of the kept box scores. */
type Recording = Readonly<{
  outputs: Map<string, Table>;
  originals: Table[];
  games: Set<string>;
  players: Set<string>;
}>;

const PROBE = 'timestamp.json';
const RECORDED_DAY = /"last_updated"\s*:\s*"(?<day>\d{4}-\d{2}-\d{2})/u;
const FRANCHISE = /^(?:[1-9]|[12]\d|30)$/u;
const HEADSHOT = 'headshots';
const SHORTEST_NAME = 5;

/** The columns whose real names the final scan looks for. */
const NAME_COLUMNS = [
  'athlete_display_name',
  'athlete_short_name',
  'full_name',
  'display_name',
  'short_name',
  'player_name',
  'espn_full_name',
  'nba_player_name',
  'fox_player',
  'yahoo_player_name',
];

/** The table of `file` in `folder`. */
function tableOf(folder: string, file: string): Table {
  const [header = [], ...rows] = parseCsv(readFileSync(path.join(folder, file), 'utf8'));
  return { header, rows };
}

/** The rows of `table` that `isKept` keeps. */
function kept(table: Table, isKept: (row: Row) => boolean): Table {
  const read = readerOf(table.header);
  return { header: table.header, rows: table.rows.filter((fields) => isKept(read(fields))) };
}

/** The first player, in file order, with box scores for two franchises; none when nobody moved. */
function firstTraded({ header, rows }: Table): string | undefined {
  const read = readerOf(header);
  const teams = new Map<string, string>();
  const lines = rows.map((fields) => read(fields)).filter((row) => FRANCHISE.test(row('team_id')));
  return lines.find((row) => {
    const known = teams.get(row('athlete_id'));
    teams.set(row('athlete_id'), row('team_id'));
    return known !== undefined && known !== row('team_id');
  })?.('athlete_id');
}

/** Keeps the box-score rows of `selection`, and notes their games and players. */
function recordBoxScores(recording: Recording, folder: string, selection: BoxSelection): void {
  const table = tableOf(folder, selection.file);
  const traded = selection.keepsTraded ? firstTraded(table) : undefined;
  const { days } = selection;
  const rows = kept(
    table,
    (row) => row('athlete_id') === traded || days.includes(row('game_date')),
  );
  const read = readerOf(table.header);
  for (const fields of rows.rows) {
    const row = read(fields);
    recording.games.add(row('game_id'));
    recording.players.add(row('athlete_id'));
  }
  recording.originals.push(table);
  recording.outputs.set(selection.file, rows);
}

/** Every row of the plan, the originals read and the games and players of the kept box scores. */
function record(folder: string, plan: RecordingPlan): Recording {
  const recording: Recording = {
    outputs: new Map(),
    originals: [],
    games: new Set(),
    players: new Set(),
  };
  for (const selection of plan.boxScores) {
    recordBoxScores(recording, folder, selection);
  }
  for (const { file, isKept } of plan.schedules) {
    const table = tableOf(folder, file);
    recording.outputs.set(
      file,
      kept(table, (row) => recording.games.has(row('game_id')) || isKept(row)),
    );
  }
  const personFiles = [
    ...plan.players.map((file) => [file, 'athlete_id'] as const),
    ...plan.crosswalks.map((file) => [file, 'espn_athlete_id'] as const),
  ];
  for (const [file, column] of personFiles) {
    const table = tableOf(folder, file);
    recording.originals.push(table);
    recording.outputs.set(
      file,
      kept(table, (row) => recording.players.has(row(column))),
    );
  }
  return recording;
}

/** What the final scan looks for: every player name of the originals, and headshot addresses. */
function realNamesOf(originals: readonly Table[]): readonly string[] {
  const names = originals.flatMap(({ header, rows }) => {
    const read = readerOf(header);
    return rows.flatMap((fields) => NAME_COLUMNS.map((column) => read(fields)(column)));
  });
  const lowered = names
    .filter((name) => name.length >= SHORTEST_NAME)
    .map((name) => name.toLowerCase());
  return [...new Set([HEADSHOT, ...lowered])];
}

/** The files written whose text holds any of `names`, with how many of them. */
function matchesIn(
  output: string,
  written: readonly string[],
  names: readonly string[],
): readonly Match[] {
  return written
    .map((file) => {
      const text = readFileSync(path.join(output, file), 'utf8').toLowerCase();
      return { file, count: names.filter((name) => text.includes(name)).length };
    })
    .filter(({ count }) => count > 0);
}

/** The fixture name of a release file: its name in kebab case. */
const fixtureName = (file: string): string => file.replaceAll('_', '-');

/**
 * Records the rows of `plan` from the release files in `originals` into `output`,
 * anonymized by the rules of the statistics-source evaluation, section 13. When the
 * final scan finds a real name or a headshot address in a file it wrote, every file
 * it wrote is removed and the run fails.
 */
export async function anonymize(
  originals: string,
  output: string,
  plan: RecordingPlan,
): Promise<AnonymizeResult> {
  const probe = readFileSync(path.join(originals, PROBE), 'utf8');
  const recordedOn = RECORDED_DAY.exec(probe)?.groups?.['day'] ?? '';
  const recording = record(originals, plan);
  const anonymized = anonymizer(recordedOn);
  mkdirSync(output, { recursive: true });
  const written = Array.from(recording.outputs, ([file, table]) => {
    const { header, rows } = anonymized(table);
    writeFileSync(path.join(output, fixtureName(file)), writeCsv([header, ...rows]));
    return fixtureName(file);
  });
  // Prettier's form of the probe, which says the same as the source's.
  writeFileSync(path.join(output, PROBE), await format(probe, { parser: 'json' }));
  const files = [...written, PROBE];
  const matches = matchesIn(output, files, realNamesOf(recording.originals));
  if (matches.length === 0) {
    return { ok: true, written: files };
  }
  for (const file of files) {
    rmSync(path.join(output, file));
  }
  return { ok: false, matches };
}

/** Keeps the rows of a schedule played on one of `days`. */
const onDays =
  (days: readonly string[]) =>
  (row: Row): boolean =>
    days.includes(row('game_date'));

const isTrue = (value: string): boolean => value.toLowerCase() === 'true';

/**
 * The recording of the adapter's tests: 1993-94, the first covered season; the
 * 2001-02 playoffs, with their two three-game series; 2024-25, with the NBA Cup
 * final, the All-Star games, the days before and after the March 2025 change to
 * daylight time, the playoffs and play-in, the postponed games and their make-ups,
 * and the neutral sites; 2026-27, the season in progress, with its placeholders and
 * times to be determined, and every game of its first traded player.
 */
const RECORDING_PLAN: RecordingPlan = {
  boxScores: [
    { file: 'player_box_1994.csv', days: ['1993-11-07'], keepsTraded: false },
    {
      file: 'player_box_2025.csv',
      days: ['2024-12-17', '2025-02-16', '2025-03-08'],
      keepsTraded: false,
    },
    { file: 'player_box_2027.csv', days: ['2026-11-21'], keepsTraded: true },
  ],
  schedules: [
    { file: 'nba_schedule_1994.csv', isKept: onDays(['1993-11-07']) },
    { file: 'nba_schedule_2002.csv', isKept: (row) => row('season_type') === '3' },
    {
      file: 'nba_schedule_2025.csv',
      isKept: (row) =>
        isTrue(row('neutral_site')) ||
        ['3', '5'].includes(row('season_type')) ||
        row('status_type_name') === 'STATUS_POSTPONED' ||
        /\bfrom\b/iu.test(row('notes_headline')) ||
        onDays(['2024-12-17', '2025-02-16', '2025-03-08', '2025-03-14'])(row),
    },
    {
      file: 'nba_schedule_2027.csv',
      isKept: (row) =>
        isTrue(row('neutral_site')) ||
        !isTrue(row('time_valid')) ||
        [row('home_abbreviation'), row('away_abbreviation')].includes('TBD') ||
        onDays(['2026-11-21', '2026-11-22'])(row),
    },
  ],
  players: ['player_core_2025.csv', 'player_core_2026.csv', 'player_core_2027.csv'],
  crosswalks: ['nba_player_crosswalk_2025.csv'],
};

const DEFAULT_OUTPUT = path.join(import.meta.dirname, '../data/fixtures/stats-source/recorded');

/** Records the fixtures from the originals named on the command line. */
async function main([originals, output = DEFAULT_OUTPUT]: readonly string[]): Promise<number> {
  if (originals === undefined) {
    console.error('Usage: bun scripts/anonymize-stats-source-fixtures.ts <originals> [<output>]');
    return 1;
  }
  const result = await anonymize(originals, output, RECORDING_PLAN);
  if (!result.ok) {
    for (const { file, count } of result.matches) {
      console.error(`✖ ${file}: ${String(count)} real names or headshot addresses; nothing kept.`);
    }
    return 1;
  }
  console.info(`✔ ${String(result.written.length)} anonymized fixtures written to ${output}.`);
  return 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
