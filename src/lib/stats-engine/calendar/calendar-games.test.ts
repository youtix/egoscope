import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { byScheduledStart } from '../schedule/series';
import { teamMembership } from '../schedule/team-membership';
import { hasTeam } from '../schedule/team-record';
import { birthdayGames, formerTeamGames, gamesToDerive } from './calendar-games';

import type { BoxScoreLine } from '../performance/box-score';
import type { SeasonSpan } from '../schedule/seasons';
import type { PlayerLine, PlayerTeamChange, TeamStint } from '../schedule/team-membership';
import type { GameId, IsoDate, TeamId } from '../types';
import type {
  Birthday,
  CalendarGame,
  CalendarPlayer,
  CalendarSchedule,
  DerivationRun,
  DerivedGame,
  FormerTeamGame,
} from './calendar-games';

// His teams, as the rulings name them, and two teams he never plays for.
const X = 1;
const Y = 2;
const Z = 3;
const W = 4;
const OTHER = 8;
const RIVAL = 9;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// The stored seasons, each from its first regular-season game to its last playoff game,
// the one in progress without an end; 1999-00 and 2099-00 hold two century years.
const SEASONS: readonly SeasonSpan[] = [
  { season: '1999-00', firstGameOn: '1999-11-02', lastGameOn: '2000-06-19' },
  { season: '2021-22', firstGameOn: '2021-10-19', lastGameOn: '2022-06-16' },
  { season: '2022-23', firstGameOn: '2022-10-18', lastGameOn: '2023-06-12' },
  { season: '2023-24', firstGameOn: '2023-10-24', lastGameOn: '2024-06-17' },
  { season: '2024-25', firstGameOn: '2024-10-22', lastGameOn: '2025-06-22' },
  { season: '2025-26', firstGameOn: '2025-10-21', lastGameOn: null },
  { season: '2099-00', firstGameOn: '2099-10-20', lastGameOn: '2100-06-15' },
];
const EVERY_SEASON = SEASONS.map(({ season }) => season);
const everySeasonBut = (season: string): readonly string[] =>
  EVERY_SEASON.filter((each) => each !== season);

/** 23:30 UTC on `day`: a tip-off at 19:30 or 18:30 US Eastern time, on that date. */
function tipOffOn(day: IsoDate): number {
  const [year = NaN, month = NaN, date = NaN] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date, 23, 30);
}

/** The final game of `home` against `away` on `day`, the lines of both teams published. */
const gameOn = (day: IsoDate, home: TeamId, away: TeamId): CalendarGame => ({
  id: Number(`${day.replaceAll('-', '')}${String(home)}`),
  phase: 'regular_season',
  status: 'final',
  scheduledStartAt: tipOffOn(day),
  gameDayOn: day,
  homeTeamId: home,
  awayTeamId: away,
  finalScore: { home: 104, away: 99 },
  homeLinesPublished: true,
  awayLinesPublished: true,
});

/** The final games of each day, home team and away team. */
const gamesOn = (...games: readonly (readonly [IsoDate, TeamId, TeamId])[]): CalendarGame[] =>
  games.map(([day, home, away]) => gameOn(day, home, away));

/** `game`, not played yet. */
const upcoming = (game: CalendarGame): CalendarGame => ({
  ...game,
  status: 'scheduled',
  finalScore: null,
  homeLinesPublished: false,
  awayLinesPublished: false,
});

// A line with zero minutes and nothing else: he did not play (CL-STA-04).
const NOT_PLAYED: BoxScoreLine = {
  minutesPrecision: 'whole_minutes',
  minutes: 0,
  seconds: null,
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  threePointersMade: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  personalFouls: 0,
};
// A line of a game he played.
const PLAYED: BoxScoreLine = { ...NOT_PLAYED, minutes: 30, points: 12, fieldGoalsMade: 6 };

/** His line in `game`, for `teamId`. */
const lineIn = (game: CalendarGame, teamId: TeamId, line = PLAYED): PlayerLine => ({
  gameId: game.id,
  scheduledStartAt: game.scheduledStartAt,
  teamId,
  line,
});

/** His lines in `games`, each played for `teamId`. */
const linesFor = (teamId: TeamId, games: readonly CalendarGame[]): PlayerLine[] =>
  games.map((game) => lineIn(game, teamId));

