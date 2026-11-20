import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { firstNbaGame, indicatorsOf } from './player-indicators';
import { teamMembership } from './team-membership';

import type { CareerSeasons, IndicatorLine } from './player-indicators';
import type { SeasonSpan } from './seasons';
import type { LinesGame, PlayerTeamChange } from './team-membership';
import type { BoxScoreLine } from '../performance/box-score';

const HOUR = 3_600_000;
// Every game tips off at 23:30 UTC, in the evening of its US date.
const TIP_OFF_HOUR = 23.5;

/** The instant `hour` hours into the UTC day `on`, written YYYY-MM-DD. */
const utc = (on: string, hour: number): number =>
  Date.UTC(Number(on.slice(0, 4)), Number(on.slice(5, 7)) - 1, Number(on.slice(8))) + hour * HOUR;

// His teams, as the rulings name them, and their opponent.
const X = 1;
const Y = 2;
const Z = 3;
const OPPONENT = 9;

/**
 * The game of `teamId` on `on`, at home against OPPONENT, final, both teams' lines
 * published; its id tells the team and the day: 1_251_022 is X's game of 2025-10-22.
 */
function gameOf(teamId: number, on: string): LinesGame {
  return {
    id: teamId * 1_000_000 + Number(on.slice(2).replaceAll('-', '')),
    phase: 'regular_season',
    status: 'final',
    scheduledStartAt: utc(on, TIP_OFF_HOUR),
    homeTeamId: teamId,
    awayTeamId: OPPONENT,
    finalScore: { home: 104, away: 98 },
    homeLinesPublished: true,
    awayLinesPublished: true,
  };
}

const gamesOf = (teamId: number, days: readonly string[]): LinesGame[] =>
  days.map((on) => gameOf(teamId, on));

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
// 34 minutes 30 seconds, from a source in seconds.
const IN_SECONDS: BoxScoreLine = {
  ...PLAYED,
  minutesPrecision: 'seconds',
  minutes: 34,
  seconds: 30,
};
// 40 points for 5 field goals: a suspect line, played (STA-09).
const SUSPECT: BoxScoreLine = { ...PLAYED, points: 40 };
// Zero whole minutes beside his statistics: played, less than 30 seconds (CL-STA-06).
const UNDER_A_MINUTE: BoxScoreLine = { ...PLAYED, minutes: 0 };
// 50 minutes: within an overtime game, suspect in regulation (STA-09).
const FIFTY_MINUTES: BoxScoreLine = { ...PLAYED, minutes: 50 };
// Zero minutes and nothing else: he did not play (CL-STA-04).
const NOT_PLAYED: BoxScoreLine = {
  ...PLAYED,
  minutes: 0,
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
  turnovers: 0,
  personalFouls: 0,
};

/** His line in the game of team `teamId` on `on`, in regulation. */
const lineIn = (teamId: number, on: string, line: BoxScoreLine = PLAYED): IndicatorLine => ({
  gameId: gameOf(teamId, on).id,
  scheduledStartAt: utc(on, TIP_OFF_HOUR),
  teamId,
  line,
  gameDayOn: on,
  overtimeCount: 0,
});

const OLDER: SeasonSpan = {
  season: '2023-24',
  firstGameOn: '2023-10-24',
  lastGameOn: '2024-06-17',
};
const LAST: SeasonSpan = { season: '2024-25', firstGameOn: '2024-10-22', lastGameOn: '2025-06-22' };
const IN_PROGRESS: SeasonSpan = { season: '2025-26', firstGameOn: '2025-10-21', lastGameOn: null };
const ENDED: SeasonSpan = { ...IN_PROGRESS, lastGameOn: '2026-06-19' };
const COMING: SeasonSpan = { season: '2026-27', firstGameOn: '2026-10-20', lastGameOn: null };

type Player = Readonly<{ lines: readonly IndicatorLine[]; history?: readonly PlayerTeamChange[] }>;
type Stored = Readonly<{ games?: readonly LinesGame[]; seasons: readonly SeasonSpan[] }>;

