// The caveats of an alert sheet (ALE-16, CL-ALE-03, CL-ALE-05, CL-ALE-13, CL-DET-07,
// ADR 0016): every caveat that applies, none ever hidden, read from the frozen profile and
// trend values of its sections, its events, what is known of its expected game and its
// marks. Whether the game's stakes are high and whether its opponent makes a case doubtful
// come from the cases/ and schedule/ rules, which the caller applies (SEN-14, SEN-15);
// freezing the caveats at the game's scheduled start is the alerts module's (CL-ALE-07).
// Every threshold is received as data, and compared with in caveat-thresholds.ts.

import { isBelowThreshold, isConfidenceNearThreshold, isSmallTrend } from './caveat-thresholds';

import type { ContextIndications } from '../cases/doubtful-criteria';
import type { EventOrigin, EventTypeId, PlayerEventId } from '../types';
import type { CaveatProfile, CaveatThresholds, CaveatTrend } from './caveat-thresholds';

/**
 * An event of a section (ALE-08, CL-ALE-13): detected, the owner's classifications and
 * rescues included, or derived from the calendar; dismissed or not (ALE-22); its context
 * indications (H-09); its detection confidence as issued (ALE-21), a model's, null when
 * the owner classified or rescued it (CL-DET-07); whether it carries the « datation à
 * vérifier » mark (DET-32).
 */
export type CaveatEvent = Readonly<{
  playerEventId: PlayerEventId;
  origin: Exclude<EventOrigin, 'historical'>;
  isDismissed: boolean;
  context: ContextIndications;
  detectionConfidence: number | null;
  isDatingToVerify: boolean;
}>;

/**
 * A section of the sheet (ALE-09, ALE-14, ALE-20, ADR 0015, ADR 0016): its type; whether the
 * player's coverage lacked that type when the section was added; whether the type is derived
 * from the calendar (its `calendar_derivation` is set); whether the type has a doubtful-case
 * criterion switched off; its events; its frozen profile, null while the section waits for
 * its values (ALE-05); and the type's frozen general trend, null when the section has none.
 */
export type CaveatSection = Readonly<{
  eventTypeId: EventTypeId;
  isTypeNotCovered: boolean;
  isCalendarDerived: boolean;
  hasSwitchedOffCriterion: boolean;
  events: readonly CaveatEvent[];
  profile: CaveatProfile | null;
  trend: CaveatTrend | null;
}>;

/**
 * What a sheet's caveats are computed from (ALE-16, H-ALE-02, D-19): its sections; whether
 * its expected game has high stakes by the statistics, a playoff elimination game included,
 * and whether its opponent's strength would make the case doubtful, both false while no
 * expected game is known; its « tardive » mark (ALE-24); and whether a related sheet of the
 * player ends on the same game.
 */
export type SheetCaveatsInput = Readonly<{
  sections: readonly CaveatSection[];
  expectedGame: Readonly<{ isHighStakes: boolean; isOpponentDoubtful: boolean }>;
  isLate: boolean;
  hasRelatedSheet: boolean;
}>;

/**
 * The two forms of the direction caveat (CL-ALE-03): an opposite effect remains possible
 * and would be counted the same way; the effect, if any, can go either way.
 */
export type DirectionCaveatForm = 'opposite_effect_possible' | 'either_way';

/** What the known-context caveat names (ALE-16, D-19), as it is stored. */
export type KnownContextReason = 'high_stakes' | 'injury_return_flagged' | 'opponent_strength';

/** A caveat of a section that names its type alone (ALE-16, SEN-46, ADR 0016). */
type SectionCaveat = Readonly<{
  kind:
    | 'small_sample'
    | 'incomplete_or_earlier_version'
    | 'type_not_covered'
    | 'confounder_not_separable';
  eventTypeId: EventTypeId;
}>;

/** A caveat of an event, which names it (ALE-16). */
type EventCaveat = Readonly<{
  kind: 'confidence_near_threshold' | 'dating_to_verify';
  playerEventId: PlayerEventId;
}>;

/**
 * One caveat of a sheet (ALE-16, ADR 0016), as `alert_sheet_caveats` stores it: a caveat
 * of a section names its type, the direction caveat with its form; one of an event names
 * the event; the known context lists its reasons; the others concern the whole sheet.
 */
export type Caveat =
  | SectionCaveat
  | Readonly<{ kind: 'effect_direction'; eventTypeId: EventTypeId; form: DirectionCaveatForm }>
  | Readonly<{ kind: 'known_context'; knownContextReasons: readonly KnownContextReason[] }>
  | Readonly<{ kind: 'several_events' | 'late_sheet' }>
  | EventCaveat;

/** A caveat's kind (ALE-16, ADR 0016), as it is stored. */
export type CaveatKind = Caveat['kind'];

/** The caveat when its condition holds, as a list of none or one. */
function caveatIf(isApplicable: boolean, caveat: Caveat): readonly Caveat[] {
  return isApplicable ? [caveat] : [];
}

/**
 * Whether the section's type is outside the player's coverage (ALE-14), which a type
 * derived from the calendar never is, since it leaves the backtest coverage (CL-ALE-13),
 * whatever events its section still holds.
 */
function isTypeNotCovered(section: CaveatSection): boolean {
  return section.isTypeNotCovered && !section.isCalendarDerived;
}

/**
 * Whether a section rests on a small sample (ALE-16, CL-ALE-05): the player's profile has
 * fewer valid cases than a verdict needs or a low confidence, on every section; and, for a
 * type not covered (ALE-14), whose general trend is then a measure that applies, the trend
 * rests on a small sample too. Below the threshold, the trend that applies (ALE-12) can add
 * nothing: the player's own cases already make the sample small, as for player B of the
 * spec's example. A section waiting for its values has no measure yet.
 */
