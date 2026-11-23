// The schedule rows of the SportsDataverse release files (statistics-source
// evaluation, sections 10 and 12): a game's season from its day, its day from its
// tip-off in US Eastern time, the games that never count by their labels first,
// placeholders, statuses, results, series and make-up games, then the season's teams
// and coverage. The CSV reading is in sportsdataverse-csv.ts, the other files' rows in
// sportsdataverse-rows.ts.
import { gameDay, gameDayStart, parseIsoDate, parseTimestamp } from '@/lib/time';

import { booleanOf, countOf, isFranchise } from './sportsdataverse-rows';

import type { RowReader, RowSink } from './sportsdataverse-csv';
import type {
  GameExclusion,
  GamePhase,
  GameStatus,
  HeldBackRow,
  Season,
  SeasonGames,
  SeriesPlace,
  SeriesRound,
  SourceGame,
  SourceGameId,
  SourceTeam,
  SourceTeamId,
} from './types';
import type { EpochMs, IsoDate } from '@/lib/time';

/** A game as its row gives it, before make-up games are tied to their postponed original. */
type ScheduledGame = Readonly<{
  game: Omit<SourceGame, 'makeUpOf'>;
  /** The month and day, `MM-DD`, of the postponed game that a make-up row names. */
  makeUpFrom: string | null;
  hasBoxScores: boolean;
}>;

/** What one schedule row gives: a game, a row held back for its status, or nothing readable. */
type ScheduleRow =
  | Readonly<{ kind: 'game'; scheduled: ScheduledGame }>
  | Readonly<{ kind: 'held_back'; row: HeldBackRow; season: Season | null }>
  | undefined;

const SIDES = ['home', 'away'] as const;
const SCHEDULE_COLUMNS = [
  'game_id',
  'date',
  'game_date_time',
  'game_date',
  'time_valid',
  'season_type',
  'type_abbreviation',
  'notes_headline',
  'neutral_site',
  'status_type_name',
  'status_period',
  'format_regulation_periods',
  'player_box',
  ...SIDES.flatMap((side) =>
    ['id', 'abbreviation', 'name', 'location', 'score'].map((field) => `${side}_${field}`),
  ),
];

/**
 * The producer passes ESPN's status names through (its ingest code filters on
 * POSTPONED, CANCEL, SUSPENDED and FORFEIT): the observed ones, and ESPN's names of
 * a canceled and an in-progress game. Any other value holds its row back (CL-STA-17).
 */
const STATUSES: ReadonlyMap<string, GameStatus> = new Map([
  ['STATUS_SCHEDULED', 'scheduled'],
  ['STATUS_IN_PROGRESS', 'in_progress'],
  ['STATUS_HALFTIME', 'in_progress'],
  ['STATUS_END_PERIOD', 'in_progress'],
  ['STATUS_FINAL', 'final'],
  ['STATUS_POSTPONED', 'postponed'],
  ['STATUS_CANCELED', 'canceled'],
]);
const PHASES: ReadonlyMap<string, GamePhase> = new Map([
  ['2', 'regular_season'],
  ['5', 'play_in'],
  ['3', 'playoffs'],
]);
const PHASE_ORDER: readonly GamePhase[] = ['regular_season', 'play_in', 'playoffs'];
const EXCLUDING_LABELS: ReadonlyMap<string, GameExclusion> = new Map([
  ['ALLSTAR', 'all_star'],
  ['CC', 'cup_final'],
]);
const PLAYOFF_ROUNDS: ReadonlyMap<string, SeriesRound> = new Map([
  ['RD16', 'first_round'],
  ['QTR', 'conference_semifinals'],
  ['SEMI', 'conference_finals'],
  ['FINAL', 'finals'],
]);
const PLAY_IN_ROUNDS: readonly (readonly [RegExp, SeriesRound])[] = [
  [/\b7th place vs\.? 8th place\b/iu, 'play_in_7_vs_8'],
  [/\b9th place vs\.? 10th place\b/iu, 'play_in_9_vs_10'],
  [/\b8th seed game\b/iu, 'play_in_8th_seed'],
];
const GAME_NUMBER = /\bgame (?<number>\d+)\b/iu;
const MAKE_UP = /\b(?:makeup|rescheduled) from (?<month>[a-z]{3})[a-z]*\.? (?<day>\d{1,2})\b/iu;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PLACEHOLDER = 'TBD';
const REGULATION_PERIODS = 4;
const TWO_DIGITS = 2;
const MONTH_DAY_START = 5;
const YEAR_DIGITS = 4;
const CENTURY = 100;
// A season starts on 1 October of its first year (no game is played between then and
// its opening night), except 2020-21, which started on 22 December 2020, after the
// 2019-20 playoffs had run into October (CL-STA-28).
const SEASON_START = '-10-01';
const LATE_STARTS: readonly string[] = ['2020-12-22'];

const twoDigits = (value: number): string => String(value).padStart(TWO_DIGITS, '0');

