import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';
import example from '@data/fixtures/stats-engine/profiles/worked-example.json';

import { dateOf, dayCount, MS_PER_DAY } from '../calendar-days';
import { verifyBoxScore } from '../performance/box-score';
import { evaluateCases } from './evaluate-cases';

import type { ManualDecision } from '../cases/manual-decisions';
import type { EngineParams, EpochMs, GameId, IsoDate, PlayerEventId, TeamId } from '../types';
import type {
  CaseEvaluation,
  CaseKey,
  EvaluationEvent,
  EvaluationType,
  PlayerEvaluationInput,
} from './evaluate-cases';
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
const SCALE = 10 ** 9;
const MS_PER_MINUTE = 60_000;
// A game starts at 19:30 US Eastern, taken as UTC-5: 00:30 UTC the next day. Its day ends at
// 08:00 UTC the next day in the Pacific time zone, and it is consolidated a week later.
const START_MS = 30 * MS_PER_MINUTE;
const PACIFIC_END_MS = 8 * 60 * MS_PER_MINUTE;
const EASTERN_OFFSET_MINUTES = 5 * 60;
const CONSOLIDATION_MS = 7 * MS_PER_DAY;
const NOON = 12 * 60;
const LATE = 23 * 60;
const NOW_ON = '2025-09-01';
const NOW: EpochMs = dayCount(NOW_ON) * MS_PER_DAY;
const SEASON = '2024-25';
const FIRST_GAME_ON = '2024-10-22';
const GAME_COUNT = 15;
const [TEAM, OPPONENT, NEW_TEAM] = [1, 2, 3];
const PLAYER_ID = '0b7e4c2d-9a1f-4e3b-8c5d-6f7a8b9c0d1e';
const TYPE = 'public-humiliation';
const OTHER_TYPE = 'public-praise';
// His Game Score per minute in a usual and a strong game of 35 minutes (the example's lines).
const USUAL = 14.8 / 35;
const STRONG = 25.9 / 35;
// Half his average minutes over the 13 games he played: 11 of 35 minutes and 2 of 14.
const THRESHOLD = 413 / 26;

type Row = Readonly<{ id: GameId; on: IsoDate; teamId: TeamId }> &
  Readonly<{ line: 'usual' | 'strong' | 'short' | null }>;

// His team's 15 games of the season, every two days from 2024-10-22 (ids 1 to 15), his lines
// alternating: he played games 3 and 11 short and missed games 5 and 6.
const SHORT = new Set([3, 11]);
const MISSED = new Set([5, 6]);

/** His line in game `id`: none when he missed it, short, or alternating. */
function lineOf(id: GameId): Row['line'] {
  if (MISSED.has(id)) {
    return null;
  }
  if (SHORT.has(id)) {
    return 'short';
  }
  return id % 2 === 1 ? 'usual' : 'strong';
}

const ROWS: readonly Row[] = Array.from({ length: GAME_COUNT }, (_, index) => ({
  id: index + 1,
  on: dateOf(dayCount(FIRST_GAME_ON) + 2 * index),
  teamId: TEAM,
  line: lineOf(index + 1),
}));

/** The instant of `minutes` after midnight US Eastern on `on`. */
function easternAt(on: IsoDate, minutes: number): EpochMs {
  return dayCount(on) * MS_PER_DAY + (minutes + EASTERN_OFFSET_MINUTES) * MS_PER_MINUTE;
}

/** The scheduled start of game `id`. */
function startOf(id: GameId): EpochMs {
  return (dayCount(FIRST_GAME_ON) + 2 * (id - 1) + 1) * MS_PER_DAY + START_MS;
}

/** A final team game of his, at home against the opponent, which the even ids win. */
function teamGameOf(row: Row): EvaluationTeamGame {
  const startAt = startOf(row.id);
  const boxScore =
    row.line === null
      ? null
      : verifyBoxScore({ ...example.lines[row.line], minutesPrecision: 'seconds' }, 0);
  const isHomeWin = row.id % 2 === 0;
  return {
    game: {
      id: row.id,
      season: SEASON,
      phase: 'regular_season',
      status: 'final',
      homeTeamId: row.teamId,
      awayTeamId: OPPONENT,
      finalScore: isHomeWin ? { home: 100, away: 90 } : { home: 90, away: 100 },
      scheduledStartAt: startAt,
      homeLinesPublished: true,
      awayLinesPublished: true,
      consolidatedAt: startAt + CONSOLIDATION_MS,
      isEliminationGame: null,
    },
    teamId: row.teamId,
    participation: row.line === null ? 'not_played' : 'played',
    minutes: boxScore?.decimalMinutes ?? null,
    gameDayOn: row.on,
    endOfDayPacificAt: (dayCount(row.on) + 1) * MS_PER_DAY + PACIFIC_END_MS,
    isBoxScoreUnavailable: false,
    boxScore,
    ejected: false,
  };
}

