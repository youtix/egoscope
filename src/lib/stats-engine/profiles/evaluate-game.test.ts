import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';
import example from '@data/fixtures/stats-engine/profiles/worked-example.json';

import { dateOf, dayCount, MS_PER_DAY } from '../calendar-days';
import { verifyBoxScore } from '../performance/box-score';
import { gameFactsOf, NOT_JUDGED, statisticsOf, teamGameOf } from './evaluate-game';

import type { BoxScoreLine } from '../performance/box-score';
import type { Participation } from '../performance/participation';
import type { GamePhase, GameStatus } from '../schedule/team-record';
import type { EngineParams, EpochMs, GameId, IsoDate, TeamId } from '../types';
import type { EvaluationTeamGame } from './evaluate-game';

// The registry's defaults. JSON gives the baseline phase as a string, which the comparison
// narrows to a BaselinePhase (types.test.ts).
const DEFAULTS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};

// Raw values are compared to 1e-9 (CL-STA-09).
const PRECISION = 9;
// A game starts at 00:30 UTC the day after its US Eastern day, and is consolidated a week later.
const START_MS = 30 * 60_000;
const CONSOLIDATION_MS = 7 * MS_PER_DAY;
const NOW: EpochMs = dayCount('2025-09-01') * MS_PER_DAY;
const [TEAM, OPPONENT, NEW_TEAM] = [1, 2, 3];
const [PREVIOUS, SEASON] = ['2023-24', '2024-25'];
// His Game Score per minute in a usual and a strong game of 35 minutes (the example's lines).
const USUAL = 14.8 / 35;
const STRONG = 25.9 / 35;

/** Any number within 1e-9 of `value` (CL-STA-09). */
function near(value: number): unknown {
  return expect.closeTo(value, PRECISION);
}

// A complete line (STA-09): the strong line's shooting, any other totals, and any time on
// court from one second to 48 minutes, in minutes and seconds or in whole minutes (CL-STA-06).
const anyCompleteLine = fc
  .record({
    seconds: fc.integer({ min: 1, max: 48 * 60 }),
    isInWholeMinutes: fc.boolean(),
    offensiveRebounds: fc.nat(8),
    defensiveRebounds: fc.nat(15),
    assists: fc.nat(15),
    steals: fc.nat(6),
    blocks: fc.nat(6),
    turnovers: fc.nat(8),
    personalFouls: fc.nat(6),
  })
  .map(({ seconds, isInWholeMinutes, ...counts }): BoxScoreLine => {
    const totals = { ...example.lines.strong, ...counts };
    return isInWholeMinutes
      ? {
          ...totals,
          minutesPrecision: 'whole_minutes',
          minutes: Math.ceil(seconds / 60),
          seconds: null,
        }
      : {
          ...totals,
          minutesPrecision: 'seconds',
          minutes: Math.floor(seconds / 60),
          seconds: seconds % 60,
        };
  });

type Row = Readonly<{
  id: GameId;
  season: string;
  phase: GamePhase;
  teamId: TeamId;
  line: 'usual' | 'strong' | 'short' | 'incomplete' | null;
  isInWholeMinutes?: boolean;
  participation: Participation | null;
  status: GameStatus;
  isHomeWin: boolean;
  isEliminationGame: boolean | null;
  isConsolidated: boolean;
  ejected: boolean | null;
}> &
  Readonly<{ on: IsoDate }>;

/** `count` final games he played, every two days from the first, his lines alternating. */
function gamesOf(
  {
    season,
    phase,
    on,
    id,
  }: Readonly<{ season: string; phase: GamePhase; on: IsoDate; id: GameId }>,
  count: number,
): readonly Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: id + index,
    season,
    on: dateOf(dayCount(on) + 2 * index),
    phase,
    teamId: TEAM,
    line: index % 2 === 0 ? 'usual' : 'strong',
    participation: 'played',
    status: 'final',
    isHomeWin: index % 2 === 0,
    isEliminationGame: phase === 'regular_season' ? null : false,
    isConsolidated: true,
    ejected: false,
  }));
}

