// The stored values of a profile or a general trend as the screens read them, with what
// is derived from them on read and never stored: the presentation notices, the warnings
// and the cases without which a fragile verdict changes (sensitivity-and-profiles.md
// sections 2.2 and 4).
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { cases, caseTriggeredCriteria, games, tallyExits } from '@/lib/db';
import { runRobustnessTest } from '@/lib/stats-engine';
import { toEpochMs } from '@/lib/time';

import { snapshotParams } from './engine-params';

import type { GeneralTrendRow, SensitivityProfileRow } from './types';
import type { Database, eventTypes, Transaction } from '@/lib/db';
import type {
  CaseId,
  CaseOrigin,
  ConfidenceStepDownReason,
  ProfileCase,
  ProfileConfidence,
  ProfileView,
  TallyExitReason,
  Verdict,
  VerdictDirection,
  VerdictLevel,
} from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

type Reader = Database | Transaction;

/** How many cases or events have each value, values that none has left out. */
export type CountsBy<K extends string> = Readonly<Partial<Record<K, number>>>;

/** A reason of a case awaiting its game or not measurable (SEN-07, CL-SEN-05). */
export type CaseStatusReason = (typeof cases.statusReason.enumValues)[number];

/** A doubtful-case criterion, `manual` for a manual exclusion (SEN-11 to SEN-17). */
export type DoubtfulCaseCriterion = (typeof caseTriggeredCriteria.criterion.enumValues)[number];

/** The criterion that a type sheet can switch off (ADR 0016, CL-SEN-13). */
export type SwitchableCriterion = NonNullable<
  (typeof eventTypes.$inferSelect)['switchedOffCriterion']
>;

/**
 * The reasons of a tally (SEN-20): its cases awaiting their game by reason, its cases not
 * measurable by reason, and its excluded cases by criterion, a case counting once under
 * each of its criteria.
 */
export type TallyReasons = Readonly<{
  awaitingGame: CountsBy<CaseStatusReason>;
  notMeasurable: CountsBy<CaseStatusReason>;
  excluded: CountsBy<DoubtfulCaseCriterion>;
}>;

/**
 * The stored values of one view of a profile or a trend (SEN-20 to SEN-27, SEN-38,
 * SEN-43): its tally, with the valid cases of each origin and those above and below zero;
 * the reasons of its tally and its exits by reason (SEN-33); its gap quantities, each
 * null below the cases it needs (CL-SEN-15); its verdict, fragility and profile
 * confidence with the reason of each step down; its control, the mean gap of its valid
 * and excluded cases with their count, plausible range and verdict (SEN-27, SEN-38); the
 * dependence on manual exclusions; the valid-case threshold that the calculation
 * applied; and the instant of the calculation.
 */
export type CalculationValues = Readonly<{
  view: ProfileView;
  tally: Readonly<
    Record<
      | 'eventCount'
      | 'caseCount'
      | 'groupedEventCount'
      | 'awaitingCount'
      | 'validCount'
      | 'excludedCount'
      | 'manuallyExcludedCount'
      | 'notMeasurableCount'
      | 'coOccurringCount'
      | 'provisionalGapCount'
      | 'historicalValidCount'
      | 'trackedValidCount'
      | 'lowResearchConfidenceCount'
      | 'aboveZeroCount'
      | 'belowZeroCount',
      number
    >
  >;
  reasons: TallyReasons;
  exits: CountsBy<TallyExitReason>;
  gaps: Readonly<
    Record<
      | 'meanGap'
      | 'gapDispersion'
      | 'retainedDispersion'
      | 'expectedNoise'
      | 'signalToNoise'
      | 'rangeLow'
      | 'rangeHigh',
      number | null
    >
  >;
  verdict: Verdict;
  isFragile: boolean;
  profileConfidence: ProfileConfidence;
  confidenceStepDownReasons: readonly ConfidenceStepDownReason[];
  control: Readonly<{
    caseCount: number;
    meanGap: number | null;
    rangeLow: number | null;
    rangeHigh: number | null;
    verdict: Verdict;
  }>;
  dependsOnManualExclusions: boolean;
  validCaseThreshold: number;
  computedAt: EpochMs;
}>;

/**
 * A presentation state of a profile or a trend, the glossary's `ProfileNotice` (SEN-19,
 * SEN-31, SEN-36): below the valid-case threshold, archived, recalculating, or awaiting
 * statistics, when every case waits for statistics or for the player's mapping.
 */
export type ProfileNotice =
  'below_threshold' | 'archived' | 'recalculating' | 'awaiting_statistics';

