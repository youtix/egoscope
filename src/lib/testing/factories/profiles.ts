// Profiles and general trends for the tests (SEN-19 to SEN-30): built by hand, as the engine's
// evaluation gives them, for the tests of the stores that write them, each view varying only
// by its valid cases, mean gap, verdict, confidence, reasons and manual exclusions and meeting
// every row check of the data model (sensitivity-and-profiles.md sections 1.1 and 1.2); or
// written whole, with the values that the engine computes from the stored cases, for the
// tests of the reads.
import { eq } from 'drizzle-orm';

import {
  generalTrends,
  profileValueVersions,
  sensitivityProfiles,
  verdictHistoryEntries,
} from '@/lib/db';
import { snapshotCalculationParams } from '@/lib/params';
import { now } from '@/lib/time';

import { firstRow } from '../rows';
import { casesOf, DEFAULT_PARAMS, profileValues, trendValues } from './profile-cases';
import { MEDIA_STORM } from './taxonomy';

import type { CalculationScope, ProfileValues } from './profile-cases';
import type { Database } from '@/lib/db';
import type {
  GeneralTrendRow,
  ProfileValueVersionRow,
  SensitivityProfileRow,
  VerdictHistoryEntryRow,
} from '@/lib/sensitivity';
import type {
  ConfidenceStepDownReason,
  EngineParams,
  EvaluatedTrend,
  EventTypeId,
  PlayerProfile,
  ProfileConfidence,
  ProfileView,
  ProfileViewValues,
  Verdict,
} from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

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

/** A stored profile or trend, by its identifier. */
export type CalculationSubject = Readonly<{ profileId: number }> | Readonly<{ trendId: number }>;

// The quantities of a calculation without a valid case (CL-SEN-15).
const NO_QUANTITIES = {
  meanGap: null,
  gapDispersion: null,
  retainedDispersion: null,
  expectedNoise: null,
  signalToNoise: null,
  rangeLow: null,
  rangeHigh: null,
} as const;

/** The columns of a profile or a trend that `values` give, with the snapshot of the parameters in force (SEN-36). */
async function calculationColumns(
  db: Database,
  scope: CalculationScope,
  calculated: Readonly<{ values: ProfileValues; historicalValidCount: number }>,
) {
  const { values, historicalValidCount } = calculated;
  const control = values.controlQuantities ?? NO_QUANTITIES;
  return {
    view: scope.view ?? 'all_cases',
    eventTypeId: scope.eventTypeId ?? MEDIA_STORM,
    ...values.tally,
    historicalValidCount,
    trackedValidCount: values.tally.validCount - historicalValidCount,
    ...(values.quantities ?? NO_QUANTITIES),
    aboveZeroCount: values.aboveZeroCount,
    belowZeroCount: values.belowZeroCount,
    verdictLevel: values.verdict.level,
    verdictDirection: values.verdict.direction,
    isFragile: values.isFragile,
    profileConfidence: values.profileConfidence,
    controlCaseCount: values.controlCaseCount,
    controlMeanGap: control.meanGap,
    controlRangeLow: control.rangeLow,
    controlRangeHigh: control.rangeHigh,
    controlVerdictLevel: values.controlVerdict.level,
    controlVerdictDirection: values.controlVerdict.direction,
    dependsOnManualExclusions: values.dependsOnManualExclusions,
    validCaseThreshold: (scope.params ?? DEFAULT_PARAMS).sensitivity.minValidCases,
    parameterSnapshotId: await snapshotCalculationParams(db),
    computedAt: new Date(scope.computedAt ?? now()),
  };
}

/**
 * Writes a player's profile of a type in a view, the media storm and all cases by
 * default, whose values the engine computes from his stored cases of that view, or those
 * of `caseIds`, with their events and criteria, none co-occurring and no manual decision
 * ruling them, the events that left the tally given by `exits` (SEN-19 to SEN-27): its
 * tally, verdict, robustness, confidence and controls, and the snapshot of the parameters
 * in force, whose sensitivity values `params` must match when it is given (SEN-36).
 */
export async function insertProfile(
  db: Database,
  scope: CalculationScope & Readonly<{ playerId: string }>,
): Promise<SensitivityProfileRow> {
  const { counted, historicalValidCount } = await casesOf(db, scope);
  const values = profileValues(counted, scope.exits ?? [], scope.params ?? DEFAULT_PARAMS);
  const rows = await db
    .insert(sensitivityProfiles)
    .values({
      ...(await calculationColumns(db, scope, { values, historicalValidCount })),
      playerId: scope.playerId,
      // A profile's confidence never steps down for a dominant player, a trend's step (SEN-29).
      confidenceStepDownReasons: values.confidenceStepDownReasons.filter(
        (reason) => reason !== 'dominant_player',
      ),
    })
    .returning();
  return firstRow(rows, 'the profile written');
}

/**
 * Writes a type's general trend in a view, the media storm and all cases by default,
 * whose values the engine computes from every player's stored cases of that view, or
 * those of `caseIds`, as `insertProfile` does, under the trend's rules (SEN-28 to SEN-30).
 */