function isSmallSample(section: CaveatSection, thresholds: CaveatThresholds): boolean {
  const { profile } = section;
  return (
    profile !== null &&
    (isBelowThreshold(profile, thresholds) ||
      profile.profileConfidence === 'low' ||
      (isTypeNotCovered(section) && isSmallTrend(section.trend, thresholds)))
  );
}

/**
 * The direction caveat of a section, always there (ALE-16, CL-ALE-03), following its frozen
 * verdict level: the opposite effect for a profile with a direction, possible or probable,
 * increase and decrease alike; either way for an inconclusive profile, which every profile
 * below the threshold is (SEN-23), and while no verdict has entered (ALE-05).
 */
function directionCaveat(section: CaveatSection): Caveat {
  const { profile } = section;
  const hasDirection = profile !== null && profile.verdict.level !== 'inconclusive';
  return {
    kind: 'effect_direction',
    eventTypeId: section.eventTypeId,
    form: hasDirection ? 'opposite_effect_possible' : 'either_way',
  };
}

/** Whether the profile is incomplete or rests in part on an earlier type sheet version (SEN-46). */
function isIncompleteOrEarlierVersion({ profile }: CaveatSection): boolean {
  return profile !== null && (profile.isIncomplete || profile.earlierVersionCaseCount > 0);
}

/** The caveats of one kind that the sections bring, in their order. */
function sectionCaveats(
  sections: readonly CaveatSection[],
  kind: SectionCaveat['kind'],
  isApplicable: (section: CaveatSection) => boolean,
): readonly Caveat[] {
  return sections
    .filter((section) => isApplicable(section))
    .map(({ eventTypeId }) => ({ kind, eventTypeId }));
}

/**
 * The caveats of one kind that the detected events bring, in their order; an event derived
 * from the calendar has no detection confidence and no dating mark (CL-ALE-13).
 */
function eventCaveats(
  events: readonly CaveatEvent[],
  kind: EventCaveat['kind'],
  isApplicable: (event: CaveatEvent) => boolean,
): readonly Caveat[] {
  return events
    .filter((event) => event.origin === 'detected' && isApplicable(event))
    .map(({ playerEventId }) => ({ kind, playerEventId }));
}

/**
 * The reasons of the known-context caveat (ALE-16, D-19, CL-SEN-28): high stakes, flagged
 * on an event or given by the statistics for the expected game; a return from injury
 * flagged on an event; an opponent whose strength would make the case doubtful.
 */
function knownContextReasons(
  input: SheetCaveatsInput,
  events: readonly CaveatEvent[],
): readonly KnownContextReason[] {
  const reasons: readonly (readonly [KnownContextReason, boolean])[] = [
    [
      'high_stakes',
      input.expectedGame.isHighStakes ||
        events.some(({ context }) => context.gameStakes === 'high'),
    ],
    ['injury_return_flagged', events.some(({ context }) => context.injuryReturn === 'yes')],
    ['opponent_strength', input.expectedGame.isOpponentDoubtful],
  ];
  return reasons.filter(([, applies]) => applies).map(([reason]) => reason);
}

/**
 * The caveats of an alert sheet (ALE-16, CL-ALE-03, CL-ALE-05, CL-ALE-13, CL-DET-07,
 * H-ALE-02, H-ALE-06, D-19, SEN-46, ADR 0016): every one that applies, none hidden, in the
 * order of ALE-16's list, each kind's in the order of the sections and events given.
 * Per section: small sample, of the player's profile or, for a type not covered, of the
 * general trend; the direction caveat, always, in the form its verdict gives; an incomplete
 * profile or one resting in part on an earlier type sheet version; the type not covered,
 * never for a calendar-derived type;
 * the confounder warning of a switched-off criterion. Per non-dismissed detected event: a
 * detection confidence near the threshold, never for an owner's classification; the dating
 * to verify. For the sheet: the known context of its expected game and of its
 * non-dismissed events; several events, when more than one is not dismissed or a related
 * sheet shares the game; the late sheet.
 */
export function sheetCaveats(
  input: SheetCaveatsInput,
  thresholds: CaveatThresholds,
): readonly Caveat[] {
  const { sections } = input;
  const events = sections
    .flatMap((section) => section.events)
    .filter(({ isDismissed }) => !isDismissed);
  const reasons = knownContextReasons(input, events);
  return [
    ...sectionCaveats(sections, 'small_sample', (section) => isSmallSample(section, thresholds)),
    ...sections.map((section) => directionCaveat(section)),
    ...caveatIf(reasons.length > 0, { kind: 'known_context', knownContextReasons: reasons }),
    ...caveatIf(events.length > 1 || input.hasRelatedSheet, { kind: 'several_events' }),
    ...eventCaveats(events, 'confidence_near_threshold', ({ detectionConfidence }) =>
      isConfidenceNearThreshold(detectionConfidence, thresholds),
    ),
    ...eventCaveats(events, 'dating_to_verify', ({ isDatingToVerify }) => isDatingToVerify),
    ...sectionCaveats(sections, 'incomplete_or_earlier_version', isIncompleteOrEarlierVersion),
    ...caveatIf(input.isLate, { kind: 'late_sheet' }),
    ...sectionCaveats(sections, 'type_not_covered', isTypeNotCovered),
    ...sectionCaveats(
      sections,
      'confounder_not_separable',
      ({ hasSwitchedOffCriterion }) => hasSwitchedOffCriterion,
    ),
  ];
}
