// Every case of one followed player (SEN-05 to SEN-18, CL-SEN-05, CL-SEN-06): each of his
// events attached to its measured game on its own and given its state, the events of one
// type on one game grouped into one case, and each case given what it records of its game
// (evaluate-game.ts), its criteria, its ruling manual decision and its outcome, as the
// evaluation gives it and as its profile counts it.

import { caseState } from '../cases/case-state';
import { groupCases } from '../cases/grouping';
import { applyManualDecisions } from '../cases/manual-decisions';
import { attachToMeasuredGame } from '../measured-game/attachment';
import { gameFactsOf, NO_GAME, NOT_JUDGED, statisticsOf, teamGameOf } from './evaluate-game';

import type {
  CaseSeasons,
  CaseState,
  CaseStateEvent,
  CaseStatus,
  CaseStatusReason,
} from '../cases/case-state';
import type {
  ContextIndications,
  DoubtfulCaseCriteriaInput,
  TriggeredCriterion,
} from '../cases/doubtful-criteria';
import type { CaseEvent, CaseGroup } from '../cases/grouping';
import type { ManualDecision } from '../cases/manual-decisions';
import type { GapStatus } from '../cases/normalized-gap';
import type { ReviewFlag } from '../cases/review-flags';
import type { AttachmentEvent, ReferenceInstantOrigin } from '../measured-game/attachment';
import type { SeasonSchedule } from '../schedule/phase-state';
import type {
  EngineParams,
  EpochMs,
  EventTypeId,
  GameId,
  IsoDate,
  PlayerEventId,
  PlayerId,
} from '../types';
import type { ManuallyDecidedCase } from './checks';
import type { EvaluationTeamGame, GameFacts, Judgment, MeasuredValues } from './evaluate-game';
import type { CaseOrigin, TypeStatus } from './evaluate-trend';
import type { ProfileCase, TallyExitReason } from './tally';

/**
 * One of his events, not withdrawn (CL-SEN-18): as its attachment reads it, as its case
 * state reads it, with its Lot 2 dating mark (SEN-45), its context indications (SEN-13,
 * SEN-14) and, for a historical event, its research confidence (SEN-43).
 */
export type EvaluationEvent = Readonly<{
  eventId: PlayerEventId;
  eventTypeId: EventTypeId;
  attachmentEvent: AttachmentEvent;
  stateEvent: CaseStateEvent;
  isDatingToVerify: boolean;
  contextIndications: ContextIndications;
  researchConfidence: 'high' | 'medium' | 'low' | null;
}>;

/**
 * One of the types of his events (TAX-10, ADR 0015, ADR 0016): its status, its calendar
 * derivation, the criterion its sheet switches off, and the reasons of his events of the
 * type that left the tally, one per event (SEN-33, CL-SEN-25).
 */
export type EvaluationType = Readonly<{
  eventTypeId: EventTypeId;
  status: TypeStatus;
  calendarDerivation: 'birthday' | 'former_team' | null;
  switchedOffCriterion: DoubtfulCaseCriteriaInput['switchedOffCriterion'];
  exitReasons: readonly TallyExitReason[];
}>;

/** A case, as the caller finds the stored case it keeps: its type, game and events. */
export type CaseKey = Readonly<{
  eventTypeId: EventTypeId;
  measuredGameId: GameId | null;
  eventIds: readonly PlayerEventId[];
}>;

/**
 * The stored case that a case keeps, or the new case it makes (events-and-cases.md, 2.5):
 * its origin, and its manual decisions, in any order, none for a new case (SEN-17).
 */
export type StoredCase = Readonly<{ origin: CaseOrigin; decisions: readonly ManualDecision[] }>;

/**
 * What a player's evaluation reads (CL-SEN-05): the player, withdrawn or not (JOU-19),
 * with or without a recorded birthday (CL-SEN-26), his stats-source mapping established
 * or not (STA-03); every type of his events, an event of a type left out being left out
 * too; his events; his team games, every season's, in any order (teamGames); the stored
 * schedule of each season, the season before a measured game's included when stored; the
 * seasons as a case state reads them; the instant of the evaluation and its US date
 * (CL-TRV-03); and the stored case of each case.
 */
