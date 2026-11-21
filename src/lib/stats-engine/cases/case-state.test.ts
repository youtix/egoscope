import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { caseState } from './case-state';
import { applyManualDecisions } from './manual-decisions';
import { attachToMeasuredGame } from '../measured-game/attachment';
import { generalTrend } from '../profiles/general-trend';
import { profileVerdict } from '../profiles/verdict';

import type { SeasonBaseline } from '../baseline/season-baseline';
import type { Attachment, AttachmentEvent, AttachmentGame } from '../measured-game/attachment';
import type { PrecedenceSource } from '../measured-game/precedence';
import type { Participation } from '../performance/participation';
import type { TrendCase } from '../profiles/general-trend';
import type { SeasonSpan } from '../schedule/seasons';
import type { EngineParams, GameId } from '../types';
import type { CaseSeasons, CaseState, CaseStateInput, MeasuredGameStatistics } from './case-state';

// The registry's defaults, a window of 10 days among them (SEN-04). JSON gives the
// baseline phase as a string, which the comparison narrows (types.test.ts).
const DEFAULTS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// New York and Los Angeles are 5 and 8 hours behind UTC in winter.
const NEW_YORK_LAG = 5 * HOUR;
const LOS_ANGELES_LAG = 8 * HOUR;
const RAW_DIGITS = 9;

// 12:00 New York time on 10 January 2024, then his team's games of 11 and 13 January.
const REFERENCE_AT = Date.UTC(2024, 0, 10, 17);
const REFERENCE_DAY = '2024-01-10';
const GAME_1_AT = Date.UTC(2024, 0, 12, 0, 30);
const GAME_2_AT = Date.UTC(2024, 0, 14, 0, 30);
const LATER = Date.UTC(2024, 1, 1);

/** The US date of an instant: its New York date in winter (CL-TRV-03). */
const usDayOf = (at: number): string => new Date(at - NEW_YORK_LAG).toISOString().slice(0, 10);

/** The end of the US date `dayOn` in Pacific time: 00:00 Los Angeles time the next day. */
function endOfDayPacific(dayOn: string): number {
  const [year = 0, month = 0, day = 0] = dayOn.split('-').map(Number);
  return Date.UTC(year, month - 1, day + 1) + LOS_ANGELES_LAG;
}

const HOME_WIN = { home: 101, away: 99 };
const HOME_LOSS = { home: 99, away: 101 };

/** His team game `id` at `startAt`, which his team won at home; his participation, null while not final. */
function teamGame(
  id: number,
  startAt: number,
  participation: Participation | null = 'played',
): AttachmentGame {
  const isFinal = participation !== null;
  const gameDayOn = usDayOf(startAt);
  return {
    game: {
      id,
      phase: 'regular_season',
      status: isFinal ? 'final' : 'scheduled',
      homeTeamId: 1,
      awayTeamId: 2,
      finalScore: isFinal ? HOME_WIN : null,
      scheduledStartAt: startAt,
      homeLinesPublished: isFinal,
      awayLinesPublished: isFinal,
    },
    teamId: 1,
    participation,
    minutes: participation === 'played' ? 31 : null,
    gameDayOn,
    endOfDayPacificAt: endOfDayPacific(gameDayOn),
    isBoxScoreUnavailable: false,
  };
}

// A source published at the reference instant, before every game after it.
const EARLY_SOURCE = { publicationDateOn: REFERENCE_DAY, publicationAt: REFERENCE_AT };

/** A historical event made public at the reference instant, or a detected one with null. */
const eventFrom = (sources: readonly PrecedenceSource[] | null): AttachmentEvent => ({
  kind: 'reference_instant',
  referenceInstantAt: REFERENCE_AT,
  referenceInstantOrigin: 'known_instant',
  sources,
});

/** The attachment of `event` over `games`, evaluated at `now`. */
function attach(event: AttachmentEvent, games: readonly AttachmentGame[], now = LATER): Attachment {
  return attachToMeasuredGame(event, { games, now, nowGameDayOn: usDayOf(now) }, DEFAULTS);
}

const baselineOf = (status: SeasonBaseline['status']): SeasonBaseline =>
  status === 'final' || status === 'provisional'
    ? { status, gameCount: 68, isPartial: false, mean: 0.513, standardDeviation: 0.205 }
    : { status, gameCount: 9, isPartial: false, mean: 0.5, standardDeviation: null };