/** A change read from the player file at noon UTC on `day` (CL-STA-27). */
const observedOn = (id: number, day: IsoDate, newTeamId: TeamId | null): PlayerTeamChange => ({
  id,
  changedAt: tipOffOn(day) - 11.5 * HOUR,
  newTeamId,
  origin: 'observed',
});

/** A change the owner entered at noon UTC on `day` (CL-JOU-03). */
const enteredOn = (id: number, day: IsoDate, newTeamId: TeamId | null): PlayerTeamChange => ({
  ...observedOn(id, day, newTeamId),
  origin: 'entered',
});

const playerOf = (
  lines: readonly PlayerLine[],
  history: readonly PlayerTeamChange[] = [],
  birthday: Birthday | null = null,
): CalendarPlayer => ({ birthday, stints: teamMembership(lines, history), lines });

const scheduleOf = (
  games: readonly CalendarGame[],
  coveredSeasons: readonly string[] = EVERY_SEASON,
): CalendarSchedule => ({ games, seasons: SEASONS, coveredSeasons });

/** Each game as its day and his team. */
const daysAndTeams = (games: readonly DerivedGame[]): unknown[] =>
  games.map(({ game, teamId }) => [game.gameDayOn, teamId]);

/** Each reunion as its day, his team, the former team and the day of his departure. */
const reunionsOf = (games: readonly FormerTeamGame[]): unknown[] =>
  games.map(({ game, teamId, formerTeamId, departure }) => [
    game.gameDayOn,
    teamId,
    formerTeamId,
    departure.gameDayOn,
  ]);

/** The games of an answer, which must have read the season of every game that it needed. */
const gamesIn = <G>(found: { ok: true; games: readonly G[] } | { ok: false }): readonly G[] =>
  found.ok ? found.games : expect.unreachable('A season was not read.');

