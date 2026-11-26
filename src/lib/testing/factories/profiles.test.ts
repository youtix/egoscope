import { describe, expect, it } from 'vitest';

import { buildProfile, buildTrend } from './profiles';

import type { EvaluatedTrend, PlayerProfile } from '@/lib/stats-engine';

/** Each view's name, tally counts, valid counts by origin and quantities that the row checks bind. */
function countsOf(views: PlayerProfile['views'] | EvaluatedTrend['views']) {
  return views.map(({ view, tally, quantities, historicalValidCount, trackedValidCount }) => [
    view,
    [tally.eventCount, tally.caseCount, tally.awaitingCount, tally.validCount, tally.excludedCount],
    [tally.manuallyExcludedCount, historicalValidCount, trackedValidCount],
    [quantities?.meanGap ?? null, quantities?.gapDispersion ?? null],
  ]);
}

describe('the hand-built profiles and trends', () => {
  it('[CL-SEN-16] [CL-SEN-19] builds a profile whole in its three views, each meeting the row checks of its tally and quantities', () => {
    const profile = buildProfile('media-storm', {
      all: { validCount: 3, meanGap: 0.25, excludedCount: 1 },
      historical: { validCount: 1 },
    });

    expect([profile.eventTypeId, profile.isArchived]).toStrictEqual(['media-storm', false]);
    expect(countsOf(profile.views)).toStrictEqual([
      ['all_cases', [5, 5, 1, 3, 1], [1, 3, 0], [0.25, 1.5]],
      ['historical_only', [2, 2, 1, 1, 0], [0, 1, 0], [0.5, null]],
      ['tracked_only', [1, 1, 1, 0, 0], [0, 0, 0], [null, null]],
    ]);
    expect(profile.views[0]?.controlQuantities?.meanGap).toBe(0.125);
    expect(profile.views[2]?.controlQuantities).toBeNull();
  });

  it('[CL-SEN-19] builds a trend whose valid cases come from two players at most, the first contributing them all', () => {
    const trend = buildTrend({ all: { validCount: 4 }, tracked: { validCount: 1 } });

    expect(
      trend.views.map(
        ({ view, distinctPlayerCount, topContributorValidCount, trackedValidCount }) => [
          view,
          distinctPlayerCount,
          topContributorValidCount,
          trackedValidCount,
        ],
      ),
    ).toStrictEqual([
      ['all_cases', 2, 4, 0],
      ['historical_only', 2, 4, 0],
      ['tracked_only', 1, 1, 1],
    ]);
  });
});
