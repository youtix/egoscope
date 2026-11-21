import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { teamGames, teamMembership } from './team-membership';

import type { BoxScoreLine } from '../performance/box-score';
import type { Participation } from '../performance/participation';
import type { LinesGame, PlayerLine, PlayerTeamChange, TeamStint } from './team-membership';

const DAY = 86_400_000;
// 2023-10-01T00:00:00Z: day 0. Instants are counted in days from it: every game tips off
// at the start of its day, and a team change is recorded at noon, between two tip-offs,
// as on day 4.5.
const DAY_ZERO = 1_696_118_400_000;

const day = (count: number): number => DAY_ZERO + count * DAY;

// His teams, as the rulings name them, and their opponent.
const X = 1;
const Y = 2;
const Z = 3;
const OPPONENT = 9;

// A line of a game he played: 30 whole minutes and consistent totals.
const PLAYED: BoxScoreLine = {
  minutesPrecision: 'whole_minutes',
  minutes: 30,
  seconds: null,
  points: 12,
  fieldGoalsMade: 5,
  fieldGoalsAttempted: 11,
  threePointersMade: 1,
  freeThrowsMade: 1,
  freeThrowsAttempted: 2,
  offensiveRebounds: 1,
  defensiveRebounds: 4,
  assists: 3,
  steals: 1,
  blocks: 0,
  turnovers: 2,
  personalFouls: 2,
};
// A line with zero minutes and nothing else, so he did not play (CL-STA-04).
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
const IN_SECONDS: BoxScoreLine = {
  ...PLAYED,
  minutesPrecision: 'seconds',
  minutes: 34,
  seconds: 30,
};
const WITHOUT_MINUTES: BoxScoreLine = { ...PLAYED, minutes: null };

/**
 * The game of team `teamId` on day `onDay`, at home against OPPONENT: final, both teams'
 * lines published, its id telling the team and the day.
 */
function gameOf(teamId: number, onDay: number): LinesGame {
  return {
    id: teamId * 1000 + onDay,
    phase: 'regular_season',
    status: 'final',
    scheduledStartAt: day(onDay),
    homeTeamId: teamId,
    awayTeamId: OPPONENT,
    finalScore: { home: 104, away: 98 },
    homeLinesPublished: true,
    awayLinesPublished: true,
  };
}

const gamesOf = (teamId: number, days: readonly number[]): LinesGame[] =>
  days.map((onDay) => gameOf(teamId, onDay));

/** His line in the game of team `teamId` on day `onDay`. */
const lineFor = (teamId: number, onDay: number, line: BoxScoreLine = PLAYED): PlayerLine => ({
  gameId: gameOf(teamId, onDay).id,
  scheduledStartAt: day(onDay),
  teamId,
  line,
});

const entered = (id: number, onDay: number, newTeamId: number | null): PlayerTeamChange => ({
  id,
  changedAt: day(onDay),
  newTeamId,
  origin: 'entered',
});

const observed = (id: number, onDay: number, newTeamId: number | null): PlayerTeamChange => ({
  id,
  changedAt: day(onDay),
  newTeamId,
  origin: 'observed',
});

const stint = (teamId: number, fromDay: number, untilDay: number | null): TeamStint => ({
  teamId,
  from: day(fromDay),
  until: untilDay === null ? null : day(untilDay),
});

type Listed = readonly [number, number, Participation | null, number | null];

// X plays on odd days, Y on even days and Z on days 6, 9 and 12.
const SCHEDULE = [
  ...gamesOf(X, [1, 3, 5, 7, 9, 11]),
  ...gamesOf(Y, [2, 4, 6, 8, 10, 12]),
  ...gamesOf(Z, [6, 9, 12]),
];

/** His team games of SCHEDULE after day 3, as [game id, team, participation, minutes]. */
function listedAfterDay3(
  lines: readonly PlayerLine[],
  history: readonly PlayerTeamChange[],
): readonly Listed[] {
  const stints = teamMembership(lines, history);
  return teamGames({ stints, lines }, SCHEDULE, day(3)).map(
    ({ game, teamId, participation, minutes }) => [game.id, teamId, participation, minutes],
  );
}

