import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';
import example from '@data/fixtures/stats-engine/profiles/worked-example.json';

import { dateOf, dayCount, MS_PER_DAY } from '../calendar-days';
import { verifyBoxScore } from '../performance/box-score';
import { evaluatePlayer } from './evaluate-player';

import type { ManualDecision } from '../cases/manual-decisions';
import type { AttachmentEvent } from '../measured-game/attachment';
import type { BoxScoreLine } from '../performance/box-score';
import type { Participation } from '../performance/participation';
import type { GameStatus } from '../schedule/team-record';
import type { EngineParams, EpochMs, GameId, IsoDate, TeamId } from '../types';
import type {
  EvaluatedCase,
  EvaluationEvent,
  EvaluationType,
  PlayerEvaluationInput,
  StoredCase,
} from './evaluate-cases';
import type { EvaluationTeamGame } from './evaluate-game';
import type { PlayerEvaluation, ProfileViewValues } from './evaluate-player';

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
const MS_PER_MINUTE = 60_000;
// A game starts at 19:30 US Eastern, taken as UTC-5 all year: 00:30 UTC the next day. Its
// day ends at 08:00 UTC the next day in the Pacific time zone, and it is consolidated a week
// later. The evaluation runs at noon UTC of the example's day.
const START_MS = 30 * MS_PER_MINUTE;
const PACIFIC_END_MS = 8 * 60 * MS_PER_MINUTE;
const EASTERN_OFFSET_MINUTES = 5 * 60;
const CONSOLIDATION_MS = 7 * MS_PER_DAY;
const NOON_MS = 12 * 60 * MS_PER_MINUTE;

// A season of the example: its regular season, his minutes when not the line's, the days
// he played short or missed, and its playoffs.
type SeasonSpec = Readonly<{
  season: string;
  firstGameOn: IsoDate;
  gameCount: number;
  playedTime: Readonly<{ minutes: number; seconds: number }> | null;
  shortGamesOn: readonly IsoDate[];
  missedGamesOn: readonly IsoDate[];
  playoffs: Readonly<{
    firstGameOn: IsoDate;
    gameCount: number;
    eliminationGameOn: IsoDate;
  }> | null;
}>;
type EventSpec = (typeof example.events)[number];
type GameRow = Readonly<{
  id: GameId;
  season: string;
  on: IsoDate;
  phase: 'regular_season' | 'playoffs';
  teamId: TeamId;
  isHomeWin: boolean;
  line: keyof typeof example.lines | 'incomplete' | null;
  playedTime: SeasonSpec['playedTime'];
  participation: Participation | null;
  status: GameStatus;
  isConsolidated: boolean;
  isEliminationGame: boolean | null;
  ejected: boolean | null;
}>;

const SEASONS: readonly SeasonSpec[] = example.seasons;
const EVENT_SPECS: readonly EventSpec[] = example.events;
const { playerId: PLAYER_ID, eventTypeId: TYPE, teamId: TEAM, opponentTeamId: OPPONENT } = example;
const OTHER_TYPE = 'public-praise';
const NOW: EpochMs = dayCount(example.nowOn) * MS_PER_DAY + NOON_MS;
const PLAYER: PlayerEvaluationInput['player'] = {
  playerId: PLAYER_ID,
  isWithdrawn: false,
  hasBirthday: true,
  isMappingEstablished: true,
};
const VALIDATED: EvaluationType = {
  eventTypeId: TYPE,
  status: 'validated',
  calendarDerivation: null,
  switchedOffCriterion: null,
  exitReasons: [],
};
const HISTORICAL: StoredCase = { origin: 'historical', decisions: [] };

/** The instant of `minutes` after midnight US Eastern on `on`. */
function easternAt(on: IsoDate, minutes: number): EpochMs {
  return dayCount(on) * MS_PER_DAY + (minutes + EASTERN_OFFSET_MINUTES) * MS_PER_MINUTE;
}

/** The end of the day `on` in the Pacific time zone. */
function endOfDayPacificOf(on: IsoDate): EpochMs {
  return (dayCount(on) + 1) * MS_PER_DAY + PACIFIC_END_MS;
}

/** The days of `count` games, every two days from `firstOn`. */
function gameDays(firstOn: IsoDate, count: number): readonly IsoDate[] {
  return Array.from({ length: count }, (_, index) => dateOf(dayCount(firstOn) + 2 * index));
}