// The worked example's C1: an index of 0.751 against 0.513 and 0.205 (CA-SEN-07).
const COMPLETE = {
  boxScoreStatus: 'complete',
  performanceIndex: 0.751,
  baseline: baselineOf('final'),
} satisfies MeasuredGameStatistics;
const C1_GAP = (0.751 - 0.513) / 0.205;
/** C1's statistics on game 2, another index on any other game. */
const byGame = (gameId: GameId): MeasuredGameStatistics =>
  gameId === 2 ? COMPLETE : { ...COMPLETE, performanceIndex: 0.2 };

// The source's first season, closed, and 2023-24, in progress or closed.
const FIRST_SPAN = { season: '1993-94', firstGameOn: '1993-11-05', lastGameOn: '1994-06-22' };
const OPEN_SPAN: SeasonSpan = { season: '2023-24', firstGameOn: '2023-10-24', lastGameOn: null };
const CLOSED_SPAN: SeasonSpan = { ...OPEN_SPAN, lastGameOn: '2024-06-17' };
// The first season read, then 2023-24 read and covered, in progress; spans and seasons
// come in any order, the first season's last.
const FIRST_READ = { season: '1993-94', hasPlayerLines: true };
const SEASONS: CaseSeasons = {
  firstCoveredSeason: '1993-94',
  spans: [OPEN_SPAN, FIRST_SPAN],
  readSeasons: [FIRST_READ, { season: '2023-24', hasPlayerLines: true }],
  unpublishedSeason: null,
};
const UNREAD: CaseSeasons = { ...SEASONS, readSeasons: [FIRST_READ] };
const WITHOUT_LINES = [FIRST_READ, { season: '2023-24', hasPlayerLines: false }];
// 2023-24 over, its games read, none of them with player lines.
const NOT_COVERED = { ...SEASONS, spans: [CLOSED_SPAN, FIRST_SPAN], readSeasons: WITHOUT_LINES };

/** A historical event's case on game 1, played, with every rule before the walk passed. */
const inputOf = (overrides: Partial<CaseStateInput> = {}): CaseStateInput => ({
  event: { origin: 'historical', referenceDayOn: REFERENCE_DAY },
  seasons: SEASONS,
  isDatingToVerify: false,
  isMappingEstablished: true,
  attachment: attach(eventFrom([EARLY_SOURCE]), [teamGame(1, GAME_1_AT)]),
  statisticsOf: () => COMPLETE,
  ...overrides,
});

type AwaitingReason = Extract<CaseState, { status: 'awaiting_game' }>['statusReason'];
type NotMeasurableReason = Extract<CaseState, { status: 'not_measurable' }>['statusReason'];
const NO_GAP = { normalizedGap: null, gapStatus: null } as const;

/** A case awaiting its game for `reason`, at the game `measuredGameId`, by default none. */
const pending = (reason: AwaitingReason, measuredGameId: GameId | null = null): CaseState => ({
  status: 'awaiting_game',
  statusReason: reason,
  measuredGameId,
  ...NO_GAP,
});
/** A case not measurable for `reason`, at the game `measuredGameId`, by default none. */
const notMeasurable = (
  reason: NotMeasurableReason,
  measuredGameId: GameId | null = null,
): CaseState => ({
  status: 'not_measurable',
  statusReason: reason,
  measuredGameId,
  ...NO_GAP,
});

/** A calendar-derived event's case on its derived game 3, every rule before the walk failing. */
const derivedInput = (participation: Participation): CaseStateInput => ({
  ...inputOf({ event: { origin: 'calendar' }, seasons: { ...UNREAD, spans: [] } }),
  isDatingToVerify: true,
  isMappingEstablished: false,
  attachment: attach(
    { kind: 'calendar_derived', derivedGame: teamGame(3, GAME_1_AT, participation) },
    [],
  ),
});
// A game whose box score is unavailable, and a game past the window (SEN-04).
const UNAVAILABLE_GAME = { ...teamGame(1, GAME_1_AT, 'unknown'), isBoxScoreUnavailable: true };
const LATE_GAME = teamGame(1, REFERENCE_AT + 241 * HOUR);