/** His indicators on `todayOn`, his membership read from his lines and his team history. */
function indicatorsFromHistory({ lines, history = [] }: Player, stored: Stored, todayOn: string) {
  const stints = teamMembership(lines, history);
  return indicatorsOf({ stints, lines }, { games: [], ...stored }, todayOn);
}

const observed = (on: string, newTeamId: number | null): PlayerTeamChange => ({
  id: Number(on.slice(2).replaceAll('-', '')),
  changedAt: utc(on, 12),
  newTeamId,
  origin: 'observed',
});

describe('indicatorsOf: games played and average minutes', () => {
  it('[STA-46] [JOU-02] [STA-09] [CL-STA-09] counts the games he played in the season in progress, a suspect line among them, and averages the minutes of the lines that are not suspect and give his time on court', () => {
    const lines = [
      lineIn(X, '2025-11-03', NOT_PLAYED),
      lineIn(X, '2025-10-22'),
      lineIn(X, '2025-10-24', IN_SECONDS),
      lineIn(X, '2025-10-26', SUSPECT),
      lineIn(X, '2025-10-28', UNDER_A_MINUTE),
      { ...lineIn(X, '2025-10-30', FIFTY_MINUTES), overtimeCount: 1 },
      lineIn(X, '2025-11-01', FIFTY_MINUTES),
      lineIn(X, '2025-03-01'),
    ];
    const indicators = indicatorsFromHistory(
      { lines },
      { seasons: [IN_PROGRESS, OLDER, LAST] },
      '2025-11-06',
    );

    expect(indicators).toMatchObject({
      indicatorSeason: '2025-26',
      gamesPlayedThisSeason: 6,
      lastGamePlayedId: gameOf(X, '2025-11-01').id,
      lastGamePlayedOn: '2025-11-01',
    });
    expect(indicators.averageMinutesThisSeason).toBeCloseTo((30 + 34.5 + 50) / 3, 9);
  });

  it('[STA-46] [CL-STA-21] [CL-JOU-15] covers, between seasons, the season that ended last and names it, the coming season stored or not', () => {
    const lines = [
      lineIn(X, '2026-04-12', IN_SECONDS),
      lineIn(X, '2025-03-01'),
      lineIn(X, '2026-04-10'),
    ];
    const expected = {
      indicatorSeason: '2025-26',
      gamesPlayedThisSeason: 2,
      averageMinutesThisSeason: (30 + 34.5) / 2,
    };

    expect(
      indicatorsFromHistory({ lines }, { seasons: [COMING, LAST, ENDED] }, '2026-08-01'),
    ).toMatchObject(expected);
    expect(
      indicatorsFromHistory({ lines }, { seasons: [LAST, ENDED] }, '2026-08-01'),
    ).toMatchObject(expected);
  });

  it('[STA-46] [CL-STA-21] [CL-JOU-15] gives, between seasons, no game for the season that ended last when he played none of it', () => {
    expect(
      indicatorsFromHistory(
        { lines: [lineIn(X, '2025-03-01')] },
        { seasons: [LAST, ENDED] },
        '2026-08-01',
      ),
    ).toMatchObject({
      indicatorSeason: '2025-26',
      gamesPlayedThisSeason: 0,
      averageMinutesThisSeason: null,
      lastGamePlayedOn: '2025-03-01',
    });
  });

  it('[STA-46] [STA-48] [CL-STA-21] covers a season from its first game day, and the season of the day while no stored season has begun', () => {
    const lines = [lineIn(X, '2026-04-10')];

    expect(
      indicatorsFromHistory({ lines }, { seasons: [ENDED, COMING] }, '2026-10-20'),
    ).toMatchObject({
      indicatorSeason: '2026-27',
      gamesPlayedThisSeason: 0,
    });
    expect(indicatorsFromHistory({ lines: [] }, { seasons: [] }, '2026-01-20')).toMatchObject({
      indicatorSeason: '2025-26',
      averageMinutesThisSeason: null,
    });
  });
});

