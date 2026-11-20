import { describe, expect, it } from 'vitest';

import { statisticsUpdateCause, verdictChanges } from './verdict-history';

import type { StatisticsUpdateEffects, VerdictAndConfidence } from './verdict-history';

const INCONCLUSIVE = { level: 'inconclusive', direction: null } as const;
const POSSIBLE_INCREASE = { level: 'possible', direction: 'increase' } as const;
const POSSIBLE_DECREASE = { level: 'possible', direction: 'decrease' } as const;
const PROBABLE_INCREASE = { level: 'probable', direction: 'increase' } as const;

/** What the history follows of a profile or a trend, with a value that it does not follow. */
function values(
  verdict: VerdictAndConfidence['verdict'],
  profileConfidence: VerdictAndConfidence['profileConfidence'],
  meanGap = 0.5,
): VerdictAndConfidence & Readonly<{ meanGap: number }> {
  return { verdict, profileConfidence, meanGap };
}

/** What a statistics update did, each effect at `false` unless named. */
function effects(changes: Partial<StatisticsUpdateEffects>): StatisticsUpdateEffects {
  return {
    usedStatisticChanged: false,
    caseLeftAwaitingGame: false,
    calendarDerivedEventAdded: false,
    ...changes,
  };
}

describe('verdictChanges', () => {
  it('[SEN-37] gives the old and the new values when the verdict level changes', () => {
    expect(
      verdictChanges(values(INCONCLUSIVE, 'low'), values(POSSIBLE_INCREASE, 'low')),
    ).toStrictEqual({
      oldVerdict: INCONCLUSIVE,
      oldProfileConfidence: 'low',
      newVerdict: POSSIBLE_INCREASE,
      newProfileConfidence: 'low',
    });
    expect(
      verdictChanges(values(PROBABLE_INCREASE, 'high'), values(POSSIBLE_INCREASE, 'high')),
    ).toStrictEqual({
      oldVerdict: PROBABLE_INCREASE,
      oldProfileConfidence: 'high',
      newVerdict: POSSIBLE_INCREASE,
      newProfileConfidence: 'high',
    });
  });

  it('[SEN-37] [SEN-24] gives a change of direction alone', () => {
    expect(
      verdictChanges(values(POSSIBLE_INCREASE, 'medium'), values(POSSIBLE_DECREASE, 'medium')),
    ).toStrictEqual({
      oldVerdict: POSSIBLE_INCREASE,
      oldProfileConfidence: 'medium',
      newVerdict: POSSIBLE_DECREASE,
      newProfileConfidence: 'medium',
    });
  });

  it('[SEN-37] [SEN-25] gives a change of profile confidence alone', () => {
    expect(
      verdictChanges(values(POSSIBLE_INCREASE, 'low'), values(POSSIBLE_INCREASE, 'medium')),
    ).toStrictEqual({
      oldVerdict: POSSIBLE_INCREASE,
      oldProfileConfidence: 'low',
      newVerdict: POSSIBLE_INCREASE,
      newProfileConfidence: 'medium',
    });
  });

  it('[SEN-37] gives no change when the level, the direction and the profile confidence stay, whatever else moved', () => {
    expect(
      verdictChanges(values(POSSIBLE_INCREASE, 'low', 0.8), values(POSSIBLE_INCREASE, 'low', 0.6)),
    ).toBeNull();
    expect(verdictChanges(values(INCONCLUSIVE, 'high'), values(INCONCLUSIVE, 'high'))).toBeNull();
  });

  it('[SEN-37] gives no change for a first calculation, which has no earlier values', () => {
    expect(verdictChanges(null, values(PROBABLE_INCREASE, 'high'))).toBeNull();
  });
});

describe('statisticsUpdateCause', () => {
  it.each([
    ['alone', effects({ usedStatisticChanged: true })],
    [
      'with a case that left the awaiting-game state',
      effects({ usedStatisticChanged: true, caseLeftAwaitingGame: true }),
    ],
    [
      'with a calendar-derived event added',
      effects({ usedStatisticChanged: true, calendarDerivedEventAdded: true }),
    ],
  ] as const)(
    '[SEN-37] [CL-SEN-17] gives "statistics correction" when a statistic the profile uses changed value, %s',
    (_, update) => {
      expect(statisticsUpdateCause(update)).toBe('stats_correction');
    },
  );

  it.each([
    ['a case left the awaiting-game state', effects({ caseLeftAwaitingGame: true })],
    ['a calendar-derived event joined', effects({ calendarDerivedEventAdded: true })],
    ['both happened', effects({ caseLeftAwaitingGame: true, calendarDerivedEventAdded: true })],
  ] as const)(
    '[SEN-37] [CL-SEN-17] gives "new cases" when %s and no statistic the profile uses changed value',
    (_, update) => {
      expect(statisticsUpdateCause(update)).toBe('new_cases');
    },
  );

  it('[CA-SEN-21] [SEN-37] [CL-SEN-17] gives "baseline updated" to any other statistics update, such as a new game that moves a provisional baseline', () => {
    expect(statisticsUpdateCause(effects({}))).toBe('baseline_updated');
  });
});