export type PlayerEvaluationInput = Readonly<{
  player: Readonly<{ playerId: PlayerId; isWithdrawn: boolean; hasBirthday: boolean }> &
    Readonly<{ isMappingEstablished: boolean }>;
  types: readonly EvaluationType[];
  events: readonly EvaluationEvent[];
  teamGames: readonly EvaluationTeamGame[];
  schedules: readonly Readonly<{ season: string; schedule: SeasonSchedule }>[];
  seasons: CaseSeasons;
  now: EpochMs;
  nowGameDayOn: IsoDate;
  storedCaseOf: (caseKey: CaseKey) => StoredCase;
}>;

/** The criterion of a manual exclusion (SEN-17, CL-SEN-27), with the decision that rules. */
export type ManualCriterion = Readonly<{
  criterion: 'manual';
  condition: null;
  triggeringValues: Readonly<{ decisionId: number }>;
}>;

/** A criterion retained on a case: automatic, with its values, or manual (SEN-11, SEN-17). */
export type CaseCriterion = TriggeredCriterion | ManualCriterion;

/**
 * What its criteria and its decision give a case (SEN-11, SEN-15, SEN-17, CL-SEN-10): its
 * retained criteria with their values, the notices of the criteria that could not be
 * evaluated, the manual decision that rules it and the status it would have without it.
 */
export type DecidedValues = Readonly<{
  triggeredCriteria: readonly CaseCriterion[];
  opponentStrengthNotEvaluable: boolean;
  stakesNotEvaluable: boolean;
  decision: ManualDecision | null;
  statusWithoutDecision: 'measured' | 'excluded' | null;
}>;

/**
 * A case of the player (SEN-05 to SEN-18, CL-SEN-05), as a row of `cases` and its child
 * rows hold it: its type, events, origin and reference instant; its state and reason; its
 * measured game and what it records of it; its gap and its status; its criteria and
 * decision; its review flags; and its co-occurring types.
 */
export type EvaluatedCase = MeasuredValues &
  DecidedValues &
  Readonly<{
    eventTypeId: EventTypeId;
    eventIds: readonly [PlayerEventId, ...PlayerEventId[]];
    origin: CaseOrigin;
    referenceInstantAt: EpochMs | null;
    referenceInstantOrigin: ReferenceInstantOrigin;
    status: CaseStatus;
    statusReason: CaseStatusReason | null;
    measuredGameId: GameId | null;
    normalizedGap: number | null;
    gapStatus: GapStatus | null;
    reviewFlags: readonly ReviewFlag[];
    isCoOccurring: boolean;
    coOccurringTypeIds: readonly EventTypeId[];
  }>;

/** A case of the profiles: a profile's case, with its origin (SEN-21). */
export type OriginCase = ProfileCase & Readonly<{ origin: CaseOrigin }>;

/**
 * A case as the evaluation gives it and as its profile counts it, and, once its gap is
 * computed, with the status that its automatic criteria alone give it, which a manual
 * decision may have changed (SEN-17, SEN-27): the status of a case that no decision rules.
 */
export type CaseEvaluation = Readonly<{
  evaluated: EvaluatedCase;
  profileCase: OriginCase;
  withoutDecision: ManuallyDecidedCase | null;
}>;

/** What the rules of one evaluation read. */
type Context = Readonly<{
  input: PlayerEvaluationInput;
  params: EngineParams;
  gameById: ReadonlyMap<GameId, EvaluationTeamGame>;
}>;

/** An event once attached and given its state, as the grouping reads it (CL-SEN-06). */
type StatedEvent = CaseEvent &
  Readonly<{ event: EvaluationEvent; type: EvaluationType; state: CaseState }>;

/** What a profile's case holds besides its outcome. */
type ProfileCaseBase = Pick<OriginCase, 'caseId' | 'events' | 'isCoOccurring' | 'origin'>;