// He last played for X on 2 January 2026; X then played five games that he missed, and
// has a game in progress and one to play.
const ABSENT = {
  lines: [lineIn(X, '2026-01-02')],
  games: [
    ...gamesOf(X, ['2025-12-30', '2026-01-02', '2026-01-04', '2026-01-06', '2026-01-08']),
    ...gamesOf(X, ['2026-01-10', '2026-01-12']),
    { ...gameOf(X, '2026-01-14'), status: 'in_progress', finalScore: null },
    { ...gameOf(X, '2026-01-16'), status: 'scheduled', finalScore: null },
  ] satisfies LinesGame[],
};

/** The id of his last game played on 3 January 2026, his lines being `lines`. */
const lastOf = (lines: readonly IndicatorLine[]): number | null =>
  indicatorsFromHistory({ lines }, { seasons: [IN_PROGRESS] }, '2026-01-03').lastGamePlayedId;

describe('indicatorsOf: consecutive team games missed', () => {
  it('[STA-46] [JOU-21] [CA-STA-16] gives, for a player absent from five games, five consecutive games missed and the date of his last game played, and no cause of absence', () => {
    const { lines, games } = ABSENT;

    expect(
      indicatorsFromHistory({ lines }, { games, seasons: [LAST, IN_PROGRESS] }, '2026-01-15'),
    ).toStrictEqual({
      indicatorSeason: '2025-26',
      gamesPlayedThisSeason: 1,
      averageMinutesThisSeason: 30,
      lastGamePlayedId: gameOf(X, '2026-01-02').id,
      lastGamePlayedOn: '2026-01-02',
      consecutiveTeamGamesMissed: 5,
    });
  });

  it('[JOU-22] [CL-JOU-15] [CL-STA-21] counts the games missed across the end of a season and the start of the next', () => {
    const lines = [lineIn(X, '2025-04-06'), lineIn(X, '2025-04-08')];
    const games = [
      ...gamesOf(X, ['2025-04-06', '2025-04-08', '2025-04-10', '2025-04-12']),
      ...gamesOf(X, ['2025-10-22', '2025-10-24', '2025-10-26']),
      { ...gameOf(X, '2025-10-28'), status: 'scheduled', finalScore: null },
    ] satisfies LinesGame[];

    expect(
      indicatorsFromHistory({ lines }, { games, seasons: [LAST, IN_PROGRESS] }, '2025-10-27'),
    ).toMatchObject({
      indicatorSeason: '2025-26',
      gamesPlayedThisSeason: 0,
      lastGamePlayedOn: '2025-04-08',
      consecutiveTeamGamesMissed: 5,
    });
  });

  it('[JOU-22] [CL-JOU-15] [CL-STA-05] counts, after a trade, the games of the team he left up to his departure and those of the new team from his arrival', () => {
    // X plays three games after his departure on 8 January and Y two after his arrival and
    // one before it, so a count that ignores the trade, or counts Y's games from before his
    // arrival, gives 5.
    const games = [
      ...gamesOf(X, ['2026-01-02', '2026-01-04', '2026-01-06']),
      ...gamesOf(X, ['2026-01-10', '2026-01-12', '2026-01-14']),
      ...gamesOf(Y, ['2026-01-05', '2026-01-09', '2026-01-11']),
    ];
    const player = { lines: [lineIn(X, '2026-01-02')], history: [observed('2026-01-08', Y)] };

    expect(
      indicatorsFromHistory(player, { games, seasons: [IN_PROGRESS] }, '2026-01-15')
        .consecutiveTeamGamesMissed,
    ).toBe(4);
  });

  it('[JOU-22] [CL-JOU-15] [CL-JOU-20] adds nothing while he has no team after a release, and counts the games of his next team from his arrival', () => {
    // X plays two games after his release on 8 January and Z one after his arrival on the
    // 12th and one before it, so a count that ignores the release, or counts Z's games from
    // before his arrival, gives 4.
    const games = [
      ...gamesOf(X, ['2026-01-02', '2026-01-04', '2026-01-06']),
      ...gamesOf(X, ['2026-01-10', '2026-01-12']),
      ...gamesOf(Y, ['2026-01-09']),
      ...gamesOf(Z, ['2026-01-11', '2026-01-13']),
    ];
    const released: PlayerTeamChange = { ...observed('2026-01-08', null), origin: 'entered' };
    const player = {
      lines: [lineIn(X, '2026-01-02')],
      history: [released, observed('2026-01-12', Z)],
    };

    expect(
      indicatorsFromHistory(player, { games, seasons: [IN_PROGRESS] }, '2026-01-14')
        .consecutiveTeamGamesMissed,
    ).toBe(3);
  });

  it('[STA-46] [CL-STA-04] counts a final game whose lines his team has not published as missed, and neither a game in progress nor one to play', () => {
    const unpublished = { ...gameOf(X, '2026-01-04'), homeLinesPublished: false };
    const games = [unpublished, ...ABSENT.games.slice(-2)];

    expect(
      indicatorsFromHistory(
        { lines: ABSENT.lines },
        { games, seasons: [IN_PROGRESS] },
        '2026-01-15',
      ).consecutiveTeamGamesMissed,
    ).toBe(1);
  });

  it('[STA-46] [CL-STA-05] counts, for a player who has never played, the games of the team chosen at his addition from the addition, a game he sat out included', () => {
    const player = {
      lines: [lineIn(X, '2026-01-04', NOT_PLAYED)],
      history: [observed('2026-01-01', X)],
    };
    const games = gamesOf(X, ['2025-12-30', '2026-01-02', '2026-01-04']);

    expect(
      indicatorsFromHistory(player, { games, seasons: [IN_PROGRESS] }, '2026-01-05'),
    ).toStrictEqual({
      indicatorSeason: '2025-26',
      gamesPlayedThisSeason: 0,
      averageMinutesThisSeason: null,
      lastGamePlayedId: null,
      lastGamePlayedOn: null,
      consecutiveTeamGamesMissed: 2,
    });
  });

  it('[STA-46] [CL-STA-09] takes his last game played by scheduled start, then by game id, whatever the order of his lines', () => {
    // Traded from Y to X, whose game ids are the lower ones; two of his lines share a start.
    const lines = [lineIn(X, '2026-01-02'), lineIn(Y, '2025-12-01'), lineIn(Y, '2026-01-02')];

    expect(lastOf(lines.slice(0, 2))).toBe(gameOf(X, '2026-01-02').id);
    expect(lastOf(lines)).toBe(gameOf(Y, '2026-01-02').id);
    expect(lastOf(lines.toReversed())).toBe(gameOf(Y, '2026-01-02').id);
  });
});