/** A historical event of his, known at `minutes` after midnight US Eastern on `on`. */
function eventOf(
  eventId: PlayerEventId,
  [on, minutes]: readonly [IsoDate, number],
  changes: Partial<EvaluationEvent> = {},
): EvaluationEvent {
  return {
    eventId,
    eventTypeId: TYPE,
    attachmentEvent: {
      kind: 'reference_instant',
      sources: null,
      referenceInstantAt: easternAt(on, minutes),
      referenceInstantOrigin: 'known_instant',
    },
    stateEvent: { origin: 'historical', referenceDayOn: on },
    isDatingToVerify: false,
    contextIndications: { injuryReturn: 'no', gameStakes: 'normal' },
    researchConfidence: 'high',
    ...changes,
  };
}

// His events: the first two before games 2 and 3, the third and fourth before game 9, the
// fifth before the two games he missed, the sixth after the last game of the season and the
// seventh before game 11.
const MOMENTS: readonly (readonly [IsoDate, number])[] = [
  ['2024-10-23', NOON],
  ['2024-10-25', NOON],
  ['2024-11-06', LATE],
  ['2024-11-07', NOON],
  ['2024-10-29', LATE],
  ['2024-11-19', LATE],
  ['2024-11-10', NOON],
];
const EVENTS = MOMENTS.map((moment, index) => eventOf(index + 1, moment));
const VALIDATED: EvaluationType = {
  eventTypeId: TYPE,
  status: 'validated',
  calendarDerivation: null,
  switchedOffCriterion: null,
  exitReasons: [],
};

/** The events, those of the given ids changed. */
function withEvents(
  changes: readonly (readonly [PlayerEventId, Partial<EvaluationEvent>])[],
): readonly EvaluationEvent[] {
  const byId = new Map(changes);
  return EVENTS.map((event) => ({ ...event, ...byId.get(event.eventId) }));
}

/** What the evaluation reads: his team games of the season, every one of his events. */
function inputOf(
  rows: readonly Row[] = ROWS,
  changes: Partial<PlayerEvaluationInput> = {},
): PlayerEvaluationInput {
  const teamGames = rows.map((row) => teamGameOf(row));
  return {
    player: {
      playerId: PLAYER_ID,
      isWithdrawn: false,
      hasBirthday: true,
      isMappingEstablished: true,
    },
    types: [VALIDATED],
    events: EVENTS,
    teamGames,
    schedules: [
      {
        season: SEASON,
        schedule: {
          games: teamGames.map(({ game }) => game),
          series: [],
          hasLaterSeasonGame: false,
        },
      },
    ],
    seasons: {
      firstCoveredSeason: SEASON,
      spans: [{ season: SEASON, firstGameOn: FIRST_GAME_ON, lastGameOn: rows.at(-1)?.on ?? null }],
      readSeasons: [{ season: SEASON, hasPlayerLines: true }],
      unpublishedSeason: null,
    },
    now: NOW,
    nowGameDayOn: NOW_ON,
    storedCaseOf: () => ({ origin: 'historical', decisions: [] }),
    ...changes,
  };
}

/** The case of `eventId`. */
function caseOf(evaluations: readonly CaseEvaluation[], eventId: PlayerEventId): CaseEvaluation {
  const found = evaluations.find(({ evaluated }) => evaluated.eventIds.includes(eventId));
  if (found === undefined) {
    throw new Error(`No case of event ${String(eventId)}`);
  }
  return found;
}

/** Each case as its events, status, reason and measured game. */
function statesOf(evaluations: readonly CaseEvaluation[]) {
  return evaluations.map(({ evaluated }) => [
    evaluated.eventIds,
    evaluated.status,
    evaluated.statusReason,
    evaluated.measuredGameId,
  ]);
}

/** A raw value rounded to the precision of the comparison (CL-STA-09), null for none. */
function rounded(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Math.round(value * SCALE) / SCALE;
}