// The season before (ids 1 to 12), then 15 regular-season games (101 to 115) and 12 playoff
// games (201 to 212) of the season, in which he missed games 104 and 105; game 106 is
// strong.
const MEASURED = 106;
const MISSED = new Set([104, 105]);
const ROWS: readonly Row[] = [
  ...gamesOf({ season: PREVIOUS, phase: 'regular_season', on: '2023-10-24', id: 1 }, 12),
  ...gamesOf({ season: SEASON, phase: 'regular_season', on: '2024-10-22', id: 101 }, 15),
  ...gamesOf({ season: SEASON, phase: 'playoffs', on: '2025-04-19', id: 201 }, 12),
].map((row): Row =>
  MISSED.has(row.id) ? { ...row, participation: 'not_played', line: null } : row,
);
const NOT_YET: Partial<Row> = {
  status: 'scheduled',
  participation: null,
  line: null,
  isConsolidated: false,
};
const FACTS = {
  contextIndications: [{ injuryReturn: 'no', gameStakes: 'normal' }],
  coOccurringTypeIds: [],
  switchedOffCriterion: null,
  decisions: [],
} as const;

/** The rows, those of the given ids changed. */
function changed(
  changes: readonly (readonly [GameId, Partial<Row>])[],
  rows = ROWS,
): readonly Row[] {
  const byId = new Map(changes);
  return rows.map((row) => ({ ...row, ...byId.get(row.id) }));
}

/**
 * His line in a game, from the example's, without points when incomplete, in minutes and
 * seconds or, as the chosen source gives it, in whole minutes (CL-STA-06).
 */
function lineOf(line: NonNullable<Row['line']>, isInWholeMinutes = false): BoxScoreLine {
  const { points, seconds, ...totals } = example.lines[line === 'incomplete' ? 'usual' : line];
  const linePoints = line === 'incomplete' ? null : points;
  return isInWholeMinutes
    ? { ...totals, points: linePoints, seconds: null, minutesPrecision: 'whole_minutes' }
    : { ...totals, points: linePoints, seconds, minutesPrecision: 'seconds' };
}

/** A team game of his, at home against the opponent. */
function teamGameFor(row: Row): EvaluationTeamGame {
  const startAt = (dayCount(row.on) + 1) * MS_PER_DAY + START_MS;
  const isFinal = row.status === 'final';
  const boxScore =
    row.line === null ? null : verifyBoxScore(lineOf(row.line, row.isInWholeMinutes), 0);
  return {
    game: {
      id: row.id,
      season: row.season,
      phase: row.phase,
      status: row.status,
      homeTeamId: row.teamId,
      awayTeamId: OPPONENT,
      finalScore: isFinal
        ? { home: row.isHomeWin ? 100 : 90, away: row.isHomeWin ? 90 : 100 }
        : null,
      scheduledStartAt: startAt,
      homeLinesPublished: isFinal,
      awayLinesPublished: isFinal,
      consolidatedAt: row.isConsolidated ? startAt + CONSOLIDATION_MS : null,
      isEliminationGame: row.isEliminationGame,
    },
    teamId: row.teamId,
    participation: row.participation,
    minutes: boxScore?.decimalMinutes ?? null,
    gameDayOn: row.on,
    endOfDayPacificAt: startAt,
    isBoxScoreUnavailable: false,
    boxScore,
    ejected: row.ejected,
  };
}

/** What a measurement reads: his team games, their schedules, the instant and the parameters. */
function contextOf(
  rows: readonly Row[] = ROWS,
  setting: Readonly<{ isOver?: boolean; params?: EngineParams }> = {},
) {
  const teamGames = rows.map((row) => teamGameFor(row));
  const seasons = [...new Set(rows.map(({ season }) => season))];
  const schedules = seasons.map((season) => ({
    season,
    schedule: {
      games: teamGames.filter(({ game }) => game.season === season).map(({ game }) => game),
      series: [],
      hasLaterSeasonGame: (setting.isOver ?? true) || season !== seasons.at(-1),
    },
  }));
  return {
    input: { teamGames, schedules, now: NOW },
    params: setting.params ?? DEFAULTS,
    gameById: new Map(teamGames.map((teamGame) => [teamGame.game.id, teamGame])),
  };
}

/** The facts of the measured game `id`. */
function factsOf(
  id: GameId,
  context = contextOf(),
  facts: Parameters<typeof gameFactsOf>[1] = FACTS,
): ReturnType<typeof gameFactsOf> {
  return gameFactsOf(teamGameOf(id, context), facts, context);
}

/** The baseline that statisticsOf gives game `id`. */
function baselineOf(id: GameId, context = contextOf()) {
  const statistics = statisticsOf(id, context);
  return statistics.boxScoreStatus === 'complete' ? statistics.baseline : null;
}