const DAYS = ['2025-10-22', '2025-10-24', '2025-10-26', '2025-10-28', '2025-10-30', '2025-11-01'];
const GAMES = [...gamesOf(X, DAYS), ...gamesOf(Y, DAYS)];

// His lines, one game a day at most, for X or Y, of every kind, with or without overtime,
// and the same lines in another order.
const anyLines: fc.Arbitrary<IndicatorLine[]> = fc
  .uniqueArray(
    fc.record({
      on: fc.constantFrom(...DAYS),
      teamId: fc.constantFrom(X, Y),
      line: fc.constantFrom(PLAYED, IN_SECONDS, SUSPECT, UNDER_A_MINUTE, FIFTY_MINUTES, NOT_PLAYED),
      overtimeCount: fc.constantFrom(0, 1, null),
    }),
    { selector: ({ on }) => on, maxLength: DAYS.length },
  )
  .map((rows) =>
    rows.map(({ on, teamId, line, overtimeCount }) => ({
      ...lineIn(teamId, on, line),
      overtimeCount,
    })),
  );
const withShuffled = anyLines.chain((lines) =>
  fc.tuple(fc.constant(lines), fc.shuffledSubarray(lines, { minLength: lines.length })),
);

describe('indicatorsOf over any data', () => {
  it('[STA-46] [CL-STA-09] gives the same indicators whatever the order of his lines and of the games', () => {
    fc.assert(
      fc.property(withShuffled, ([lines, shuffled]) => {
        const stored = { games: GAMES, seasons: [IN_PROGRESS] };
        const reordered = { ...stored, games: GAMES.toReversed() };

        expect(indicatorsFromHistory({ lines: shuffled }, reordered, '2025-11-02')).toStrictEqual(
          indicatorsFromHistory({ lines }, stored, '2025-11-02'),
        );
      }),
    );
  });
});

