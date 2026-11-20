import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { rebuildSeries } from './series';

import type { RebuiltSeries, SeriesGame, SeriesGamePosition, SeriesRound } from './series';
import type { GameStatus } from './team-record';

const DAY = 86_400_000;
// 2023-04-15T00:00:00Z: day 0 of the games below.
const DAY_ZERO = 1_681_516_800_000;

// Whether a game of a later season is stored, as it is for a past season and not for the
// latest one (`!IS_PAST`): a past season's series end as its stored games say, while
// those of the latest season end on wins only.
const IS_PAST = true;

type Teams = readonly [number, number];

type GameSpec = Partial<SeriesGame> &
  Readonly<{ id: number; day: number; teams: readonly [number | null, number | null] }>;

/** A scheduled playoff game on `day` between `teams`, the first one at home. */
function gameOf({ id, day, teams, ...fields }: GameSpec): SeriesGame {
  return {
    id,
    phase: 'playoffs',
    status: 'scheduled',
    scheduledStartAt: DAY_ZERO + day * DAY,
    homeTeamId: teams[0],
    awayTeamId: teams[1],
    finalScore: null,
    roundLabel: null,
    sourceGameNumber: null,
    ...fields,
  };
}

type SeriesOptions = Readonly<{
  from?: number;
  phase?: 'play_in' | 'playoffs';
  label?: SeriesRound;
  isNumbered?: boolean;
  day?: number;
}>;

/**
 * The final games of a series between `teams`, one per letter of `winners`: `a` when the
 * first team won it, `b` when the second did. Their identifiers count up `from` 1, the
 * first team is at home in the odd games, and the games are two days apart from `day`.
 */
function series(teams: Teams, winners: string, options: SeriesOptions = {}): SeriesGame[] {
  const from = options.from ?? 1;
  return Array.from(winners, (winner, index) => {
    const [home, away] = index % 2 === 0 ? teams : [teams[1], teams[0]];
    const isHomeWin = (winner === 'a') === (home === teams[0]);
    return gameOf({
      id: from + index,
      day: (options.day ?? 0) + 2 * index,
      teams: [home, away],
      phase: options.phase ?? 'playoffs',
      status: 'final',
      finalScore: isHomeWin ? { home: 108, away: 101 } : { home: 99, away: 112 },
      roundLabel: options.label ?? null,
      sourceGameNumber: options.isNumbered === true ? index + 1 : null,
    });
  });
}

/** `games`, the game `id` changed by `fields`. */
function changed(
  games: readonly SeriesGame[],
  id: number,
  fields: Partial<SeriesGame>,
): SeriesGame[] {
  return games.map((game) => (game.id === id ? { ...game, ...fields } : game));
}

const unknown = (gameId: number): SeriesGamePosition => ({
  gameId,
  gameNumber: null,
  homeSeriesWinsBefore: null,
  awaySeriesWinsBefore: null,
  isEliminationGame: null,
});

/** The position of `gameId`: its number, then the home and away wins before it, and its flag. */
const at = (
  gameId: number,
  gameNumber: number,
  [home, away, isEliminationGame]: readonly [number, number, boolean | null],
): SeriesGamePosition => ({
  gameId,
  gameNumber,
  homeSeriesWinsBefore: home,
  awaySeriesWinsBefore: away,
  isEliminationGame,
});

const facts = (rebuilt: readonly RebuiltSeries[]): unknown[] =>
  rebuilt.map(({ teamAId, teamBId, round, winsNeeded, isRebuilt }) => [
    teamAId,
    teamBId,
    round,
    winsNeeded,
    isRebuilt,
  ]);

const roundOf = (games: readonly SeriesGame[]): SeriesRound | null | undefined =>
  rebuildSeries('2022-23', games, IS_PAST)[0]?.round;

