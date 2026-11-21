import { describe, expect, it } from 'vitest';

import { expectedGameOf, nextGameOf } from './next-game';
import { teamMembership } from './team-membership';

import type { BoxScoreLine } from '../performance/box-score';
import type { NextGameCandidate, NextGameSchedule } from './next-game';
import type { PhaseSeries } from './phase-state';
import type { SeriesRound } from './series';
import type { LinesGame, PlayerLine, PlayerTeamChange } from './team-membership';

const HOUR = 3_600_000;
// From mid-March, games tip off at 19:30 New York time, 23:30 UTC under daylight saving
// time, and a game whose time is to be determined is deemed to start at 00:00 New York
// time, 04:00 UTC.
const TIP_OFF_HOUR = 23.5;
const DEEMED_START_HOUR = 4;

/** The instant `hour` hours into the UTC day `on`, written YYYY-MM-DD. */
const utc = (on: string, hour: number): number =>
  Date.UTC(Number(on.slice(0, 4)), Number(on.slice(5, 7)) - 1, Number(on.slice(8))) + hour * HOUR;

// His team X, the team Y he is traded to; the other teams go by their numbers.
const X = 1;
const Y = 2;

type Teams = readonly [home: number | null, away: number | null];

/** Game `id` of the 2025-26 regular season on `on`, `teams` at home and away, to play. */
function toPlay(id: number, on: string, [home, away]: Teams): NextGameCandidate {
  return {
    id,
    phase: 'regular_season',
    status: 'scheduled',
    scheduledStartAt: utc(on, TIP_OFF_HOUR),
    isStartTimeTbd: false,
    gameDayOn: on,
    homeTeamId: home,
    awayTeamId: away,
    finalScore: null,
    consolidatedAt: null,
  };
}

/** The same game, final and won by the home team. */
const won = (id: number, on: string, teams: Teams): NextGameCandidate => ({
  ...toPlay(id, on, teams),
  status: 'final',
  finalScore: { home: 112, away: 104 },
});

const inPlayoffs = (game: NextGameCandidate): NextGameCandidate => ({ ...game, phase: 'playoffs' });

/** The playoff games that `winner` won at home against `loser` on `days`, from id `firstId`. */
const sweep = (firstId: number, [winner, loser]: Teams, days: readonly string[]) =>
  days.map((on, index) => inPlayoffs(won(firstId + index, on, [winner, loser])));

const seriesOf = ([one, other]: readonly [number, number], round: SeriesRound): PhaseSeries => ({
  phase: 'playoffs',
  teamAId: Math.min(one, other),
  teamBId: Math.max(one, other),
  round,
  winsNeeded: 4,
});

const scheduleOf = (
  games: readonly NextGameCandidate[],
  series: readonly PhaseSeries[] = [],
): NextGameSchedule => ({ season: { games, series }, nextSeasonGames: [] });

const PLAYER = { teamId: X, lastGamePlayedOn: '2026-04-03' };

// April 2026: X played team 3 on the 3rd and plays at team 4 on the 7th, then team 5 at
// home on the 9th; Y plays team 6 on the 6th. Earlier, X has a postponed and a canceled
// game and two placeholders, each with one team still to be determined, on the 6th, and a
// game at the very instant of the question on the 5th.
const NOW = utc('2026-04-05', 12);
const APRIL = scheduleOf([
  toPlay(103, '2026-04-09', [X, 5]),
  won(101, '2026-04-03', [X, 3]),
  { ...toPlay(110, '2026-04-06', [X, 7]), status: 'postponed' },
  { ...toPlay(111, '2026-04-06', [7, X]), status: 'canceled' },
  toPlay(112, '2026-04-06', [null, X]),
  toPlay(113, '2026-04-06', [X, null]),
  { ...toPlay(114, '2026-04-05', [X, 8]), scheduledStartAt: NOW },
  toPlay(104, '2026-04-06', [Y, 6]),
  toPlay(102, '2026-04-07', [4, X]),
]);