describe('birthdayGames', () => {
  const MARCH_14: Birthday = { month: 3, day: 14 };

  it('[CL-TAX-18] [CL-TRV-03] lists in scheduled-start order every official game of his team whose day has his day and month, played or not', () => {
    const first = gameOn('2023-10-25', X, OTHER);
    // 22:30 US Eastern time on 14 March is 02:30 UTC on the 15th: its day decides.
    const late = {
      ...gameOn('2024-03-14', X, OTHER),
      scheduledStartAt: Date.UTC(2024, 2, 15, 2, 30),
    };
    const missed = gameOn('2025-03-14', OTHER, X);
    const others = gamesOn(
      ['2024-03-13', X, RIVAL],
      ['2024-03-15', OTHER, X],
      ['2024-04-14', X, Z],
    );
    const games = [upcoming(gameOn('2026-03-14', X, RIVAL)), missed, late, first, ...others];
    const lines = [lineIn(first, X), lineIn(late, X), lineIn(missed, X, NOT_PLAYED)];
    const schedule = scheduleOf([...games, gameOn('2024-03-14', Y, RIVAL)]);
    const found = birthdayGames(playerOf(lines, [], MARCH_14), schedule);

    expect(daysAndTeams(gamesIn(found))).toStrictEqual([
      ['2024-03-14', X],
      ['2025-03-14', X],
      ['2026-03-14', X],
    ]);
  });

  // He plays for X from 1999 on.
  const since1999 = gameOn('1999-11-02', X, OTHER);
  const daysFound = (birthday: Birthday, day: IsoDate): readonly IsoDate[] => {
    const player = playerOf([lineIn(since1999, X)], [], birthday);
    const found = birthdayGames(player, scheduleOf([since1999, gameOn(day, X, RIVAL)]));
    return gamesIn(found).map(({ game }) => game.gameDayOn);
  };

  it.each([
    ['29 February in a leap year', '2024-02-29', ['2024-02-29']],
    ['28 February in a leap year', '2024-02-28', []],
    ['28 February in a common year', '2023-02-28', ['2023-02-28']],
    ['1 March in a common year', '2023-03-01', []],
    ['28 February 2000, a leap year: a century divisible by 400', '2000-02-28', []],
    ['29 February 2000', '2000-02-29', ['2000-02-29']],
    ['28 February 2100, a common year: a century', '2100-02-28', ['2100-02-28']],
  ])('[CL-JOU-17] finds for a birthday on 29 February the game on %s', (_, day, found) => {
    expect(daysFound({ month: 2, day: 29 }, day)).toStrictEqual(found);
  });

  it.each([
    [{ month: 2, day: 28 }, '2024-02-28', ['2024-02-28']],
    [{ month: 2, day: 28 }, '2024-02-29', []],
    [{ month: 3, day: 29 }, '2023-03-29', ['2023-03-29']],
    [{ month: 2, day: 10 }, '2023-02-10', ['2023-02-10']],
  ])('[CL-JOU-17] moves no other birthday: %o on %s', (birthday, day, found) => {
    expect(daysFound(birthday, day)).toStrictEqual(found);
  });

  it('[CL-JOU-16] gives a player without a recorded birthday no birthday game', () => {
    const first = gameOn('2023-10-25', X, OTHER);
    const games = [first, ...gamesOn(['2024-03-14', X, OTHER], ['2024-10-25', X, RIVAL])];
    const player = playerOf([lineIn(first, X)]);

    expect(birthdayGames(player, scheduleOf(games))).toStrictEqual({ ok: true, games: [] });
  });

  it('[CL-TAX-18] [CL-STA-05] takes his team at the start of each game: none before his first game, and after a recorded trade the new team before he plays for it', () => {
    const first = gameOn('2023-10-25', X, OTHER);
    const firstAtY = gameOn('2024-03-20', Y, RIVAL);
    const others = gamesOn(
      ['2023-03-14', X, OTHER],
      ['2024-03-14', X, RIVAL],
      ['2024-03-14', Y, W],
    );
    const lines = [...linesFor(X, [first]), ...linesFor(Y, [firstAtY])];
    const player = playerOf(lines, [observedOn(1, '2024-02-08', Y)], MARCH_14);
    const found = birthdayGames(player, scheduleOf([...others, first, firstAtY]));

    expect(daysAndTeams(gamesIn(found))).toStrictEqual([['2024-03-14', Y]]);
  });

  it('[CL-STA-24] finds birthday games in covered seasons only', () => {
    const first = gameOn('2021-10-20', X, OTHER);
    const games = ['2022-03-14', '2023-03-14', '2024-03-14'].map((day) => gameOn(day, X, OTHER));
    const schedule = scheduleOf([first, ...games], ['2021-22', '2023-24']);
    const found = birthdayGames(playerOf([lineIn(first, X)], [], MARCH_14), schedule);

    expect(daysAndTeams(gamesIn(found))).toStrictEqual([
      ['2022-03-14', X],
      ['2024-03-14', X],
    ]);
  });

  it('[CL-TAX-18] [CL-STA-14] [CL-STA-17] counts play-in and playoff games, and no postponed or canceled game nor a placeholder', () => {
    const first = gameOn('2021-10-20', X, OTHER);
    const games: CalendarGame[] = [
      first,
      { ...gameOn('2022-04-20', X, OTHER), phase: 'playoffs' },
      { ...gameOn('2023-04-20', OTHER, X), phase: 'play_in' },
      { ...gameOn('2024-04-20', X, OTHER), status: 'postponed', finalScore: null },
      { ...gameOn('2025-04-20', X, OTHER), status: 'canceled', finalScore: null },
      { ...upcoming(gameOn('2026-04-20', X, OTHER)), awayTeamId: null },
    ];
    const player = playerOf([lineIn(first, X)], [], { month: 4, day: 20 });
    const found = birthdayGames(player, scheduleOf(games));

    expect(daysAndTeams(gamesIn(found))).toStrictEqual([
      ['2022-04-20', X],
      ['2023-04-20', X],
    ]);
  });
});

// He leaves X for Y on 1 July 2022, then meets X on 15 November 2023, his birthday, and on
// 20 January 2024.
const LEFT_X = gameOn('2022-01-10', X, OTHER);
const AT_Y = gameOn('2023-10-25', Y, OTHER);
const TRADED_GAMES = [LEFT_X, AT_Y, ...gamesOn(['2023-11-15', Y, X], ['2024-01-20', X, Y])];
const TRADED_LINES = [...linesFor(X, [LEFT_X]), ...linesFor(Y, TRADED_GAMES.slice(1))];
const TRADED = playerOf(TRADED_LINES, [observedOn(1, '2022-07-01', Y)], { month: 11, day: 15 });

