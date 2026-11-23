// The rows of the SportsDataverse release files other than the schedule's
// (statistics-source evaluation, sections 10 and 12): the reading of their values and
// the box-score, player-file and crosswalk rows. The CSV reading is in
// sportsdataverse-csv.ts, the schedule's rows in sportsdataverse-schedule.ts.
import { compareIsoDates, parseIsoDate } from '@/lib/time';

import type { RowReader, RowSink } from './sportsdataverse-csv';
import type {
  Birthday,
  BoxScoreCount,
  BoxScoreCounts,
  DirectoryEntry,
  DirectoryTeam,
  PlayerMapping,
  PlayerRecord,
  SourceBoxScore,
  SourcePlayerId,
  SourceTeamId,
} from './types';
import type { IsoDate } from '@/lib/time';

/** The lines of a season's box-score file and the directory they give (STA-03, STA-08). */
export type BoxScoreFile = Readonly<{
  lines: readonly SourceBoxScore[];
  directory: readonly DirectoryEntry[];
}>;

/** The thirteen counts as a row reads them, each nothing while unreadable. */
type ReadCounts = Readonly<Record<BoxScoreCount, number | null | undefined>>;

/** A player of the directory as it builds: his names and, per team, his first and last game day. */
type EntryInProgress = Readonly<{
  player: SourcePlayerId;
  names: readonly string[];
  teams: Map<SourceTeamId, DirectoryTeam>;
}>;

const NOT_PROVIDED: ReadonlySet<string> = new Set(['', 'NA']);
const BOOLEANS: ReadonlyMap<string, boolean> = new Map([
  ['true', true],
  ['false', false],
]);
const FRANCHISE_ID = /^\d+$/u;
const FIRST_FRANCHISE = 1;
const LAST_FRANCHISE = 30;
const SIDES: ReadonlyMap<string, boolean> = new Map([
  ['home', true],
  ['away', false],
]);
const BIRTH_DATE = /^\d{4}-(?<month>\d{2})-(?<day>\d{2})T/u;
const UNMATCHED = 'unmatched';
const WITHOUT_TEAM = { kind: 'without_team' } as const;

/** The column of each of the thirteen counts (evaluation, section 12). */
const COUNT_COLUMNS: Readonly<Record<BoxScoreCount, string>> = {
  points: 'points',
  fieldGoalsMade: 'field_goals_made',
  fieldGoalsAttempted: 'field_goals_attempted',
  threePointersMade: 'three_point_field_goals_made',
  freeThrowsMade: 'free_throws_made',
  freeThrowsAttempted: 'free_throws_attempted',
  offensiveRebounds: 'offensive_rebounds',
  defensiveRebounds: 'defensive_rebounds',
  assists: 'assists',
  steals: 'steals',
  blocks: 'blocks',
  turnovers: 'turnovers',
  personalFouls: 'fouls',
};

const BOX_SCORE_COLUMNS = [
  'game_id',
  'game_date',
  'athlete_id',
  'athlete_display_name',
  'athlete_short_name',
  'team_id',
  'opponent_team_id',
  'home_away',
  'did_not_play',
  'minutes',
  ...Object.values(COUNT_COLUMNS),
];

/** A boolean written in any case (T6), or nothing for any other value. */
export const booleanOf = (value: string): boolean | undefined => BOOLEANS.get(value.toLowerCase());

/** A whole number written `5` or `5.0`; null when not provided, never 0 (STA-10); nothing when unreadable. */
export function countOf(value: string): number | null | undefined {
  if (NOT_PROVIDED.has(value)) {
    return null;
  }
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : undefined;
}

/** Says whether `team` is one of the thirty franchises, which All-Star teams are not (CL-STA-16). */
export function isFranchise(team: string): boolean {
  const id = Number(team);
  return FRANCHISE_ID.test(team) && id >= FIRST_FRANCHISE && id <= LAST_FRANCHISE;
}

/** Says whether every count could be read. */
const isComplete = (counts: ReadCounts): counts is BoxScoreCounts =>
  Object.values(counts).every((count) => count !== undefined);

/** The thirteen counts of a box-score row, each null when not provided; nothing when one is unreadable (STA-08, STA-10). */
function countsOf(row: RowReader): BoxScoreCounts | undefined {
  const count = (name: BoxScoreCount): number | null | undefined =>
    countOf(row(COUNT_COLUMNS[name]));
  const counts: ReadCounts = {
    points: count('points'),
    fieldGoalsMade: count('fieldGoalsMade'),
    fieldGoalsAttempted: count('fieldGoalsAttempted'),
    threePointersMade: count('threePointersMade'),
    freeThrowsMade: count('freeThrowsMade'),
    freeThrowsAttempted: count('freeThrowsAttempted'),
    offensiveRebounds: count('offensiveRebounds'),
    defensiveRebounds: count('defensiveRebounds'),
    assists: count('assists'),
    steals: count('steals'),
    blocks: count('blocks'),
    turnovers: count('turnovers'),
    personalFouls: count('personalFouls'),
  };
  return isComplete(counts) ? counts : undefined;
}

/**
 * A box-score row: whole minutes marked as such (STA-12), the did-not-play reason
 * never read (DSN-15), the ejection unknown, since the source never sets it (SEN-16,
 * T6); nothing when a value is unreadable.
 */