/** Game 103 of the 9th, at a time to be determined. */
const TBD: NextGameCandidate = {
  ...toPlay(103, '2026-04-09', [X, 5]),
  isStartTimeTbd: true,
  scheduledStartAt: utc('2026-04-09', DEEMED_START_HOUR),
};

describe('nextGameOf', () => {
  it('[STA-26] [CL-STA-14] [CL-STA-17] gives the first game of his current team still to play after now, with its start, opponent, venue, phase and the date of his last game played, passing over the games of other teams, games not scheduled, placeholders and a game at now', () => {
    expect(nextGameOf(PLAYER, APRIL, NOW)).toStrictEqual({
      kind: 'game',
      gameId: 102,
      scheduledStartAt: utc('2026-04-07', TIP_OFF_HOUR),
      isStartTimeTbd: false,
      gameDayOn: '2026-04-07',
      phase: 'regular_season',
      opponentTeamId: 4,
      venue: 'away',
      lastGamePlayedOn: '2026-04-03',
    });
  });

  it('[STA-26] [STA-31] [CL-STA-14] gives a game whose time is to be determined with its deemed start and the mark', () => {
    const schedule = scheduleOf([TBD, won(102, '2026-04-07', [4, X])]);

    expect(nextGameOf(PLAYER, schedule, utc('2026-04-08', 12))).toMatchObject({
      gameId: 103,
      scheduledStartAt: utc('2026-04-09', DEEMED_START_HOUR),
      isStartTimeTbd: true,
      gameDayOn: '2026-04-09',
      opponentTeamId: 5,
      venue: 'home',
    });
  });

  it('[STA-26] [CL-STA-14] compares now with the deemed start of a game whose time is to be determined, never with the end of its day', () => {
    const schedule = scheduleOf([toPlay(106, '2026-04-11', [6, X]), TBD]);

    expect(nextGameOf(PLAYER, schedule, utc('2026-04-09', 12))).toMatchObject({ gameId: 106 });
  });

  it('[STA-26] [JOU-14] reads the next game in the schedule of his new current team after a trade', () => {
    const traded = { teamId: Y, lastGamePlayedOn: '2026-04-03' };

    expect(nextGameOf(traded, APRIL, NOW)).toMatchObject({
      gameId: 104,
      opponentTeamId: 6,
      venue: 'home',
    });
  });

  it('[STA-26] [CL-STA-30] finds the next game, between seasons, in the stored schedule of the next season', () => {
    const schedule = {
      ...scheduleOf([won(201, '2026-04-12', [X, 3])]),
      nextSeasonGames: [toPlay(401, '2026-10-21', [5, X])],
    };

    expect(nextGameOf(PLAYER, schedule, utc('2026-08-01', 12))).toMatchObject({
      gameId: 401,
      gameDayOn: '2026-10-21',
      opponentTeamId: 5,
      venue: 'away',
    });
  });
});

