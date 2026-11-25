// The tally of a profile (SEN-20, SEN-32, SEN-33, SEN-43): how many events and cases
// it counts, by status and reason, and how many events left it, by reason. Its input
// is the profile's own view of a case, ProfileCase, which holds only what the profiles
// part reads. The cases on an earlier sheet version are not counted here: the
// sensitivity module derives them on read (CL-TAX-07).

import { AWAITING_GAME_REASONS, NOT_MEASURABLE_REASONS, valuesOf } from '../cases/case-state';

import type { CaseId, EpochMs } from '../types';

/** A list that holds at least one item. */
type NonEmpty<T> = readonly [T, ...T[]];

// The criteria and exit reasons of the glossary, in its order, which is the order of the
// counts the tally gives, as the reasons of a case are (case-state.ts).
const DOUBTFUL_CASE_CRITERIA = valuesOf([
  'playing_time_too_low',
  'injury_return',
  'unusual_stakes',
  'opponent_strength',
  'co_occurring',
  'manual',
]);
const TALLY_EXIT_REASONS = valuesOf([
  'dismissed',
  'merged',
  'deleted',
  'replaced_at_import',
  'erased',
  'no_longer_derived',
]);

type AwaitingGameReason = (typeof AWAITING_GAME_REASONS)[number];
type NotMeasurableReason = (typeof NOT_MEASURABLE_REASONS)[number];
type DoubtfulCaseCriterion = (typeof DOUBTFUL_CASE_CRITERIA)[number];

/**
 * Why an event left a profile's tally (SEN-33, CL-SEN-25). A withdrawal is none of
 * them: it leaves no trace per player or per type, only the global counter (DSN-29).
 */
export type TallyExitReason = (typeof TALLY_EXIT_REASONS)[number];

/** One event of a case: a historical event's research confidence, null for the others. */
type ProfileCaseEvent = Readonly<{ researchConfidence: 'high' | 'medium' | 'low' | null }>;

/** A case whose gap is computed, which only a measured or an excluded case has (SEN-10). */
type GapOutcome = Readonly<{
  /** The measured game's scheduled start, the first key of the order of sums (CL-STA-09). */
  measuredGameScheduledStartAt: EpochMs;
  normalizedGap: number;
  gapStatus: 'provisional' | 'final';
}>;

type CaseOutcome =
  | Readonly<{ status: 'awaiting_game'; statusReason: AwaitingGameReason }>
  | Readonly<{ status: 'not_measurable'; statusReason: NotMeasurableReason }>
  | (GapOutcome & Readonly<{ status: 'measured' }>)
  | (GapOutcome &
      Readonly<{ status: 'excluded'; triggeredCriteria: NonEmpty<DoubtfulCaseCriterion> }>);

/**
 * A case as a profile counts it (SEN-07, SEN-20): its status with its reason, or its
 * triggered criteria when excluded, `manual` for a manual exclusion; its gap when
 * measured or excluded; whether it is co-occurring (SEN-06); and its events that
 * count, at least one. A dismissed event leaves the tally (SEN-48) and a case none of
 * whose events counts is no case of the profile (CL-VUE-03): such events are exits.
 */
export type ProfileCase = Readonly<{
  /** The second key of the order of sums (CL-STA-09). */
  caseId: CaseId;
  events: NonEmpty<ProfileCaseEvent>;
  isCoOccurring: boolean;
}> &
  CaseOutcome;

/** How many cases or events have each value, in the glossary's order, zeros left out. */
type Counts<K extends string> = Readonly<Partial<Record<K, number>>>;

/**
 * The tally of a profile (SEN-20, SEN-32): events, cases and events grouped into an
 * existing case; cases by status, excluded ones by hand among them; co-occurring cases
 * and cases whose gap is provisional; valid cases resting on an event of low research
 * confidence (SEN-43); the awaiting and not-measurable cases by reason and the
 * excluded ones by criterion, a case counting once under each of its criteria; and the
 * events that left the tally, by reason (SEN-33).
 */