/** Checks that `state` is measured on `measuredGameId` with C1's gap, within 1e-9. */
function expectMeasured(state: CaseState, measuredGameId: number, gapStatus = 'final'): void {
  const measured = { status: 'measured', statusReason: null, measuredGameId, gapStatus };

  expect({ ...state, normalizedGap: 0 }).toStrictEqual({ ...measured, normalizedGap: 0 });
  expect(state.normalizedGap).toBeCloseTo(C1_GAP, RAW_DIGITS);
}

// Six valid cases of three players, which give a verdict of their own.
const VALID: readonly TrendCase[] = [0.9, 1.2, 0.7, 1.1, 0.8, 1].map((gap, position) => ({
  caseId: position + 1,
  playerId: `player-${String(position % 3)}`,
  events: [{ researchConfidence: 'high' }],
  isCoOccurring: false,
  status: 'measured',
  measuredGameScheduledStartAt: position * HOUR,
  normalizedGap: gap,
  gapStatus: 'final',
}));
const trendOf = (cases: readonly TrendCase[]) =>
  generalTrend({ cases, exitReasons: [], manuallyDecidedCases: [] }, DEFAULTS);

/**
 * Checks that `state` has no gap and enters no verdict, check, robustness test, confidence
 * or trend, while it stays in the tally (CL-SEN-08).
 */
function expectInNoCalculation(state: CaseState): void {
  if (state.status === 'measured') {
    throw new Error('a measured case enters the calculations');
  }
  const counted: TrendCase = {
    ...state,
    caseId: 7,
    playerId: 'player-0',
    events: [{ researchConfidence: 'high' }],
    isCoOccurring: false,
  };
  const cases = [...VALID, counted];
  const withCase = trendOf(cases);

  expect(state.normalizedGap).toBeNull();
  expect(profileVerdict(cases, DEFAULTS)).toStrictEqual(profileVerdict(VALID, DEFAULTS));
  expect({ ...withCase, tally: null }).toStrictEqual({ ...trendOf(VALID), tally: null });
  expect(withCase.tally.caseCount).toBe(VALID.length + 1);
}

