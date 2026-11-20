import { describe, expect, it } from 'vitest';

import { phaseState } from './phase-state';

import type { PhaseGame, PhaseSeries, PhaseState, SeasonSchedule } from './phase-state';
import type { SeriesRound } from './series';

const DAY = 86_400_000;
// 2023-10-01T00:00:00Z: day 0 of the games below.
const DAY_ZERO = 1_696_118_400_000;

type Teams = readonly [number, number];
type Part = Readonly<{ games: PhaseGame[]; series: PhaseSeries }>;

const day = (count: number): number => DAY_ZERO + count * DAY;

/** A final regular-season game on `onDay`, consolidated eight days later. */
function gameOf(id: number, onDay: number, fields: Partial<PhaseGame> = {}): PhaseGame {
  return {
    id,
    phase: 'regular_season',
    status: 'final',
    scheduledStartAt: day(onDay),
    homeTeamId: 1,
    awayTeamId: 2,
    finalScore: { home: 101, away: 99 },
    consolidatedAt: day(onDay + 8),
    ...fields,
  };
}

/** A game still to play on `onDay`. */
const toPlay = (id: number, onDay: number, fields: Partial<PhaseGame> = {}): PhaseGame =>
  gameOf(id, onDay, { status: 'scheduled', finalScore: null, consolidatedAt: null, ...fields });

const regularSeasonAt = (games: readonly PhaseGame[], at: number): PhaseState | null =>
  phaseState({ games, series: [] }, { phase: 'regular_season', at });

const postseasonOf = (schedule: SeasonSchedule, teamId: number): PhaseState | null =>
  phaseState(schedule, { phase: 'postseason', teamId });

type SeriesOptions = Readonly<{
  from?: number;
  phase?: 'play_in' | 'playoffs';
  round?: SeriesRound;
  day?: number;
  isLastConsolidated?: boolean;
}>;

/**
 * A series between `teams` and its final games, one per letter of `winners`: `a` when the
 * first team, at home, won the game, `b` when the second did. Their identifiers count up
 * `from` 1, two days apart from `day` on, each consolidated, but the last one when
 * `isLastConsolidated` is false.
 */
function played(teams: Teams, winners: string, options: SeriesOptions = {}): Part {
  const phase = options.phase ?? 'playoffs';
  const games = Array.from(winners, (winner, index) => {
    const onDay = (options.day ?? 0) + 2 * index;
    const isInWindow = index === winners.length - 1 && options.isLastConsolidated === false;
    return gameOf((options.from ?? 1) + index, onDay, {
      phase,
      homeTeamId: teams[0],
      awayTeamId: teams[1],
      finalScore: winner === 'a' ? { home: 108, away: 100 } : { home: 100, away: 108 },
      consolidatedAt: isInWindow ? null : day(onDay + 8),
    });
  });
  const series: PhaseSeries = {
    phase,
    teamAId: Math.min(...teams),
    teamBId: Math.max(...teams),
    round: options.round ?? null,
    winsNeeded: phase === 'play_in' ? 1 : 4,
  };
  return { games, series };
}

/** The schedule of these series, with the `others` games besides. */
function scheduleOf(parts: readonly Part[], others: readonly PhaseGame[] = []): SeasonSchedule {
  return {
    games: [...parts.flatMap((part) => part.games), ...others],
    series: parts.map((part) => part.series),
  };
}

const FINISHED: PhaseState = { finished: true, lastGameConsolidated: true };
const RUNNING: PhaseState = { finished: false, lastGameConsolidated: false };
const IN_WINDOW: PhaseState = { finished: true, lastGameConsolidated: false };

