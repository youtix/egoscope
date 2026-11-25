// Profiles and general trends built by hand, as the engine's evaluation gives them, for the
// tests of the stores that write them (SEN-19 to SEN-30): each view varies only by its valid
// cases, mean gap, verdict, confidence, reasons and manual exclusions, and meets every row
// check of the data model (sensitivity-and-profiles.md sections 1.1 and 1.2).
import type {
  ConfidenceStepDownReason,
  EvaluatedTrend,
  EventTypeId,
  PlayerProfile,
  ProfileConfidence,
  ProfileView,
  ProfileViewValues,
  Verdict,
} from '@/lib/stats-engine';

/**
 * What a hand-built view varies: its valid cases and their mean gap, its verdict (inconclusive
 * by default), its confidence (low by default), its reasons for a lower confidence, and its
 * manually excluded cases, which stay in its tally (SEN-17).
 */
export type ViewShape = Readonly<{
  validCount: number;
  meanGap?: number;
  verdict?: Verdict;
  confidence?: ProfileConfidence;
  reasons?: readonly ConfidenceStepDownReason[];
  excludedCount?: number;
}>;

/** The shapes of the three views: the historical one as the default one, no tracked case by default. */
type ViewShapes = Readonly<{ all: ViewShape; historical?: ViewShape; tracked?: ViewShape }>;

const INCONCLUSIVE: Verdict = { level: 'inconclusive', direction: null };
// The gap and its spread, exact binary fractions that the tests compare exactly.
const DEFAULT_MEAN_GAP = 0.5;
const DISPERSION = 1.5;
const EXPECTED_NOISE = 0.25;
const HALF_RANGE = 0.5;
const CONTROL_OFFSET = 0.125;
const VALID_CASE_THRESHOLD = 5;
// The one case of each view that awaits its game.
const AWAITING_COUNT = 1;

/** The quantities of `validCount` valid cases around `meanGap`, none without a valid case (CL-SEN-15). */
function quantitiesOf(validCount: number, meanGap: number) {
  return validCount === 0
    ? null
    : {
        meanGap,
        gapDispersion: validCount < 2 ? null : DISPERSION,
        retainedDispersion: DISPERSION,
        expectedNoise: EXPECTED_NOISE,
        signalToNoise: meanGap / EXPECTED_NOISE,
        rangeLow: meanGap - HALF_RANGE,
        rangeHigh: meanGap + HALF_RANGE,
      };
}

/** A view with one case awaiting its game beside its valid and excluded cases (SEN-20 to SEN-27). */
function viewOf(view: ProfileView, shape: ViewShape): ProfileViewValues {
  const { validCount, meanGap = DEFAULT_MEAN_GAP, verdict = INCONCLUSIVE } = shape;
  const { confidence = 'low', excludedCount = 0 } = shape;
  const caseCount = validCount + excludedCount + AWAITING_COUNT;
  const isTracked = view === 'tracked_only';
  return {
    view,
    tally: {
      groupedEventCount: 0,
      excludedCount,
      manuallyExcludedCount: excludedCount,
      notMeasurableCount: 0,
      coOccurringCount: 0,
      provisionalGapCount: 0,
      lowResearchConfidenceCount: 0,
      eventCount: caseCount,
      caseCount,
      awaitingCount: AWAITING_COUNT,
      validCount,
      tallyReasons: { awaitingGame: {}, notMeasurable: {}, excluded: {} },
      exitCounts: {},
    },
    quantities: quantitiesOf(validCount, meanGap),
    aboveZeroCount: validCount,
    belowZeroCount: 0,
    verdict,
    isFragile: false,
    profileConfidence: confidence,
    confidenceStepDownReasons: shape.reasons ?? [],
    controlCaseCount: validCount,
    controlQuantities: quantitiesOf(validCount, meanGap - CONTROL_OFFSET),
    controlVerdict: verdict,
    dependsOnManualExclusions: false,
    historicalValidCount: isTracked ? 0 : validCount,
    trackedValidCount: isTracked ? validCount : 0,
    validCaseThreshold: VALID_CASE_THRESHOLD,
  };
}

/** The three views of `shapes`, in the glossary's order (CL-SEN-19). */
function viewsOf({ all, historical = all, tracked = { validCount: 0 } }: ViewShapes) {
  return [
    viewOf('all_cases', all),
    viewOf('historical_only', historical),
    viewOf('tracked_only', tracked),
  ];
}

/**
 * A player's profile of `eventTypeId` in the three views of `shapes`, as the engine evaluates
 * it (SEN-19, CL-SEN-19), for the tests of the profile store.
 */
export function buildProfile(eventTypeId: EventTypeId, shapes: ViewShapes): PlayerProfile {
  return { eventTypeId, isArchived: false, views: viewsOf(shapes) };
}

/**
 * A general trend in the three views of `shapes`, as the engine evaluates it (SEN-28,
 * CL-SEN-19): its valid cases from two players at most, the first contributing them all.
 */
export function buildTrend(shapes: ViewShapes): EvaluatedTrend {
  return {
    isArchived: false,
    views: viewsOf(shapes).map((view) => ({
      ...view,
      distinctPlayerCount: Math.min(view.tally.validCount, 2),
      topContributorValidCount: view.tally.validCount,
    })),
  };
}