// He played for X on days 1 and 3.
const AT_X = [lineFor(X, 1), lineFor(X, 3)];
// He played for Z in an earlier season, on days 1 and 3.
const AT_Z = [lineFor(Z, 1), lineFor(Z, 3)];

describe('teamMembership from his box scores', () => {
  it('[STA-27] [CL-STA-05] starts a stint at his first game played for a team and ends it at his first game played for another, none before his first game', () => {
    const lines = [lineFor(Y, 10), lineFor(X, 15), lineFor(X, 1), lineFor(Y, 8), lineFor(X, 3)];

    expect(teamMembership(lines, [])).toStrictEqual([
      stint(X, 1, 8),
      stint(Y, 8, 15),
      stint(X, 15, null),
    ]);
  });

  it('[CL-STA-04] [CL-STA-05] takes no stint from a line that says he did not play', () => {
    const lines = [lineFor(X, 1), lineFor(Z, 6, NOT_PLAYED), lineFor(X, 7)];

    expect(teamMembership(lines, [])).toStrictEqual([stint(X, 1, null)]);
  });

  it('[STA-27] [CL-STA-05] [CL-JOU-18] keeps one stint, and his team games, across the move of a franchise that keeps its id', () => {
    // Team 25 moved between its game of day 100 and that of day 500.
    const lines = [lineFor(25, 100), lineFor(25, 500)];
    const stints = teamMembership(lines, []);
    const games = teamGames({ stints, lines }, gamesOf(25, [100, 300, 500]), day(0));

    expect(stints).toStrictEqual([stint(25, 100, null)]);
    expect(games.map(({ game }) => game.id)).toStrictEqual([25_100, 25_300, 25_500]);
  });
});

describe('teamMembership from his team history', () => {
  it.each([
    ['a change', Y, [stint(X, 1, 5.5), stint(Y, 5.5, null)]],
    ['a release', null, [stint(X, 1, 5.5)]],
  ])(
    '[CL-STA-05] [CL-STA-27] ends his stint and starts that of the new team, none for a release, at the instant of %s read from the player file',
    (_, team, expected) => {
      expect(teamMembership(AT_X, [observed(1, 5.5, team)])).toStrictEqual(expected);
    },
  );

  it('[CL-STA-05] changes nothing for a recorded change to the team he belongs to', () => {
    expect(teamMembership(AT_X, [observed(1, 5.5, X)])).toStrictEqual([stint(X, 1, null)]);
  });

  it('[CL-STA-05] [CL-JOU-02] dates every change at its own instant, so that neither a later change nor an older season fetched later rewrites the membership before it', () => {
    const lines = [lineFor(X, 301), lineFor(Y, 308)];
    const history = [observed(1, 312.5, Z)];
    const withOlderSeason = [...lines, lineFor(X, 1), lineFor(Z, 120)];
    const fromDay301 = [stint(X, 301, 308), stint(Y, 308, 312.5), stint(Z, 312.5, null)];

    expect(teamMembership(lines, history)).toStrictEqual(fromDay301);
    expect(teamMembership(withOlderSeason, history)).toStrictEqual([
      stint(X, 1, 120),
      stint(Z, 120, 301),
      ...fromDay301,
    ]);
  });

  it.each([
    ['moves him on', X, [stint(X, 1, 8), stint(Y, 8, 10.5), stint(X, 10.5, null)]],
    ['takes him back', Y, [stint(X, 1, 8), stint(Y, 8, null)]],
  ])(
    '[CL-STA-05] [CL-STA-09] lets the change recorded last stand when two share an instant, whether it %s',
    (_, last, expected) => {
      const history = [observed(2, 10.5, last), observed(1, 10.5, Z)];

      expect(teamMembership([...AT_X, lineFor(Y, 8)], history)).toStrictEqual(expected);
    },
  );
});

/** His lines AT_X and `later`, and his entries to `first` on day 4.5 and `second` on day 6.5. */
const entries = (
  first: number | null,
  second: number,
  later: readonly PlayerLine[] = [],
): Readonly<{ lines: PlayerLine[]; history: PlayerTeamChange[] }> => ({
  lines: [...AT_X, ...later],
  history: [entered(2, 6.5, second), entered(1, 4.5, first)],
});