// A sixteen-team bracket, round by round, the winner of each series first: team 9 beats
// team 8, of the lower identifier, and goes on.
const BRACKET: readonly (readonly Teams[])[] = [
  [
    [1, 16],
    [9, 8],
    [4, 13],
    [5, 12],
    [2, 15],
    [7, 10],
    [3, 14],
    [6, 11],
  ],
  [
    [1, 9],
    [4, 5],
    [2, 7],
    [3, 6],
  ],
  [
    [1, 4],
    [2, 3],
  ],
  [[1, 2]],
];
const ROUNDS: readonly SeriesRound[] = [
  'first_round',
  'conference_semifinals',
  'conference_finals',
  'finals',
];

/** The bracket's games: each first-round series won `firstRound`, every later one swept. */
function bracket(firstRound: string, isLabeled = false): SeriesGame[] {
  return BRACKET.flatMap((pairs, round) =>
    pairs.flatMap((teams, index) => {
      const label = ROUNDS[round];
      return series(teams, round === 0 ? firstRound : 'aaaa', {
        from: 100 * (round + 1) + 10 * index,
        day: 20 * round,
        isNumbered: isLabeled,
        ...(isLabeled && label !== undefined && { label }),
      });
    }),
  );
}

/** The facts of every series of the bracket, a first-round series taking `firstRoundWins`. */
const bracketFacts = (firstRoundWins: number): unknown[] =>
  BRACKET.flatMap((pairs, round) =>
    pairs.map((teams) => [
      Math.min(...teams),
      Math.max(...teams),
      ROUNDS[round],
      round === 0 ? firstRoundWins : 4,
      true,
    ]),
  );

/** The facts of the bracket rebuilt in `season`, its first round won `firstRound`. */
const bracketIn = (season: string, firstRound: string): unknown[] =>
  facts(rebuildSeries(season, bracket(firstRound), IS_PAST));

// Series that cannot be rebuilt, in a past season as in the latest one, and why.
const UNREBUILDABLE: readonly (readonly [string, string, readonly SeriesGame[]])[] = [
  [
    'the source numbers a game otherwise',
    '2022-23',
    changed(series([1, 8], 'aaaa', { isNumbered: true }), 3, { sourceGameNumber: 4 }),
  ],
  [
    'a final game is listed without its score',
    '2022-23',
    changed(series([1, 8], 'aaaaa'), 2, { finalScore: null }),
  ],
  ['a game follows the deciding win, the winner at home', '2022-23', series([1, 8], 'aaaaa')],
  ['a game follows the deciding win, the winner away', '2022-23', series([1, 8], 'bbbbb')],
  [
    'a game still to play comes before a final one',
    '2022-23',
    changed(series([1, 8], 'aaaa'), 2, { status: 'scheduled', finalScore: null }),
  ],
];

// Series that no team has won, with no game left to play: a game of them is missing, or
// the source has not listed the next one yet.
const NOT_WON: readonly (readonly [string, readonly SeriesGame[]])[] = [
  ['a first round at three games to two', series([1, 8], 'aabab')],
  [
    'Finals tied two games to two, their fifth game not listed',
    series([1, 7], 'abab', { from: 51, label: 'finals', isNumbered: true }),
  ],
];

const anySeason = fc.constantFrom('1997-98', '2001-02', '2002-03', '2019-20', '2022-23');
const anySourceNumber = fc.option(fc.integer({ min: 1, max: 6 }), { nil: null, freq: 2 });
const anyStatus = fc.constantFrom<GameStatus>(
  'final',
  'final',
  'scheduled',
  'postponed',
  'canceled',
);
const anyRow = fc.record({
  phase: fc.constantFrom('play_in', 'playoffs'),
  status: anyStatus,
  isFirstAtHome: fc.boolean(),
  isFirstWinner: fc.boolean(),
  sourceGameNumber: anySourceNumber,
});