/** The season whose first year is `firstYear`, written `2024-25` (CL-STA-28). */
const seasonNamed = (firstYear: number): Season =>
  `${String(firstYear)}-${twoDigits((firstYear + 1) % CENTURY)}`;

/** The year that a season or a day, such as `2024-25` or `2024-10-22`, starts with. */
export const yearOf = (text: string): number => Number(text.slice(0, YEAR_DIGITS));

/** The season of a game played on `day`: the latest season that started on or before it (CL-STA-28, T14). */
export function seasonOfDay(day: IsoDate): Season {
  const year = yearOf(day);
  const start =
    LATE_STARTS.find((late) => yearOf(late) === year) ?? `${String(year)}${SEASON_START}`;
  return seasonNamed(start <= day ? year : year - 1);
}

/** The instant that `text` writes with its offset, or nothing. */
function instantOf(text: string): EpochMs | undefined {
  const parsed = parseTimestamp(text);
  return parsed.ok && parsed.timestamp.kind === 'instant' ? parsed.timestamp.at : undefined;
}

/**
 * When a row's game starts and on which day: its UTC instant, which its US Eastern
 * writing must match, and the US Eastern date of that instant, which its game date
 * must be; 00:00 US Eastern while its time is to be determined. Nothing when they
 * disagree (CL-TRV-03, CL-STA-14, T11, T21).
 */
function timingOf(
  row: RowReader,
): Pick<SourceGame, 'tipOff' | 'isTimeKnown' | 'gameDay'> | undefined {
  const at = instantOf(row('date'));
  const day = parseIsoDate(row('game_date'));
  const isTimeKnown = booleanOf(row('time_valid'));
  if (at === undefined || isTimeKnown === undefined || at !== instantOf(row('game_date_time'))) {
    return undefined;
  }
  return day.ok && gameDay(at) === day.on
    ? { tipOff: isTimeKnown ? at : gameDayStart(day.on), isTimeKnown, gameDay: day.on }
    : undefined;
}

/**
 * A game's exclusion and teams: the All-Star and NBA Cup final labels first, whatever
 * the teams; then a team to be determined, a placeholder without team ids; then a team
 * that is no franchise, an All-Star game without its label (CL-STA-14, CL-STA-16).
 */
function sidesOf(row: RowReader): Pick<SourceGame, 'exclusion' | 'homeTeam' | 'awayTeam'> {
  const isPlaceholder = SIDES.some((side) => row(`${side}_abbreviation`) === PLACEHOLDER);
  const areFranchises = SIDES.every((side) => isFranchise(row(`${side}_id`)));
  const exclusion =
    EXCLUDING_LABELS.get(row('type_abbreviation')) ??
    (isPlaceholder || areFranchises ? null : 'all_star');
  const isKnown = areFranchises && !isPlaceholder;
  return {
    exclusion,
    homeTeam: isKnown ? row('home_id') : null,
    awayTeam: isKnown ? row('away_id') : null,
  };
}

/** The score and overtimes of a final game, its periods beyond the fourth (CL-STA-03); nothing when its score is unreadable. */
function resultOf(
  row: RowReader,
  status: GameStatus,
): Pick<SourceGame, 'score' | 'overtimes'> | undefined {
  if (status !== 'final') {
    return { score: null, overtimes: null };
  }
  const [home, away, period, regulation] = [
    'home_score',
    'away_score',
    'status_period',
    'format_regulation_periods',
  ].map((column) => countOf(row(column)));
  if (typeof home !== 'number' || typeof away !== 'number') {
    return undefined;
  }
  const isPlayedOut =
    regulation === REGULATION_PERIODS && typeof period === 'number' && period >= REGULATION_PERIODS;
  return { score: { home, away }, overtimes: isPlayedOut ? period - REGULATION_PERIODS : null };
}

/** Where a postseason game sits: its round from its label, its number from its headline (CL-STA-18, T19). */
function seriesOf(row: RowReader, phase: GamePhase): SeriesPlace | null {
  if (phase === 'regular_season') {
    return null;
  }
  const headline = row('notes_headline');
  const round =
    phase === 'playoffs'
      ? PLAYOFF_ROUNDS.get(row('type_abbreviation'))
      : PLAY_IN_ROUNDS.find(([label]) => label.test(headline))?.[1];
  const number = GAME_NUMBER.exec(headline)?.groups?.['number'];
  return { round: round ?? null, gameNumber: number === undefined ? null : Number(number) };
}

/** The `MM-DD` of the original game that a make-up row's headline names, such as "Makeup from Jan 11" (T19). */
function makeUpFromOf(headline: string): string | null {
  const groups = MAKE_UP.exec(headline)?.groups;
  if (groups === undefined) {
    return null;
  }
  const month = MONTHS.indexOf(String(groups['month']).toLowerCase()) + 1;
  return month === 0 ? null : `${twoDigits(month)}-${twoDigits(Number(groups['day']))}`;
}

/** A row held back while its status value is not mapped, with the season of its day when it is readable (CL-STA-17). */
function heldBackOf(row: RowReader): ScheduleRow {
  const day = parseIsoDate(row('game_date'));
  return {
    kind: 'held_back',
    row: { game: row('game_id'), status: row('status_type_name') },
    season: day.ok ? seasonOfDay(day.on) : null,
  };
}