const R1_DAYS = ['2026-04-18', '2026-04-20', '2026-04-22', '2026-04-24'];
const FINALS_DAYS = ['2026-06-04', '2026-06-07', '2026-06-10', '2026-06-13'];
// The last day of the 2025-26 regular season, every game of it final.
const REGULAR_SEASON = [
  won(201, '2026-04-12', [X, 3]),
  won(202, '2026-04-12', [5, 6]),
  won(203, '2026-04-12', [7, 8]),
  won(204, '2026-04-12', [Y, 4]),
];
// Team 3 swept X in the first round, and team 5 swept team 6.
const FIRST_ROUND = [...sweep(211, [3, X], R1_DAYS), ...sweep(221, [5, 6], R1_DAYS)];
const FIRST_ROUND_SERIES = [seriesOf([X, 3], 'first_round'), seriesOf([5, 6], 'first_round')];
// Then team 3 leads team 5 in the second round.
const ELIMINATED = scheduleOf(
  [
    ...REGULAR_SEASON,
    ...FIRST_ROUND,
    inPlayoffs(won(231, '2026-05-04', [3, 5])),
    inPlayoffs(toPlay(232, '2026-05-06', [5, 3])),
  ],
  [...FIRST_ROUND_SERIES, seriesOf([3, 5], 'conference_semifinals')],
);
// Or team 5 leads team 3 two games to none in the Finals, or swept it.
const FINALS_UNDER_WAY = scheduleOf(
  [
    ...REGULAR_SEASON,
    ...FIRST_ROUND,
    ...sweep(241, [5, 3], FINALS_DAYS.slice(0, 2)),
    inPlayoffs(toPlay(243, '2026-06-10', [3, 5])),
  ],
  [...FIRST_ROUND_SERIES, seriesOf([3, 5], 'finals')],
);
const FINALS_OVER = scheduleOf(
  [...REGULAR_SEASON, ...FIRST_ROUND, ...sweep(241, [5, 3], FINALS_DAYS)],
  [...FIRST_ROUND_SERIES, seriesOf([3, 5], 'finals')],
);
// Or they are tied two games to two, their fifth game not listed.
const FINALS_TIED = scheduleOf(
  [
    ...REGULAR_SEASON,
    ...FIRST_ROUND,
    ...sweep(241, [5, 3], FINALS_DAYS.slice(0, 2)),
    ...sweep(243, [3, 5], FINALS_DAYS.slice(2)),
  ],
  [...FIRST_ROUND_SERIES, seriesOf([3, 5], 'finals')],
);
// A game of the next season, between two other teams.
const NEXT_SEASON_GAMES = [toPlay(401, '2026-10-21', [5, 6])];
// Or the stored playoffs stop at X and team 3 one game each in the first round, no Finals
// listed.
const CUT_SHORT = scheduleOf(
  [
    ...REGULAR_SEASON,
    inPlayoffs(won(211, '2026-04-18', [X, 3])),
    inPlayoffs(won(212, '2026-04-20', [3, X])),
  ],
  [seriesOf([X, 3], 'first_round')],
);
// X swept team 3, then won the first game of its second-round series against team 5,
// whose next game is not in the schedule yet.
const STILL_IN = scheduleOf(
  [
    ...REGULAR_SEASON,
    ...sweep(211, [X, 3], R1_DAYS),
    ...sweep(221, [5, 6], R1_DAYS),
    inPlayoffs(won(231, '2026-05-04', [X, 5])),
  ],
  [...FIRST_ROUND_SERIES, seriesOf([X, 5], 'conference_semifinals')],
);
// The regular season is over and the play-in under way, X in neither.
const PLAY_IN = scheduleOf(
  [...REGULAR_SEASON, { ...toPlay(301, '2026-04-15', [7, 8]), phase: 'play_in' }],
  [{ phase: 'play_in', teamAId: 7, teamBId: 8, round: 'play_in_7_vs_8', winsNeeded: 1 }],
);
// The last days of the regular season: X has played its last game, other teams play on.
const LAST_DAYS = scheduleOf([won(201, '2026-04-10', [X, 3]), toPlay(202, '2026-04-12', [5, 6])]);

const NO_GAME = { kind: 'no_game_scheduled' } as const;