export type ProfileTally = Readonly<{
  eventCount: number;
  caseCount: number;
  groupedEventCount: number;
  awaitingCount: number;
  validCount: number;
  excludedCount: number;
  manuallyExcludedCount: number;
  notMeasurableCount: number;
  coOccurringCount: number;
  provisionalGapCount: number;
  lowResearchConfidenceCount: number;
  tallyReasons: Readonly<{
    awaitingGame: Counts<AwaitingGameReason>;
    notMeasurable: Counts<NotMeasurableReason>;
    excluded: Counts<DoubtfulCaseCriterion>;
  }>;
  exitCounts: Counts<TallyExitReason>;
}>;

/** How often each of `values`, in their order, occurs in `occurring`, zeros left out. */
function countEach<K extends string>(values: readonly K[], occurring: readonly K[]): Counts<K> {
  const counts: Partial<Record<K, number>> = {};
  for (const value of values) {
    const count = occurring.filter((item) => item === value).length;
    if (count > 0) {
      counts[value] = count;
    }
  }
  return counts;
}

/** Says whether the case rests on an event of low research confidence (SEN-43). */
function hasLowResearchConfidenceEvent(caseItem: ProfileCase): boolean {
  return caseItem.events.some((playerEvent) => playerEvent.researchConfidence === 'low');
}

/**
 * Tallies a profile from its cases and the reasons of the events that left it, one
 * per event (SEN-20, SEN-32, SEN-33). Every event of a case counts, and those beyond
 * the first are grouped into it (SEN-05), so the tally always holds: events = cases +
 * grouped events, and cases = awaiting + valid + excluded + not measurable. A valid
 * case rests on a low research confidence when one of its events has it, which only a
 * historical event can: a calendar-derived case never counts there (SEN-43, CL-SEN-03).
 */
export function tallyProfile(
  cases: readonly ProfileCase[],
  exitReasons: readonly TallyExitReason[],
): ProfileTally {
  const awaiting = cases.filter((caseItem) => caseItem.status === 'awaiting_game');
  const valid = cases.filter((caseItem) => caseItem.status === 'measured');
  const excluded = cases.filter((caseItem) => caseItem.status === 'excluded');
  const notMeasurable = cases.filter((caseItem) => caseItem.status === 'not_measurable');
  const eventCount = cases.reduce((total, caseItem) => total + caseItem.events.length, 0);
  return {
    eventCount,
    caseCount: cases.length,
    groupedEventCount: eventCount - cases.length,
    awaitingCount: awaiting.length,
    validCount: valid.length,
    excludedCount: excluded.length,
    manuallyExcludedCount: excluded.filter((caseItem) =>
      caseItem.triggeredCriteria.includes('manual'),
    ).length,
    notMeasurableCount: notMeasurable.length,
    coOccurringCount: cases.filter((caseItem) => caseItem.isCoOccurring).length,
    provisionalGapCount: [...valid, ...excluded].filter(
      (caseItem) => caseItem.gapStatus === 'provisional',
    ).length,
    lowResearchConfidenceCount: valid.filter((caseItem) => hasLowResearchConfidenceEvent(caseItem))
      .length,
    tallyReasons: {
      awaitingGame: countEach(
        AWAITING_GAME_REASONS,
        awaiting.map((caseItem) => caseItem.statusReason),
      ),
      notMeasurable: countEach(
        NOT_MEASURABLE_REASONS,
        notMeasurable.map((caseItem) => caseItem.statusReason),
      ),
      excluded: countEach(
        DOUBTFUL_CASE_CRITERIA,
        excluded.flatMap((caseItem) => [...new Set(caseItem.triggeredCriteria)]),
      ),
    },
    exitCounts: countEach(TALLY_EXIT_REASONS, exitReasons),
  };
}