describe('the calendar games while a season is not read', () => {
  // Each time, the spans of both seasons that the day of that game can belong to are left out.
  it.each([
    ['a game on his birthday', birthdayGames, ['2022-23', '2023-24']],
    ['the departure that a reunion follows', formerTeamGames, ['2021-22', '2022-23']],
    ['a reunion', formerTeamGames, ['2022-23', '2023-24']],
  ])(
    '[CL-STA-24] [STA-48] [CL-STA-28] gives season_not_read, never a guessed season, when the stored spans cannot tell the season of %s',
    (_, derive, candidates) => {
      const seasons = SEASONS.filter(({ season }) => !candidates.includes(season));
      const found = derive(TRADED, { ...scheduleOf(TRADED_GAMES), seasons });

      expect(found).toStrictEqual({ ok: false, error: { kind: 'season_not_read', candidates } });
    },
  );
});

describe('formerTeamGames', () => {
  it('[CL-TAX-18] [CL-JOU-18] takes the first game between his team and a team he played for after his last game for it, while he belongs to another team, played or not, and no later meeting', () => {
    const atX = gamesOn(['2023-10-25', X, OTHER], ['2023-12-01', OTHER, X]);
    const missedAtX = gameOn('2024-01-05', X, RIVAL);
    const atY = gameOn('2024-01-25', Y, OTHER);
    const reunion = gameOn('2024-02-10', Y, X);
    const later = gameOn('2024-03-10', X, Y);
    const lines = [
      ...linesFor(X, atX),
      lineIn(missedAtX, X, NOT_PLAYED),
      ...linesFor(Y, [atY, later]),
      lineIn(reunion, Y, NOT_PLAYED),
    ];
    const player = playerOf(lines, [observedOn(1, '2024-01-20', Y)]);
    const found = formerTeamGames(player, scheduleOf([later, reunion, atY, missedAtX, ...atX]));

    expect(reunionsOf(gamesIn(found))).toStrictEqual([['2024-02-10', Y, X, '2023-12-01']]);
  });

  it('[CL-TAX-18] [CL-JOU-18] gives each stint its own reunion: going X, Y, X again, then Z gives two with X and one with Y', () => {
    const firstAtX = gamesOn(['2021-10-20', X, OTHER], ['2022-01-10', X, RIVAL]);
    const atY = gamesOn(['2022-02-01', Y, OTHER], ['2022-03-01', Y, X], ['2022-03-20', X, Y]);
    const againAtX = gamesOn(['2022-10-20', X, W], ['2022-11-15', X, Y], ['2023-01-15', RIVAL, X]);
    const atZ = gamesOn(['2023-02-10', Z, OTHER], ['2023-03-05', Z, X], ['2023-03-25', X, Z]);
    const lines = [
      ...linesFor(X, [...firstAtX, ...againAtX]),
      ...linesFor(Y, atY),
      ...linesFor(Z, atZ),
    ];
    const schedule = scheduleOf([...atZ, ...againAtX, ...atY, ...firstAtX]);
    const found = formerTeamGames(playerOf(lines), schedule);

    expect(reunionsOf(gamesIn(found))).toStrictEqual([
      ['2022-03-01', Y, X, '2022-01-10'],
      ['2022-11-15', X, Y, '2022-03-20'],
      ['2023-03-05', Z, X, '2023-01-15'],
    ]);
  });

  it('[CL-TAX-18] [CL-JOU-03] takes as his reunion, after a trade entered while he was injured, the first meeting before his first game for the new team, not a later one he plays', () => {
    const atX = gameOn('2023-12-01', X, OTHER);
    const reunion = gameOn('2024-01-22', Y, X);
    const firstAtY = gameOn('2024-02-01', Y, OTHER);
    const later = gameOn('2024-02-15', X, Y);
    const lines = [...linesFor(X, [atX]), ...linesFor(Y, [firstAtY, later])];
    const player = playerOf(lines, [enteredOn(1, '2024-01-20', Y)]);
    const found = formerTeamGames(player, scheduleOf([atX, reunion, firstAtY, later]));

    expect(reunionsOf(gamesIn(found))).toStrictEqual([['2024-01-22', Y, X, '2023-12-01']]);
  });

  it('[CL-TAX-18] [CL-JOU-18] makes no stint of a period in which he played no game for a team: no former team of it, and no new departure from a team he had played for', () => {
    // Added with W, he plays for X, Y, comes back to X without playing, then goes to Z.
    const atW = gameOn('2021-10-25', W, OTHER);
    const atX = gamesOn(['2021-11-01', X, OTHER], ['2021-12-01', RIVAL, X]);
    const atY = gameOn('2022-01-10', Y, OTHER);
    const backAtX = gamesOn(['2022-02-10', X, Y], ['2022-02-20', X, OTHER]);
    const atZ = gamesOn(['2022-03-05', Z, OTHER], ['2022-03-12', Z, X], ['2022-03-20', Z, W]);
    const history = [
      observedOn(1, '2021-10-01', W),
      observedOn(2, '2022-01-05', Y),
      observedOn(3, '2022-02-01', X),
      observedOn(4, '2022-03-01', Z),
    ];
    const lines = [...linesFor(X, atX), ...linesFor(Y, [atY]), ...linesFor(Z, atZ)];
    const schedule = scheduleOf([atW, ...atX, atY, ...backAtX, ...atZ]);
    const found = formerTeamGames(playerOf(lines, history), schedule);

    expect(reunionsOf(gamesIn(found))).toStrictEqual([
      ['2022-02-10', X, Y, '2022-01-10'],
      ['2022-03-12', Z, X, '2021-12-01'],
    ]);
  });

  it('[CL-JOU-18] keeps a franchise that moved one former team, under the id it keeps', () => {
    // X plays the 2022-23 season in its old city and the 2023-24 season in its new one.
    const atX = gameOn('2023-01-10', X, OTHER);
    const atY = gameOn('2023-10-25', Y, OTHER);
    const meetings = gamesOn(['2023-11-20', X, Y], ['2024-01-15', Y, X]);
    const player = playerOf([...linesFor(X, [atX]), ...linesFor(Y, [atY, ...meetings])]);
    const found = formerTeamGames(player, scheduleOf([atX, atY, ...meetings]));

    expect(reunionsOf(gamesIn(found))).toStrictEqual([['2023-11-20', Y, X, '2023-01-10']]);
  });

  it.each([
    ['all covered', EVERY_SEASON, [['2023-11-15', Y, X, '2022-01-10']]],
    ['a season in between not covered', everySeasonBut('2022-23'), []],
    ['the season of the meeting not covered', everySeasonBut('2023-24'), []],
    ['the season of his departure not covered', everySeasonBut('2021-22'), []],
  ])(
    '[CL-STA-24] [CL-JOU-18] derives a reunion only when every season from his departure to it is covered, and never a later meeting: %s',
    (_, covered, expected) => {
      const found = formerTeamGames(TRADED, scheduleOf(TRADED_GAMES, covered));

      expect(reunionsOf(gamesIn(found))).toStrictEqual(expected);
    },
  );

  it('[CL-TAX-18] [CL-STA-25] [CL-TAX-19] judges his next game as a past game, so that a regular run derives an upcoming reunion', () => {
    const atX = gameOn('2025-01-10', X, OTHER);
    const atY = gameOn('2025-10-22', Y, OTHER);
    const next = upcoming(gameOn('2025-11-20', X, Y));
    const player = playerOf([lineIn(atX, X), lineIn(atY, Y)], [observedOn(1, '2025-07-01', Y)]);
    const run: DerivationRun = {
      kind: 'regular',
      at: tipOffOn('2025-11-01'),
      previousRunAt: tipOffOn('2025-10-31'),
      nextGameId: next.id,
    };
    const qualifying = gamesIn(formerTeamGames(player, scheduleOf([atX, atY, next])));

    expect(reunionsOf(gamesToDerive(qualifying, run))).toStrictEqual([
      ['2025-11-20', Y, X, '2025-01-10'],
    ]);
  });
});