// Games of two teams, each a play-in or playoff game of any status, with or without the
// source's number.
const anyPostseason: fc.Arbitrary<SeriesGame[]> = fc.array(anyRow, { maxLength: 10 }).map((rows) =>
  rows.map((row, index) =>
    gameOf({
      id: index + 1,
      day: index,
      teams: row.isFirstAtHome ? [1, 2] : [2, 1],
      phase: row.phase,
      status: row.status,
      finalScore:
        row.isFirstWinner === row.isFirstAtHome ? { home: 104, away: 97 } : { home: 97, away: 104 },
      sourceGameNumber: row.sourceGameNumber,
    }),
  ),
);

/** The numbered positions of every series, with their rank and their series' wins needed. */
function numberedPositions(
  rebuilt: readonly RebuiltSeries[],
): readonly (SeriesGamePosition & Readonly<{ rank: number; winsNeeded: number }>)[] {
  return rebuilt.flatMap((each) =>
    each.games
      .filter((position) => position.gameNumber !== null)
      .map((position, index) => ({ ...position, rank: index + 1, winsNeeded: each.winsNeeded })),
  );
}

/** The larger of the two teams' series wins before a game, 0 when unknown. */
const highestWins = (position: SeriesGamePosition): number =>
  Math.max(position.homeSeriesWinsBefore ?? 0, position.awaySeriesWinsBefore ?? 0);