describe('teamMembership after an entered change', () => {
  it.each([
    ['no game played since', [], [stint(X, 1, 4.5), stint(Y, 4.5, null)]],
    ['a game for the entered team', [lineFor(Y, 8)], [stint(X, 1, 4.5), stint(Y, 4.5, null)]],
    ['a game for the team he left', [lineFor(X, 9)], [stint(X, 1, null)]],
    ['a game for a third team', [lineFor(Z, 9)], [stint(X, 1, 4.5), stint(Z, 9, null)]],
  ])(
    '[CL-STA-05] [CL-JOU-03] judges an entered trade from X to Y by his first game after it: %s',
    (_, later, expected) => {
      const lines = [...AT_X, ...later];

      expect(teamMembership(lines, [entered(1, 4.5, Y)])).toStrictEqual(expected);
    },
  );

  it.each([
    ['no game played since', [], [stint(X, 1, 4.5)]],
    ['a game for the team he left', [lineFor(X, 9)], [stint(X, 1, null)]],
    ['a game for another team', [lineFor(Z, 9)], [stint(X, 1, 4.5), stint(Z, 9, null)]],
  ])(
    '[CL-JOU-03] [CL-JOU-20] ends his stint at an entered release, starts none, and judges it by his first game after it: %s',
    (_, later, expected) => {
      const lines = [...AT_X, ...later];

      expect(teamMembership(lines, [entered(1, 4.5, null)])).toStrictEqual(expected);
    },
  );

  it('[CL-JOU-03] applies first a change read from the player file between the entry and his next game, and then judges no entry', () => {
    const history = [entered(1, 4.5, Y), observed(2, 6.5, Z)];

    expect(teamMembership([...AT_X, lineFor(X, 9)], history)).toStrictEqual([
      stint(X, 1, 4.5),
      stint(Y, 4.5, 6.5),
      stint(Z, 6.5, 9),
      stint(X, 9, null),
    ]);
  });

  // His stints with X up to the first entry, and with Y from it up to the second.
  const [WITH_X, WITH_Y] = [stint(X, 1, 4.5), stint(Y, 4.5, 6.5)];
  it.each([
    ['to Y then Z, a game for Z', entries(Y, Z, [lineFor(Z, 9)]), [WITH_Y, stint(Z, 6.5, null)]],
    ['to Y then Z, a game for Y', entries(Y, Z, [lineFor(Y, 8)]), [stint(Y, 4.5, null)]],
    ['to Y then Z, a game for X', entries(Y, Z, [lineFor(X, 9)]), [WITH_Y, stint(X, 9, null)]],
    ['to Y then X, a game for X', entries(Y, X, [lineFor(X, 9)]), [WITH_Y, stint(X, 6.5, null)]],
    ['a release then Y, a game for X', entries(null, Y, [lineFor(X, 9)]), [stint(X, 9, null)]],
    ['to Y then Z, no game since', entries(Y, Z), [WITH_Y, stint(Z, 6.5, null)]],
  ])(
    '[CL-STA-05] [CL-JOU-03] judges by his first game after two entries only the latest, the team he leaves at it being that of the earlier one, whose membership ends at the latest: %s',
    (_, { lines, history }, expected) => {
      expect(teamMembership(lines, history)).toStrictEqual([WITH_X, ...expected]);
    },
  );

  it('[CL-JOU-03] judges an entry by a game that starts after it, never by one that starts at its instant', () => {
    const lines = [...AT_X, lineFor(Y, 8)];

    expect(teamMembership(lines, [entered(1, 3, Y)])).toStrictEqual([
      stint(X, 1, 3),
      stint(Y, 3, null),
    ]);
  });
});