/** His line in the game of `on`, the `index`th of its season: short, or alternating. */
function playedLineOf(spec: SeasonSpec, on: IsoDate, index: number): GameRow['line'] {
  if (spec.shortGamesOn.includes(on)) {
    return 'short';
  }
  return index % 2 === 0 ? 'usual' : 'strong';
}

/** His team games of a season: its regular season then its playoffs, the lines alternating. */
function seasonRows(spec: SeasonSpec): readonly Omit<GameRow, 'id'>[] {
  const { playoffs } = spec;
  const regular = gameDays(spec.firstGameOn, spec.gameCount).map((on) => ({
    on,
    phase: 'regular_season' as const,
    isEliminationGame: null,
  }));
  const postseason = (
    playoffs === null ? [] : gameDays(playoffs.firstGameOn, playoffs.gameCount)
  ).map((on) => ({
    on,
    phase: 'playoffs' as const,
    isEliminationGame: on === playoffs?.eliminationGameOn,
  }));
  return [...regular, ...postseason].map((game, index) => {
    const isMissed = spec.missedGamesOn.includes(game.on);
    return {
      ...game,
      season: spec.season,
      teamId: TEAM,
      isHomeWin: index % 4 < 2,
      line: isMissed ? null : playedLineOf(spec, game.on, index),
      playedTime: spec.playedTime,
      participation: isMissed ? 'not_played' : 'played',
      status: 'final',
      isConsolidated: true,
      ejected: false,
    };
  });
}

const ROWS: readonly GameRow[] = SEASONS.flatMap((spec) => seasonRows(spec)).map((row, index) => ({
  ...row,
  id: index + 1,
}));

/** The rows, those of the given days changed. */
function changed(changes: readonly (readonly [IsoDate, Partial<GameRow>])[]): readonly GameRow[] {
  const byDay = new Map(changes);
  return ROWS.map((row) => ({ ...row, ...byDay.get(row.on) }));
}

/** His line in a game: the example's, its minutes those of its season, without points when incomplete. */
function boxScoreLineOf({ line, playedTime }: GameRow): BoxScoreLine | null {
  if (line === null) {
    return null;
  }
  const { minutes, seconds, points, ...totals } =
    example.lines[line === 'incomplete' ? 'usual' : line];
  const time = line === 'short' || playedTime === null ? { minutes, seconds } : playedTime;
  const linePoints = line === 'incomplete' ? null : points;
  return { ...totals, ...time, points: linePoints, minutesPrecision: 'seconds' };
}