describe('nextGameOf without a game to play', () => {
  it('[STA-26] [CL-STA-20] [CL-JOU-20] answers "no game scheduled" for a player without a team, the first reason, whatever the schedule', () => {
    const withoutTeam = { teamId: null, lastGamePlayedOn: '2026-04-03' };

    expect(nextGameOf(withoutTeam, APRIL, NOW)).toStrictEqual({
      ...NO_GAME,
      reason: 'player_without_team',
    });
  });

  it.each([
    ['put out in the first round, the second under way', ELIMINATED, '2026-05-05'],
    ['put out in the first round, the Finals under way', FINALS_UNDER_WAY, '2026-06-08'],
    ['never in the postseason, the play-in under way', PLAY_IN, '2026-04-14'],
  ])(
    '[STA-26] [CA-STA-09] [CL-STA-20] answers "no game scheduled", team eliminated, for a team %s',
    (_, schedule, on) => {
      expect(nextGameOf(PLAYER, schedule, utc(on, 12))).toStrictEqual({
        ...NO_GAME,
        reason: 'team_eliminated',
      });
    },
  );

  it('[STA-26] [CA-STA-09] [CL-STA-20] [CL-STA-30] answers "no game scheduled", offseason, once the Finals are over and while no game of the next season is stored', () => {
    expect(nextGameOf(PLAYER, FINALS_OVER, utc('2026-07-01', 12))).toStrictEqual({
      ...NO_GAME,
      reason: 'offseason',
    });
  });

  it('[STA-26] [CL-STA-18] [CL-STA-20] reads Finals tied two games to two, their fifth game not listed, as under way while no game of the next season is stored, and as over once one is', () => {
    const withNextSeason = { ...FINALS_TIED, nextSeasonGames: NEXT_SEASON_GAMES };

    expect(nextGameOf(PLAYER, FINALS_TIED, utc('2026-06-15', 12))).toStrictEqual({
      ...NO_GAME,
      reason: 'team_eliminated',
    });
    expect(nextGameOf(PLAYER, withNextSeason, utc('2026-08-01', 12))).toStrictEqual({
      ...NO_GAME,
      reason: 'schedule_not_published',
    });
  });

  it('[STA-26] [CL-STA-18] [CL-STA-20] reads Finals that the stored series list before any game of theirs is stored as not over', () => {
    const finalsListedOnly = scheduleOf(
      [...REGULAR_SEASON, ...FIRST_ROUND],
      [...FIRST_ROUND_SERIES, seriesOf([7, 8], 'finals')],
    );

    expect(nextGameOf(PLAYER, finalsListedOnly, utc('2026-06-08', 12))).toStrictEqual({
      ...NO_GAME,
      reason: 'team_eliminated',
    });
  });

  it.each([
    ['X, still in its series', X, 'schedule_not_published'],
    ['team 7, never in the postseason', 7, 'team_eliminated'],
  ])(
    '[STA-26] [CL-STA-18] [CL-STA-20] reads playoffs stopped short, no Finals listed, as under way while no game of the next season is stored, and as over once one is: %s',
    (_, teamId, reason) => {
      const player = { teamId, lastGamePlayedOn: '2026-04-20' };
      const withNextSeason = { ...CUT_SHORT, nextSeasonGames: NEXT_SEASON_GAMES };

      expect(nextGameOf(player, CUT_SHORT, utc('2026-05-01', 12))).toStrictEqual({
        ...NO_GAME,
        reason,
      });
      expect(nextGameOf(player, withNextSeason, utc('2026-08-01', 12))).toStrictEqual({
        ...NO_GAME,
        reason: 'schedule_not_published',
      });
    },
  );

  it.each([
    ['still in the playoffs, its next game not stored yet', STILL_IN, '2026-05-05'],
    ['done with its regular season while other teams play on', LAST_DAYS, '2026-04-11'],
    [
      'missing from the stored schedule of the next season',
      { ...FINALS_OVER, nextSeasonGames: [toPlay(401, '2026-10-21', [5, 6])] },
      '2026-08-01',
    ],
  ])(
    '[STA-26] [CL-STA-20] answers "no game scheduled", schedule not published, in any other case, as for a team %s',
    (_, schedule, on) => {
      expect(nextGameOf(PLAYER, schedule, utc(on, 12))).toStrictEqual({
        ...NO_GAME,
        reason: 'schedule_not_published',
      });
    },
  );

  it('[STA-26] [CL-STA-20] gives the teams still in the playoffs their next game while another team is out', () => {
    const atTeam5 = { teamId: 5, lastGamePlayedOn: '2026-05-04' };

    expect(nextGameOf(atTeam5, ELIMINATED, utc('2026-05-05', 12))).toMatchObject({
      gameId: 232,
      phase: 'playoffs',
      opponentTeamId: 3,
      venue: 'home',
    });
  });
});

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

type DatedGame = LinesGame & Readonly<{ gameDayOn: string; isStartTimeTbd: boolean }>;