describe('caseState', () => {
  it('[SEN-07] [SEN-08] [CL-SEN-05] measures the case on the game the walk reached, with its unrounded gap, final with its baseline', () => {
    const games = [teamGame(1, GAME_1_AT, 'not_played'), teamGame(2, GAME_2_AT)];
    const attachment = attach(eventFrom([EARLY_SOURCE]), games);
    const state = caseState(inputOf({ attachment, statisticsOf: byGame }));

    expect(state.status).toBe('measured');
    expectMeasured(state, 2);
  });

  it('[SEN-07] [CL-SEN-03] [CL-SEN-05] takes a calendar-derived event to its derived game before the season, the dating mark and the mapping', () => {
    expect(caseState(derivedInput('played')).status).toBe('measured');
    expect(caseState(derivedInput('not_played'))).toStrictEqual(
      notMeasurable('derived_game_missed', 3),
    );
  });

  it('[STA-45] [SEN-07] [SEN-47] [CL-STA-22] [CL-SEN-05] applies the rules before the walk in their order: season not covered, dating mark, mapping, season to read', () => {
    const detected = { origin: 'detected', referenceDayOn: REFERENCE_DAY } as const;
    const blocked = inputOf({
      event: detected,
      isDatingToVerify: true,
      isMappingEstablished: false,
    });
    const unread = { ...blocked, seasons: UNREAD };
    const established = { ...unread, isDatingToVerify: false, isMappingEstablished: true };

    expect(caseState({ ...blocked, seasons: NOT_COVERED })).toStrictEqual(
      notMeasurable('season_not_covered'),
    );
    expect(caseState(unread)).toStrictEqual(pending('dating_to_verify'));
    expect(caseState({ ...unread, isDatingToVerify: false })).toStrictEqual(
      pending('mapping_not_established'),
    );
    expect(caseState(established)).toStrictEqual(pending('statistics_pending'));
    expect(caseState({ ...established, seasons: SEASONS }).status).toBe('measured');
  });

  it('[STA-45] [CA-STA-19] [CL-STA-22] measures an old season like any other from its first game, its baseline partial, the day before it not covered, and a season not over that has no box score yet', () => {
    const partial: SeasonBaseline = { ...baselineOf('final'), gameCount: 39, isPartial: true };
    const firstGameDay = { origin: 'historical', referenceDayOn: '1993-11-05' } as const;
    const old = inputOf({
      event: firstGameDay,
      statisticsOf: () => ({ ...COMPLETE, baseline: partial }),
    });
    const dayBefore = { ...old, event: { ...firstGameDay, referenceDayOn: '1993-11-04' } };
    const withoutLinesYet = inputOf({ seasons: { ...SEASONS, readSeasons: WITHOUT_LINES } });

    expectMeasured(caseState(old), 1);
    expect(caseState(dayBefore)).toStrictEqual(notMeasurable('season_not_covered'));
    expect(caseState(withoutLinesYet).status).toBe('measured');
  });

  it('[CA-IMP-29] [IMP-18] [SEN-44] [CL-SEN-08] keeps an event of precedence to verify, its season not read or not known, out of every calculation, never on a game already stored, until its schedule is read', () => {
    const toVerify = caseState(inputOf({ seasons: UNREAD }));
    const seasonUnknown = caseState(inputOf({ seasons: { ...UNREAD, spans: [] } }));

    expect(toVerify).toStrictEqual(pending('precedence_to_verify'));
    expect(seasonUnknown).toStrictEqual(pending('precedence_to_verify'));
    expectInNoCalculation(toVerify);
    expectMeasured(caseState(inputOf()), 1);
  });

  it('[SEN-04] [CA-SEN-04] [CL-STA-30] [CL-SEN-05] walks the coming season while its schedule is unpublished: "game not played yet", then "no game played within the window"', () => {
    // A detected event of 12:00 New York time on 5 July 2024, after the 2023-24 Finals.
    const julyAt = Date.UTC(2024, 6, 5, 16);
    const event: AttachmentEvent = { ...eventFrom(null), referenceInstantAt: julyAt };
    const between = { ...NOT_COVERED, readSeasons: [], unpublishedSeason: '2024-25' };
    const julyState = (now: number, seasons: CaseSeasons): CaseState => {
      const july = { origin: 'detected', referenceDayOn: '2024-07-05' } as const;
      return caseState(inputOf({ event: july, seasons, attachment: attach(event, [], now) }));
    };

    const published = { ...between, unpublishedSeason: null };

    expect(julyState(julyAt + 3 * DAY, between)).toStrictEqual(pending('game_not_played_yet'));
    expect(julyState(julyAt + 11 * DAY, between)).toStrictEqual(
      notMeasurable('no_game_within_window'),
    );
    expect(julyState(julyAt + 3 * DAY, published)).toStrictEqual(pending('statistics_pending'));
  });

  it.each([
    ['a game not played yet', teamGame(1, GAME_1_AT, null), pending('game_not_played_yet', 1)],
    ['a box score unavailable', UNAVAILABLE_GAME, notMeasurable('box_score_unavailable', 1)],
    ['no game within the window', LATE_GAME, notMeasurable('no_game_within_window')],
  ])('[SEN-07] [SEN-47] [CL-SEN-05] keeps the end of the walk at %s', (_end, game, expected) => {
    const attachment = attach(eventFrom([EARLY_SOURCE]), [game], REFERENCE_AT + HOUR);

    expect(caseState(inputOf({ attachment }))).toStrictEqual(expected);
  });

  it('[CA-IMP-09] [IMP-18] [SEN-44] [SEN-10] [CL-SEN-08] makes a case whose sources all follow its game\'s start not measurable, "precedence not established", with no gap and in no verdict, check or trend', () => {
    const late = { publicationDateOn: '2024-01-11', publicationAt: GAME_1_AT + HOUR };
    const attachment = attach(eventFrom([late]), [teamGame(1, GAME_1_AT)]);
    const state = caseState(inputOf({ attachment }));

    expect(state).toStrictEqual(notMeasurable('precedence_not_established'));
    expectInNoCalculation(state);
  });

  it('[SEN-44] [CL-SEN-07] measures an event of uncertain precedence on the next game he plays, its gap computed, with the mention "uncertain precedence"', () => {
    const sameDay: PrecedenceSource = { publicationDateOn: '2024-01-11', publicationAt: null };
    const games = [teamGame(1, GAME_1_AT), teamGame(2, GAME_2_AT)];
    const attachment = attach(eventFrom([sameDay]), games);

    expect(attachment.referenceInstantOrigin).toBe('uncertain_precedence_shift');
    expectMeasured(caseState(inputOf({ attachment, statisticsOf: byGame })), 2);
  });

  it.each([
    ['incomplete', 'in_correction_window', pending('statistics_pending', 1)],
    ['suspect', 'in_correction_window', pending('statistics_pending', 1)],
    ['incomplete', 'consolidated', notMeasurable('box_score_incomplete', 1)],
    ['suspect', 'consolidated', notMeasurable('box_score_suspect', 1)],
  ] as const)(
    '[SEN-07] [SEN-47] [CL-SEN-05] gives a measured game whose box score is %s, %s, its state',
    (boxScoreStatus, consolidation, expected) => {
      const statisticsOf = () => ({ boxScoreStatus, consolidation });

      expect(caseState(inputOf({ statisticsOf }))).toStrictEqual(expected);
    },
  );

  it.each([
    ['building', pending('baseline_building', 1)],
    ['insufficient', notMeasurable('insufficient_baseline', 1)],
  ] as const)(
    '[SEN-07] [SEN-47] [CL-SEN-05] gives a measured game whose baseline is %s its state',
    (status, expected) => {
      const statisticsOf = () => ({ ...COMPLETE, baseline: baselineOf(status) });

      expect(caseState(inputOf({ statisticsOf }))).toStrictEqual(expected);
    },
  );

  it('[SEN-09] gives a provisional gap while the baseline is provisional', () => {
    const state = caseState(
      inputOf({ statisticsOf: () => ({ ...COMPLETE, baseline: baselineOf('provisional') }) }),
    );

    expect(state.gapStatus).toBe('provisional');
    expectMeasured(state, 1, 'provisional');
  });

  it('[SEN-10] computes the gap of a case that the doubtful-case criteria or a manual exclusion then exclude', () => {
    const state = caseState(inputOf());
    const exclusion = { id: 1, kind: 'exclude', decidedAt: LATER, measuredGameId: 1 } as const;

    expect(applyManualDecisions(state, [exclusion]).status).toBe('excluded');
    expectMeasured(state, 1);
  });
});

