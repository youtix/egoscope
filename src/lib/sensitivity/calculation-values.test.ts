import { describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import {
  isAllExcludedForUnusualStakes,
  noticesOf,
  originOfView,
  switchWarnings,
  verdictOf,
} from './calculation-values';

import type { CalculationValues } from './calculation-values';

const NO_COUNT = {
  eventCount: 0,
  caseCount: 0,
  groupedEventCount: 0,
  awaitingCount: 0,
  validCount: 0,
  excludedCount: 0,
  manuallyExcludedCount: 0,
  notMeasurableCount: 0,
  coOccurringCount: 0,
  provisionalGapCount: 0,
  historicalValidCount: 0,
  trackedValidCount: 0,
  lowResearchConfidenceCount: 0,
  aboveZeroCount: 0,
  belowZeroCount: 0,
};
const NO_GAP = {
  meanGap: null,
  gapDispersion: null,
  retainedDispersion: null,
  expectedNoise: null,
  signalToNoise: null,
  rangeLow: null,
  rangeHigh: null,
};
const INCONCLUSIVE = { level: 'inconclusive', direction: null } as const;

/** Counts by stored value, as a tally's reasons hold them. */
function countsOf(...counts: readonly (readonly [string, number])[]): Record<string, number> {
  return Object.fromEntries(counts);
}

/** The values of a calculation with the counts and reasons given, nothing else. */
function valuesOf(
  tally: Partial<typeof NO_COUNT>,
  reasons: Partial<CalculationValues['reasons']> = {},
): CalculationValues {
  return {
    view: 'all_cases',
    tally: { ...NO_COUNT, ...tally },
    reasons: { awaitingGame: {}, notMeasurable: {}, excluded: {}, ...reasons },
    exits: {},
    gaps: NO_GAP,
    verdict: INCONCLUSIVE,
    isFragile: false,
    profileConfidence: 'low',
    confidenceStepDownReasons: [],
    control: {
      caseCount: 0,
      meanGap: null,
      rangeLow: null,
      rangeHigh: null,
      verdict: INCONCLUSIVE,
    },
    dependsOnManualExclusions: false,
    validCaseThreshold: 5,
    computedAt: toEpochMs(0),
  };
}

describe('the values of a calculation', () => {
  it('[SEN-21] counts the cases of each origin in its view, both in the default one', () => {
    expect(originOfView('all_cases')).toBeNull();
    expect(originOfView('historical_only')).toBe('historical');
    expect(originOfView('tracked_only')).toBe('tracked');
  });

  it('[SEN-24] gives a direction to a possible or probable verdict only', () => {
    expect(verdictOf('possible', 'increase')).toStrictEqual({
      level: 'possible',
      direction: 'increase',
    });
    expect(verdictOf('probable', 'decrease')).toStrictEqual({
      level: 'probable',
      direction: 'decrease',
    });
    expect(verdictOf('inconclusive', null)).toStrictEqual(INCONCLUSIVE);
    expect(verdictOf('inconclusive', 'increase')).toStrictEqual(INCONCLUSIVE);
  });

  it('[SEN-24] gives the inconclusive verdict to a possible or probable level stored without a direction', () => {
    expect(verdictOf('possible', null)).toStrictEqual(INCONCLUSIVE);
    expect(verdictOf('probable', null)).toStrictEqual(INCONCLUSIVE);
  });

  it('[SEN-19] [CA-SEN-13] notes a profile below the threshold its calculation applied: 4 valid cases of 5', () => {
    expect(
      noticesOf(valuesOf({ caseCount: 4, validCount: 4 }), {
        isArchived: false,
        isRecalculating: false,
      }),
    ).toStrictEqual(['below_threshold']);
    expect(
      noticesOf(valuesOf({ caseCount: 5, validCount: 5 }), {
        isArchived: false,
        isRecalculating: false,
      }),
    ).toStrictEqual([]);
  });

  it('[SEN-19] [SEN-36] gives the notices in the glossary order: below threshold, archived, recalculating, awaiting statistics', () => {
    const waiting = valuesOf(
      { caseCount: 3, awaitingCount: 3 },
      { awaitingGame: countsOf(['statistics_pending', 2], ['mapping_not_established', 1]) },
    );

    expect(noticesOf(waiting, { isArchived: true, isRecalculating: true })).toStrictEqual([
      'below_threshold',
      'archived',
      'recalculating',
      'awaiting_statistics',
    ]);
  });

  it('[SEN-19] awaits statistics only while every case waits for them or for the mapping, and never without a case', () => {
    const state = { isArchived: false, isRecalculating: false };
    const oneOtherReason = valuesOf(
      { caseCount: 3, awaitingCount: 3 },
      { awaitingGame: countsOf(['statistics_pending', 2], ['game_not_played_yet', 1]) },
    );

    expect(noticesOf(oneOtherReason, state)).toStrictEqual(['below_threshold']);
    expect(noticesOf(valuesOf({}), state)).toStrictEqual(['below_threshold']);
  });

  it('[CL-SEN-13] warns of the criterion switched off for the type, and of none while none is', () => {
    expect(switchWarnings('injury_return')).toStrictEqual([
      { kind: 'confounder_not_separable', criterion: 'injury_return' },
    ]);
    expect(switchWarnings(null)).toStrictEqual([]);
  });

  it.each([
    {
      situation: 'every excluded case for unusual stakes, none valid',
      tally: { excludedCount: 2 },
      excluded: countsOf(['unusual_stakes', 2], ['injury_return', 1]),
      criterion: null,
      isWarned: true,
    },
    {
      situation: 'another criterion switched off',
      tally: { excludedCount: 2 },
      excluded: countsOf(['unusual_stakes', 2]),
      criterion: 'injury_return',
      isWarned: true,
    },
    {
      situation: 'unusual stakes switched off',
      tally: { excludedCount: 2 },
      excluded: countsOf(['unusual_stakes', 2]),
      criterion: 'unusual_stakes',
      isWarned: false,
    },
    {
      situation: 'a valid case left',
      tally: { excludedCount: 2, validCount: 1 },
      excluded: countsOf(['unusual_stakes', 2]),
      criterion: null,
      isWarned: false,
    },
    {
      situation: 'an excluded case for another criterion',
      tally: { excludedCount: 2 },
      excluded: countsOf(['unusual_stakes', 1], ['playing_time_too_low', 1]),
      criterion: null,
      isWarned: false,
    },
    { situation: 'no excluded case', tally: {}, excluded: {}, criterion: null, isWarned: false },
  ] as const)(
    '[CL-SEN-13] warns that all cases are excluded for unusual stakes: $situation',
    ({ tally, excluded, criterion, isWarned }) => {
      expect(isAllExcludedForUnusualStakes(valuesOf(tally, { excluded }), criterion)).toBe(
        isWarned,
      );
    },
  );
});