// The play-in and the first round are over, and the second round under way: team 1 leads
// team 7 two games to one. Team 8 lost the 7-8 game, won the 8th-seed game and was swept
// by team 1, its last game still in its correction window; team 2, of the lower
// identifier, was swept by team 7. Team 11 played the regular season only, and team 12 a
// canceled playoff game besides.
const UNDER_WAY = scheduleOf(
  [
    played([7, 8], 'a', { phase: 'play_in', round: 'play_in_7_vs_8' }),
    played([9, 10], 'a', { from: 2, phase: 'play_in', round: 'play_in_9_vs_10' }),
    played([8, 9], 'a', { from: 3, phase: 'play_in', round: 'play_in_8th_seed', day: 2 }),
    played([1, 8], 'aaaa', { from: 10, day: 4, isLastConsolidated: false }),
    played([7, 2], 'aaaa', { from: 20, day: 4 }),
    played([1, 7], 'aba', { from: 30, day: 14 }),
  ],
  [
    toPlay(33, 20, { phase: 'playoffs', homeTeamId: 7, awayTeamId: 1 }),
    gameOf(40, 0, { homeTeamId: 11, awayTeamId: 12 }),
    toPlay(41, 4, { phase: 'playoffs', status: 'canceled', homeTeamId: 12, awayTeamId: 13 }),
  ],
);

type FinalsCase = Readonly<{
  finals: string;
  winners: string;
  others: readonly PhaseGame[];
  isLastConsolidated: boolean;
  expected: PhaseState;
}>;

const FINALS_CASES: readonly FinalsCase[] = [
  {
    finals: 'won four games to two',
    winners: 'aabbaa',
    others: [],
    isLastConsolidated: true,
    expected: FINISHED,
  },
  {
    finals: 'won, their last game in its window',
    winners: 'aabbaa',
    others: [],
    isLastConsolidated: false,
    expected: IN_WINDOW,
  },
  {
    finals: 'swept, a fifth game still listed',
    winners: 'aaaa',
    others: [toPlay(9, 30)],
    isLastConsolidated: true,
    expected: FINISHED,
  },
  {
    finals: 'under way, a game scheduled',
    winners: 'aab',
    others: [toPlay(9, 30)],
    isLastConsolidated: true,
    expected: RUNNING,
  },
  {
    finals: 'under way, a game in progress',
    winners: 'aab',
    others: [toPlay(9, 30, { status: 'in_progress' })],
    isLastConsolidated: true,
    expected: RUNNING,
  },
  {
    finals: 'ended, a game of them missing',
    winners: 'aaab',
    others: [],
    isLastConsolidated: true,
    expected: FINISHED,
  },
  {
    finals: 'ended, a game postponed',
    winners: 'aaab',
    others: [toPlay(9, 30, { status: 'postponed' })],
    isLastConsolidated: true,
    expected: FINISHED,
  },
  {
    finals: 'ended, a game canceled',
    winners: 'aaab',
    others: [toPlay(9, 30, { status: 'canceled' })],
    isLastConsolidated: true,
    expected: FINISHED,
  },
];

describe('phaseState of the regular season', () => {
  // Games 1 and 2 share the last scheduled start, so game 2, of the higher identifier,
  // is the last game.
  it.each([
    ['every game consolidated', [], FINISHED],
    ['the last game in its correction window', [2], IN_WINDOW],
    ['another game in its correction window', [1], FINISHED],
  ])(
    '[STA-20] [CL-STA-02] finishes once no game of it is left, its last final game its last game: %s',
    (_, inWindow, expected) => {
      const games = [gameOf(2, 9), gameOf(3, 5), gameOf(1, 9)].map((game) =>
        inWindow.includes(game.id) ? { ...game, consolidatedAt: null } : game,
      );

      expect(regularSeasonAt(games, day(30))).toStrictEqual(expected);
    },
  );

  it.each(['scheduled', 'in_progress', 'postponed'] as const)(
    '[STA-20] [CL-STA-02] keeps running while a game of it is %s',
    (status) => {
      const playoffs = toPlay(4, 100, { phase: 'playoffs' });
      const games = [gameOf(1, 1), gameOf(2, 2), toPlay(3, 9, { status }), playoffs];

      expect(regularSeasonAt(games, day(50))).toStrictEqual(RUNNING);
    },
  );

  it('[CL-STA-02] is not held open by a canceled game, nor by the postseason games still to play', () => {
    const games = [
      gameOf(1, 1),
      toPlay(2, 2, { status: 'canceled' }),
      toPlay(3, 100, { phase: 'play_in' }),
    ];

    expect(regularSeasonAt(games, day(50))).toStrictEqual(FINISHED);
  });

  it.each([
    ['the day before', day(19), RUNNING],
    ['a millisecond before', day(20) - 1, RUNNING],
    ['at that instant', day(20), FINISHED],
    ['between the first postseason games', day(22), FINISHED],
  ])(
    '[CL-STA-02] [CL-STA-17] finishes at the scheduled start of the first play-in or playoff game still counted, a postponed game left in it: %s',
    (_, at, expected) => {
      const games = [
        gameOf(1, 1),
        toPlay(2, 3, { status: 'postponed' }),
        gameOf(3, 5),
        toPlay(10, 15, { phase: 'play_in', status: 'postponed' }),
        toPlay(11, 16, { phase: 'play_in', status: 'canceled' }),
        toPlay(13, 25, { phase: 'playoffs' }),
        toPlay(12, 20, { phase: 'play_in' }),
      ];

      expect(regularSeasonAt(games, at)).toStrictEqual(expected);
    },
  );

  it('[CL-STA-02] [CL-STA-17] finishes at the start of the postseason even with no final game, then without a last game', () => {
    const games = [toPlay(1, 3, { status: 'postponed' }), toPlay(2, 20, { phase: 'play_in' })];

    expect(regularSeasonAt(games, day(20))).toStrictEqual({
      finished: true,
      lastGameConsolidated: false,
    });
  });

  it('[CL-STA-02] has not finished while the schedule holds none of its games', () => {
    expect(regularSeasonAt([], day(50))).toStrictEqual(RUNNING);
  });
});