/** A team game of his, at home against the opponent. */
function teamGameOf(row: GameRow): EvaluationTeamGame {
  const startAt = (dayCount(row.on) + 1) * MS_PER_DAY + START_MS;
  const line = boxScoreLineOf(row);
  const boxScore = line === null ? null : verifyBoxScore(line, 0);
  const isFinal = row.status === 'final';
  const score = row.isHomeWin ? { home: 100, away: 90 } : { home: 90, away: 100 };
  return {
    game: {
      id: row.id,
      season: row.season,
      phase: row.phase,
      status: row.status,
      homeTeamId: row.teamId,
      awayTeamId: OPPONENT,
      finalScore: isFinal ? score : null,
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
    endOfDayPacificAt: endOfDayPacificOf(row.on),
    isBoxScoreUnavailable: false,
    boxScore,
    ejected: row.ejected,
  };
}

/** An event of the example, known at its instant US Eastern or, without one, at the end of its day. */
function eventOf(spec: EventSpec, changes: Partial<EvaluationEvent> = {}): EvaluationEvent {
  const [hours = 0, minutes = 0] = (spec.atEastern ?? '').split(':').map(Number);
  const attachmentEvent: AttachmentEvent =
    spec.atEastern === null
      ? {
          kind: 'reference_instant',
          sources: null,
          referenceInstantAt: endOfDayPacificOf(spec.on),
          referenceInstantOrigin: 'date_only',
        }
      : {
          kind: 'reference_instant',
          sources: null,
          referenceInstantAt: easternAt(spec.on, hours * 60 + minutes),
          referenceInstantOrigin: 'known_instant',
        };
  return {
    eventId: spec.eventId,
    eventTypeId: TYPE,
    attachmentEvent,
    stateEvent: { origin: 'historical', referenceDayOn: spec.on },
    isDatingToVerify: false,
    contextIndications: { injuryReturn: 'no', gameStakes: 'normal' },
    researchConfidence: 'high',
    ...changes,
  };
}

const EVENTS = EVENT_SPECS.map((spec) => eventOf(spec));

/** The events of the example, those of the given ids changed. */
function withEvents(
  changes: readonly (readonly [number, Partial<EvaluationEvent>])[],
): readonly EvaluationEvent[] {
  const byId = new Map(changes);
  return EVENTS.map((event) => ({ ...event, ...byId.get(event.eventId) }));
}

/** The evaluation's input from his team games and his events: every season stored and read. */
function inputOf(
  rows: readonly GameRow[] = ROWS,
  events: readonly EvaluationEvent[] = EVENTS,
): PlayerEvaluationInput {
  const teamGames = rows.map((row) => teamGameOf(row));
  const seasons = [...new Set(rows.map(({ season }) => season))];
  const spanOf = (
    season: string,
  ): Readonly<{ firstGameOn: IsoDate; lastGameOn: IsoDate | null }> => {
    const days = rows.filter((row) => row.season === season);
    const isOver = days.every(({ status }) => status === 'final');
    return {
      firstGameOn: days[0]?.on ?? '',
      lastGameOn: isOver ? (days.at(-1)?.on ?? null) : null,
    };
  };
  return {
    player: PLAYER,
    types: [VALIDATED],
    events,
    teamGames,
    schedules: seasons.map((season) => ({
      season,
      schedule: {
        games: teamGames.filter(({ game }) => game.season === season).map(({ game }) => game),
        series: [],
        hasLaterSeasonGame: season !== seasons.at(-1),
      },
    })),
    seasons: {
      firstCoveredSeason: seasons[0] ?? '',
      spans: seasons.map((season) => ({ season, ...spanOf(season) })),
      readSeasons: seasons.map((season) => ({ season, hasPlayerLines: true })),
      unpublishedSeason: null,
    },
    now: NOW,
    nowGameDayOn: example.nowOn,
    storedCaseOf: () => HISTORICAL,
  };
}

/** The case of `eventId`. */
function caseOf({ cases }: PlayerEvaluation, eventId: number): EvaluatedCase {
  const found = cases.find(({ eventIds }) => eventIds.includes(eventId));
  if (found === undefined) {
    throw new Error(`No case of event ${String(eventId)}`);
  }
  return found;
}

/** The view of all cases of his profile of the example's type. */
function viewOf({ profiles }: PlayerEvaluation): ProfileViewValues {
  const profile = profiles.find((each) => each.eventTypeId === TYPE);
  const found = profile?.views.find((each) => each.view === 'all_cases');
  if (found === undefined) {
    throw new Error(`No view of all cases of ${TYPE}`);
  }
  return found;
}

/** The items in any order. */
function anyOrder<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

/** Each profile as its type, whether it is archived, and each view's events and exits. */
function profilesOf({ profiles }: PlayerEvaluation): readonly string[] {
  return profiles.map(({ eventTypeId, isArchived, views }) =>
    [
      eventTypeId,
      isArchived ? 'archived' : 'current',
      ...views.map(({ tally }) => `${String(tally.eventCount)}${JSON.stringify(tally.exitCounts)}`),
    ].join(' '),
  );
}

const BASE = evaluatePlayer(inputOf(), DEFAULTS);

describe('evaluatePlayer', () => {
  it('[SEN-32] [SEN-05] [SEN-01] [SEN-03] [SEN-12] [SEN-14] gives step 1 of the worked example: 12 events, 11 cases, 8 valid, 2 excluded, 1 not measurable, none awaiting, one event grouped', () => {
    expect(
      BASE.cases.map((caseItem) => ({
        eventIds: caseItem.eventIds,
        status: caseItem.status,
        statusReason: caseItem.statusReason,
        measuredGameOn: ROWS.find(({ id }) => id === caseItem.measuredGameId)?.on ?? null,
        baselineGameCount: caseItem.baseline?.gameCount ?? null,
        triggeredCriteria: caseItem.triggeredCriteria,
      })),
    ).toStrictEqual(example.expected.cases);
    const { tally } = viewOf(BASE);
    expect(tally).toStrictEqual(example.expected.tally);
    // SEN-32: 12 = 11 + 1 and 11 = 0 + 8 + 2 + 1.
    expect(tally.eventCount).toBe(tally.caseCount + tally.groupedEventCount);
    expect(tally.caseCount).toBe(
      tally.awaitingCount + tally.validCount + tally.excludedCount + tally.notMeasurableCount,
    );
  });

  it('[SEN-32] [SEN-19] gives the same cases and profiles, to the bit, whatever the order of its inputs', () => {
    const input = {
      ...inputOf(),
      types: [VALIDATED, { ...VALIDATED, eventTypeId: OTHER_TYPE }],
      events: [
        ...EVENTS,
        eventOf({ eventId: 13, on: '2019-10-22', atEastern: '22:10' }, { eventTypeId: OTHER_TYPE }),
      ],
    };
    const expected = evaluatePlayer(input, DEFAULTS);
    const schedules = fc
      .tuple(
        ...input.schedules.map(({ season, schedule }) =>
          anyOrder(schedule.games).map((games) => ({ season, schedule: { ...schedule, games } })),
        ),
      )
      .chain((each) => anyOrder(each));
    const { seasons } = input;
    const shuffledInputs = fc.record({
      events: anyOrder(input.events),
      teamGames: anyOrder(input.teamGames),
      schedules,
      spans: anyOrder(seasons.spans),
      readSeasons: anyOrder(seasons.readSeasons),
    });
    fc.assert(
      fc.property(shuffledInputs, ({ spans, readSeasons, ...shuffled }) => {
        const evaluation = evaluatePlayer(
          { ...input, ...shuffled, seasons: { ...seasons, spans, readSeasons } },
          DEFAULTS,
        );
        expect(evaluation).toStrictEqual(expected);
      }),
    );
  });

  it('[SEN-27] [SEN-17] says that the verdict depends on the manual exclusions when undoing them changes it', () => {
    const strongDays: readonly IsoDate[] = ['2019-10-24', '2021-01-17', '2021-10-27', '2022-10-26'];
    const input = inputOf(changed(strongDays.map((on) => [on, { line: 'huge' }])));
    const excluded = new Set([2, 5, 7, 8]);
    const decided = evaluatePlayer(
      {
        ...input,
        storedCaseOf: ({ eventIds, measuredGameId }) => {
          const isExcluded = excluded.has(eventIds[0] ?? 0) && measuredGameId !== null;
          const decision: ManualDecision = {
            id: 1,
            kind: 'exclude',
            decidedAt: NOW,
            measuredGameId: measuredGameId ?? 0,
          };
          return { origin: 'historical', decisions: isExcluded ? [decision] : [] };
        },
      },
      DEFAULTS,
    );
    expect([
      viewOf(decided).verdict.level,
      viewOf(decided).dependsOnManualExclusions,
    ]).toStrictEqual(['inconclusive', true]);
    const undecided = viewOf(evaluatePlayer(input, DEFAULTS));
    expect([undecided.verdict, undecided.dependsOnManualExclusions]).toStrictEqual([
      { level: 'probable', direction: 'increase' },
      false,
    ]);
  });

  it('[CA-VUE-03] [VUE-03] weighs a valid case in a win of his team exactly as one of equal gap in a loss: the final scores change nothing', () => {
    const [inLoss, inWin] = [caseOf(BASE, 1), caseOf(BASE, 3)];
    const scoreOf = (caseItem: EvaluatedCase) =>
      inputOf().teamGames.find(({ game }) => game.id === caseItem.measuredGameId)?.game.finalScore;
    expect([scoreOf(inLoss), scoreOf(inWin)]).toStrictEqual([
      { home: 90, away: 100 },
      { home: 100, away: 90 },
    ]);
    expect(inLoss.normalizedGap).toBeCloseTo(inWin.normalizedGap ?? NaN, PRECISION);
    const flipped = ROWS.map((row) => ({ ...row, isHomeWin: !row.isHomeWin }));
    expect(evaluatePlayer(inputOf(flipped), DEFAULTS)).toStrictEqual(BASE);
  });

  it('[SEN-19] [CL-SEN-26] gives a profile to a validated or withdrawn type while its tally holds an event, exits included, none to a proposed or rejected one, and an empty birthday profile to a player without a recorded birthday', () => {
    const typed = (eventTypeId: string, changes: Partial<EvaluationType>): EvaluationType => ({
      ...VALIDATED,
      eventTypeId,
      ...changes,
    });
    const otherEvents = ['proposed', 'rejected', 'withdrawn'].map((eventTypeId, index) =>
      eventOf({ eventId: 21 + index, on: '2019-11-02', atEastern: '12:00' }, { eventTypeId }),
    );
    const input = {
      ...inputOf(),
      player: { ...PLAYER, hasBirthday: false },
      types: [
        VALIDATED,
        typed('proposed', { status: 'proposed' }),
        typed('rejected', { status: 'rejected' }),
        typed('withdrawn', { status: 'withdrawn' }),
        typed('exits-only', { exitReasons: ['dismissed'] }),
        typed('no-event', {}),
        typed('birthday', { calendarDerivation: 'birthday' }),
        typed('withdrawn-birthday', { status: 'withdrawn', calendarDerivation: 'birthday' }),
        typed('former-team', { calendarDerivation: 'former_team' }),
      ],
      events: [...EVENTS, ...otherEvents],
    };
    const evaluation = evaluatePlayer(input, DEFAULTS);
    expect(profilesOf(evaluation)).toStrictEqual([
      `${TYPE} current 12{} 12{} 0{}`,
      'withdrawn archived 1{} 1{} 0{}',
      'exits-only current 0{"dismissed":1} 0{} 0{}',
      'birthday current 0{} 0{} 0{}',
    ]);
    expect(
      evaluation.cases.map(({ eventTypeId }) => eventTypeId).filter((id) => id !== TYPE),
    ).toStrictEqual(['proposed', 'rejected', 'withdrawn']);
    const withBirthday = evaluatePlayer({ ...input, player: PLAYER }, DEFAULTS);
    expect(withBirthday.profiles.map(({ eventTypeId }) => eventTypeId)).toStrictEqual([
      TYPE,
      'withdrawn',
      'exits-only',
    ]);
  });

  it('[CA-JOU-13] [SEN-19] [H-JOU-07] still computes a withdrawn player’s cases and profile in full, the profile archived', () => {
    const withdrawn = evaluatePlayer(
      { ...inputOf(), player: { ...PLAYER, isWithdrawn: true } },
      DEFAULTS,
    );
    expect(withdrawn.cases).toStrictEqual(BASE.cases);
    expect(withdrawn.profiles).toStrictEqual(
      BASE.profiles.map((profile) => ({ ...profile, isArchived: true })),
    );
  });

  it('[SEN-21] [CL-SEN-19] [SEN-33] [SEN-43] splits a profile into all cases, historical only and tracked only, each with its valid cases by origin, the exits counted in all cases alone', () => {
    const tracked = new Set([3, 4, 5, 6, 10, 12]);
    const events = withEvents([
      [3, { researchConfidence: 'low' }],
      [11, { researchConfidence: 'low' }],
    ]);
    const evaluation = evaluatePlayer(
      {
        ...inputOf(ROWS, events),
        types: [{ ...VALIDATED, exitReasons: ['merged', 'merged', 'erased'] }],
        storedCaseOf: ({ eventIds }) => ({
          origin: tracked.has(eventIds[0] ?? 0) ? 'tracked' : 'historical',
          decisions: [],
        }),
      },
      DEFAULTS,
    );
    expect(caseOf(evaluation, 3).origin).toBe('tracked');
    expect(
      evaluation.profiles[0]?.views.map(
        ({ view, tally, historicalValidCount, trackedValidCount }) => [
          view,
          tally.eventCount,
          tally.validCount,
          tally.lowResearchConfidenceCount,
          tally.exitCounts,
          historicalValidCount,
          trackedValidCount,
        ],
      ),
    ).toStrictEqual([
      ['all_cases', 12, 8, 2, { merged: 2, erased: 1 }, 4, 4],
      ['historical_only', 5, 4, 0, {}, 4, 0],
      ['tracked_only', 7, 4, 2, {}, 0, 4],
    ]);
  });
});

describe('evaluatePlayer on the marks and criteria of a case', () => {
  it('[SEN-25] steps the profile confidence down when the gaps of its valid cases disagree', () => {
    const rows = changed([
      ['2018-10-31', { line: 'huge' }],
      ['2019-10-24', { line: 'huge' }],
    ]);
    const view = viewOf(evaluatePlayer(inputOf(rows), DEFAULTS));
    expect(view.quantities?.gapDispersion).toBeGreaterThan(
      DEFAULTS.sensitivity.confidenceDispersionDrop,
    );
    expect([view.profileConfidence, view.confidenceStepDownReasons]).toStrictEqual([
      'low',
      ['high_dispersion'],
    ]);
  });
});