/** The statistics of the measured game once incomplete, consolidated or not. */
function incompleteStatisticsOf(isConsolidated: boolean) {
  const rows = changed([[MEASURED, { line: 'incomplete', isConsolidated }]]);
  return statisticsOf(MEASURED, contextOf(rows));
}

/** The measured game's baseline once the first three games of the season are changed. */
function withFirstGames(change: Partial<Row>) {
  const rows = changed([101, 102, 103].map((id) => [id, change]));
  const baseline = baselineOf(MEASURED, contextOf(rows));
  return [baseline?.status, baseline?.gameCount, baseline?.isPartial];
}

describe('statisticsOf', () => {
  it('[STA-14] [STA-16] [CL-SEN-05] gives his complete box score with its index and the baseline of its season and phase, the measured game left out', () => {
    const mean = (7 * USUAL + 5 * STRONG) / 12;
    const deviation = Math.sqrt((7 * (USUAL - mean) ** 2 + 5 * (STRONG - mean) ** 2) / 11);
    const statistics = statisticsOf(MEASURED, contextOf());
    expect(statistics).toMatchObject({ boxScoreStatus: 'complete' });
    const index = statistics.boxScoreStatus === 'complete' ? statistics.performanceIndex : NaN;
    expect(index).toBeCloseTo(STRONG, PRECISION);
    const baseline = baselineOf(MEASURED);
    expect(baseline).toMatchObject({
      season: SEASON,
      phase: 'regular_season',
      status: 'final',
      gameCount: 12,
      isPartial: false,
    });
    expect(baseline?.mean).toBeCloseTo(mean, PRECISION);
    expect(baseline?.standardDeviation).toBeCloseTo(deviation, PRECISION);
  });

  it('[STA-24] [STA-13] counts a game he played too short among the played games, so that 2 of 10 without an index leave the baseline whole', () => {
    const unknown: Partial<Row> = { participation: 'unknown', line: null };
    const missed: Partial<Row> = { participation: 'not_played', line: null };
    const rows = changed([
      [101, unknown],
      [102, unknown],
      [103, { line: 'short' }],
      [107, missed],
      [108, missed],
      [109, missed],
    ]);
    const baseline = baselineOf(MEASURED, contextOf(rows));
    expect([baseline?.status, baseline?.gameCount, baseline?.isPartial]).toStrictEqual([
      'insufficient',
      6,
      false,
    ]);
  });

  it('[STA-33] gives an incomplete box score with whether its game is still in its correction window', () => {
    expect(incompleteStatisticsOf(false)).toStrictEqual({
      boxScoreStatus: 'incomplete',
      consolidation: 'in_correction_window',
    });
    expect(incompleteStatisticsOf(true)).toStrictEqual({
      boxScoreStatus: 'incomplete',
      consolidation: 'consolidated',
    });
  });

  it('[STA-24] [STA-14] marks a baseline partial when too many of its games lack an index, a game he missed counting in none', () => {
    expect(withFirstGames({ participation: 'unknown', line: null })).toStrictEqual([
      'insufficient',
      9,
      true,
    ]);
    expect(withFirstGames({ line: 'incomplete' })).toStrictEqual(['insufficient', 9, true]);
    expect(withFirstGames({ participation: 'not_played', line: null })).toStrictEqual([
      'insufficient',
      9,
      false,
    ]);
  });

  it('[STA-20] [CL-STA-02] gives a provisional baseline while the regular season or his postseason goes on, and a final one once it is over', () => {
    const regularUnderWay = contextOf(
      changed(
        [[115, NOT_YET]],
        ROWS.filter(({ phase }) => phase === 'regular_season'),
      ),
      { isOver: false },
    );
    expect(baselineOf(MEASURED, regularUnderWay)).toMatchObject({
      status: 'provisional',
      gameCount: 11,
    });
    const playoffsUnderWay = contextOf(changed([[212, NOT_YET]]), { isOver: false });
    expect(baselineOf(204, playoffsUnderWay)).toMatchObject({
      phase: 'postseason',
      status: 'provisional',
      gameCount: 10,
    });
    expect(baselineOf(MEASURED, playoffsUnderWay)).toMatchObject({
      phase: 'regular_season',
      status: 'final',
    });
    expect(baselineOf(204)).toMatchObject({ phase: 'postseason', status: 'final', gameCount: 11 });
  });

  it('[CL-SEN-05] throws, as for a bug of the caller, on a game that is none of his, a played game without his line, a season without its schedule, or a postseason that its schedule does not hold', () => {
    expect(() => statisticsOf(999, contextOf())).toThrow('Game 999 is not one of his team games');
    expect(() => statisticsOf(MEASURED, contextOf(changed([[MEASURED, { line: null }]])))).toThrow(
      'Game 106 has no checked line of his',
    );
    const context = contextOf(ROWS, { isOver: false });
    const unscheduled = {
      ...context,
      input: {
        ...context.input,
        schedules: context.input.schedules.filter(({ season }) => season !== SEASON),
      },
    };
    expect(() => statisticsOf(MEASURED, unscheduled)).toThrow(
      'The schedule of 2024-25 is not stored',
    );
    const withoutPlayoffs = context.input.schedules.map(({ season, schedule }) => ({
      season,
      schedule: {
        ...schedule,
        games: schedule.games.filter(({ phase }) => phase === 'regular_season'),
      },
    }));
    expect(() =>
      statisticsOf(204, { ...context, input: { ...context.input, schedules: withoutPlayoffs } }),
    ).toThrow('The schedule of 2024-25 holds no postseason of his team');
  });
});