describe('teamMembership from the team chosen at addition, on day 10.5', () => {
  it('[CL-STA-05] starts his stint with the team chosen at the addition when the player file gave the same team, with no first-game test', () => {
    const lines = [...AT_Z, lineFor(Z, 12)];

    expect(teamMembership(lines, [observed(1, 10.5, X)])).toStrictEqual([
      stint(Z, 1, 10.5),
      stint(X, 10.5, 12),
      stint(Z, 12, null),
    ]);
  });

  it.each([
    ['for the team chosen', lineFor(X, 12), [stint(Z, 1, 10.5), stint(X, 10.5, null)]],
    ['for the team of his last game before it', lineFor(Z, 12), [stint(Z, 1, null)]],
    ['for a third team', lineFor(Y, 12), [stint(Z, 1, 10.5), stint(Y, 12, null)]],
  ])(
    '[CL-STA-05] [CL-JOU-03] judges an entered team chosen at addition against the team of his last game before it, by his first game after it: %s',
    (_, first, expected) => {
      expect(teamMembership([...AT_Z, first], [entered(1, 10.5, X)])).toStrictEqual(expected);
    },
  );

  it.each([
    ['before any game', [], [stint(X, 10.5, null)]],
    ['after his first game, for that team', [lineFor(X, 12)], [stint(X, 10.5, null)]],
    ['after his first game, for another team', [lineFor(Y, 12)], [stint(Y, 12, null)]],
  ])(
    '[CL-STA-05] gives a rookie added before his first NBA game the team chosen from the addition: %s',
    (_, lines, expected) => {
      expect(teamMembership(lines, [entered(1, 10.5, X)])).toStrictEqual(expected);
    },
  );

  it.each([
    ['for that team, which verifies the choice', lineFor(X, 12), [stint(X, 1, null)]],
    ['for a third team', lineFor(Z, 12), [stint(X, 1, 10.5), stint(Z, 12, null)]],
  ])(
    '[CL-STA-05] [CL-JOU-03] never voids a team chosen at addition that his box scores already give: his first game after it is %s',
    (_, first, expected) => {
      expect(teamMembership([...AT_X, first], [entered(1, 10.5, X)])).toStrictEqual(expected);
    },
  );
});

describe('teamGames', () => {
  it('[STA-27] [CL-STA-05] lists in scheduled-start order, strictly after an instant, the official games of the team he belonged to at their start', () => {
    // X also plays at the very start of his first game for Y.
    const games = [...gamesOf(Y, [10, 8, 6]), ...gamesOf(X, [9, 8, 7, 5, 3, 1]), gameOf(Z, 4)];
    const lines = [...AT_X, lineFor(Y, 8)];
    const listed = teamGames({ stints: teamMembership(lines, []), lines }, games, day(1));

    expect(listed.map(({ game }) => game.id)).toStrictEqual([1003, 1005, 1007, 2008, 2010]);
  });

  it('[STA-27] [STA-09] [CL-STA-04] gives each final team game his participation and his minutes, a suspect line included, and neither before it is final', () => {
    const away = (onDay: number, fields: Partial<LinesGame>): LinesGame => ({
      ...gameOf(X, onDay),
      homeTeamId: OPPONENT,
      awayTeamId: X,
      ...fields,
    });
    const games: LinesGame[] = [
      ...gamesOf(X, [1, 2, 3, 4, 5]),
      { ...gameOf(X, 6), homeLinesPublished: false },
      away(7, { awayLinesPublished: false }),
      away(8, { homeLinesPublished: false }),
      { ...gameOf(X, 9), status: 'in_progress', finalScore: null },
      { ...gameOf(X, 10), status: 'scheduled', finalScore: null },
    ];
    const lines = [
      lineFor(X, 1),
      lineFor(X, 2, IN_SECONDS),
      lineFor(X, 3, WITHOUT_MINUTES),
      lineFor(X, 4, NOT_PLAYED),
      // 40 points for 5 field goals: a suspect line, with its 30 minutes (STA-09).
      lineFor(X, 5, { ...PLAYED, points: 40 }),
    ];
    const listed = teamGames({ stints: [stint(X, 0, null)], lines }, games, day(0));

    expect(listed.map((each) => [each.participation, each.minutes])).toStrictEqual([
      ['played', 30],
      ['played', 34.5],
      ['played', null],
      ['not_played', null],
      ['played', 30],
      ['unknown', null],
      ['unknown', null],
      ['not_played', null],
      [null, null],
      [null, null],
    ]);
  });

  it('[CL-STA-14] [CL-STA-17] lists no postponed game that no make-up was linked to, no canceled game and no placeholder whose teams are still to be determined', () => {
    const toPlay = (onDay: number, fields: Partial<LinesGame>): LinesGame => ({
      ...gameOf(X, onDay),
      status: 'scheduled',
      finalScore: null,
      ...fields,
    });
    const games = [
      toPlay(5, { status: 'postponed' }),
      toPlay(6, { status: 'canceled' }),
      toPlay(7, { homeTeamId: null, awayTeamId: X }),
      toPlay(8, { awayTeamId: null }),
      toPlay(9, {}),
    ];
    const listed = teamGames({ stints: [stint(X, 1, null)], lines: [] }, games, day(1));

    expect(listed.map(({ game }) => game.id)).toStrictEqual([1009]);
  });

  it('[STA-27] [CL-STA-05] [CL-JOU-03] counts no game of X after an entered trade from X to Y and counts the games of Y from the entry', () => {
    expect(listedAfterDay3(AT_X, [entered(1, 4.5, Y)])).toStrictEqual([
      [2006, Y, 'not_played', null],
      [2008, Y, 'not_played', null],
      [2010, Y, 'not_played', null],
      [2012, Y, 'not_played', null],
    ]);
  });

  it('[STA-27] [CL-JOU-03] [CL-JOU-20] counts no game of X after an entered release by X, nor any while he has no team', () => {
    expect(listedAfterDay3(AT_X, [entered(1, 4.5, null)])).toStrictEqual([]);
  });

  it('[STA-27] [CL-STA-05] counts as missed, after a trade the app did not record, the games of the old team up to his first game for the new team, and none of the earlier games of the new team', () => {
    expect(listedAfterDay3([...AT_X, lineFor(Y, 10)], [])).toStrictEqual([
      [1005, X, 'not_played', null],
      [1007, X, 'not_played', null],
      [1009, X, 'not_played', null],
      [2010, Y, 'played', 30],
      [2012, Y, 'not_played', null],
    ]);
  });

  it('[STA-27] [CL-STA-05] [CL-JOU-03] counts as missed the games of an earlier entered team up to the latest entry, which his first game after both verifies', () => {
    const history = [entered(1, 4.5, Y), entered(2, 6.5, Z)];

    expect(listedAfterDay3([...AT_X, lineFor(Z, 9)], history)).toStrictEqual([
      [2006, Y, 'not_played', null],
      [3009, Z, 'played', 30],
      [3012, Z, 'not_played', null],
    ]);
  });

  it('[STA-27] [CL-JOU-03] counts neither as played nor as missed the games of the entered team in a stint that ended unconfirmed', () => {
    expect(listedAfterDay3([...AT_X, lineFor(Z, 9)], [entered(1, 4.5, Y)])).toStrictEqual([
      [3009, Z, 'played', 30],
      [3012, Z, 'not_played', null],
    ]);
  });
});

