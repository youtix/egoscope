// The games that the calendar derivation turns into events (record 0015, CL-TAX-18): his
// birthday games and his first games against a former team, and which of them a run
// derives (CL-TAX-19). Both kinds are read from the stored schedule, each game with its
// day, its US Eastern date (CL-TRV-03), and among his team games, the official games of
// the team he belonged to at their start (CL-STA-05), so that a past game and his next
// game are judged alike (CL-STA-25). Whether he played a game is never a condition: a
// game he misses gives a case that is not measurable (record 0015). The calendar-events
// module turns these games into events.

import { seasonOfDate } from '../schedule/seasons';
import { byScheduledStart } from '../schedule/series';
import { teamGames } from '../schedule/team-membership';
import { hasTeam } from '../schedule/team-record';

import type { SeasonSpan } from '../schedule/seasons';
import type { LinesGame, PlayerLine, TeamGame, TeamStint } from '../schedule/team-membership';
import type { EpochMs, GameId, IsoDate, TeamId } from '../types';

/** His day and month of birth, never a year (CL-JOU-16): a month from 1 to 12, a day of it. */
export type Birthday = Readonly<{ month: number; day: number }>;

/**
 * A game of the stored schedule with its day: its date in US Eastern time, which stands
 * for the local date at the venue (CL-TRV-03, CL-STA-14).
 */
export type CalendarGame = LinesGame & Readonly<{ gameDayOn: IsoDate }>;

/**
 * What the derivation reads of a followed player (CL-TAX-18): his recorded birthday, null
 * when none is recorded (CL-JOU-16); his stints, from teamMembership; and the lines of
 * his box scores, from which his former teams come (CL-JOU-18).
 */
export type CalendarPlayer = Readonly<{
  birthday: Birthday | null;
  stints: readonly TeamStint[];
  lines: readonly PlayerLine[];
}>;

/**
 * The stored schedule that the derivation reads (CL-TAX-18, CL-STA-24): its games, past
 * and upcoming, his next game included; the span of every season that a game's day can
 * fall in, which files it by season (STA-48); and the names of the covered seasons
 * (CL-STA-22), the season in progress and the coming one included.
 */
export type CalendarSchedule = Readonly<{
  games: readonly CalendarGame[];
  seasons: readonly SeasonSpan[];
  coveredSeasons: readonly string[];
}>;

/**
 * A game that the derivation turns into an event, its derived game (CL-TAX-18): one of his
 * team games, with its day.
 */
export type DerivedGame = TeamGame & Readonly<{ game: CalendarGame }>;

/**
 * A first game against a former team (CL-TAX-18, CL-JOU-18): the former team, and his
 * departure from it, the last game he played for it in the stint that the meeting
 * follows, which opening the event shows (CL-VUE-15).
 */
export type FormerTeamGame = DerivedGame &
  Readonly<{ formerTeamId: TeamId; departure: CalendarGame }>;

/**
 * A run of the derivation at its instant (CL-TAX-19): a regular run, with the instant of
 * the player's previous run and his next game (STA-26), null when none is scheduled; or a
 * full run.
 */
export type DerivationRun =
  | Readonly<{ kind: 'full'; at: EpochMs }>
  | Readonly<{ kind: 'regular'; at: EpochMs; previousRunAt: EpochMs; nextGameId: GameId | null }>;

/** His stints and his lines, which say which games are his team games (CL-STA-05). */
type Membership = Omit<CalendarPlayer, 'birthday'>;

// teamGames lists the team games strictly after an instant: from this one, all of them.
const FROM_THE_START = -Infinity;

// A season is named by its two years, `2024-25`: its first four characters are the first.
const YEAR_LENGTH = 4;

// A birthday on 29 February falls on 28 February in a common year (CL-JOU-17).
const FEBRUARY = 2;
const LEAP_DAY = 29;
const LEAP_BIRTHDAY_IN_A_COMMON_YEAR = 28;

// The Gregorian calendar: a year divisible by 4 is a leap year, a century year only when
// it is divisible by 400.
const LEAP_YEAR_CYCLE = 4;
const CENTURY = 100;
const LEAP_CENTURY_CYCLE = 400;

function isLeapYear(year: number): boolean {
  return year % LEAP_YEAR_CYCLE === 0 && (year % CENTURY !== 0 || year % LEAP_CENTURY_CYCLE === 0);
}

/** Whether `date`, written YYYY-MM-DD, is his birthday that year (CL-JOU-17). */
function isBirthday(date: IsoDate, birthday: Birthday): boolean {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  const isOnLeapDay = birthday.month === FEBRUARY && birthday.day === LEAP_DAY;
  const birthdayDay =
    isOnLeapDay && !isLeapYear(year) ? LEAP_BIRTHDAY_IN_A_COMMON_YEAR : birthday.day;
  return month === birthday.month && day === birthdayDay;
}

