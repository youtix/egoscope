// Every case and every profile of one followed player, from his data (SEN-01 to SEN-27,
// SEN-32, SEN-36, CL-SEN-05, CL-SEN-06): each event attached to its measured game on its
// own and given its state, the events grouped into cases, each case measured against its
// season baseline, judged by the doubtful-case criteria and the owner's manual decisions
// and given its review flags (evaluate-cases.ts, evaluate-game.ts), then the profile of
// each type in its three views (profile-view.ts). Which stored case a group of events
// keeps, with its origin and its decisions, is the sensitivity module's
// (events-and-cases.md, 2.5): the caller answers it for each case.

import { evaluateCases } from './evaluate-cases';
import { casesByView, hasProfiles, hasTallyEvent } from './evaluate-trend';
import { profileViewValues } from './profile-view';

import type { EngineParams, EventTypeId } from '../types';
import type {
  CaseEvaluation,
  EvaluatedCase,
  EvaluationType,
  PlayerEvaluationInput,
} from './evaluate-cases';
import type { ProfileViewValues } from './profile-view';

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

/**
 * The profile of `type`, null when it has none (SEN-19, CL-SEN-26): a validated or a
 * withdrawn type has one while its tally holds an event, the events that left it
 * included, and, while the birthday type is validated, a player without a recorded
 * birthday has one with an empty tally. It is archived when the player or the type is
 * withdrawn, and computed in full in each view all the same, each view reading the cases
 * of the type that a manual decision rules (SEN-27).
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
  const manuallyDecidedCases = ofType
    .map(({ withoutDecision }) => withoutDecision)
    .filter((withoutDecision) => withoutDecision !== null);
  return {
    eventTypeId: type.eventTypeId,
    isArchived: player.isWithdrawn || type.status === 'withdrawn',
    views: casesByView(cases, type.exitReasons).map((part) =>
      profileViewValues({ ...part, manuallyDecidedCases }, input.params),
    ),
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