const TEAMS = [X, Y, Z];
const LAST_DAY = 60;

type BoxScoreRow = Readonly<{ onDay: number; teamId: number; hasPlayed: boolean }>;

// His box scores, one game a day at most, played or not; his team history, recorded at
// noon so that no row shares an instant with a game, though two rows may share one; and
// a schedule of his teams' games.
const anyBoxScores: fc.Arbitrary<BoxScoreRow[]> = fc.uniqueArray(
  fc.record({
    onDay: fc.integer({ min: 1, max: LAST_DAY }),
    teamId: fc.constantFrom(...TEAMS),
    hasPlayed: fc.boolean(),
  }),
  { selector: (row) => row.onDay, maxLength: 24 },
);
const linesOf = (rows: readonly BoxScoreRow[]): PlayerLine[] =>
  rows.map(({ onDay, teamId, hasPlayed }) =>
    lineFor(teamId, onDay, hasPlayed ? PLAYED : NOT_PLAYED),
  );
const anyLines = anyBoxScores.map((rows) => linesOf(rows));
const anyHistory: fc.Arbitrary<PlayerTeamChange[]> = fc
  .array(
    fc.record({
      onDay: fc.integer({ min: 0, max: LAST_DAY }),
      newTeamId: fc.constantFrom(X, Y, Z, null),
      isEntered: fc.boolean(),
    }),
    { maxLength: 6 },
  )
  .map((rows) =>
    rows.map(({ onDay, newTeamId, isEntered }, index) =>
      (isEntered ? entered : observed)(index + 1, onDay + 0.5, newTeamId),
    ),
  );