// The seasons of his career, framed by their first and last games.
const CAREER_SPANS: readonly SeasonSpan[] = [
  { season: '1993-94', firstGameOn: '1993-11-05', lastGameOn: '1994-06-22' },
  { season: '2018-19', firstGameOn: '2018-10-16', lastGameOn: '2019-06-13' },
  { season: '2019-20', firstGameOn: '2019-10-22', lastGameOn: '2020-10-11' },
  { season: '2020-21', firstGameOn: '2020-12-22', lastGameOn: '2021-07-20' },
];

/** The seasons listing him, each stored or not, the source covering seasons from 1993-94. */
const careerOf = (stored: Readonly<Record<string, boolean>>): CareerSeasons => ({
  listedSeasons: Object.entries(stored).map(([season, areBoxScoresStored]) => ({
    season,
    areBoxScoresStored,
  })),
  firstCoveredSeason: '1993-94',
});

// His first season holds a game he sat out, then his first game played.
const CAREER = [
  lineIn(X, '2020-12-23'),
  lineIn(X, '2019-10-25', NOT_PLAYED),
  lineIn(X, '2019-10-27', UNDER_A_MINUTE),
];
const DEBUT = { firstNbaGameId: gameOf(X, '2019-10-27').id, firstNbaGameOn: '2019-10-27' };

describe('firstNbaGame', () => {
  it.each([
    ['every season stored', { '2019-20': true, '2020-21': true }],
    ['only the earliest stored', { '2019-20': true, '2020-21': false }],
  ])(
    '[STA-47] [CL-STA-04] [CL-STA-12] gives the US date of the earliest official game he played once the earliest season listing him is stored: %s',
    (_, stored) => {
      expect(firstNbaGame(CAREER, careerOf(stored), CAREER_SPANS)).toStrictEqual(DEBUT);
    },
  );

  it.each([
    [
      'his earliest season, not stored, beside a later one',
      CAREER.slice(0, 1),
      { '2019-20': false, '2020-21': true },
    ],
    ['the season of his earliest game, not stored', CAREER, { '2019-20': false }],
    [
      'a season after one he sat out, not stored',
      [lineIn(X, '2020-12-23'), lineIn(X, '2019-01-10', NOT_PLAYED)],
      { '2018-19': true, '2019-20': false, '2020-21': true },
    ],
    [
      'the first season the source covers',
      [lineIn(X, '1993-11-06')],
      { '1993-94': true, '1994-95': true },
    ],
    ['no game played yet', [lineIn(X, '2020-12-23', NOT_PLAYED)], { '2020-21': true }],
  ])('[STA-47] [CL-STA-12] answers "date unknown" for %s', (_, lines, stored) => {
    expect(firstNbaGame(lines, careerOf(stored), CAREER_SPANS)).toBeNull();
  });

  it('[STA-47] [CL-STA-12] gives the earliest game he played after a first season he sat out, once every season up to it is stored', () => {
    const lines = [lineIn(X, '2020-12-23'), lineIn(X, '2019-01-10', NOT_PLAYED)];
    const stored = { '2018-19': true, '2019-20': true, '2020-21': true };

    expect(firstNbaGame(lines, careerOf(stored), CAREER_SPANS)).toStrictEqual({
      firstNbaGameId: gameOf(X, '2020-12-23').id,
      firstNbaGameOn: '2020-12-23',
    });
  });
});