/** A manual decision of `kind` made on game `measuredGameId`. */
function decision(
  id: number,
  kind: ManualDecision['kind'],
  measuredGameId: GameId,
): ManualDecision {
  return { id, kind, decidedAt: NOW, measuredGameId };
}

/** The criterion of the manual exclusion `decisionId`. */
function manual(decisionId: number) {
  return { criterion: 'manual', condition: null, triggeringValues: { decisionId } };
}

/** What a case co-occurring with cases of `coOccurringTypeIds` holds when they make it doubtful. */
function coOccurring(coOccurringTypeIds: readonly string[]) {
  return {
    status: 'excluded',
    isCoOccurring: true,
    coOccurringTypeIds,
    triggeredCriteria: [
      { criterion: 'co_occurring', condition: null, triggeringValues: { coOccurringTypeIds } },
    ],
  };
}

/** The cases of the example, evaluated afresh by each test that reads them, never as the file loads. */
const base = (): readonly CaseEvaluation[] => evaluateCases(inputOf(), DEFAULTS);

describe('evaluateCases', () => {
  it('[SEN-05] [SEN-07] [CL-SEN-06] gives each event its case, two events of one type on one game grouped into one, in the order of their earliest events', () => {
    expect(statesOf(base())).toStrictEqual([
      [[1], 'measured', null, 2],
      [[2], 'excluded', null, 3],
      [[5], 'measured', null, 7],
      [[3, 4], 'measured', null, 9],
      [[7], 'excluded', null, 11],
      [[6], 'not_measurable', 'no_game_within_window', null],
    ]);
    const lowResearch = evaluateCases(
      inputOf(ROWS, { events: withEvents([[4, { researchConfidence: 'low' }]]) }),
      DEFAULTS,
    );
    expect(caseOf(lowResearch, 4).profileCase.events).toStrictEqual([
      { researchConfidence: 'high' },
      { researchConfidence: 'low' },
    ]);
  });

  it('[SEN-03] [SEN-08] [SEN-10] [CL-SEN-05] [CL-SEN-09] records of a measured case its game, the games he missed before it, his minutes, index, baseline, gap and its status', () => {
    const mean = (4 * USUAL + 6 * STRONG) / 10;
    const deviation = Math.sqrt((4 * (USUAL - mean) ** 2 + 6 * (STRONG - mean) ** 2) / 9);
    const { evaluated, profileCase, withoutDecision } = caseOf(base(), 5);
    const { playingTimeThresholdMinutes, performanceIndex, baseline, normalizedGap, ...rest } =
      evaluated;
    const raw = [
      playingTimeThresholdMinutes,
      performanceIndex,
      baseline?.mean,
      baseline?.standardDeviation,
      normalizedGap,
    ];
    const expected = [THRESHOLD, USUAL, mean, deviation, (USUAL - mean) / deviation];
    expect(raw.map((value) => rounded(value))).toStrictEqual(
      expected.map((value) => rounded(value)),
    );
    expect(rest).toStrictEqual({
      eventTypeId: TYPE,
      eventIds: [5],
      origin: 'historical',
      referenceInstantAt: easternAt('2024-10-29', LATE),
      referenceInstantOrigin: 'known_instant',
      status: 'measured',
      statusReason: null,
      measuredGameId: 7,
      teamGamesMissedBefore: 2,
      measuredMinutes: 35,
      gapStatus: 'final',
      triggeredCriteria: [],
      opponentStrengthNotEvaluable: false,
      stakesNotEvaluable: false,
      decision: null,
      statusWithoutDecision: null,
      reviewFlags: [],
      isCoOccurring: false,
      coOccurringTypeIds: [],
    });
    expect({ ...baseline, mean: null, standardDeviation: null }).toStrictEqual({
      season: SEASON,
      phase: 'regular_season',
      status: 'final',
      gameCount: 10,
      isPartial: false,
      mean: null,
      standardDeviation: null,
    });
    expect(profileCase).toStrictEqual({
      caseId: 2,
      events: [{ researchConfidence: 'high' }],
      isCoOccurring: false,
      origin: 'historical',
      measuredGameScheduledStartAt: startOf(7),
      normalizedGap,
      gapStatus: 'final',
      status: 'measured',
    });
    expect(withoutDecision).toStrictEqual({ caseId: 2, statusWithoutDecision: 'measured' });
  });

  it('[SEN-07] [SEN-11] [CL-SEN-05] excludes a case on its criteria with their values, and gives a case without a game nothing of one', () => {
    const excluded = caseOf(base(), 2);
    expect(excluded.evaluated.triggeredCriteria).toStrictEqual([
      {
        criterion: 'playing_time_too_low',
        condition: null,
        triggeringValues: {
          minutes: 14,
          threshold: caseOf(base(), 5).evaluated.playingTimeThresholdMinutes,
        },
      },
    ]);
    expect(excluded.profileCase).toMatchObject({
      status: 'excluded',
      triggeredCriteria: ['playing_time_too_low'],
    });
    const { evaluated, profileCase, withoutDecision } = caseOf(base(), 6);
    expect(evaluated).toStrictEqual({
      eventTypeId: TYPE,
      eventIds: [6],
      origin: 'historical',
      referenceInstantAt: easternAt('2024-11-19', LATE),
      referenceInstantOrigin: 'known_instant',
      status: 'not_measurable',
      statusReason: 'no_game_within_window',
      measuredGameId: null,
      teamGamesMissedBefore: null,
      playingTimeThresholdMinutes: null,
      measuredMinutes: null,
      performanceIndex: null,
      baseline: null,
      normalizedGap: null,
      gapStatus: null,
      triggeredCriteria: [],
      opponentStrengthNotEvaluable: false,
      stakesNotEvaluable: false,
      decision: null,
      statusWithoutDecision: null,
      reviewFlags: [],
      isCoOccurring: false,
      coOccurringTypeIds: [],
    });
    expect(profileCase).toStrictEqual({
      caseId: 5,
      events: [{ researchConfidence: 'high' }],
      isCoOccurring: false,
      origin: 'historical',
      status: 'not_measurable',
      statusReason: 'no_game_within_window',
      measuredGameId: null,
      normalizedGap: null,
      gapStatus: null,
    });
    expect(withoutDecision).toBeNull();
  });

  it('[SEN-17] [CL-SEN-12] [CL-SEN-27] lets the decision made on its measured game rule a case, adding the criterion manual to an exclusion and dropping the criteria of a reinstatement', () => {
    const decisions = new Map([
      [1, [decision(11, 'exclude', 2)]],
      [2, [decision(12, 'reinstate', 3)]],
      [3, [decision(14, 'exclude', 8)]],
      [6, [decision(16, 'exclude', 15)]],
      [7, [decision(13, 'exclude', 11)]],
    ]);
    const keys: CaseKey[] = [];
    const storedCaseOf = (key: CaseKey) => {
      keys.push(key);
      return { origin: 'tracked' as const, decisions: decisions.get(key.eventIds[0] ?? 0) ?? [] };
    };
    const evaluations = evaluateCases(inputOf(ROWS, { storedCaseOf }), DEFAULTS);
    expect(keys).toStrictEqual(
      base().map(({ evaluated }) => ({
        eventTypeId: TYPE,
        measuredGameId: evaluated.measuredGameId,
        eventIds: evaluated.eventIds,
      })),
    );
    expect(
      evaluations.map(({ evaluated }) => [
        evaluated.origin,
        evaluated.status,
        evaluated.decision?.id ?? null,
        evaluated.statusWithoutDecision,
        evaluated.triggeredCriteria.map(({ criterion }) => criterion),
        evaluated.reviewFlags,
      ]),
    ).toStrictEqual([
      ['tracked', 'excluded', 11, 'measured', ['manual'], []],
      ['tracked', 'measured', 12, 'excluded', [], []],
      ['tracked', 'measured', null, null, [], []],
      ['tracked', 'measured', null, null, [], ['manual_decision_to_review']],
      ['tracked', 'excluded', 13, 'excluded', ['playing_time_too_low', 'manual'], []],
      ['tracked', 'not_measurable', null, null, [], []],
    ]);
    expect([
      caseOf(evaluations, 1).evaluated.triggeredCriteria,
      caseOf(evaluations, 7).evaluated.triggeredCriteria.at(-1),
    ]).toStrictEqual([[manual(11)], manual(13)]);
    expect(
      evaluations.map(({ profileCase }) => [
        profileCase.origin,
        profileCase.status,
        profileCase.status === 'excluded' ? profileCase.triggeredCriteria : null,
      ]),
    ).toStrictEqual([
      ['tracked', 'excluded', ['manual']],
      ['tracked', 'measured', null],
      ['tracked', 'measured', null],
      ['tracked', 'measured', null],
      ['tracked', 'excluded', ['playing_time_too_low', 'manual']],
      ['tracked', 'not_measurable', null],
    ]);
    expect(evaluations.map(({ withoutDecision }) => withoutDecision)).toStrictEqual([
      { caseId: 0, statusWithoutDecision: 'measured' },
      { caseId: 1, statusWithoutDecision: 'excluded' },
      { caseId: 2, statusWithoutDecision: 'measured' },
      { caseId: 3, statusWithoutDecision: 'measured' },
      { caseId: 4, statusWithoutDecision: 'excluded' },
      null,
    ]);
  });

  it('[JOU-14] [SEN-16] [CL-SEN-11] keeps every case when he is traded between an event and the next game, measuring it on the first game he played after it, with his new team, flagged and not excluded', () => {
    const traded = ROWS.map((row) => (row.id >= 5 ? { ...row, teamId: NEW_TEAM } : row));
    const evaluations = evaluateCases(inputOf(traded), DEFAULTS);
    expect(evaluations).toStrictEqual(
      base().map((each) =>
        each.evaluated.measuredGameId === 7
          ? { ...each, evaluated: { ...each.evaluated, reviewFlags: ['first_game_with_new_team'] } }
          : each,
      ),
    );
    expect(caseOf(evaluations, 5).evaluated).toMatchObject({
      status: 'measured',
      measuredGameId: 7,
    });
  });

  it('[SEN-45] [STA-03] keeps a case awaiting while its dating is to verify or his statistics mapping is not established, each event then a case of its own', () => {
    const dating = evaluateCases(
      inputOf(ROWS, { events: withEvents([[1, { isDatingToVerify: true }]]) }),
      DEFAULTS,
    );
    expect(statesOf(dating)[0]).toStrictEqual([[1], 'awaiting_game', 'dating_to_verify', null]);
    const unmapped = evaluateCases(
      inputOf(ROWS, { player: { ...inputOf().player, isMappingEstablished: false } }),
      DEFAULTS,
    );
    expect(statesOf(unmapped)).toStrictEqual(
      [1, 2, 5, 3, 4, 7, 6].map((eventId) => [
        [eventId],
        'awaiting_game',
        'mapping_not_established',
        null,
      ]),
    );
  });

  it('[SEN-06] [SEN-13] [SEN-14] [CL-SEN-13] [CL-SEN-28] judges a case on the indications of each of its events, the types of the cases on its game and the sheet of its type, leaving out an event of a type not given', () => {
    const events = [
      ...withEvents([[4, { contextIndications: { injuryReturn: 'yes', gameStakes: 'high' } }]]),
      eventOf(8, ['2024-10-23', LATE], { eventTypeId: OTHER_TYPE }),
      eventOf(9, ['2024-10-23', LATE], { eventTypeId: 'not-given' }),
    ];
    const types = [
      { ...VALIDATED, switchedOffCriterion: 'playing_time_too_low' as const },
      { ...VALIDATED, eventTypeId: OTHER_TYPE },
    ];
    const params = {
      ...DEFAULTS,
      sensitivity: { ...DEFAULTS.sensitivity, coOccurringCasesDoubtful: true },
    };
    const evaluations = evaluateCases(inputOf(ROWS, { events, types }), params);
    expect(evaluations.map(({ evaluated }) => evaluated.eventTypeId)).toStrictEqual([
      TYPE,
      OTHER_TYPE,
      ...Array.from({ length: 5 }, () => TYPE),
    ]);
    expect(caseOf(evaluations, 4).evaluated.triggeredCriteria).toStrictEqual([
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
    ]);
    expect([
      caseOf(evaluations, 2).evaluated.status,
      caseOf(evaluations, 7).evaluated.status,
    ]).toStrictEqual(['measured', 'measured']);
    expect([caseOf(evaluations, 1).evaluated, caseOf(evaluations, 8).evaluated]).toMatchObject([
      coOccurring([OTHER_TYPE]),
      coOccurring([TYPE]),
    ]);
    expect(caseOf(evaluations, 8).profileCase).toMatchObject({
      isCoOccurring: true,
      triggeredCriteria: ['co_occurring'],
    });
  });
});