describe('gamesToDerive', () => {
  // The previous run came at the tip-off of 10 March, this one comes at that of 20 March.
  const started = gamesOn(
    ['2024-03-01', X, OTHER],
    ['2024-03-10', X, OTHER],
    ['2024-03-15', X, OTHER],
    ['2024-03-20', X, OTHER],
  );
  const toCome = gamesOn(['2024-03-25', X, OTHER], ['2024-04-05', X, OTHER]);
  const qualifying = [...started, ...toCome.map((game) => upcoming(game))].map(
    (game): DerivedGame => ({ game, teamId: X, participation: null, minutes: null }),
  );
  const at = tipOffOn('2024-03-20');
  const regularRun = (nextGameId: GameId | null): DerivationRun => ({
    kind: 'regular',
    at,
    previousRunAt: tipOffOn('2024-03-10'),
    nextGameId,
  });
  const FULL_RUN: DerivationRun = { kind: 'full', at };
  const NEXT_QUALIFYING = gameOn('2024-03-25', X, OTHER).id;
  const NEXT_NOT_QUALIFYING = gameOn('2024-03-23', RIVAL, X).id;

  it.each([
    ['regular, his next game qualifying', regularRun(NEXT_QUALIFYING), ['03-15', '03-20', '03-25']],
    ['regular, his next game not qualifying', regularRun(NEXT_NOT_QUALIFYING), ['03-15', '03-20']],
    ['regular, no game scheduled', regularRun(null), ['03-15', '03-20']],
    ['full', FULL_RUN, ['03-01', '03-10', '03-15', '03-20']],
  ])(
    '[CL-TAX-19] derives the games started after the previous run and up to the run, with his next game if it qualifies, or for a full run every started game: %s',
    (_, run, days) => {
      const derived = gamesToDerive(qualifying, run).map(({ game }) => game.gameDayOn.slice(5));

      expect(derived).toStrictEqual(days);
    },
  );
});