/** One schedule row: a game, or a row held back while its status value is not mapped (CL-STA-17). */
function scheduleRowOf(row: RowReader): ScheduleRow {
  const status = STATUSES.get(row('status_type_name'));
  if (status === undefined) {
    return heldBackOf(row);
  }
  const game = row('game_id');
  const timing = timingOf(row);
  const phase = PHASES.get(row('season_type'));
  const isNeutralSite = booleanOf(row('neutral_site'));
  const hasBoxScores = booleanOf(row('player_box'));
  const result = resultOf(row, status);
  if (
    !timing ||
    phase === undefined ||
    isNeutralSite === undefined ||
    hasBoxScores === undefined ||
    !result
  ) {
    return undefined;
  }
  const season = seasonOfDay(timing.gameDay);
  const fields = { game, season, phase, ...sidesOf(row), ...timing, isNeutralSite, status };
  return {
    kind: 'game',
    scheduled: {
      game: { ...fields, ...result, series: seriesOf(row, phase) },
      makeUpFrom: makeUpFromOf(row('notes_headline')),
      hasBoxScores,
    },
  };
}

/** Says whether two games are between the same two teams, whoever is at home. */
const isSamePairing = (one: ScheduledGame['game'], other: ScheduledGame['game']): boolean =>
  (one.homeTeam === other.homeTeam && one.awayTeam === other.awayTeam) ||
  (one.homeTeam === other.awayTeam && one.awayTeam === other.homeTeam);

/** The postponed game of the same two teams on the day that a make-up names (CL-STA-17, T19). */
function originalOf(
  { game, makeUpFrom }: ScheduledGame,
  games: readonly ScheduledGame[],
): SourceGameId | null {
  if (makeUpFrom === null) {
    return null;
  }
  const original = games.find(
    ({ game: other }) =>
      other.status === 'postponed' &&
      other.gameDay.slice(MONTH_DAY_START) === makeUpFrom &&
      isSamePairing(other, game),
  );
  return original?.game.game ?? null;
}

/** Adds the franchises of a row to the season's teams, under that season's names (T22). */
function addTeams(teams: Map<SourceTeamId, SourceTeam>, row: RowReader): void {
  for (const side of SIDES) {
    const team = row(`${side}_id`);
    if (isFranchise(team) && !teams.has(team)) {
      teams.set(team, {
        team,
        name: row(`${side}_name`),
        abbreviation: row(`${side}_abbreviation`),
        location: row(`${side}_location`),
      });
    }
  }
}

/** The season's games with their make-up links, its teams, its coverage and its held-back rows (STA-35, CL-STA-22). */
function seasonGamesOf(
  scheduled: readonly ScheduledGame[],
  teams: ReadonlyMap<SourceTeamId, SourceTeam>,
  heldBack: readonly HeldBackRow[],
): SeasonGames {
  const counted = scheduled.filter(
    ({ game }) => game.status === 'final' && game.exclusion === null,
  );
  const phases = new Set(counted.filter((game) => game.hasBoxScores).map(({ game }) => game.phase));
  return {
    games: scheduled.map((game) => ({ ...game.game, makeUpOf: originalOf(game, scheduled) })),
    teams: Array.from(teams, ([, team]) => team),
    coverage: {
      phasesWithBoxScores: PHASE_ORDER.filter((phase) => phases.has(phase)),
      gamesWithoutBoxScores: counted
        .filter((game) => !game.hasBoxScores)
        .map(({ game }) => game.game),
    },
    heldBack,
  };
}

/**
 * Reads a schedule file for `season`: each game once, whatever season its file is
 * named after (T14), with the season's teams, its coverage and the rows held back
 * for a status value not mapped yet (STA-05, STA-29, STA-31, CL-STA-17).
 */
export function scheduleSink(season: Season): RowSink<SeasonGames> {
  const seen = new Set<SourceGameId>();
  const scheduled: ScheduledGame[] = [];
  const teams = new Map<SourceTeamId, SourceTeam>();
  const heldBack: HeldBackRow[] = [];
  return {
    columns: SCHEDULE_COLUMNS,
    add: (row) => {
      const parsed = seen.has(row('game_id')) ? null : scheduleRowOf(row);
      seen.add(row('game_id'));
      if (parsed?.kind === 'held_back' && (parsed.season ?? season) === season) {
        heldBack.push(parsed.row);
      } else if (parsed?.kind === 'game' && parsed.scheduled.game.season === season) {
        scheduled.push(parsed.scheduled);
        addTeams(teams, row);
      }
      return parsed !== undefined;
    },
    finish: () => seasonGamesOf(scheduled, teams, heldBack),
  };
}

/** What says whether a day lies in `season`, by which a box-score file's lines are filed (CL-STA-28). */
export const withinSeason =
  (season: Season) =>
  (day: IsoDate): boolean =>
    seasonOfDay(day) === season;