/**
 * A warning of a profile or a trend, which never changes a verdict (SEN-46, ADR 0016,
 * CL-SEN-13, CL-STA-24, CL-JOU-16, CL-JOU-18): the criterion switched off for the type;
 * "all cases are excluded for unusual stakes"; on a birthday profile, "birthday not
 * recorded" or the season from which birthday games are counted; on a former-team
 * profile, the season with which the team history starts.
 */
export type ProfileWarning =
  | Readonly<{ kind: 'confounder_not_separable'; criterion: SwitchableCriterion }>
  | Readonly<{ kind: 'all_excluded_for_unusual_stakes' }>
  | Readonly<{ kind: 'birthday_not_recorded' }>
  | Readonly<{ kind: 'birthday_counted_from'; season: string }>
  | Readonly<{ kind: 'team_history_from'; season: string }>;

const COUNT = z.number().int().nonnegative();
const REASON_COUNTS = z.partialRecord(z.enum(cases.statusReason.enumValues), COUNT);
const TALLY_REASONS = z.object({
  awaitingGame: REASON_COUNTS,
  notMeasurable: REASON_COUNTS,
  excluded: z.partialRecord(z.enum(caseTriggeredCriteria.criterion.enumValues), COUNT),
});
// A dismissal is counted from the events, the other exits from their rows (SEN-33).
const EXIT_COUNTS = z.partialRecord(
  z.enum([...tallyExits.exitReason.enumValues, 'dismissed'] as const),
  COUNT,
);
// The awaiting reasons that make a profile wait for statistics (12, « Cas limites »).
const STATISTICS_REASONS = ['statistics_pending', 'mapping_not_established'] as const;
const INCONCLUSIVE: Verdict = { level: 'inconclusive', direction: null };

/** The origin of the cases of a view, none for the default one, which counts both (SEN-21, CL-SEN-19). */
export function originOfView(view: ProfileView): CaseOrigin | null {
  if (view === 'historical_only') {
    return 'historical';
  }
  return view === 'tracked_only' ? 'tracked' : null;
}

/** The verdict that a stored level and direction make, a direction exactly when the level is not inconclusive (SEN-24). */
export function verdictOf(level: VerdictLevel, direction: VerdictDirection | null): Verdict {
  return level === 'inconclusive' || direction === null ? INCONCLUSIVE : { level, direction };
}

/** The values of a stored profile or trend row (SEN-20 to SEN-27, SEN-33, SEN-38). */
export function calculationValues(row: SensitivityProfileRow | GeneralTrendRow): CalculationValues {
  return {
    view: row.view,
    tally: {
      eventCount: row.eventCount,
      caseCount: row.caseCount,
      groupedEventCount: row.groupedEventCount,
      awaitingCount: row.awaitingCount,
      validCount: row.validCount,
      excludedCount: row.excludedCount,
      manuallyExcludedCount: row.manuallyExcludedCount,
      notMeasurableCount: row.notMeasurableCount,
      coOccurringCount: row.coOccurringCount,
      provisionalGapCount: row.provisionalGapCount,
      historicalValidCount: row.historicalValidCount,
      trackedValidCount: row.trackedValidCount,
      lowResearchConfidenceCount: row.lowResearchConfidenceCount,
      aboveZeroCount: row.aboveZeroCount,
      belowZeroCount: row.belowZeroCount,
    },
    reasons: TALLY_REASONS.parse(row.tallyReasons),
    exits: EXIT_COUNTS.parse(row.exitCounts),
    gaps: {
      meanGap: row.meanGap,
      gapDispersion: row.gapDispersion,
      retainedDispersion: row.retainedDispersion,
      expectedNoise: row.expectedNoise,
      signalToNoise: row.signalToNoise,
      rangeLow: row.rangeLow,
      rangeHigh: row.rangeHigh,
    },
    verdict: verdictOf(row.verdictLevel, row.verdictDirection),
    isFragile: row.isFragile,
    profileConfidence: row.profileConfidence,
    confidenceStepDownReasons: row.confidenceStepDownReasons,
    control: {
      caseCount: row.controlCaseCount,
      meanGap: row.controlMeanGap,
      rangeLow: row.controlRangeLow,
      rangeHigh: row.controlRangeHigh,
      verdict: verdictOf(row.controlVerdictLevel, row.controlVerdictDirection),
    },
    dependsOnManualExclusions: row.dependsOnManualExclusions,
    validCaseThreshold: row.validCaseThreshold,
    computedAt: toEpochMs(row.computedAt.getTime()),
  };
}

/** Whether every case of the values waits for statistics or for the mapping (12, « Cas limites »). */
function isAwaitingStatistics({ tally, reasons }: CalculationValues): boolean {
  const waiting = STATISTICS_REASONS.reduce(
    (total, reason) => total + (reasons.awaitingGame[reason] ?? 0),
    0,
  );
  return tally.caseCount > 0 && waiting === tally.caseCount;
}