const anySchedule: fc.Arbitrary<LinesGame[]> = fc
  .uniqueArray(
    fc.record({ onDay: fc.integer({ min: 0, max: LAST_DAY }), teamId: fc.constantFrom(...TEAMS) }),
    { selector: (row) => [row.onDay, row.teamId].join(' '), maxLength: 40 },
  )
  .map((rows) => rows.map(({ onDay, teamId }) => gameOf(teamId, onDay)));

/** Values from `values`, with the same values in another order. */
const withShuffled = <T>(values: fc.Arbitrary<T[]>): fc.Arbitrary<[T[], T[]]> =>
  values.chain((each) =>
    fc.tuple(fc.constant(each), fc.shuffledSubarray(each, { minLength: each.length })),
  );

/** Whether `stints` follow one another in time, never overlap, and two touching ones differ. */
function isWellOrdered(stints: readonly TeamStint[]): boolean {
  return stints.every(({ teamId, from, until }, index) => {
    const next = stints[index + 1];
    if (until === null) {
      return next === undefined;
    }
    const isBeforeNext =
      next === undefined || until < next.from || (until === next.from && teamId !== next.teamId);
    return from < until && isBeforeNext;
  });
}

const byValue = (left: number, right: number): number => left - right;

/** The team of the stint that holds `at`, by the oracle of the tests. */
const teamAt = (stints: readonly TeamStint[], at: number): number | null =>
  stints.find((each) => each.from <= at && (each.until === null || at < each.until))?.teamId ??
  null;

describe('teamMembership and teamGames over any data', () => {
  it('[STA-27] [CL-STA-05] gives stints that follow one another, never overlap, and differ when they touch', () => {
    fc.assert(
      fc.property(anyLines, anyHistory, (lines, history) => {
        expect(isWellOrdered(teamMembership(lines, history))).toBe(true);
      }),
    );
  });

  it('[CL-STA-05] [CL-STA-09] gives the same stints whatever the order of his lines and of his history', () => {
    fc.assert(
      fc.property(
        withShuffled(anyLines),
        withShuffled(anyHistory),
        ([lines, otherLines], [history, otherHistory]) => {
          expect(teamMembership(otherLines, otherHistory)).toStrictEqual(
            teamMembership(lines, history),
          );
        },
      ),
    );
  });

  it('[STA-27] [CL-STA-05] puts every game he played, from his box scores alone, in a stint of the team he played for, and lists it as played', () => {
    fc.assert(
      fc.property(anyBoxScores, (rows) => {
        const lines = linesOf(rows);
        const stints = teamMembership(lines, []);
        const played = rows.filter(({ hasPlayed }) => hasPlayed);
        const games = played.map(({ teamId, onDay }) => gameOf(teamId, onDay));
        const listed = teamGames({ stints, lines }, games, day(0));

        expect(played.map(({ onDay }) => teamAt(stints, day(onDay)))).toStrictEqual(
          played.map(({ teamId }) => teamId),
        );
        expect(listed.map(({ participation }) => participation)).toStrictEqual(
          played.map(() => 'played'),
        );
      }),
    );
  });

  it('[STA-27] [CL-STA-05] [CL-STA-09] lists once each, in scheduled-start order and after the instant, only games of the team he belonged to at their start', () => {
    const anyData = fc.record({
      lines: anyLines,
      history: anyHistory,
      games: anySchedule,
      after: fc.integer({ min: 0, max: LAST_DAY }).map((count) => day(count)),
    });
    fc.assert(
      fc.property(anyData, ({ lines, history, games, after }) => {
        const stints = teamMembership(lines, history);
        const listed = teamGames({ stints, lines }, games, after);
        const starts = listed.map(({ game }) => game.scheduledStartAt);
        const expected = games.filter(
          (game) =>
            game.scheduledStartAt > after &&
            teamAt(stints, game.scheduledStartAt) === game.homeTeamId,
        );

        expect(new Set(listed.map(({ game }) => game.id)).size).toBe(listed.length);
        expect(starts).toStrictEqual(starts.toSorted(byValue));
        expect(listed.every(({ game, teamId }) => game.homeTeamId === teamId)).toBe(true);
        expect(listed.map(({ game }) => game.id).toSorted(byValue)).toStrictEqual(
          expected.map(({ id }) => id).toSorted(byValue),
        );
      }),
    );
  });
});