/** Game `id` on `on`, `teams` at home and away, final, both teams' lines published. */
function gameOf(id: number, on: string, [home, away]: Teams): DatedGame {
  return {
    id,
    phase: 'regular_season',
    status: 'final',
    scheduledStartAt: utc(on, TIP_OFF_HOUR),
    gameDayOn: on,
    isStartTimeTbd: false,
    homeTeamId: home,
    awayTeamId: away,
    finalScore: { home: 99, away: 97 },
    homeLinesPublished: true,
    awayLinesPublished: true,
  };
}

const toPlayOn = (game: DatedGame): DatedGame => ({
  ...game,
  status: 'scheduled',
  finalScore: null,
});

// March 2026: X plays on the 16th, which he played, on the 18th, which he did not, and on
// the 20th at a time to be determined, its game of the 17th postponed with no make-up
// linked to it; Y plays on the 17th and the 19th.
const PLAYED_GAME = gameOf(1001, '2026-03-16', [X, 9]);
const MISSED_GAME = gameOf(1002, '2026-03-18', [9, X]);
const AT_Y = gameOf(2001, '2026-03-17', [Y, 9]);
const TBD_GAME: DatedGame = {
  ...toPlayOn(gameOf(1003, '2026-03-20', [X, 9])),
  isStartTimeTbd: true,
  scheduledStartAt: utc('2026-03-20', DEEMED_START_HOUR),
};
const MARCH: readonly DatedGame[] = [
  AT_Y,
  PLAYED_GAME,
  { ...gameOf(1004, '2026-03-17', [X, 9]), status: 'postponed', finalScore: null },
  MISSED_GAME,
  toPlayOn(gameOf(2002, '2026-03-19', [Y, 9])),
  TBD_GAME,
];
const LINES: readonly PlayerLine[] = [
  { gameId: 1001, scheduledStartAt: PLAYED_GAME.scheduledStartAt, teamId: X, line: PLAYED },
];
const ENTERED_AT = utc('2026-03-17', 12);

/** His expected game after `after`, his team history being `history`. */
const expectedAfter = (after: number, history: readonly PlayerTeamChange[] = []) =>
  expectedGameOf({ stints: teamMembership(LINES, history), lines: LINES }, MARCH, after);

/** A team change the owner entered on the 17th, at noon. */
const entered = (newTeamId: number | null): PlayerTeamChange => ({
  id: 1,
  changedAt: ENTERED_AT,
  newTeamId,
  origin: 'entered',
});

describe('expectedGameOf', () => {
  it('[STA-27] [CL-IMP-17] gives the first of his team games after an instant as the game given itself, with his team, participation and minutes', () => {
    const expected = expectedAfter(utc('2026-03-16', 12));

    expect(expected).toStrictEqual({
      game: PLAYED_GAME,
      teamId: X,
      participation: 'played',
      minutes: 30,
    });
    expect(expected?.game).toBe(PLAYED_GAME);
  });

  it('[STA-27] [CL-IMP-17] [CL-STA-17] keeps, strictly after the instant, a final game he did not play, and passes over a postponed game', () => {
    expect(expectedAfter(PLAYED_GAME.scheduledStartAt)).toStrictEqual({
      game: MISSED_GAME,
      teamId: X,
      participation: 'not_played',
      minutes: null,
    });
  });

  it('[STA-27] [STA-31] [CL-STA-14] reads the deemed start of a game whose time is to be determined, and gives none after the last team game', () => {
    expect(expectedAfter(MISSED_GAME.scheduledStartAt)?.game).toBe(TBD_GAME);
    expect(expectedAfter(TBD_GAME.scheduledStartAt)).toBeNull();
  });

  it('[STA-27] [CL-STA-05] [CL-JOU-03] gives, after an entered trade, the first game of the new team, not that of the team he left', () => {
    expect(expectedAfter(ENTERED_AT, [entered(Y)])).toStrictEqual({
      game: AT_Y,
      teamId: Y,
      participation: 'not_played',
      minutes: null,
    });
  });

  it('[STA-27] [CL-STA-05] [CL-JOU-20] gives no expected game while he belongs to no team', () => {
    expect(expectedAfter(ENTERED_AT, [entered(null)])).toBeNull();
  });
});