const firstYearOf = (season: string): number => Number(season.slice(0, YEAR_LENGTH));

/**
 * Whether every season from that of one game to that of another, both included, is
 * covered (CL-JOU-18, CL-STA-24). The seasons from one to another are those whose first
 * years run from the first one's to the last one's.
 */
function coverageOf(schedule: CalendarSchedule): (from: CalendarGame, to: CalendarGame) => boolean {
  const coveredYears = new Set(schedule.coveredSeasons.map((season) => firstYearOf(season)));
  const yearOf = ({ gameDayOn }: CalendarGame): number =>
    firstYearOf(seasonOfDate(gameDayOn, schedule.seasons));
  return (from, to) => {
    const firstYear = yearOf(from);
    return Array.from(
      { length: yearOf(to) - firstYear + 1 },
      (_, index) => firstYear + index,
    ).every((year) => coveredYears.has(year));
  };
}

/**
 * His team games among `games`, each with its day, in scheduled-start order (STA-27,
 * CL-STA-05, CL-STA-09): teamGames says which games are his team's, and his team and his
 * participation at each.
 */
function datedTeamGames(
  player: Membership,
  games: readonly CalendarGame[],
): readonly DerivedGame[] {
  const listed = new Map(
    teamGames(player, games, FROM_THE_START).map((teamGame) => [teamGame.game.id, teamGame]),
  );
  return games.toSorted(byScheduledStart).flatMap((game) => {
    const teamGame = listed.get(game.id);
    return teamGame === undefined ? [] : { ...teamGame, game };
  });
}

/**
 * His birthday games, in scheduled-start order (record 0015, CL-TAX-18, CL-JOU-16,
 * CL-JOU-17, CL-STA-24): every official game of the team he belonged to at its start
 * whose day (CL-TRV-03) has his day and month of birth, in a covered season. A birthday
 * on 29 February falls on 28 February in a common year, and in a leap year 28 February
 * is not his birthday. A player without a recorded birthday has none.
 */
export function birthdayGames(
  player: CalendarPlayer,
  schedule: CalendarSchedule,
): readonly DerivedGame[] {
  const { birthday } = player;
  if (birthday === null) {
    return [];
  }
  const isCovered = coverageOf(schedule);
  const onBirthday = schedule.games.filter(
    (game) => isBirthday(game.gameDayOn, birthday) && isCovered(game, game),
  );
  return datedTeamGames(player, onBirthday);
}

/**
 * His first games against a former team, in scheduled-start order (record 0015,
 * CL-TAX-18, CL-JOU-18, CL-STA-24). A former team is a team he played an official game
 * for (CL-STA-04); each stint with it ends at his departure, the last game he played for
 * it in that stint, and a period with it in which he played none is no stint with it.
 * The first official game between his team and it after his departure, while he belongs
 * to another team, is his reunion with it, played or not, and later meetings never count
 * until he has played for it again, so that each stint gives at most one, and a meeting
 * that follows two stints with one team follows the later one. A reunion is derived only
 * when every season from the departure to it is covered. Teams keep their id when a
 * franchise moves, so it stays one former team.
 */
export function formerTeamGames(
  player: Membership,
  schedule: CalendarSchedule,
): readonly FormerTeamGame[] {
  const isCovered = coverageOf(schedule);
  // For each team, the last game he played for it, while he has not met it since.
  const departures = new Map<TeamId, CalendarGame>();
  const reunions: FormerTeamGame[] = [];
  for (const teamGame of datedTeamGames(player, schedule.games)) {
    const met = [...departures].find(
      ([teamId]) => teamId !== teamGame.teamId && hasTeam(teamGame.game, teamId),
    );
    if (met !== undefined) {
      const [formerTeamId, departure] = met;
      departures.delete(formerTeamId);
      if (isCovered(departure, teamGame.game)) {
        reunions.push({ ...teamGame, formerTeamId, departure });
      }
    }
    if (teamGame.participation === 'played') {
      departures.set(teamGame.teamId, teamGame.game);
    }
  }
  return reunions;
}

/**
 * The games that a run derives among the qualifying ones that birthdayGames or
 * formerTeamGames give (CL-TAX-19): for a regular run, those that started after the
 * player's previous run, and his next game if it qualifies; for a full run, every game
 * already started, so that upcoming events are only ever derived by regular runs, for
 * his next game (CL-STA-25). A game has started when its scheduled start, the deemed one
 * while its time is to be determined (CL-STA-14), is not after the run's instant.
 */
export function gamesToDerive<Derived extends DerivedGame>(
  qualifying: readonly Derived[],
  run: DerivationRun,
): readonly Derived[] {
  return qualifying.filter(({ game }) => {
    const hasStarted = game.scheduledStartAt <= run.at;
    return run.kind === 'full'
      ? hasStarted
      : (hasStarted && game.scheduledStartAt > run.previousRunAt) || game.id === run.nextGameId;
  });
}