// --- Generated situations, and how time and the data advance (SEN-47) -------------

/** His participation in a game: null while it is not final, `unavailable` for a box score that is. */
type WorldParticipation = Participation | 'unavailable' | null;
/** A game of his team: when it starts, what is known of it, and what it turns out to be. */
type WorldGame = Readonly<{
  hoursAfter: number;
  participation: WorldParticipation;
  fate: 'played' | 'not_played' | 'unavailable';
}>;
type SeasonState = 'read' | 'toRead' | 'unpublished' | 'notCovered';
/** A situation: the event, the seasons, the mapping, his games, the evaluation's instant. */
type World = Readonly<{
  origin: 'calendar' | 'historical' | 'detected';
  source: 'early' | 'late' | 'sameDay';
  season: SeasonState;
  isDatingToVerify: boolean;
  isMappingEstablished: boolean;
  first: WorldGame;
  others: readonly WorldGame[];
  nowHoursAfter: number;
  statistics: MeasuredGameStatistics;
  baselineFate: 'final' | 'insufficient';
}>;
/** The three waits without limit (SEN-47, CL-STA-17). */
type Hold = 'outage' | 'unconfirmedMapping' | 'unrecognizedCancellation';

// A year after the reference instant: every window has passed, every game has started.
const LONG_AFTER_HOURS = 24 * 365;
const AWAITING_REASONS: readonly AwaitingReason[] = [
  'game_not_played_yet',
  'statistics_pending',
  'mapping_not_established',
  'baseline_building',
  'precedence_to_verify',
  'dating_to_verify',
];
// The reasons under which a case can stay pending: none once time and the data advance,
// and under each wait without limit, its own.
const HELD_REASONS = new Map<Hold | null, readonly AwaitingReason[]>([
  [null, []],
  ['outage', ['precedence_to_verify', 'statistics_pending', 'baseline_building']],
  ['unconfirmedMapping', ['mapping_not_established']],
  ['unrecognizedCancellation', ['statistics_pending']],
]);
const HOLDS: readonly Hold[] = ['outage', 'unconfirmedMapping', 'unrecognizedCancellation'];
const SOURCES: Readonly<Record<World['source'], readonly PrecedenceSource[]>> = {
  early: [EARLY_SOURCE],
  late: [{ publicationDateOn: '2030-01-01', publicationAt: Date.UTC(2030, 0, 1) }],
  sameDay: [{ publicationDateOn: REFERENCE_DAY, publicationAt: null }],
};
const SEASONS_OF: Readonly<Record<SeasonState, CaseSeasons>> = {
  read: SEASONS,
  toRead: UNREAD,
  unpublished: { ...UNREAD, unpublishedSeason: '2023-24' },
  notCovered: NOT_COVERED,
};
const STATISTICS: readonly MeasuredGameStatistics[] = [
  ...(['final', 'provisional', 'building', 'insufficient'] as const).map((status) => ({
    ...COMPLETE,
    baseline: baselineOf(status),
  })),
  { boxScoreStatus: 'incomplete', consolidation: 'in_correction_window' },
  { boxScoreStatus: 'suspect', consolidation: 'consolidated' },
];