/** The outcome of a case: as its profile counts it, and what its criteria give it. */
type Outcome = Omit<CaseEvaluation, 'evaluated'> & Readonly<{ decided: DecidedValues }>;

/** An event attached on its own and given its state (CL-SEN-05, CL-SEN-06). */
function statedEvent(event: EvaluationEvent, type: EvaluationType, context: Context): StatedEvent {
  const { input, params } = context;
  const gameContext = { games: input.teamGames, now: input.now, nowGameDayOn: input.nowGameDayOn };
  const attachment = attachToMeasuredGame(event.attachmentEvent, gameContext, params);
  const state = caseState({
    event: event.stateEvent,
    seasons: input.seasons,
    isDatingToVerify: event.isDatingToVerify,
    isMappingEstablished: input.player.isMappingEstablished,
    attachment,
    statisticsOf: (gameId) => statisticsOf(gameId, context),
  });
  return {
    playerId: input.player.playerId,
    eventTypeId: event.eventTypeId,
    eventId: event.eventId,
    measuredGameId: state.measuredGameId,
    referenceInstantAt: attachment.referenceInstantAt,
    referenceInstantOrigin: attachment.referenceInstantOrigin,
    event,
    type,
    state,
  };
}

/** The criteria of a case once its ruling decision applies (SEN-17, CL-SEN-27). */
function criteriaOf(
  automatic: readonly TriggeredCriterion[],
  decision: ManualDecision | null,
): readonly CaseCriterion[] {
  if (decision === null) {
    return automatic;
  }
  const manual: ManualCriterion = {
    criterion: 'manual',
    condition: null,
    triggeringValues: { decisionId: decision.id },
  };
  return decision.kind === 'exclude' ? [...automatic, manual] : [];
}

/** A case awaiting its game or not measurable (SEN-07): no criterion, notice or decision. */
function openOutcome(
  state: Exclude<CaseState, Readonly<{ status: 'measured' }>>,
  base: ProfileCaseBase,
): Outcome {
  return {
    profileCase: { ...base, ...state },
    withoutDecision: null,
    decided: { ...NOT_JUDGED, decision: null, statusWithoutDecision: null },
  };
}

/**
 * A case whose gap is computed (SEN-10, SEN-17, CL-SEN-05 step 10, CL-SEN-27): excluded
 * when an automatic criterion applies, unless the ruling decision reinstates it, whose
 * criteria it then drops; excluded too, with the criterion `manual` after the others,
 * when that decision excludes it; measured, a valid case, otherwise.
 */
function gapOutcome(
  state: Extract<CaseState, Readonly<{ status: 'measured' }>>,
  ofCase: Readonly<{ base: ProfileCaseBase; judgment: Judgment }>,
  ruling: Readonly<{ decisions: readonly ManualDecision[]; context: Context }>,
): Outcome {
  const { base, judgment } = ofCase;
  const automaticStatus = judgment.triggeredCriteria.length > 0 ? 'excluded' : 'measured';
  const { measuredGameId } = state;
  const { decision } = applyManualDecisions(
    { status: automaticStatus, measuredGameId },
    ruling.decisions,
  );
  const triggeredCriteria = criteriaOf(judgment.triggeredCriteria, decision);
  const gap = {
    measuredGameScheduledStartAt: teamGameOf(measuredGameId, ruling.context).game.scheduledStartAt,
    normalizedGap: state.normalizedGap,
    gapStatus: state.gapStatus,
  };
  const [firstCriterion, ...otherCriteria] = triggeredCriteria.map(({ criterion }) => criterion);
  return {
    profileCase:
      firstCriterion === undefined
        ? { ...base, ...gap, status: 'measured' }
        : {
            ...base,
            ...gap,
            status: 'excluded',
            triggeredCriteria: [firstCriterion, ...otherCriteria],
          },
    withoutDecision: { caseId: base.caseId, statusWithoutDecision: automaticStatus },
    decided: {
      ...judgment,
      triggeredCriteria,
      decision,
      statusWithoutDecision: decision === null ? null : automaticStatus,
    },
  };
}

