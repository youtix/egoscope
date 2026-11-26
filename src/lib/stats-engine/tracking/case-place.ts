// Where a tracked case counts in the rows of the validation table (SUI-06, SUI-16, SUI-24,
// SUI-25, CL-DET-09, CL-SUI-02): nowhere, when all of its events were dismissed before tip-off;
// among the post-tip-off counts, when a decision touched it after tip-off; otherwise among the
// cases recorded after tip-off, then by its status when it is not measured, then in the
// late-forecast part when its forecast is late, and in the testing set when none of these
// holds. The same place holds in each of its rows; its sub-row of the overall row follows its
// frozen or late forecast.

import { valuesOf } from '../cases/case-state';
import { decisionStanding } from './decisions';
import { recordingTiming } from './recording';

import type { GapStatus } from '../cases/normalized-gap';
import type { CaseId, EpochMs, EventTypeId, PlayerId } from '../types';
import type { PostTipOffDecisionEffect, TrackedCaseDecision } from './decisions';
import type { Forecast } from './forecast';

/** The sub-rows of the overall row, in the glossary's order, which is the order of the rows. */
export const OVERALL_SUBROW_KINDS = valuesOf([
  'probable_profile',
  'possible_profile',
  'general_trend',
]);

/** A sub-row of the overall row (SUI-28), by forecast source and level, the glossary's set. */
export type OverallSubrowKind = (typeof OVERALL_SUBROW_KINDS)[number];

/**
 * Where a tracked case's measurement stands (SEN-07, SEN-10, SUI-12): its status, with the
 * last known scheduled start of its measured game, null until one is established; and its
 * normalized gap with its status when measured or excluded, which only a case with a measured
 * game has.
 */
export type TrackedCaseOutcome =
  | Readonly<{ status: 'awaiting_game' | 'not_measurable'; measuredGameStartAt: EpochMs | null }>
  | Readonly<{
      status: 'measured' | 'excluded';
      measuredGameStartAt: EpochMs;
      normalizedGap: number;
      gapStatus: GapStatus;
    }>;

/** The stored frozen or late forecast of a tracked case (SUI-09, SUI-10, CL-SUI-05). */
export type TableForecast = Readonly<{ state: 'frozen' | 'late'; forecast: Forecast }>;

/**
 * A tracked case as the table reads it (SUI-06, SUI-17, SUI-24, CL-DET-09, CL-SUI-06): its
 * player and type, its creation instant, its expected game's last known scheduled start,
 * null while none is known, its measurement, its frozen or late forecast, null without one or
 * before the freeze, whether it is co-occurring, its decisions, and, when all of its events
 * are dismissed, the instant of the dismissal that left none of them undismissed.
 */
export type TableTrackedCase = Readonly<{
  caseId: CaseId;
  playerId: PlayerId;
  eventTypeId: EventTypeId;
  createdAt: EpochMs;
  expectedGameStartAt: EpochMs | null;
  outcome: TrackedCaseOutcome;
  frozenForecast: TableForecast | null;
  isCoOccurring: boolean;
  decisions: readonly TrackedCaseDecision[];
  allEventsDismissedAt: EpochMs | null;
}>;

/** A case's gap, with the keys of the fixed order of sums (CL-STA-09). */
export type CaseGap = Readonly<{
  caseId: CaseId;
  measuredGameScheduledStartAt: EpochMs;
  normalizedGap: number;
  gapStatus: GapStatus;
}>;

/**
 * Where a tracked case counts in each of its rows (SUI-24, SUI-25): the testing set or the
 * late-forecast part, with its gap; one of the separate counts, with its gap when it has one.
 */
export type CasePlace =
  | Readonly<{ kind: 'testing' | 'late'; gap: CaseGap }>
  | Readonly<{
      kind:
        | 'recorded_after_tip_off'
        | 'awaiting_game'
        | 'not_measurable'
        | 'excluded'
        | PostTipOffDecisionEffect;
      gap: CaseGap | null;
    }>;

/**
 * Gives the overall sub-row of a forecast (SUI-28, CL-SUI-16): `general_trend` for a forecast
 * from the type's general trend, `probable_profile` or `possible_profile` by the level of one
 * from the player's profile, and none without a forecast.
 */
export function overallSubrowOf(forecast: Forecast | null): OverallSubrowKind | null {
  if (forecast === null) {
    return null;
  }
  if (forecast.source === 'general_trend') {
    return 'general_trend';
  }
  return forecast.level === 'probable' ? 'probable_profile' : 'possible_profile';
}

function gapOf(
  caseId: CaseId,
  outcome: Extract<TrackedCaseOutcome, Readonly<{ normalizedGap: number }>>,
): CaseGap {
  return {
    caseId,
    measuredGameScheduledStartAt: outcome.measuredGameStartAt,
    normalizedGap: outcome.normalizedGap,
    gapStatus: outcome.gapStatus,
  };
}

/**
 * Gives where a tracked case counts in its rows, null when it shows nowhere (SUI-06, SUI-16,
 * SUI-24, SUI-25, CL-DET-09, CL-DET-15, CL-SUI-10), in this precedence: as its decisions leave
 * it when they removed it or touched it after tip-off; then among the cases recorded after
 * tip-off; then by its status when it is not measured; then in the late-forecast part when its
 * forecast is late; otherwise in the testing set, valid, recorded in time, untouched and with
 * an event not dismissed. A measured or excluded case keeps its gap wherever it counts.
 */
export function casePlace(item: TableTrackedCase): CasePlace | null {
  const { outcome } = item;
  const games = {
    measuredGameStartAt: outcome.measuredGameStartAt,
    expectedGameStartAt: item.expectedGameStartAt,
  };
  const gap =
    outcome.status === 'measured' || outcome.status === 'excluded'
      ? gapOf(item.caseId, outcome)
      : null;
  const standing = decisionStanding({
    ...games,
    decisions: item.decisions,
    allEventsDismissedAt: item.allEventsDismissedAt,
  });
  if (standing === 'removed') {
    return null;
  }
  if (standing !== 'untouched') {
    return { kind: standing, gap };
  }
  if (recordingTiming({ ...games, createdAt: item.createdAt }) === 'recorded_after_tip_off') {
    return { kind: 'recorded_after_tip_off', gap };
  }
  if (outcome.status !== 'measured') {
    return { kind: outcome.status, gap };
  }
  const kind = item.frozenForecast?.state === 'late' ? 'late' : 'testing';
  return { kind, gap: gapOf(item.caseId, outcome) };
}
