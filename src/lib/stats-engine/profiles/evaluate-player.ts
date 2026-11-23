// Every case and every profile of one followed player, from his data (SEN-01 to SEN-27,
// SEN-32, SEN-36, CL-SEN-05, CL-SEN-06): each event attached to its measured game on its
// own and given its state, the events grouped into cases, each case measured against its
// season baseline, judged by the doubtful-case criteria and the owner's manual decisions
// and given its review flags (evaluate-cases.ts, evaluate-game.ts), then the profile of
// each type in its three views. Which stored case a group of events keeps, with its
// origin and its decisions, is the sensitivity module's (events-and-cases.md, 2.5): the
// caller answers it for each case.

import { profileChecks } from './checks';
import { profileConfidence } from './confidence';
import { evaluateCases } from './evaluate-cases';
import { casesByView, hasProfiles, hasTallyEvent } from './evaluate-trend';
import { runRobustnessTest } from './robustness';
import { tallyProfile } from './tally';
import { profileVerdict } from './verdict';

import type { EngineParams, EventTypeId } from '../types';
import type { ProfileChecks } from './checks';
import type { ConfidenceValues } from './confidence';
import type {
  CaseEvaluation,
  EvaluatedCase,
  EvaluationType,
  OriginCase,
  PlayerEvaluationInput,
} from './evaluate-cases';
import type { CaseOrigin, ProfileView } from './evaluate-trend';
import type { ProfileTally, TallyExitReason } from './tally';
import type { ProfileVerdict } from './verdict';

/**
 * One view of a profile (SEN-20 to SEN-27, CL-SEN-19): its tally, verdict values,
 * fragility, profile confidence and checks, and its valid cases of each origin (SEN-21).
 */
export type ProfileViewValues = ProfileVerdict &
  ConfidenceValues &
  ProfileChecks &
  Readonly<{ view: ProfileView; tally: ProfileTally; isFragile: boolean }> &
  Readonly<{ historicalValidCount: number; trackedValidCount: number }>;

/** A profile of the player (SEN-19, SEN-21): its type, whether it is archived, its views. */
export type PlayerProfile = Readonly<{
  eventTypeId: EventTypeId;
  isArchived: boolean;
  views: readonly ProfileViewValues[];
}>;

/** A player's evaluation: his cases, in the order of their earliest events, and his profiles. */
export type PlayerEvaluation = Readonly<{
  cases: readonly EvaluatedCase[];
  profiles: readonly PlayerProfile[];
}>;

/** How many valid cases of `origin` there are among `cases` (SEN-21). */
function validCountOf(cases: readonly OriginCase[], origin: CaseOrigin): number {
  return cases.filter((caseItem) => caseItem.status === 'measured' && caseItem.origin === origin)
    .length;
}

/**
 * The values of one view of a profile (SEN-20 to SEN-27, CL-SEN-19): its tally, verdict
 * values, robustness test, profile confidence and checks, each computed on the view's own
 * cases, and its valid cases of each origin.
 */
function profileValuesOf(
  part: Readonly<{ cases: readonly OriginCase[]; exitReasons: readonly TallyExitReason[] }>,
  evaluations: readonly CaseEvaluation[],
  params: EngineParams,
): Omit<ProfileViewValues, 'view'> {
  const { cases, exitReasons } = part;
  const tally = tallyProfile(cases, exitReasons);
  const verdictValues = profileVerdict(cases, params);
  const { isFragile } = runRobustnessTest(cases, verdictValues.verdict, params);
  const confidenceInputs = {
    validCount: tally.validCount,
    excludedCount: tally.excludedCount,
    gapDispersion: verdictValues.quantities?.gapDispersion ?? null,
    isFragile,
  };
  const manuallyDecidedCases = evaluations
    .map(({ withoutDecision }) => withoutDecision)
    .filter((withoutDecision) => withoutDecision !== null);
  return {
    tally,
    ...verdictValues,
    isFragile,
    ...profileConfidence(confidenceInputs, params),
    ...profileChecks({ cases, manuallyDecidedCases }, params),
    historicalValidCount: validCountOf(cases, 'historical'),
    trackedValidCount: validCountOf(cases, 'tracked'),
  };
}

/**
 * The profile of `type`, null when it has none (SEN-19, CL-SEN-26): a validated or a
 * withdrawn type has one while its tally holds an event, the events that left it
 * included, and, while the birthday type is validated, a player without a recorded
 * birthday has one with an empty tally. It is archived when the player or the type is
 * withdrawn, and computed in full in each view all the same.
 */
function profileOf(
  type: EvaluationType,
  evaluations: readonly CaseEvaluation[],
  input: Readonly<{ player: PlayerEvaluationInput['player']; params: EngineParams }>,
): PlayerProfile | null {
  const { player } = input;
  const ofType = evaluations.filter(({ evaluated }) => evaluated.eventTypeId === type.eventTypeId);
  const isBirthdayUnrecorded =
    !player.hasBirthday && type.calendarDerivation === 'birthday' && type.status === 'validated';
  const hasTally = hasTallyEvent(ofType, type.exitReasons) || isBirthdayUnrecorded;
  if (!hasTally || !hasProfiles(type.status)) {
    return null;
  }
  const cases = ofType.map(({ profileCase }) => profileCase);
  return {
    eventTypeId: type.eventTypeId,
    isArchived: player.isWithdrawn || type.status === 'withdrawn',
    views: casesByView(cases, type.exitReasons).map((part) => ({
      view: part.view,
      ...profileValuesOf(part, ofType, input.params),
    })),
  };
}

/**
 * Evaluates every case and every profile of one followed player (SEN-01 to SEN-27,
 * SEN-32, SEN-36, CL-SEN-05, CL-SEN-06, CL-SEN-26, JOU-14, VUE-03), whatever the order of
 * its inputs, to the bit. Each of his events of the given types is attached to its
 * measured game on its own, the first game he played after it with whichever team, and
 * given its state; the events of one type on one game form one case. A case whose gap is
 * computed is judged by the doubtful-case criteria, then by the manual decision made on
 * its game, and every case with a measured game gets its review flags, among them the
 * first game with a new team, which excludes nothing. The result of a game, its final
 * score, enters nothing: only his performance index is measured. Each validated or
 * withdrawn type then gets its profile in the views all cases, historical cases only and
 * tracked cases only, in the order of `types`, while its tally holds an event, archived
 * when the player or the type is withdrawn; a proposed or rejected type has none.
 */
export function evaluatePlayer(
  input: PlayerEvaluationInput,
  params: EngineParams,
): PlayerEvaluation {
  const evaluations = evaluateCases(input, params);
  return {
    cases: evaluations.map(({ evaluated }) => evaluated),
    profiles: input.types.flatMap(
      (type) => profileOf(type, evaluations, { player: input.player, params }) ?? [],
    ),
  };
}
