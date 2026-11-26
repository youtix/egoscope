// The rows of profiles and general trends as the profile store writes and compares them
// (sensitivity-and-profiles.md sections 1.1, 1.2 and 1.5): one row per view, its values as
// the engine gives them, and the instant a replacing value version takes effect. Pure:
// profile-store.ts reads and writes the database.
import { toEpochMs } from '@/lib/time';

import { verdictOf as verdictOfLevel } from './calculation-values';

import type { SensitivityProfileRow, VerdictHistoryEntryRow } from './types';
import type { generalTrends, sensitivityProfiles } from '@/lib/db';
import type {
  ConfidenceStepDownReason,
  EvaluatedTrend,
  EventTypeId,
  PlayerId,
  ProfileView,
  ProfileViewValues,
  VerdictAndConfidence,
} from '@/lib/stats-engine';
import type { EpochMs } from '@/lib/time';

/** The cause of a recalculation and of each change it records (SEN-37, CL-SEN-17). */
export type VerdictChangeCause = VerdictHistoryEntryRow['cause'];

/**
 * A tracked case, as the replacement of the value versions dates it (CL-SEN-18, CL-SUI-03):
 * its player and type, its creation, and the scheduled start of its measured game, else of
 * its expected game while no measured game is established, null while no game is known.
 */
export type TrackedCaseTiming = Readonly<{
  playerId: PlayerId;
  eventTypeId: EventTypeId;
  createdAt: EpochMs;
  gameStartAt: EpochMs | null;
}>;

/**
 * How a job keeps the value versions of the historical-only view (CL-SEN-18,
 * sensitivity-and-profiles.md section 1.5): a version appended at each change, or, for the
 * full job that follows a withdrawal, a player-data deletion or a restore's re-application
 * of the withdrawal ledger, every version replaced by one, dated from the tracked cases.
 */
export type VersionWrite =
  | Readonly<{ kind: 'append' }>
  | Readonly<{ kind: 'replace'; trackedCases: readonly TrackedCaseTiming[] }>;

/**
 * Whose tracked cases date the version that replaces a profile's or a trend's others
 * (CL-SEN-18): the pair's for a profile, the type's, every player's, for a trend (`playerId`
 * null).
 */
export type CaseScope = Readonly<{ playerId: PlayerId | null; eventTypeId: EventTypeId }>;

/** What each write of a job carries (SEN-36, SEN-37, CL-SEN-16, CL-SEN-17). */
export type JobWrite = Readonly<{
  /** The job's instant: the computation date, and that of its history entries and versions. */
  computedAt: EpochMs;
  /** The calculation parameters in force, as `params.snapshotCalculationParams()` gives them. */
  parameterSnapshotId: number;
  /** The cause of a change of the type's profile or trend, resolved by the job. */
  causeOf: (eventTypeId: EventTypeId) => VerdictChangeCause;
  versions: VersionWrite;
}>;

type CalculationView = ProfileViewValues | EvaluatedTrend['views'][number];
type ProfileStepDownReason = Exclude<ConfidenceStepDownReason, 'dominant_player'>;
/** The columns of one view that a profile and a trend share, as the store writes them. */
export type CalculationRow = Omit<
  SensitivityProfileRow,
  'id' | 'playerId' | 'eventTypeId' | 'confidenceStepDownReasons'
>;
/** A profile or a trend as the database holds it. */
export type StoredRow = typeof sensitivityProfiles.$inferSelect | typeof generalTrends.$inferSelect;

/** The views in the glossary's order, every one written at each calculation (CL-SEN-19). */
export const VIEWS: readonly ProfileView[] = ['all_cases', 'historical_only', 'tracked_only'];
// What a stored row holds besides its values: they change at each calculation.
const NOT_VALUES = new Set(['computedAt', 'parameterSnapshotId']);
// The quantities of a view without a valid case, or of a control without a gap (CL-SEN-15).
const NO_QUANTITIES = {
  meanGap: null,
  gapDispersion: null,
  retainedDispersion: null,
  expectedNoise: null,
  signalToNoise: null,
  rangeLow: null,
  rangeHigh: null,
} as const;

/**
 * The item of `items` in `view` (CL-SEN-16, CL-SEN-19): a profile or a trend is written
 * whole, in its three views, and a missing view is a bug of the caller, thrown.
 */
export function viewOf<T extends Readonly<{ view: ProfileView }>>(
  items: readonly T[],
  view: ProfileView,
): T {
  const item = items.find((candidate) => candidate.view === view);
  if (item === undefined) {
    throw new Error(`A profile or a trend is written whole, and the view ${view} is missing.`);
  }
  return item;
}