describe('gameFactsOf', () => {
  it('[SEN-08] [STA-12] [CL-SEN-09] records the games he missed right before the measured game, the threshold of its season, his minutes, index and baseline, and no criterion in a usual game', () => {
    const { values, judgment, reviewFlags } = factsOf(MEASURED);
    expect(values).toMatchObject({
      teamGamesMissedBefore: 2,
      playingTimeThresholdMinutes: 17.5,
      measuredMinutes: 35,
    });
    expect(values.performanceIndex).toBeCloseTo(STRONG, PRECISION);
    expect(values.baseline).toStrictEqual(baselineOf(MEASURED));
    expect([judgment, reviewFlags]).toStrictEqual([NOT_JUDGED, []]);
  });

  it('[CL-SEN-09] counts in that run every game he missed since the start of the season, and no postponed game', () => {
    const missedFirst = changed([
      [101, { participation: 'not_played', line: null }],
      [102, { participation: 'not_played', line: null }],
    ]);
    expect(factsOf(103, contextOf(missedFirst)).values.teamGamesMissedBefore).toBe(2);
    const postponed = changed([[103, { status: 'postponed', participation: null, line: null }]]);
    expect(factsOf(MEASURED, contextOf(postponed)).values.teamGamesMissedBefore).toBe(2);
  });

  it('[SEN-07] [STA-12] [CL-STA-06] records his minutes and their mark alone on an incomplete box score, and nothing of his performance in a game not played yet', () => {
    const incomplete = factsOf(MEASURED, contextOf(changed([[MEASURED, { line: 'incomplete' }]])));
    expect(incomplete).toMatchObject({
      values: {
        measuredMinutes: 35,
        hasRoundedMinutes: false,
        measuredGameScore: null,
        performanceIndex: null,
        baseline: null,
      },
      judgment: NOT_JUDGED,
    });
    const notYet = factsOf(115, contextOf(changed([[115, NOT_YET]]), { isOver: false }));
    expect(notYet).toMatchObject({
      values: {
        teamGamesMissedBefore: 0,
        measuredMinutes: null,
        hasRoundedMinutes: null,
        measuredGameScore: null,
        performanceIndex: null,
        baseline: null,
      },
      judgment: NOT_JUDGED,
      reviewFlags: [],
    });
  });

  it('[STA-11] [STA-12] [CL-STA-06] [CL-STA-09] records the Game Score of his complete line, never rounded, and whether his line is in whole minutes, whatever its status', () => {
    const changes: readonly Partial<Row>[] = [
      {},
      { isInWholeMinutes: true },
      { line: 'usual' },
      { line: 'short' },
      { line: 'incomplete' },
      { line: 'incomplete', isInWholeMinutes: true },
    ];
    const recorded = changes.map((change) => {
      const { values } = factsOf(MEASURED, contextOf(changed([[MEASURED, change]])));
      return [values.measuredGameScore, values.hasRoundedMinutes, values.measuredMinutes];
    });
    expect(recorded).toStrictEqual([
      [near(25.9), false, 35],
      [near(25.9), true, 35],
      [near(14.8), false, 35],
      [near(2.9), false, 14],
      [null, false, 35],
      [null, true, 35],
    ]);
  });

  it('[STA-11] [STA-12] [CL-STA-06] [CL-STA-09] gives every complete line an index that is its Game Score divided by his minutes, to the bit, and the mark of its minutes', () => {
    const context = contextOf();
    const measured = teamGameOf(MEASURED, context);
    fc.assert(
      fc.property(anyCompleteLine, (line) => {
        const boxScore = verifyBoxScore(line, 0);
        const { values } = gameFactsOf({ ...measured, boxScore }, FACTS, context);
        expect(boxScore.status).toBe('complete');
        expect(values.performanceIndex).toBe(
          (values.measuredGameScore ?? NaN) / (values.measuredMinutes ?? NaN),
        );
        expect(values.hasRoundedMinutes).toBe(line.minutesPrecision === 'whole_minutes');
      }),
    );
  });

  it('[SEN-12] [SEN-13] [SEN-14] [SEN-06] [CL-SEN-13] [CL-SEN-28] retains each criterion with its values, from the indications of each event, the co-occurring types and the playoffs, except the one the type sheet switches off', () => {
    const facts = {
      ...FACTS,
      contextIndications: [
        { injuryReturn: 'yes', gameStakes: 'normal' },
        { injuryReturn: 'no', gameStakes: 'high' },
      ],
      coOccurringTypeIds: ['public-praise'],
    } as const;
    const context = contextOf(changed([[MEASURED, { line: 'short' }]]), {
      params: {
        ...DEFAULTS,
        sensitivity: { ...DEFAULTS.sensitivity, coOccurringCasesDoubtful: true },
      },
    });
    expect(factsOf(MEASURED, context, facts).judgment.triggeredCriteria).toStrictEqual([
      {
        criterion: 'playing_time_too_low',
        condition: null,
        triggeringValues: { minutes: 14, threshold: 434 / 26 },
      },
      {
        criterion: 'injury_return',
        condition: 'flagged',
        triggeringValues: { injuryReturn: 'yes' },
      },
      {
        criterion: 'unusual_stakes',
        condition: 'flagged',
        triggeringValues: { gameStakes: 'high' },
      },
      {
        criterion: 'co_occurring',
        condition: null,
        triggeringValues: { coOccurringTypeIds: ['public-praise'] },
      },
    ]);
    const switchedOff = factsOf(MEASURED, context, {
      ...FACTS,
      switchedOffCriterion: 'playing_time_too_low',
    });
    expect(switchedOff.judgment.triggeredCriteria).toStrictEqual([]);
    const elimination = (isEliminationGame: boolean | null) =>
      factsOf(204, contextOf(changed([[204, { isEliminationGame }]]))).judgment;
    expect(elimination(true)).toStrictEqual({
      triggeredCriteria: [
        {
          criterion: 'unusual_stakes',
          condition: 'calculated',
          triggeringValues: { phase: 'playoffs', isEliminationGame: true },
        },
      ],
      opponentStrengthNotEvaluable: false,
      stakesNotEvaluable: false,
    });
    expect(elimination(null)).toStrictEqual({ ...NOT_JUDGED, stakesNotEvaluable: true });
  });

  it('[SEN-15] [CL-SEN-10] judges the opponent on the season before when its own season has too few games, and says when no season can tell', () => {
    const params = { ...DEFAULTS, sensitivity: { ...DEFAULTS.sensitivity, opponentMinGames: 20 } };
    const beaten = ROWS.map((row) => (row.season === PREVIOUS ? { ...row, isHomeWin: true } : row));
    expect(
      factsOf(MEASURED, contextOf(beaten, { params })).judgment.triggeredCriteria,
    ).toStrictEqual([
      {
        criterion: 'opponent_strength',
        condition: null,
        triggeringValues: { wins: 0, losses: 12, isPreviousSeason: true },
      },
    ]);
    const alone = contextOf(
      ROWS.filter(({ season }) => season === SEASON),
      { params },
    );
    expect(factsOf(MEASURED, alone).judgment).toStrictEqual({
      ...NOT_JUDGED,
      opponentStrengthNotEvaluable: true,
    });
  });

  it('[SEN-16] [CL-SEN-11] flags for review a first game with a new team, an ejection and a decision made on another game', () => {
    const traded = ROWS.map((row) =>
      row.id >= MEASURED && row.phase === 'regular_season' ? { ...row, teamId: NEW_TEAM } : row,
    );
    const context = contextOf(changed([[MEASURED, { ejected: true }]], traded));
    const decision = { id: 1, kind: 'exclude', decidedAt: NOW, measuredGameId: 105 } as const;
    expect(
      factsOf(MEASURED, context, { ...FACTS, decisions: [decision] }).reviewFlags,
    ).toStrictEqual(['first_game_with_new_team', 'ejection', 'manual_decision_to_review']);
  });
});