export async function insertTrend(
  db: Database,
  scope: CalculationScope = {},
): Promise<GeneralTrendRow> {
  const { counted, historicalValidCount } = await casesOf(db, scope);
  const values = trendValues(counted, scope.exits ?? [], scope.params ?? DEFAULT_PARAMS);
  const rows = await db
    .insert(generalTrends)
    .values({
      ...(await calculationColumns(db, scope, { values, historicalValidCount })),
      confidenceStepDownReasons: [...values.confidenceStepDownReasons],
      distinctPlayerCount: values.distinctPlayerCount,
      topContributorValidCount: values.topContributorValidCount,
    })
    .returning();
  return firstRow(rows, 'the trend written');
}

/** The stored subject's reference column, its row, and its type, view and player, the last for a profile only. */
async function subjectOf(db: Database, subject: CalculationSubject) {
  if ('profileId' in subject) {
    const id = subject.profileId;
    const rows = await db.select().from(sensitivityProfiles).where(eq(sensitivityProfiles.id, id));
    const row = firstRow(rows, 'the profile');
    const { eventTypeId, view, playerId } = row;
    return { reference: { sensitivityProfileId: id }, row, scope: { eventTypeId, view, playerId } };
  }
  const id = subject.trendId;
  const rows = await db.select().from(generalTrends).where(eq(generalTrends.id, id));
  const row = firstRow(rows, 'the trend');
  const { eventTypeId, view } = row;
  return { reference: { generalTrendId: id }, row, scope: { eventTypeId, view } };
}

/** What the engine computes for a stored subject from its cases, or those of `caseIds`, with its row. */
async function subjectValues(
  db: Database,
  subject: CalculationSubject,
  scope: Readonly<{ caseIds?: readonly number[]; params: EngineParams }>,
) {
  const { reference, row, scope: of } = await subjectOf(db, subject);
  const { params } = scope;
  const { counted } = await casesOf(db, { ...of, ...scope });
  const values =
    'playerId' in of ? profileValues(counted, [], params) : trendValues(counted, [], params);
  return { reference, row, values };
}

/**
 * Writes the change of a stored profile's or trend's verdict or confidence, with its cause
 * and instant (SEN-37, CL-SEN-17): from the values that the engine computes from its cases
 * with the parameters `paramsBefore` to those it records, which the engine computed from
 * them; throws when they do not differ, a bug of the caller.
 */
export async function insertVerdictChange(
  db: Database,
  change: Readonly<{
    subject: CalculationSubject;
    paramsBefore: EngineParams;
    cause: VerdictHistoryEntryRow['cause'];
    changedAt: EpochMs;
  }>,
): Promise<VerdictHistoryEntryRow> {
  const params = change.paramsBefore;
  const { reference, row, values } = await subjectValues(db, change.subject, { params });
  const { verdict, profileConfidence } = values;
  if (
    verdict.level === row.verdictLevel &&
    verdict.direction === row.verdictDirection &&
    profileConfidence === row.profileConfidence
  ) {
    throw new Error('Expected a change of verdict or confidence, found none.');
  }
  const rows = await db
    .insert(verdictHistoryEntries)
    .values({
      ...reference,
      changedAt: new Date(change.changedAt),
      oldVerdictLevel: verdict.level,
      oldVerdictDirection: verdict.direction,
      oldProfileConfidence: profileConfidence,
      newVerdictLevel: row.verdictLevel,
      newVerdictDirection: row.verdictDirection,
      newProfileConfidence: row.profileConfidence,
      cause: change.cause,
    })
    .returning();
  return firstRow(rows, 'the verdict change written');
}

/**
 * Writes a version of a stored historical-only profile's or trend's values, effective at
 * `effectiveAt`, as the engine computes them from its cases, or those of `caseIds`, with the
 * case threshold of the calculation for a profile (SUI-08, SUI-09, SEN-31, CL-SEN-19).
 */
export async function insertValueVersion(
  db: Database,
  version: Readonly<{
    subject: CalculationSubject;
    effectiveAt: EpochMs;
    caseIds?: readonly number[];
    params?: EngineParams;
  }>,
): Promise<ProfileValueVersionRow> {
  const params = version.params ?? DEFAULT_PARAMS;
  const { reference, values } = await subjectValues(db, version.subject, { ...version, params });
  // A profile's version keeps the case threshold of its calculation, a trend's none.
  const threshold = 'profileId' in version.subject ? params.sensitivity.minValidCases : null;
  const rows = await db
    .insert(profileValueVersions)
    .values({
      ...reference,
      effectiveAt: new Date(version.effectiveAt),
      validCount: values.tally.validCount,
      meanGap: values.quantities?.meanGap ?? null,
      verdictLevel: values.verdict.level,
      verdictDirection: values.verdict.direction,
      profileConfidence: values.profileConfidence,
      validCaseThreshold: threshold,
    })
    .returning();
  return firstRow(rows, 'the value version written');
}
