import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { teamRecord } from './team-record';

import type { GamePhase, GameStatus, ScheduleGame } from '../types';

// Team 1's record is counted; teams 2 and 3 are its opponents.
const TEAM = 1;
const TEAMS = [1, 2, 3, 4];

/** A final regular-season game: the home team, the away team, and their final score. */
function game(
  id: number,
  [home, away, homeScore, awayScore]: readonly [number, number, number, number],
  fields: Partial<ScheduleGame> = {},
): ScheduleGame {
  return {
    id,
    phase: 'regular_season',
    status: 'final',
    homeTeamId: home,
    awayTeamId: away,
    finalScore: { home: homeScore, away: awayScore },
    ...fields,
  };
}

// Team 1 wins games 1, 2 and 5, at home and away, and loses games 3 and 4; game 6 is
// between two other teams.
const SEASON: readonly ScheduleGame[] = [
  game(1, [1, 2, 110, 100]),
  game(2, [3, 1, 99, 104]),
  game(3, [1, 3, 95, 101]),
  game(4, [2, 1, 120, 90]),
  game(5, [1, 2, 100, 99]),
  game(6, [2, 3, 101, 97]),
];

const anyPoints = fc.integer({ min: 95, max: 105 });
const anyScore = fc.option(fc.record({ home: anyPoints, away: anyPoints }), { nil: null });
const anyPhase = fc.constantFrom<GamePhase>('regular_season', 'play_in', 'playoffs');
const anyStatus = fc.constantFrom<GameStatus>(
  'scheduled',
  'in_progress',
  'final',
  'postponed',
  'canceled',
);
const anyRow = fc.record({
  phase: anyPhase,
  status: anyStatus,
  homeTeamId: fc.constantFrom(...TEAMS),
  awayOffset: fc.integer({ min: 1, max: TEAMS.length - 1 }),
  finalScore: anyScore,
});
const anyGames: fc.Arbitrary<ScheduleGame[]> = fc.array(anyRow, { maxLength: 40 }).map((rows) =>
  rows.map(({ awayOffset, ...row }, index) => ({
    ...row,
    id: index + 1,
    awayTeamId: ((row.homeTeamId - 1 + awayOffset) % TEAMS.length) + 1,
  })),
);

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

/** Whether `each` is a regular-season game with a winner, by the oracle of the tests. */
const hasResult = (each: ScheduleGame): boolean =>
  each.phase === 'regular_season' &&
  each.status === 'final' &&
  each.finalScore !== null &&
  each.finalScore.home !== each.finalScore.away;

describe('teamRecord', () => {
  it('[STA-06] [CL-STA-19] counts the wins and losses of its final regular-season games, at home and away, from their scores alone', () => {
    // Rows as the source writes them carry its own record columns, which say otherwise.
    const rows = SEASON.map((row) => ({ ...row, homeRecord: '0-82', awayRecord: '82-0' }));

    expect(teamRecord(SEASON, TEAM)).toStrictEqual({ wins: 3, losses: 2 });
    expect(teamRecord(rows, TEAM)).toStrictEqual({ wins: 3, losses: 2 });
    expect(teamRecord(SEASON, 3)).toStrictEqual({ wins: 1, losses: 2 });
  });

  it('[STA-06] leaves out the excluded game, such as the measured game of a case', () => {
    expect(teamRecord(SEASON, TEAM, 3)).toStrictEqual({ wins: 3, losses: 1 });
    expect(teamRecord(SEASON, TEAM, 2)).toStrictEqual({ wins: 2, losses: 2 });
    expect(teamRecord(SEASON, TEAM, 6)).toStrictEqual({ wins: 3, losses: 2 });
  });

  it.each([
    ['a scheduled game', { status: 'scheduled', finalScore: null }],
    ['a game in progress, its live score included', { status: 'in_progress' }],
    ['a postponed game', { status: 'postponed', finalScore: null }],
    ['a canceled game', { status: 'canceled' }],
    ['a final game listed without its score', { finalScore: null }],
    ['a final game with a level score', { finalScore: { home: 100, away: 100 } }],
  ] as const)('[STA-06] [CL-STA-19] counts no win and no loss for %s', (_, fields) => {
    const atHome = game(7, [1, 2, 104, 98], fields);
    const away = game(8, [2, 1, 96, 102], fields);

    expect(teamRecord([atHome, away], TEAM)).toStrictEqual({ wins: 0, losses: 0 });
    expect(teamRecord([...SEASON, atHome, away], TEAM)).toStrictEqual({ wins: 3, losses: 2 });
  });

  it.each(['play_in', 'playoffs'] as const)(
    '[STA-06] counts the regular season only, never a %s game',
    (phase) => {
      const postseason = [
        game(7, [1, 2, 110, 100], { phase }),
        game(8, [1, 3, 90, 100], { phase }),
      ];

      expect(teamRecord([...SEASON, ...postseason], TEAM)).toStrictEqual({ wins: 3, losses: 2 });
    },
  );

  it('[STA-06] never counts the excluded game', () => {
    const gamesAndOne = anyGames
      .filter((games) => games.length > 0)
      .chain((games) => fc.tuple(fc.constant(games), fc.constantFrom(...games)));

    fc.assert(
      fc.property(gamesAndOne, fc.constantFrom(...TEAMS), ([games, excluded], teamId) => {
        const others = games.filter((other) => other.id !== excluded.id);

        expect(teamRecord(games, teamId, excluded.id)).toStrictEqual(teamRecord(others, teamId));
      }),
    );
  });

  it('[STA-06] [CL-STA-19] gives every regular-season game with a result one win and one loss', () => {
    fc.assert(
      fc.property(anyGames, (games) => {
        const records = TEAMS.map((teamId) => teamRecord(games, teamId));
        const withResult = games.filter((each) => hasResult(each)).length;

        expect(sum(records.map((record) => record.wins))).toBe(withResult);
        expect(sum(records.map((record) => record.losses))).toBe(withResult);
      }),
    );
  });
});