const worldGame: fc.Arbitrary<WorldGame> = fc.record({
  hoursAfter: fc.integer({ min: 1, max: 400 }),
  participation: fc.constantFrom<WorldParticipation>('played', 'not_played', 'unknown', null),
  fate: fc.constantFrom<WorldGame['fate']>('played', 'not_played', 'unavailable'),
});
const world: fc.Arbitrary<World> = fc.record({
  origin: fc.constantFrom<World['origin']>('calendar', 'historical', 'detected'),
  source: fc.constantFrom<World['source']>('early', 'late', 'sameDay'),
  season: fc.constantFrom<SeasonState>('read', 'read', 'toRead', 'unpublished', 'notCovered'),
  isDatingToVerify: fc.boolean(),
  isMappingEstablished: fc.boolean(),
  first: worldGame,
  others: fc.array(worldGame, { maxLength: 4 }),
  nowHoursAfter: fc.integer({ min: 0, max: 500 }),
  statistics: fc.constantFrom(...STATISTICS),
  baselineFate: fc.constantFrom<World['baselineFate']>('final', 'insufficient'),
});

/** The team game `id` of `game` seen at `now`, final only once started, with that result. */
function worldTeamGame(
  game: WorldGame,
  id: number,
  seen: Readonly<{ now: number; isHomeWin: boolean }>,
): AttachmentGame {
  const startAt = REFERENCE_AT + game.hoursAfter * HOUR;
  const participation = startAt > seen.now ? null : game.participation;
  const known = teamGame(id, startAt, participation === 'unavailable' ? 'unknown' : participation);
  const finalScore = known.game.finalScore && (seen.isHomeWin ? HOME_WIN : HOME_LOSS);
  return {
    ...known,
    game: { ...known.game, finalScore },
    isBoxScoreUnavailable: participation === 'unavailable',
  };
}

/** The attachment and the state of the case of `situation`, each game with its result. */
function evaluate(
  situation: World,
  isHomeWin = true,
): Readonly<{ attachment: Attachment; state: CaseState }> {
  const seen = { now: REFERENCE_AT + situation.nowHoursAfter * HOUR, isHomeWin };
  const derivedGame = worldTeamGame(situation.first, 1, seen);
  const others = situation.others.map((game, position) => worldTeamGame(game, position + 2, seen));
  const { origin } = situation;
  const sources = origin === 'historical' ? SOURCES[situation.source] : null;
  const event: AttachmentEvent =
    origin === 'calendar' ? { kind: 'calendar_derived', derivedGame } : eventFrom(sources);
  const attachment = attach(
    event,
    situation.season === 'read' ? [derivedGame, ...others] : [],
    seen.now,
  );
  const state = caseState({
    event: origin === 'calendar' ? { origin } : { origin, referenceDayOn: REFERENCE_DAY },
    seasons: SEASONS_OF[situation.season],
    isDatingToVerify: origin === 'detected' && situation.isDatingToVerify,
    isMappingEstablished: situation.isMappingEstablished,
    attachment,
    statisticsOf: () => situation.statistics,
  });
  return { attachment, state };
}