/**
 * A profile's reasons for a lower confidence (SEN-25, SEN-29): a dominant player is a
 * general trend's alone, and one on a profile is a bug of the caller, thrown.
 */
export function profileReasons(
  reasons: readonly ConfidenceStepDownReason[],
): ProfileStepDownReason[] {
  if (reasons.includes('dominant_player')) {
    throw new Error('A profile has no dominant player: only a general trend does.');
  }
  return reasons.filter((reason) => reason !== 'dominant_player');
}

/**
 * The columns of one view of a profile or a trend, from its tally to its computation, each
 * value as the engine gives it, recomputed from none (SEN-20 to SEN-27, SEN-36, SEN-38): the
 * names of the tally and of the quantities are those of their columns; the control range is
 * that of the control mean gap, null with it.
 */
export function calculationValues(view: CalculationView, write: JobWrite): CalculationRow {
  const { verdict, controlVerdict } = view;
  const control = view.controlQuantities ?? NO_QUANTITIES;
  return {
    view: view.view,
    ...view.tally,
    historicalValidCount: view.historicalValidCount,
    trackedValidCount: view.trackedValidCount,
    ...(view.quantities ?? NO_QUANTITIES),
    aboveZeroCount: view.aboveZeroCount,
    belowZeroCount: view.belowZeroCount,
    verdictLevel: verdict.level,
    verdictDirection: verdict.direction,
    isFragile: view.isFragile,
    profileConfidence: view.profileConfidence,
    controlCaseCount: view.controlCaseCount,
    controlMeanGap: control.meanGap,
    controlRangeLow: control.rangeLow,
    controlRangeHigh: control.rangeHigh,
    controlVerdictLevel: controlVerdict.level,
    controlVerdictDirection: controlVerdict.direction,
    dependsOnManualExclusions: view.dependsOnManualExclusions,
    validCaseThreshold: view.validCaseThreshold,
    parameterSnapshotId: write.parameterSnapshotId,
    computedAt: new Date(write.computedAt),
  };
}

/** `value` with the keys of every object in code-unit order, as JSON compares it. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => canonical(item));
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const entries = Object.entries(value).toSorted(([left], [right]) => (left < right ? -1 : 1));
  return Object.fromEntries(entries.map(([key, item]) => [key, canonical(item)]));
}

/**
 * Whether `stored` holds the values of `written` (SEN-36, CL-SEN-16): each of its keys but
 * those of the computation, its date and parameter snapshot, compared exactly, whatever the
 * order of the keys of an object, which a `jsonb` column does not keep.
 */
export function hasSameValues(stored: object, written: object): boolean {
  const keys = new Set(Object.keys(written).filter((key) => !NOT_VALUES.has(key)));
  const valuesOf = (row: object) => {
    const values = Object.entries(row).filter(([key]) => keys.has(key));
    return JSON.stringify(canonical(Object.fromEntries(values)));
  };
  return valuesOf(stored) === valuesOf(written);
}

/** The verdict and the profile confidence that a row holds, as the verdict history follows them (SEN-23 to SEN-25, SEN-37). */
export function verdictOf(
  row: Readonly<Pick<StoredRow, 'verdictLevel' | 'verdictDirection' | 'profileConfidence'>>,
): VerdictAndConfidence {
  const verdict = verdictOfLevel(row.verdictLevel, row.verdictDirection);
  return { verdict, profileConfidence: row.profileConfidence };
}

/**
 * The instant a value version of the profile or trend of `scope` takes effect (CL-SEN-16,
 * CL-SEN-18, CL-SUI-03): an appended one at the job's instant; the single one that replaces
 * all the others at the creation of the earliest tracked case of the pair (of the type, for a
 * trend) whose game has not started at the job's instant, or has none known, else at the
 * job's instant.
 */
export function versionInstant(scope: CaseScope, write: JobWrite): EpochMs {
  const { versions, computedAt } = write;
  if (versions.kind === 'append') {
    return computedAt;
  }
  const waiting = versions.trackedCases.filter(
    (tracked) =>
      tracked.eventTypeId === scope.eventTypeId &&
      (scope.playerId === null || tracked.playerId === scope.playerId) &&
      (tracked.gameStartAt === null || computedAt < tracked.gameStartAt),
  );
  return toEpochMs(Math.min(computedAt, ...waiting.map(({ createdAt }) => createdAt)));
}