/**
 * What a case reads of its measured game (SEN-08, SEN-11, SEN-16, CL-SEN-05), with the
 * context indications of each of its events, its co-occurring types, the criterion its
 * type's sheet switches off and its decisions; nothing when it has no measured game.
 */
function factsOf(
  group: CaseGroup<StatedEvent>,
  decisions: readonly ManualDecision[],
  context: Context,
): GameFacts {
  const { measuredGameId, events } = group;
  if (measuredGameId === null) {
    return NO_GAME;
  }
  const caseFacts = {
    contextIndications: events.map(({ event }) => event.contextIndications),
    coOccurringTypeIds: group.coOccurringTypeIds,
    switchedOffCriterion: events[0].type.switchedOffCriterion,
    decisions,
  };
  return gameFactsOf(teamGameOf(measuredGameId, context), caseFacts, context);
}

/**
 * A case of the player, as the evaluation gives it and as its profile counts it (SEN-05
 * to SEN-18, CL-SEN-05, CL-SEN-06): its state is that of its earliest event, which every
 * event on its measured game shares; its stored case gives its origin and decisions; its
 * identifier in the profiles is its place among his cases, since no two of them of one
 * type share a measured game, nor, as he plays one game at a time, a scheduled start.
 */
function caseEvaluation(
  group: CaseGroup<StatedEvent>,
  caseId: number,
  context: Context,
): CaseEvaluation {
  const [first, ...others] = group.events;
  const { state } = first;
  const { eventTypeId, measuredGameId } = group;
  const eventIds: EvaluatedCase['eventIds'] = [
    first.eventId,
    ...others.map((each) => each.eventId),
  ];
  const { origin, decisions } = context.input.storedCaseOf({
    eventTypeId,
    measuredGameId,
    eventIds,
  });
  const facts = factsOf(group, decisions, context);
  const base: ProfileCaseBase = {
    caseId,
    events: [
      { researchConfidence: first.event.researchConfidence },
      ...others.map(({ event }) => ({ researchConfidence: event.researchConfidence })),
    ],
    isCoOccurring: group.isCoOccurring,
    origin,
  };
  const { profileCase, withoutDecision, decided } =
    state.status === 'measured'
      ? gapOutcome(state, { base, judgment: facts.judgment }, { decisions, context })
      : openOutcome(state, base);
  return {
    evaluated: {
      eventTypeId,
      eventIds,
      origin,
      referenceInstantAt: group.referenceInstantAt,
      referenceInstantOrigin: group.referenceInstantOrigin,
      status: profileCase.status,
      statusReason: state.statusReason,
      measuredGameId,
      ...facts.values,
      normalizedGap: state.normalizedGap,
      gapStatus: state.gapStatus,
      ...decided,
      reviewFlags: facts.reviewFlags,
      isCoOccurring: group.isCoOccurring,
      coOccurringTypeIds: group.coOccurringTypeIds,
    },
    profileCase,
    withoutDecision,
  };
}

/**
 * Evaluates every case of one followed player (SEN-05 to SEN-18, SEN-32, CL-SEN-05,
 * CL-SEN-06, JOU-14), whatever the order of its inputs: each of his events of the given
 * types is attached to its measured game on its own, the first game he played after it
 * with whichever team, and given its state; the events of one type on one game form one
 * case, the cases in the order of their earliest events. A case whose gap is computed is
 * judged by the doubtful-case criteria, then by the manual decision made on its game,
 * and every case with a measured game gets its review flags.
 */
export function evaluateCases(
  input: PlayerEvaluationInput,
  params: EngineParams,
): readonly CaseEvaluation[] {
  const gameById = new Map(input.teamGames.map((teamGame) => [teamGame.game.id, teamGame]));
  const context: Context = { input, params, gameById };
  const stated = input.types.flatMap((type) =>
    input.events
      .filter((event) => event.eventTypeId === type.eventTypeId)
      .map((event) => statedEvent(event, type, context)),
  );
  return groupCases(stated).map((group, caseId) => caseEvaluation(group, caseId, context));
}