// Any league data over the first three months of 2022 to 2025, four seasons: games of
// four teams, each tipping off at its own minute; his lines in some of them; his team
// history; the covered seasons among the four.
const TEAMS = [X, Y, Z, W];
const anyTeam = fc.constantFrom(...TEAMS);
const twoDigits = (value: number): string => String(value).padStart(2, '0');
const anyDay: fc.Arbitrary<IsoDate> = fc.oneof(
  fc
    .record({
      year: fc.integer({ min: 2022, max: 2025 }),
      month: fc.integer({ min: 1, max: 3 }),
      date: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ year, month, date }) => `${String(year)}-${twoDigits(month)}-${twoDigits(date)}`),
  fc.constant('2024-02-29'),
);
const anySide = fc.constantFrom<'away' | 'home'>('home', 'away');
const anyLine = fc.option(fc.record({ side: anySide, box: fc.constantFrom(PLAYED, NOT_PLAYED) }), {
  nil: null,
});
const anyRows = fc.uniqueArray(
  fc
    .record({ day: anyDay, home: anyTeam, away: anyTeam, line: anyLine })
    .filter(({ home, away }) => home !== away),
  { selector: ({ day, home }) => `${day} ${String(home)}`, maxLength: 40 },
);
const anyHistory = fc.array(
  fc.record({ day: anyDay, newTeamId: fc.option(anyTeam, { nil: null }), isEntered: fc.boolean() }),
  { maxLength: 4 },
);
const anyBirthday: fc.Arbitrary<Birthday> = fc.record({
  month: fc.integer({ min: 1, max: 3 }),
  day: fc.integer({ min: 1, max: 29 }),
});
const anyCovered = fc.subarray(['2021-22', '2022-23', '2023-24', '2024-25']);
const anyData = fc
  .record({ rows: anyRows, rowsOfHistory: anyHistory, covered: anyCovered })
  .map(({ rows, rowsOfHistory, covered }) => {
    const played = rows.map((row) => ({
      row,
      game: {
        ...gameOn(row.day, row.home, row.away),
        scheduledStartAt: tipOffOn(row.day) + row.home * MINUTE,
      },
    }));
    const lines = played.flatMap(({ row: { line, home, away }, game }) =>
      line === null ? [] : lineIn(game, { home, away }[line.side], line.box),
    );
    const history = rowsOfHistory.map(({ day, newTeamId, isEntered }, index) =>
      (isEntered ? enteredOn : observedOn)(index + 1, day, newTeamId),
    );
    const games = played.map(({ game }) => game);
    return { player: playerOf(lines, history), schedule: scheduleOf(games, covered) };
  });

/** His stint at `at`, by the oracle of the tests. */
const stintAt = (stints: readonly TeamStint[], at: number): TeamStint | undefined =>
  stints.find(({ from, until }) => from <= at && (until === null || at < until));

/** Whether `game` is a game of `teamId`, the team of his stint at its start. */
function isHisTeamGame(game: CalendarGame, teamId: TeamId, player: CalendarPlayer): boolean {
  return stintAt(player.stints, game.scheduledStartAt)?.teamId === teamId && hasTeam(game, teamId);
}