/**
 * The notices of a profile or a trend, in the glossary's order (SEN-19, SEN-31, SEN-36,
 * CL-SEN-16): below the threshold its calculation applied, archived when its player or
 * type is withdrawn, recalculating while a job covers it, awaiting statistics.
 */
export function noticesOf(
  values: CalculationValues,
  state: Readonly<{ isArchived: boolean; isRecalculating: boolean }>,
): readonly ProfileNotice[] {
  const holding: readonly (readonly [ProfileNotice, boolean])[] = [
    ['below_threshold', values.tally.validCount < values.validCaseThreshold],
    ['archived', state.isArchived],
    ['recalculating', state.isRecalculating],
    ['awaiting_statistics', isAwaitingStatistics(values)],
  ];
  return holding.filter(([, holds]) => holds).map(([notice]) => notice);
}

/**
 * The warning of a criterion switched off for the type, on its every profile and its
 * trend (ADR 0016, CL-SEN-13); none while no criterion is switched off.
 */
export function switchWarnings(criterion: SwitchableCriterion | null): readonly ProfileWarning[] {
  return criterion === null ? [] : [{ kind: 'confounder_not_separable', criterion }];
}

/**
 * Whether a profile shows "all cases are excluded for unusual stakes" (CL-SEN-13): an
 * excluded case at least, no valid case, unusual stakes among the criteria of every
 * excluded case, and that criterion not switched off for the type.
 */
export function isAllExcludedForUnusualStakes(
  { tally, reasons }: CalculationValues,
  criterion: SwitchableCriterion | null,
): boolean {
  return (
    tally.excludedCount > 0 &&
    tally.validCount === 0 &&
    reasons.excluded.unusual_stakes === tally.excludedCount &&
    criterion !== 'unusual_stakes'
  );
}

/** The valid cases of a profile (a player and a type) or of a trend (a type) in a view, as the robustness test reads them. */
async function validCasesOf(
  db: Reader,
  subject: Readonly<{ playerId: string | null; eventTypeId: string; view: ProfileView }>,
): Promise<ProfileCase[]> {
  type GapStatus = NonNullable<(typeof cases.$inferSelect)['gapStatus']>;
  const origin = originOfView(subject.view);
  // A measured case always has its gap and its gap status (cases_measurement_check).
  const rows = await db
    .select({
      caseId: cases.id,
      normalizedGap: sql<number>`${cases.normalizedGap}`,
      gapStatus: sql<GapStatus>`${cases.gapStatus}`,
      startsAt: games.scheduledStartAt,
    })
    .from(cases)
    .innerJoin(games, eq(games.id, cases.measuredGameId))
    .where(
      and(
        eq(cases.eventTypeId, subject.eventTypeId),
        eq(cases.status, 'measured'),
        subject.playerId === null ? undefined : eq(cases.playerId, subject.playerId),
        origin === null ? undefined : eq(cases.origin, origin),
      ),
    );
  // The test reads only each case's gap and place in the fixed order (CL-STA-09).
  return rows.map(({ caseId, normalizedGap, gapStatus, startsAt }) => ({
    caseId,
    status: 'measured',
    normalizedGap,
    gapStatus,
    measuredGameScheduledStartAt: toEpochMs(startsAt.getTime()),
    events: [{ researchConfidence: null }],
    isCoOccurring: false,
  }));
}

/**
 * The cases without which a fragile verdict changes, derived on read and never stored
 * (SEN-26, coordinator decision): the robustness test run on the stored gaps of the valid
 * cases of the view, in the fixed order of CL-STA-09, with the parameter values of the
 * row's snapshot, gives the case set aside by each recomputation whose verdict differs
 * from the stored one. None for a verdict that is not fragile, nor when no recomputation
 * differs any more, as while a recalculation is pending.
 */
export async function casesWithoutWhichVerdictChanges(
  db: Reader,
  subject: Readonly<{ playerId: string | null; eventTypeId: string }>,
  stored: Readonly<{ values: CalculationValues; snapshotValues: unknown }>,
): Promise<readonly CaseId[]> {
  const { values } = stored;
  if (!values.isFragile) {
    return [];
  }
  const validCases = await validCasesOf(db, { ...subject, view: values.view });
  const { trials } = runRobustnessTest(
    validCases,
    values.verdict,
    snapshotParams(stored.snapshotValues),
  );
  return trials
    .filter(
      ({ verdict }) =>
        verdict.level !== values.verdict.level || verdict.direction !== values.verdict.direction,
    )
    .map(({ removedCaseId }) => removedCaseId);
}