describe('phaseState of the postseason', () => {
  it.each([
    [1, RUNNING],
    [7, RUNNING],
    [8, IN_WINDOW],
    [2, FINISHED],
    [9, FINISHED],
    [10, FINISHED],
  ])(
    '[STA-20] [CL-STA-02] finishes for team %i once a series put it out, its last postseason game its last game',
    (teamId, expected) => {
      expect(postseasonOf(UNDER_WAY, teamId)).toStrictEqual(expected);
    },
  );

  it('[CL-STA-02] gives no postseason to a team that never entered it, a canceled game aside', () => {
    expect(postseasonOf(UNDER_WAY, 11)).toBeNull();
    expect(postseasonOf(UNDER_WAY, 12)).toBeNull();
  });

  it('[STA-07] [STA-20] puts out the loser of the 9-10 and 8th-seed games but not that of the 7-8 game, nor that of a game no label places', () => {
    const playIn = scheduleOf(
      [
        played([7, 8], 'a', { phase: 'play_in', round: 'play_in_7_vs_8' }),
        played([9, 10], 'a', { from: 2, phase: 'play_in', round: 'play_in_9_vs_10' }),
        played([5, 6], 'a', { from: 3, phase: 'play_in' }),
      ],
      [toPlay(4, 2, { phase: 'play_in', homeTeamId: 8, awayTeamId: 9 })],
    );

    expect([8, 10, 6].map((teamId) => postseasonOf(playIn, teamId))).toStrictEqual([
      RUNNING,
      FINISHED,
      RUNNING,
    ]);
  });

  it('[CL-STA-02] counts apart the games of two teams that met in the play-in and meet again in the playoffs', () => {
    // Team 7 beat team 8 in the 7-8 game and leads it three games to two in the playoffs.
    const twice = scheduleOf(
      [
        played([7, 8], 'a', { phase: 'play_in', round: 'play_in_7_vs_8' }),
        played([7, 8], 'ababa', { from: 10, day: 30, round: 'conference_finals' }),
      ],
      [toPlay(15, 40, { phase: 'playoffs', homeTeamId: 8, awayTeamId: 7 })],
    );

    expect(postseasonOf(twice, 8)).toStrictEqual(RUNNING);
  });

  it.each(FINALS_CASES)(
    '[STA-20] [CL-STA-02] finishes for every team once the Finals are over: Finals $finals',
    ({ winners, others, isLastConsolidated, expected }) => {
      const finals = played([1, 7], winners, { day: 16, round: 'finals', isLastConsolidated });
      const otherGames = others.map((game) => ({
        ...game,
        phase: 'playoffs' as const,
        homeTeamId: 7,
        awayTeamId: 1,
      }));
      const schedule = scheduleOf([finals], otherGames);

      expect([postseasonOf(schedule, 1), postseasonOf(schedule, 7)]).toStrictEqual([
        expected,
        expected,
      ]);
    },
  );
});