/** `game` once the source has it all: final, his participation known or its box score unavailable. */
const settled = (game: WorldGame): WorldGame =>
  game.participation === null || game.participation === 'unknown'
    ? { ...game, participation: game.fate }
    : game;

/** `statistics` once the game is consolidated and the phase over. */
function settledStatistics({ statistics, baselineFate }: World): MeasuredGameStatistics {
  if (statistics.boxScoreStatus !== 'complete') {
    return { ...statistics, consolidation: 'consolidated' };
  }
  return statistics.baseline.status === 'building'
    ? { ...statistics, baseline: baselineOf(baselineFate) }
    : statistics;
}

/**
 * `situation` a year later, the dating mark lifted and the mapping confirmed, and the
 * source's data complete: every season read, every game settled, every box score
 * consolidated, every phase over; but what `hold` keeps back. An outage freezes the
 * source's data as they were; an unconfirmed mapping stays so; a game canceled under a
 * status the adapter does not recognize stays scheduled.
 */
function advanced(situation: World, hold: Hold | null): World {
  const { first, others, nowHoursAfter } = situation;
  const later: World = {
    ...situation,
    isDatingToVerify: false,
    isMappingEstablished: hold !== 'unconfirmedMapping' || situation.isMappingEstablished,
    nowHoursAfter: LONG_AFTER_HOURS,
  };
  const frozen = (game: WorldGame): WorldGame =>
    game.hoursAfter > nowHoursAfter ? { ...game, participation: null } : game;
  if (hold === 'outage') {
    return { ...later, first: frozen(first), others: others.map((game) => frozen(game)) };
  }
  return {
    ...later,
    season: situation.season === 'toRead' ? 'read' : situation.season,
    first: hold === 'unrecognizedCancellation' ? { ...first, participation: null } : settled(first),
    others: others.map((game) => settled(game)),
    statistics: settledStatistics(situation),
  };
}

describe('caseState over generated situations', () => {
  it('[SEN-07] [SEN-44] [CL-SEN-05] [CL-SEN-08] gives every case one state and one reason, a gap to a measured case alone, and none while its precedence is to verify or not established', () => {
    fc.assert(
      fc.property(world, (situation) => {
        const { attachment, state } = evaluate(situation);
        const isMeasured = state.status === 'measured';
        const isUncounted = ['to_verify', 'not_established'].includes(
          String(attachment.precedence),
        );
        const nulls = [state.statusReason, state.normalizedGap, state.gapStatus].map(
          (value) => value === null,
        );

        expect(nulls).toStrictEqual([isMeasured, !isMeasured, !isMeasured]);
        expect(isMeasured && isUncounted).toBe(false);
      }),
    );
  });

  it('[SEN-47] [CL-STA-17] [CL-SEN-05] gives every pending reason its outcome once time and the data advance, but under an outage, an unconfirmed mapping or a game canceled under an unknown status, each under its own reason', () => {
    fc.assert(
      fc.property(world, fc.constantFrom(null, ...HOLDS), (situation, hold) => {
        const { state } = evaluate(advanced(situation, hold));

        expect([...(HELD_REASONS.get(hold) ?? []), null]).toContain(
          state.status === 'awaiting_game' ? state.statusReason : null,
        );
      }),
    );
  });

  it('[SEN-47] generates situations that reach every pending reason, and cases that each wait without limit keeps pending', () => {
    const situations = fc.sample(world, { numRuns: 3000, seed: 47 });
    const reasons = situations
      .map((situation) => evaluate(situation).state)
      .filter((state) => state.status === 'awaiting_game')
      .map((state) => state.statusReason);
    const isKeptPending = (hold: Hold): boolean =>
      situations.some(
        (situation) => evaluate(advanced(situation, hold)).state.status === 'awaiting_game',
      );

    expect(new Set(reasons)).toStrictEqual(new Set(AWAITING_REASONS));
    expect(HOLDS.filter((hold) => isKeptPending(hold))).toStrictEqual(HOLDS);
  });

  it("[VUE-03] [SEN-08] gives the same state and gap whatever the result of his team's games", () => {
    fc.assert(
      fc.property(world, (situation) => {
        expect(evaluate(situation, false).state).toStrictEqual(evaluate(situation).state);
      }),
    );
  });
});