function boxScoreOf(row: RowReader): SourceBoxScore | undefined {
  const isHome = SIDES.get(row('home_away'));
  const didNotPlay = booleanOf(row('did_not_play'));
  const minutes = countOf(row('minutes'));
  const counts = countsOf(row);
  if (isHome === undefined || didNotPlay === undefined || minutes === undefined || !counts) {
    return undefined;
  }
  return {
    game: row('game_id'),
    player: row('athlete_id'),
    team: row('team_id'),
    opponent: row('opponent_team_id'),
    isHome,
    didNotPlay,
    playingTime: minutes === null ? null : { precision: 'whole_minutes', minutes },
    counts,
    ejected: null,
  };
}

/** Says whether a line is between two franchises, which an All-Star game's are not (CL-STA-16). */
const isBetweenFranchises = (row: RowReader): boolean =>
  isFranchise(row('team_id')) && isFranchise(row('opponent_team_id'));

/** The directory entry of the row's player, begun with the names of his first line. */
function entryFor(
  entries: Map<SourcePlayerId, EntryInProgress>,
  player: SourcePlayerId,
  row: RowReader,
): EntryInProgress {
  const names = [row('athlete_display_name'), row('athlete_short_name')];
  const entry = entries.get(player) ?? {
    player,
    names: [...new Set(names.filter((name) => name !== ''))],
    teams: new Map(),
  };
  entries.set(player, entry);
  return entry;
}

/** Extends the player's days with `team` to `day`. */
function addDay(entry: EntryInProgress, team: SourceTeamId, day: IsoDate): void {
  const known = entry.teams.get(team);
  entry.teams.set(team, {
    team,
    firstGameDay: known && compareIsoDates(known.firstGameDay, day) < 0 ? known.firstGameDay : day,
    lastGameDay: known && compareIsoDates(known.lastGameDay, day) > 0 ? known.lastGameDay : day,
  });
}

/** The finished directory entry: his teams from the earliest first game day (JOU-13). */
function entryOf({ player, names, teams }: EntryInProgress): DirectoryEntry {
  const [displayName = '', ...otherNames] = names;
  return {
    player,
    displayName,
    otherNames,
    teams: Array.from(teams, ([, team]) => team).toSorted((left, right) =>
      compareIsoDates(left.firstGameDay, right.firstGameDay),
    ),
  };
}

/**
 * Reads a box-score file for `isOfSeason` days: each line between two franchises,
 * once per game and player (All-Star lines skipped, CL-STA-16; repeated seasons of
 * the 1999-2000 file left to their own season, T4), and the directory of their
 * players with each team's first and last game day (STA-03, JOU-13).
 */
export function boxScoreSink(isOfSeason: (day: IsoDate) => boolean): RowSink<BoxScoreFile> {
  const lines = new Map<string, SourceBoxScore>();
  const entries = new Map<SourcePlayerId, EntryInProgress>();
  return {
    columns: BOX_SCORE_COLUMNS,
    add: (row) => {
      const day = parseIsoDate(row('game_date'));
      if (!day.ok) {
        return false;
      }
      const key = `${row('game_id')} ${row('athlete_id')}`;
      if (lines.has(key) || !isOfSeason(day.on) || !isBetweenFranchises(row)) {
        return true;
      }
      const line = boxScoreOf(row);
      if (line === undefined) {
        return false;
      }
      lines.set(key, line);
      addDay(entryFor(entries, line.player, row), line.team, day.on);
      return true;
    },
    finish: () => ({
      lines: Array.from(lines, ([, line]) => line),
      directory: Array.from(entries, ([, entry]) => entryOf(entry)),
    }),
  };
}

/** The day and month of a birth date written `YYYY-MM-DDT07:00Z`, its year dropped (CL-JOU-16); null when not given. */
function birthdayOf(value: string): Birthday | null | undefined {
  if (value === '') {
    return null;
  }
  const groups = BIRTH_DATE.exec(value)?.groups;
  return groups === undefined
    ? undefined
    : { month: Number(groups['month']), day: Number(groups['day']) };
}

/**
 * Reads the requested players' rows of a player file: name, birthday and the team
 * the file gives, an empty one being a release (STA-26, CL-STA-27).
 */
export function playerFileSink(
  players: ReadonlySet<SourcePlayerId>,
): RowSink<ReadonlyMap<SourcePlayerId, PlayerRecord>> {
  const records = new Map<SourcePlayerId, PlayerRecord>();
  return {
    columns: ['athlete_id', 'display_name', 'date_of_birth', 'current_team_id'],
    add: (row) => {
      const player = row('athlete_id');
      if (records.has(player) || !players.has(player)) {
        return true;
      }
      const birthday = birthdayOf(row('date_of_birth'));
      if (birthday === undefined) {
        return false;
      }
      const team = row('current_team_id');
      records.set(player, {
        player,
        displayName: row('display_name'),
        birthday,
        currentTeam: team === '' ? WITHOUT_TEAM : { kind: 'team', team },
      });
      return true;
    },
    finish: () => records,
  };
}

/** Reads a player crosswalk: each matched player's identifier in `column`, the other source's (CL-TRV-14). */
export function crosswalkSink(column: string): RowSink<readonly PlayerMapping[]> {
  const mappings: PlayerMapping[] = [];
  return {
    columns: ['espn_athlete_id', 'match_method', column],
    add: (row) => {
      const otherPlayer = row(column);
      if (otherPlayer !== '' && row('match_method') !== UNMATCHED) {
        mappings.push({ player: row('espn_athlete_id'), otherPlayer });
      }
      return true;
    },
    finish: () => mappings,
  };
}