/**
 * Whether `reunion` meets the former team with another team of his, after his departure,
 * which is the last game he played for it in the stint that holds that departure.
 */
function isAfterHisLastGame(reunion: FormerTeamGame, player: CalendarPlayer): boolean {
  const { game, teamId, formerTeamId, departure } = reunion;
  const stint = stintAt(player.stints, departure.scheduledStartAt);
  const playedInStint = player.lines
    .filter((line) => line.teamId === formerTeamId && line.line === PLAYED)
    .map(({ scheduledStartAt }) => scheduledStartAt)
    .filter((at) => stint !== undefined && stintAt([stint], at) !== undefined);
  return (
    stint?.teamId === formerTeamId &&
    Math.max(...playedInStint) === departure.scheduledStartAt &&
    teamId !== formerTeamId &&
    hasTeam(game, formerTeamId) &&
    departure.scheduledStartAt < game.scheduledStartAt
  );
}

/** Whether `day`, of 2022 to 2025, is `birthday`: 29 February falls on the 28th but in 2024. */
function isBirthdayOracle(day: IsoDate, birthday: Birthday): boolean {
  const isMoved = birthday.month === 2 && birthday.day === 29 && !day.startsWith('2024');
  const monthAndDay = isMoved ? '02-28' : `${twoDigits(birthday.month)}-${twoDigits(birthday.day)}`;
  return day.endsWith(monthAndDay);
}

/** The season of a day of the first three months of a year: 2024-02-10 is in 2023-24. */
const seasonOracle = (day: IsoDate): string => {
  const year = Number(day.slice(0, 4));
  return `${String(year - 1)}-${twoDigits(year % 100)}`;
};

/** The games of his team on `birthday` in a covered season, in scheduled-start order. */
function birthdayGamesOracle(
  player: CalendarPlayer,
  schedule: CalendarSchedule,
  birthday: Birthday,
): readonly CalendarGame[] {
  const isCovered = (game: CalendarGame): boolean =>
    schedule.coveredSeasons.includes(seasonOracle(game.gameDayOn));
  const isHis = (game: CalendarGame): boolean =>
    TEAMS.some((teamId) => isHisTeamGame(game, teamId, player));
  return schedule.games
    .filter((game) => isBirthdayOracle(game.gameDayOn, birthday) && isCovered(game) && isHis(game))
    .toSorted(byScheduledStart);
}

describe('the calendar games over any data', () => {
  it('[CL-TAX-18] [CL-STA-05] derives only games of the team he belonged to at their start', () => {
    fc.assert(
      fc.property(anyData, anyBirthday, ({ player, schedule }, birthday) => {
        const birthdays = gamesIn(birthdayGames({ ...player, birthday }, schedule));
        const derived = [...birthdays, ...gamesIn(formerTeamGames(player, schedule))];

        expect(derived.every(({ game, teamId }) => isHisTeamGame(game, teamId, player))).toBe(true);
      }),
    );
  });

  it('[CL-TAX-18] [CL-JOU-18] gives no stint two reunions, each after the last game he played for the former team in that stint, in scheduled-start order', () => {
    fc.assert(
      fc.property(anyData, ({ player, schedule }) => {
        const reunions = gamesIn(formerTeamGames(player, schedule));
        const games = reunions.map(({ game }) => game);
        const stints = reunions.map(({ departure }) =>
          stintAt(player.stints, departure.scheduledStartAt),
        );

        expect(new Set(stints).size).toBe(reunions.length);
        expect(reunions.every((reunion) => isAfterHisLastGame(reunion, player))).toBe(true);
        expect(games).toStrictEqual(games.toSorted(byScheduledStart));
      }),
    );
  });

  it('[CL-TAX-18] [CL-JOU-17] [CL-STA-24] lists every game of his team on his birthday in a covered season, in scheduled-start order, and no other', () => {
    fc.assert(
      fc.property(anyData, anyBirthday, ({ player, schedule }, birthday) => {
        const found = gamesIn(birthdayGames({ ...player, birthday }, schedule));

        expect(found.map(({ game }) => game)).toStrictEqual(
          birthdayGamesOracle(player, schedule, birthday),
        );
      }),
    );
  });
});