describe('rebuildSeries', () => {
  it('[STA-07] [CL-STA-18] flags the 9-10 and 8th-seed play-in games as eliminating their loser, and the 7-8 game as not', () => {
    const playIn = [
      ...series([7, 8], 'a', { from: 1, phase: 'play_in', label: 'play_in_7_vs_8' }),
      ...series([9, 10], 'b', { from: 2, phase: 'play_in', label: 'play_in_9_vs_10' }),
      ...series([8, 10], 'a', { from: 3, phase: 'play_in', label: 'play_in_8th_seed', day: 2 }),
    ];

    expect(rebuildSeries('2022-23', playIn, IS_PAST)).toStrictEqual([
      {
        phase: 'play_in',
        teamAId: 7,
        teamBId: 8,
        round: 'play_in_7_vs_8',
        winsNeeded: 1,
        isRebuilt: true,
        games: [at(1, 1, [0, 0, false])],
      },
      {
        phase: 'play_in',
        teamAId: 9,
        teamBId: 10,
        round: 'play_in_9_vs_10',
        winsNeeded: 1,
        isRebuilt: true,
        games: [at(2, 1, [0, 0, true])],
      },
      {
        phase: 'play_in',
        teamAId: 8,
        teamBId: 10,
        round: 'play_in_8th_seed',
        winsNeeded: 1,
        isRebuilt: true,
        games: [at(3, 1, [0, 0, true])],
      },
    ]);
  });

  it('[STA-05] [STA-07] numbers the games of a labeled series in date order, with the wins of each team before each, and flags those a team one win short of four can end', () => {
    // Team 1 is at home in games 1, 3 and 5; it wins games 1, 3, 4 and 6.
    const games = series([1, 8], 'abaaba', { from: 11, label: 'first_round', isNumbered: true });

    expect(rebuildSeries('2022-23', games.toReversed(), IS_PAST)).toStrictEqual([
      {
        phase: 'playoffs',
        teamAId: 1,
        teamBId: 8,
        round: 'first_round',
        winsNeeded: 4,
        isRebuilt: true,
        games: [
          at(11, 1, [0, 0, false]),
          at(12, 2, [0, 1, false]),
          at(13, 3, [1, 1, false]),
          at(14, 4, [1, 2, false]),
          at(15, 5, [3, 1, true]),
          at(16, 6, [2, 3, true]),
        ],
      },
    ]);
  });

  it('[STA-05] [CL-STA-18] finds the rounds of an unlabeled season from the playoff series each team played before, the first being the first round', () => {
    expect(bracketIn('2002-03', 'aaaa')).toStrictEqual(bracketFacts(4));
  });

  it('[CL-STA-18] finds by the order the rounds that the labels of a labeled season give (T19)', () => {
    const labeled = rebuildSeries('2022-23', bracket('abaaa', true), IS_PAST);

    expect(facts(labeled)).toStrictEqual(bracketFacts(4));
    expect(rebuildSeries('2022-23', bracket('abaaa'), IS_PAST)).toStrictEqual(labeled);
  });

  it('[STA-07] [CL-STA-18] plays a best of five in the first round up to 2001-02 and a best of seven from 2002-03, every later round a best of seven', () => {
    expect(bracketIn('2001-02', 'aaa')).toStrictEqual(bracketFacts(3));
    expect(bracketIn('1997-98', 'aaa')).toStrictEqual(bracketFacts(3));
    expect(bracketIn('2002-03', 'aaa').slice(0, 1)).toStrictEqual([
      [1, 16, 'first_round', 4, false],
    ]);
  });

  it('[STA-07] [CL-STA-18] flags in a best-of-five first round the games a team one win short of three can end', () => {
    const [firstRound] = rebuildSeries('2001-02', series([1, 8], 'ababa', { from: 21 }), IS_PAST);

    expect(firstRound?.games).toStrictEqual([
      at(21, 1, [0, 0, false]),
      at(22, 2, [0, 1, false]),
      at(23, 3, [1, 1, false]),
      at(24, 4, [1, 2, true]),
      at(25, 5, [2, 2, true]),
    ]);
  });

  it('[STA-05] [STA-07] numbers and flags the next game of a series under way, and gives no position to later, postponed or canceled games', () => {
    const games = [
      ...series([1, 8], 'aaab', { from: 31, isNumbered: true }),
      gameOf({ id: 35, day: 8, teams: [1, 8], sourceGameNumber: 5 }),
      gameOf({ id: 36, day: 10, teams: [8, 1], sourceGameNumber: 6 }),
      gameOf({ id: 37, day: 7, teams: [8, 1], status: 'postponed' }),
      gameOf({ id: 38, day: 9, teams: [1, 8], status: 'canceled' }),
    ];
    const [underWay] = rebuildSeries('2022-23', games, IS_PAST);

    expect(underWay?.isRebuilt).toBe(true);
    expect(underWay?.games).toStrictEqual([
      at(31, 1, [0, 0, false]),
      at(32, 2, [0, 1, false]),
      at(33, 3, [2, 0, false]),
      at(34, 4, [0, 3, true]),
      unknown(37),
      at(35, 5, [3, 1, true]),
      unknown(38),
      unknown(36),
    ]);
  });

  it('[STA-07] gives no position to a game still listed after the deciding win', () => {
    const games = [
      ...series([1, 8], 'aaaa', { from: 41 }),
      gameOf({ id: 45, day: 8, teams: [1, 8] }),
    ];
    const [swept] = rebuildSeries('2022-23', games, IS_PAST);

    expect(swept?.isRebuilt).toBe(true);
    expect(swept?.games.map((position) => position.gameNumber)).toStrictEqual([1, 2, 3, 4, null]);
  });

  it.each(UNREBUILDABLE)(
    '[STA-07] [CL-STA-18] cannot rebuild a series when %s, whether a game of a later season is stored or not, and leaves every game of it unknown',
    (_, season, games) => {
      const rebuilt = [IS_PAST, !IS_PAST].map((hasLaterSeasonGame) =>
        rebuildSeries(season, games, hasLaterSeasonGame).at(0),
      );
      const expected = { isRebuilt: false, games: games.map((game) => unknown(game.id)) };

      expect(rebuilt).toMatchObject([expected, expected]);
    },
  );

  it.each(NOT_WON)(
    '[STA-07] [CL-STA-18] cannot rebuild a series of a past season that no team won, a game of it missing, and leaves every game of it unknown: %s',
    (_, games) => {
      const [rebuilt] = rebuildSeries('2025-26', games, IS_PAST);

      expect(rebuilt?.isRebuilt).toBe(false);
      expect(rebuilt?.games).toStrictEqual(games.map((game) => unknown(game.id)));
    },
  );

  it.each(NOT_WON)(
    '[STA-05] [CL-STA-18] [CL-STA-20] keeps under way a series of the latest season that no team has won yet, its next game not listed, and numbers its games: %s',
    (_, games) => {
      const [rebuilt] = rebuildSeries('2025-26', games, !IS_PAST);

      expect(rebuilt?.isRebuilt).toBe(true);
      expect(rebuilt?.games.map((position) => position.gameNumber)).toStrictEqual(
        games.map((_game, index) => index + 1),
      );
    },
  );

  it("[STA-05] [STA-07] [CL-STA-18] [CL-STA-20] places every game of the latest season's Finals tied two games to two, their fifth game not listed yet", () => {
    const finals = series([1, 7], 'abab', { from: 51, label: 'finals', isNumbered: true });

    expect(rebuildSeries('2025-26', finals, !IS_PAST)).toStrictEqual([
      {
        phase: 'playoffs',
        teamAId: 1,
        teamBId: 7,
        round: 'finals',
        winsNeeded: 4,
        isRebuilt: true,
        games: [
          at(51, 1, [0, 0, false]),
          at(52, 2, [0, 1, false]),
          at(53, 3, [1, 1, false]),
          at(54, 4, [1, 2, false]),
        ],
      },
    ]);
  });

  it('[STA-07] [CL-STA-18] [CL-STA-20] ends a series won four games to one alike whether a game of a later season is stored or not, a game listed after it unplaced', () => {
    const won = [
      ...series([1, 7], 'aabaa', { from: 61, label: 'finals' }),
      gameOf({ id: 66, day: 10, teams: [7, 1] }),
    ];
    const [latest] = rebuildSeries('2025-26', won, !IS_PAST);

    expect(latest?.isRebuilt).toBe(true);
    expect(latest?.games.map((position) => position.gameNumber)).toStrictEqual([
      1,
      2,
      3,
      4,
      5,
      null,
    ]);
    expect(rebuildSeries('2025-26', won, IS_PAST)).toStrictEqual([latest]);
  });

  it('[STA-07] [CL-STA-18] leaves unknown the flag of a play-in game that no label places, as in the 2019-20 seeding play-in', () => {
    const [seeding] = rebuildSeries('2019-20', series([8, 9], 'a', { phase: 'play_in' }), IS_PAST);
    // Had the ninth seed won the first game, a second one would have followed it.
    const [twoGames] = rebuildSeries(
      '2019-20',
      series([8, 9], 'ba', { phase: 'play_in' }),
      IS_PAST,
    );

    expect(seeding).toStrictEqual({
      phase: 'play_in',
      teamAId: 8,
      teamBId: 9,
      round: null,
      winsNeeded: 1,
      isRebuilt: true,
      games: [at(1, 1, [0, 0, null])],
    });
    expect(twoGames?.isRebuilt).toBe(false);
    expect(twoGames?.games).toStrictEqual([unknown(1), unknown(2)]);
  });

  it('[STA-05] [CL-STA-18] groups the games of each pair of teams in each phase, and no placeholder or regular-season game', () => {
    const games = [
      ...series([8, 3], 'a', { phase: 'play_in', label: 'play_in_7_vs_8' }),
      ...series([8, 3], 'abba', { from: 10, day: 4 }),
      gameOf({ id: 20, day: 6, teams: [null, null] }),
      gameOf({ id: 21, day: 6, teams: [null, 8] }),
      gameOf({ id: 22, day: 6, teams: [3, null] }),
      ...series([3, 8], 'a', { from: 23, day: 6 }).map((game) => ({
        ...game,
        phase: 'regular_season' as const,
      })),
    ];
    const pairs = rebuildSeries('2022-23', games, IS_PAST).map((each) => [
      each.phase,
      each.teamAId,
      each.teamBId,
      each.games.map((position) => position.gameId),
    ]);

    expect(pairs).toStrictEqual([
      ['play_in', 3, 8, [1]],
      ['playoffs', 3, 8, [10, 11, 12, 13]],
    ]);
  });

  it('[CL-STA-18] takes the round from the label before the order, from the labeled games when some lack one, and from the order when labels disagree', () => {
    const labeled = series([1, 2], 'aaaa', { label: 'conference_finals' });

    expect(roundOf(labeled)).toBe('conference_finals');
    expect(roundOf(changed(labeled, 1, { roundLabel: null }))).toBe('conference_finals');
    expect(roundOf(changed(labeled, 3, { roundLabel: 'finals' }))).toBe('first_round');
  });

  it('[CL-STA-18] counts no play-in pairing as a playoff round', () => {
    const games = [
      ...series([7, 8], 'a', { phase: 'play_in', label: 'play_in_7_vs_8' }),
      ...series([2, 7], 'aaaa', { from: 10, day: 4 }),
    ];

    expect(rebuildSeries('2020-21', games, IS_PAST).map((each) => each.round)).toStrictEqual([
      'play_in_7_vs_8',
      'first_round',
    ]);
  });

  it('[CL-STA-18] places no series whose teams disagree on the series they played before, which takes four wins even up to 2001-02', () => {
    // The first-round series of team 3 is missing from the schedule.
    const games = [...series([1, 2], 'aaa'), ...series([1, 3], 'aaaa', { from: 10, day: 10 })];

    expect(facts(rebuildSeries('2001-02', games, IS_PAST))).toStrictEqual([
      [1, 2, 'first_round', 3, true],
      [1, 3, null, 4, true],
    ]);
  });

  it('[CL-STA-18] places no series after four rounds', () => {
    // Teams 1 and 2 have each played four series when they meet.
    const earlier = [3, 4, 5, 6].flatMap((opponent, index) => [
      ...series([1, opponent], 'a', { from: 1000 + 10 * index, day: 2 * index }),
      ...series([2, opponent + 4], 'a', { from: 2000 + 10 * index, day: 2 * index }),
    ]);
    const final = series([1, 2], 'a', { from: 3000, day: 10 });
    const rounds = rebuildSeries('2022-23', [...earlier, ...final], IS_PAST).map(
      (each) => each.round,
    );

    expect(rounds.at(-1)).toBeNull();
    expect(rounds.slice(0, 2)).toStrictEqual(['first_round', 'first_round']);
  });

  it('[STA-05] [STA-07] [CL-STA-18] never gives a rebuilt series wins before that reach its wins needed, and numbers its games one by one', () => {
    fc.assert(
      fc.property(anySeason, anyPostseason, fc.boolean(), (season, games, hasLaterSeasonGame) => {
        const rebuilt = rebuildSeries(season, games, hasLaterSeasonGame);
        const numbered = numberedPositions(rebuilt);
        const ofUnrebuilt = rebuilt.filter((each) => !each.isRebuilt).flatMap((each) => each.games);

        expect(numbered.every((position) => position.gameNumber === position.rank)).toBe(true);
        expect(numbered.every((position) => highestWins(position) < position.winsNeeded)).toBe(
          true,
        );
        expect(ofUnrebuilt).toStrictEqual(ofUnrebuilt.map((position) => unknown(position.gameId)));
      }),
    );
  });

  it('[CL-STA-09] rebuilds the same series whatever the order of the games', () => {
    const games = bracket('abaaa');
    const expected = rebuildSeries('2022-23', games, IS_PAST);

    fc.assert(
      fc.property(fc.shuffledSubarray(games, { minLength: games.length }), (shuffled) => {
        expect(rebuildSeries('2022-23', shuffled, IS_PAST)).toStrictEqual(expected);
      }),
    );
  });
});
