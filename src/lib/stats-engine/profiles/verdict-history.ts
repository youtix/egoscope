// The verdict history (SEN-37, CL-SEN-17): which recalculations of a profile or a general
// trend change what it records, the verdict's level and direction and the profile
// confidence, and which cause a statistics update gives such a change. The caller dates
// each change, names its profile or trend and records the default view only (CL-SEN-19).

import { isSameVerdict } from './robustness';

import type { ProfileConfidence } from './confidence';
import type { Verdict } from './verdict';

/** What the verdict history follows of a profile or a general trend (SEN-37). */
export type VerdictAndConfidence = Readonly<{
  verdict: Verdict;
  profileConfidence: ProfileConfidence;
}>;

/** A change of verdict level, direction or profile confidence, with its old and new values (SEN-37). */
export type VerdictChange = Readonly<{
  oldVerdict: Verdict;
  oldProfileConfidence: ProfileConfidence;
  newVerdict: Verdict;
  newProfileConfidence: ProfileConfidence;
}>;

/**
 * The causes a statistics update gives a change (CL-SEN-17), from the glossary's
 * `VerdictChangeCause`: a statistics correction, new cases or a baseline updated.
 */
export type StatisticsUpdateCause = 'stats_correction' | 'new_cases' | 'baseline_updated';

/** What a statistics update did to one profile or one general trend (CL-SEN-17). */
export type StatisticsUpdateEffects = Readonly<{
  /** A stored statistic that it uses changed value (STA-33, STA-34). */
  usedStatisticChanged: boolean;
  /** One of its cases left the awaiting-game state. */
  caseLeftAwaitingGame: boolean;
  /** A calendar-derived event joined it (ADR 0015). */
  calendarDerivedEventAdded: boolean;
}>;

/**
 * Gives the verdict-history entry of a recalculation of a profile or a general trend
 * (SEN-37): its old and new values when its verdict's level, its direction or its profile
 * confidence changed, and null when none did, whatever else changed, such as its mean gap,
 * its fragility or its reasons for a lower confidence. Without earlier values, a first
 * calculation changes nothing.
 */
export function verdictChanges(
  before: VerdictAndConfidence | null,
  after: VerdictAndConfidence,
): VerdictChange | null {
  if (
    before === null ||
    (isSameVerdict(before.verdict, after.verdict) &&
      before.profileConfidence === after.profileConfidence)
  ) {
    return null;
  }
  return {
    oldVerdict: before.verdict,
    oldProfileConfidence: before.profileConfidence,
    newVerdict: after.verdict,
    newProfileConfidence: after.profileConfidence,
  };
}

/**
 * Picks the cause that a statistics update gives a change of a profile or a general trend
 * (SEN-37, CL-SEN-17, CA-SEN-21): "statistics correction" when a stored statistic that it
 * uses changed value; otherwise "new cases" when one of its cases left the awaiting-game
 * state or a calendar-derived event joined it; otherwise "baseline updated", as when a new
 * game moves a provisional baseline or a phase ends.
 */
export function statisticsUpdateCause(effects: StatisticsUpdateEffects): StatisticsUpdateCause {
  if (effects.usedStatisticChanged) {
    return 'stats_correction';
  }
  return effects.caseLeftAwaitingGame || effects.calendarDerivedEventAdded
    ? 'new_cases'
    : 'baseline_updated';
}
