import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { cases, createTestDatabase, events } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';

import { profiledPlayer } from '../scenarios';
import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import { DEFAULT_PARAMS } from './profile-cases';
import {
  buildProfile,
  buildTrend,
  insertProfile,
  insertTrend,
  insertValueVersion,
  insertVerdictChange,
} from './profiles';
import { BIRTHDAY, insertCalendarType, MEDIA_STORM } from './taxonomy';

import type { ProfiledPlayer } from '../scenarios';
import type { Database } from '@/lib/db';
import type { EvaluatedTrend, PlayerProfile } from '@/lib/stats-engine';

const AT = toEpochMs(Date.UTC(2026, 10, 20, 8, 15));
const EARLIER = toEpochMs(Date.UTC(2025, 6, 1));
const THREE_CASES = { ...DEFAULT_PARAMS.sensitivity, minValidCases: 3 };

/** Each view's name, tally counts, valid counts by origin and quantities that the row checks bind. */
function countsOf(views: PlayerProfile['views'] | EvaluatedTrend['views']) {
  return views.map(({ view, tally, quantities, historicalValidCount, trackedValidCount }) => [
    view,
    [tally.eventCount, tally.caseCount, tally.awaitingCount, tally.validCount, tally.excludedCount],
    [tally.manuallyExcludedCount, historicalValidCount, trackedValidCount],
    [quantities?.meanGap ?? null, quantities?.gapDispersion ?? null],
  ]);
}

describe('the profile factories', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let profiled: ProfiledPlayer;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(AT));
    profiled = await profiledPlayer(db);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  it('[SEN-20] [SEN-33] [SEN-36] computes a profile from the cases given, with the exits, the parameters and the instant given', async () => {
    const caseIds = profiled.cases.slice(0, 3).map(({ id }) => id);
    const profile = await insertProfile(db, {
      playerId: profiled.player.id,
      caseIds,
      exits: ['dismissed', 'merged', 'dismissed'],
      params: { ...DEFAULT_PARAMS, sensitivity: THREE_CASES },
      computedAt: EARLIER,
    });

    expect(profile).toMatchObject({
      eventTypeId: MEDIA_STORM,
      view: 'all_cases',
      caseCount: 3,
      validCount: 3,
      historicalValidCount: 3,
      trackedValidCount: 0,
      exitCounts: { dismissed: 2, merged: 1 },
      validCaseThreshold: 3,
      computedAt: new Date(EARLIER),
    });
  });

  it('[SEN-25] writes the reasons of a lower confidence that the engine gives the profile', async () => {
    // The profiled player's seven gaps disperse by about 1.22, above a drop set at 1.
    const sensitivity = { ...DEFAULT_PARAMS.sensitivity, confidenceDispersionDrop: 1 };

    await expect(
      insertProfile(db, {
        playerId: profiled.player.id,
        params: { ...DEFAULT_PARAMS, sensitivity },
      }),
    ).resolves.toMatchObject({
      validCount: 7,
      profileConfidence: 'low',
      confidenceStepDownReasons: ['high_dispersion'],
    });
  });

  it('[SEN-20] [CL-SEN-15] computes a profile without a case: no gap quantity, no control', async () => {
    await insertCalendarType(db);

    await expect(
      insertProfile(db, { playerId: profiled.player.id, eventTypeId: BIRTHDAY }),
    ).resolves.toMatchObject({
      caseCount: 0,
      meanGap: null,
      controlCaseCount: 0,
      controlMeanGap: null,
      verdictLevel: 'inconclusive',
      computedAt: new Date(AT),
    });
  });

  it('[SEN-37] [SUI-08] refuses a verdict change that changes nothing, and writes a version without a valid case', async () => {
    const trend = await insertTrend(db, { view: 'historical_only' });
    const subject = { trendId: trend.id };

    await expect(
      insertVerdictChange(db, {
        subject,
        paramsBefore: DEFAULT_PARAMS,
        cause: 'parameter_change',
        changedAt: AT,
      }),
    ).rejects.toThrow('Expected a change of verdict or confidence, found none.');
    await expect(
      insertValueVersion(db, { subject, effectiveAt: EARLIER, caseIds: [] }),
    ).resolves.toMatchObject({ generalTrendId: trend.id, validCount: 0, meanGap: null });
  });

  it('[SEN-37] [CL-SEN-17] writes a change of confidence alone, from the values of the earlier parameters to those the profile records', async () => {
    const profile = await insertProfile(db, { playerId: profiled.player.id });
    // His seven valid cases gave a medium confidence while it started from seven cases.
    const sensitivity = { ...DEFAULT_PARAMS.sensitivity, confidenceMediumFromCases: 7 };

    await expect(
      insertVerdictChange(db, {
        subject: { profileId: profile.id },
        paramsBefore: { ...DEFAULT_PARAMS, sensitivity },
        cause: 'parameter_change',
        changedAt: EARLIER,
      }),
    ).resolves.toMatchObject({
      sensitivityProfileId: profile.id,
      generalTrendId: null,
      changedAt: new Date(EARLIER),
      oldVerdictLevel: 'inconclusive',
      oldVerdictDirection: null,
      oldProfileConfidence: 'medium',
      newVerdictLevel: 'inconclusive',
      newVerdictDirection: null,
      newProfileConfidence: 'low',
      cause: 'parameter_change',
    });
  });

  it('[SEN-07] throws on a case without an event, or excluded without a criterion, which no case of the specs is', async () => {
    const [first, second] = profiled.cases;
    await db
      .update(events)
      .set({ caseId: null })
      .where(eq(events.caseId, first?.id ?? 0));

    await expect(insertProfile(db, { playerId: profiled.player.id })).rejects.toThrow(
      'an event of the case',
    );
    await expect(insertTrend(db, { caseIds: [second?.id ?? 0], exits: [] })).resolves.toMatchObject(
      { validCount: 1 },
    );
    await db
      .update(cases)
      .set({ status: 'excluded' })
      .where(eq(cases.id, second?.id ?? 0));
    await expect(insertTrend(db, { caseIds: [second?.id ?? 0] })).rejects.toThrow('a criterion');
  });
});

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
