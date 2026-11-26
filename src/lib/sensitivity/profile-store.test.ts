import { asc, TransactionRollbackError } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createTestDatabase,
  generalTrends,
  profileValueVersions,
  sensitivityProfiles,
  verdictHistoryEntries,
} from '@/lib/db';
import { snapshotCalculationParams } from '@/lib/params';
import { evaluatePlayer, statisticsUpdateCause } from '@/lib/stats-engine';
import {
  BIRTHDAY,
  buildProfile,
  buildTrend,
  DATABASE_TEST_TIMEOUT_MS,
  insertCalendarType,
  insertEventType,
  insertPlayer,
  leaguePlayerId,
  MEDIA_STORM,
} from '@/lib/testing';
import { fixedClock, gameDay, installFakeClock, toEpochMs } from '@/lib/time';
import engineParams from '@data/fixtures/stats-engine/engine-params.json';

import { writePlayerProfiles, writeTrends } from './profile-store';

import type { VerdictChangeCause, VersionWrite } from './profile-rows';
import type { PlayerProfilesWrite, ProfilePair } from './profile-store';
import type { Database } from '@/lib/db';
import type {
  EngineParams,
  EventTypeId,
  PlayerEvaluationInput,
  PlayerProfile,
  ProfileConfidence,
  ProfileView,
  Verdict,
} from '@/lib/stats-engine';
import type { ViewShape } from '@/lib/testing';
import type { EpochMs } from '@/lib/time';

// The registry's defaults; JSON gives the baseline phase as a string, narrowed here.
const PARAMS: EngineParams = {
  ...engineParams,
  games: {
    ...engineParams.games,
    postseasonBaseline:
      engineParams.games.postseasonBaseline === 'regular_season' ? 'regular_season' : 'postseason',
  },
};
// 2025-01-10 at noon UTC, the first job's instant; the later jobs follow hour by hour.
const T1 = toEpochMs(1_736_510_400_000);
const at = (hours: number): EpochMs => toEpochMs(T1 + hours * 3_600_000);
const T2 = at(1);
const T3 = at(2);
const PLAYER = leaguePlayerId('p01');
const OTHER_PLAYER = leaguePlayerId('p02');
const TRADE_RUMOR = 'trade-rumor';
const COVERED = [MEDIA_STORM, TRADE_RUMOR, BIRTHDAY];
const POSSIBLE_UP: Verdict = { level: 'possible', direction: 'increase' };

/** A tracked case of `pair` created `created` hours after T1, its game starting `start` hours after T1 if known. */
const tracked = (pair: ProfilePair, created: number, start?: number) => ({
  ...pair,
  createdAt: at(created),
  gameStartAt: start === undefined ? null : at(start),
});

/** The media storm's and the trade rumor's profiles, `confidence` in every view. */
const bothProfiles = (confidence: ProfileConfidence) =>
  [MEDIA_STORM, TRADE_RUMOR].map((type) =>
    buildProfile(type, { all: { validCount: 5, confidence } }),
  );

/** A statistics update that corrected a statistic of the media storm's cases and moved the other baselines. */
const statisticsCauseOf = (eventTypeId: EventTypeId): VerdictChangeCause =>
  statisticsUpdateCause({
    usedStatisticChanged: eventTypeId === MEDIA_STORM,
    caseLeftAwaitingGame: eventTypeId === MEDIA_STORM,
    calendarDerivedEventAdded: false,
  });

// A validated type as the engine reads it, of no calendar and with no exit.
const VALIDATED = {
  status: 'validated',
  calendarDerivation: null,
  switchedOffCriterion: null,
} as const;

/**
 * His profiles as the engine evaluates them without an event: the birthday profile while his
 * birthday is not recorded, the media storm's with its one dismissed event, no trade rumor.
 */
function evaluated(hasBirthday: boolean): readonly PlayerProfile[] {
  const input: PlayerEvaluationInput = {
    player: { playerId: PLAYER, isWithdrawn: false, hasBirthday, isMappingEstablished: true },
    types: [
      { ...VALIDATED, eventTypeId: BIRTHDAY, calendarDerivation: 'birthday', exitReasons: [] },
      { ...VALIDATED, eventTypeId: MEDIA_STORM, exitReasons: ['dismissed'] },
      { ...VALIDATED, eventTypeId: TRADE_RUMOR, exitReasons: [] },
    ],
    events: [],
    teamGames: [],
    schedules: [],
    seasons: { firstCoveredSeason: '2024-25', spans: [], readSeasons: [], unpublishedSeason: null },
    now: T3,
    nowGameDayOn: gameDay(T3),
    storedCaseOf: () => ({ origin: 'historical', decisions: [] }),
  };
  return evaluatePlayer(input, PARAMS).profiles;
}

/** A row without its identifier, which the database chose. */
const withoutId = (row: object) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id'));

describe('the profile store', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;
  let snapshotId: number;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(T1));
    await insertPlayer(db);
    await insertEventType(db);
    await insertEventType(db, { id: TRADE_RUMOR, name: 'Trade rumor' });
    await insertCalendarType(db);
    snapshotId = await snapshotCalculationParams(db);
    return async () => {
      restoreClock();
      await database.close();
    };
  }, DATABASE_TEST_TIMEOUT_MS);

  type JobFields = Omit<PlayerProfilesWrite, 'playerId' | 'eventTypeIds' | 'profiles'>;

  /** A job's write at `computedAt`, with the cause new cases and appended versions by default. */
  function job(computedAt: EpochMs, overrides: Partial<JobFields> = {}): JobFields {
    return {
      computedAt,
      parameterSnapshotId: snapshotId,
      causeOf: (): VerdictChangeCause => 'new_cases',
      versions: { kind: 'append' },
      ...overrides,
    };
  }

  async function writeProfiles(
    profiles: readonly PlayerProfile[],
    computedAt: EpochMs,
    overrides: Partial<JobFields> & Readonly<{ eventTypeIds?: readonly EventTypeId[] }> = {},
  ) {
    const { eventTypeIds = COVERED, ...fields } = overrides;
    return writePlayerProfiles(db, {
      playerId: PLAYER,
      eventTypeIds,
      profiles,
      ...job(computedAt, fields),
    });
  }

  const profileRows = async () =>
    db.select().from(sensitivityProfiles).orderBy(asc(sensitivityProfiles.id));
  const historyRows = async () =>
    db.select().from(verdictHistoryEntries).orderBy(asc(verdictHistoryEntries.id));
  const versionRows = async () =>
    db.select().from(profileValueVersions).orderBy(asc(profileValueVersions.id));
  /** Each value version: the profile or the trend it belongs to, its instant and its mean gap. */
  async function ownedVersions() {
    const versions = await versionRows();
    return versions.map((row) => [
      row.sensitivityProfileId,
      row.generalTrendId,
      row.effectiveAt.getTime(),
      row.meanGap,
    ]);
  }
  const idOf = async (view: ProfileView) => {
    const rows = await profileRows();
    return rows.find((row) => row.view === view)?.id;
  };

  /** Each value version of a profile: its profile's type and view, instant and mean gap. */
  async function profileVersions() {
    const rows = await profileRows();
    const versions = await versionRows();
    return versions.map(({ sensitivityProfileId, effectiveAt, meanGap }) => {
      const row = rows.find(({ id }) => id === sensitivityProfileId);
      return [row?.eventTypeId, row?.view, effectiveAt.getTime(), meanGap];
    });
  }

  it('[SEN-20] [SEN-36] [CL-SEN-16] [CL-SEN-19] writes a profile whole in its three views, with the job instant, the snapshot of the parameters in force and the control range, and rewrites it in place', async () => {
    const profile = buildProfile(MEDIA_STORM, {
      all: { validCount: 3, reasons: ['high_dispersion'] },
      historical: { validCount: 2 },
    });
    const pairs = await writeProfiles([profile], T1);
    const rows = await profileRows();

    const again = await writeProfiles([profile], T2);

    const after = await profileRows();
    expect([pairs, again, snapshotId]).toStrictEqual([
      [{ playerId: PLAYER, eventTypeId: MEDIA_STORM }],
      [],
      await snapshotCalculationParams(db),
    ]);
    expect(
      rows.map((row) => [
        row.view,
        [
          row.validCount,
          row.meanGap,
          row.controlMeanGap,
          row.controlRangeLow,
          row.controlRangeHigh,
        ],
        row.confidenceStepDownReasons,
        [row.parameterSnapshotId, row.computedAt.getTime()],
      ]),
    ).toStrictEqual([
      ['all_cases', [3, 0.5, 0.375, -0.125, 0.875], ['high_dispersion'], [snapshotId, T1]],
      ['historical_only', [2, 0.5, 0.375, -0.125, 0.875], [], [snapshotId, T1]],
      ['tracked_only', [0, null, null, null, null], [], [snapshotId, T1]],
    ]);
    expect(after.map(({ id, computedAt }) => [id, computedAt.getTime()])).toStrictEqual(
      rows.map(({ id }) => [id, T2]),
    );
  });

  it('[CL-SEN-16] writes inside the caller’s transaction, which a rollback undoes whole', async () => {
    const written = db.transaction(async (tx) => {
      await writePlayerProfiles(tx, {
        playerId: PLAYER,
        eventTypeIds: COVERED,
        profiles: [buildProfile(MEDIA_STORM, { all: { validCount: 3 } })],
        ...job(T1),
      });
      expect(await tx.select().from(sensitivityProfiles)).toHaveLength(3);
      tx.rollback();
    });

    await expect(written).rejects.toThrow(TransactionRollbackError);
    expect([await profileRows(), await versionRows()]).toStrictEqual([[], []]);
  });

  it('[SEN-37] [CL-SEN-17] [CL-SEN-19] records each change of verdict or confidence of the default view with its old and new values and the job cause, and none for the other views', async () => {
    await writeProfiles([buildProfile(MEDIA_STORM, { all: { validCount: 3 } })], T1);
    const first = await historyRows();
    const changed = await writeProfiles(
      [
        buildProfile(MEDIA_STORM, {
          all: { validCount: 5, meanGap: 1, verdict: POSSIBLE_UP, confidence: 'medium' },
          historical: { validCount: 3, verdict: POSSIBLE_UP, confidence: 'high' },
          tracked: { validCount: 2, verdict: POSSIBLE_UP },
        }),
      ],
      T2,
      { causeOf: () => 'manual_decision' },
    );
    const sameVerdict = { validCount: 6, meanGap: 1.25, verdict: POSSIBLE_UP } as const;

    const later = await writeProfiles(
      [buildProfile(MEDIA_STORM, { all: { ...sameVerdict, confidence: 'medium' } })],
      T3,
    );

    const history = await historyRows();
    const pair = { playerId: PLAYER, eventTypeId: MEDIA_STORM };
    expect([first, changed, later]).toStrictEqual([[], [pair], [pair]]);
    expect(history.map((entry) => withoutId(entry))).toStrictEqual([
      {
        sensitivityProfileId: await idOf('all_cases'),
        generalTrendId: null,
        changedAt: new Date(T2),
        oldVerdictLevel: 'inconclusive',
        oldVerdictDirection: null,
        oldProfileConfidence: 'low',
        newVerdictLevel: 'possible',
        newVerdictDirection: 'increase',
        newProfileConfidence: 'medium',
        cause: 'manual_decision',
      },
    ]);
  });

  it('[SEN-37] [CL-SEN-17] gives each profile of a statistics update the cause resolved for it', async () => {
    await writeProfiles(bothProfiles('low'), T1);

    await writeProfiles(bothProfiles('medium'), T2, { causeOf: statisticsCauseOf });

    const history = await historyRows();
    expect(
      history.map(({ cause, newProfileConfidence }) => [cause, newProfileConfidence]),
    ).toStrictEqual([
      ['stats_correction', 'medium'],
      ['baseline_updated', 'medium'],
    ]);
  });

  it('[CL-SEN-18] [CL-SEN-19] appends a value version of the historical-only view only when one of its five values changes, and never updates one', async () => {
    await writeProfiles([buildProfile(MEDIA_STORM, { all: { validCount: 3 } })], T1);
    const [first] = await versionRows();
    const sameValues = { validCount: 3, reasons: ['high_dispersion'] } as const;
    const otherValues = {
      all: { validCount: 3 },
      historical: sameValues,
      tracked: { validCount: 1 },
    };
    await writeProfiles([buildProfile(MEDIA_STORM, otherValues)], T2);
    const unchanged = await versionRows();

    await writeProfiles(
      [
        buildProfile(MEDIA_STORM, {
          all: { validCount: 3 },
          historical: { validCount: 3, meanGap: 0.75 },
        }),
      ],
      T3,
    );

    const versions = await versionRows();
    const historicalId = await idOf('historical_only');
    expect([unchanged, versions[0]]).toStrictEqual([[first], first]);
    expect(versions.map((row) => withoutId(row))[1]).toStrictEqual({
      sensitivityProfileId: historicalId,
      generalTrendId: null,
      effectiveAt: new Date(T3),
      validCount: 3,
      meanGap: 0.75,
      verdictLevel: 'inconclusive',
      verdictDirection: null,
      profileConfidence: 'low',
    });
    expect(await profileVersions()).toStrictEqual([
      [MEDIA_STORM, 'historical_only', T1, 0.5],
      [MEDIA_STORM, 'historical_only', T3, 0.75],
    ]);
  });

  it('[CL-SEN-18] [CL-SUI-03] replaces every version of a changed historical-only profile by one, effective at the creation of the earliest tracked case of the pair whose game has not started, else at the job instant', async () => {
    const profiles = (meanGap: number) => [
      buildProfile(MEDIA_STORM, { all: { validCount: 3, meanGap } }),
      buildProfile(TRADE_RUMOR, { all: { validCount: 3, meanGap } }),
      buildProfile(BIRTHDAY, { all: { validCount: 3 } }),
    ];
    await writeProfiles(profiles(0.5), T1);
    await writeProfiles(profiles(0.75), T2);
    const before = await versionRows();
    // At the job's instant T3, his media storm's case waits for a game, his trade rumor's game
    // started; another player's earlier cases of both types wait, and date none of his versions.
    const trackedCases = [
      tracked({ playerId: PLAYER, eventTypeId: MEDIA_STORM }, -10, 4),
      tracked({ playerId: PLAYER, eventTypeId: TRADE_RUMOR }, -40, 0),
      tracked({ playerId: OTHER_PLAYER, eventTypeId: MEDIA_STORM }, -20),
      tracked({ playerId: OTHER_PLAYER, eventTypeId: TRADE_RUMOR }, -30, 5),
    ];
    const versions: VersionWrite = { kind: 'replace', trackedCases };

    await writeProfiles(profiles(0.25), T3, { versions, causeOf: () => 'recalculation' });

    expect(before).toHaveLength(5);
    expect(await profileVersions()).toStrictEqual([
      [BIRTHDAY, 'historical_only', T1, 0.5],
      [MEDIA_STORM, 'historical_only', at(-10), 0.25],
      [TRADE_RUMOR, 'historical_only', T3, 0.25],
    ]);
  });

  it('[CL-SEN-18] replaces the versions of a historical-only profile whose tally alone the job changes, so that no gap from before a withdrawal stays', async () => {
    const historical = (shape: ViewShape) => [buildProfile(MEDIA_STORM, { all: shape })];
    await writeProfiles(historical({ validCount: 3, meanGap: 0.5 }), T1);
    // One case excluded by hand, which stays in the tally, then withdrawn: the five values stay.
    await writeProfiles(historical({ validCount: 2, meanGap: 0.25, excludedCount: 1 }), T2);
    const before = await profileVersions();
    const versions: VersionWrite = { kind: 'replace', trackedCases: [] };

    const pairs = await writeProfiles(historical({ validCount: 2, meanGap: 0.25 }), T3, {
      versions,
    });

    const rows = await profileRows();
    expect([before, pairs]).toStrictEqual([
      [
        [MEDIA_STORM, 'historical_only', T1, 0.5],
        [MEDIA_STORM, 'historical_only', T2, 0.25],
      ],
      [{ playerId: PLAYER, eventTypeId: MEDIA_STORM }],
    ]);
    expect(rows.map((row) => [row.view, row.eventCount, row.excludedCount])).toStrictEqual([
      ['all_cases', 3, 0],
      ['historical_only', 3, 0],
      ['tracked_only', 1, 0],
    ]);
    expect(await profileVersions()).toStrictEqual([[MEDIA_STORM, 'historical_only', T3, 0.25]]);
  });

  it('[SEN-37] [CL-SEN-16] writes each profile in a transaction of its own, which a failure after its upsert undoes with its history entry and its version', async () => {
    await writeProfiles(bothProfiles('low'), T1);
    const changed = [MEDIA_STORM, TRADE_RUMOR].map((type) =>
      buildProfile(type, { all: { validCount: 6, meanGap: 1, confidence: 'medium' } }),
    );
    const causeOf = (eventTypeId: EventTypeId): VerdictChangeCause => {
      if (eventTypeId === TRADE_RUMOR) {
        throw new Error('No cause resolved for the trade rumor.');
      }
      return 'new_cases';
    };

    const failed = writeProfiles(changed, T2, { causeOf });

    await expect(failed).rejects.toThrow('No cause resolved for the trade rumor.');
    const rows = await profileRows();
    const history = await historyRows();
    expect(
      rows.map((row) => [row.eventTypeId, row.view, row.validCount, row.computedAt.getTime()]),
    ).toStrictEqual([
      [MEDIA_STORM, 'all_cases', 6, T2],
      [MEDIA_STORM, 'historical_only', 6, T2],
      [MEDIA_STORM, 'tracked_only', 0, T2],
      [TRADE_RUMOR, 'all_cases', 5, T1],
      [TRADE_RUMOR, 'historical_only', 5, T1],
      [TRADE_RUMOR, 'tracked_only', 0, T1],
    ]);
    expect(
      history.map(({ cause, newProfileConfidence }) => [cause, newProfileConfidence]),
    ).toStrictEqual([['new_cases', 'medium']]);
    expect(await profileVersions()).toStrictEqual([
      [MEDIA_STORM, 'historical_only', T1, 0.5],
      [TRADE_RUMOR, 'historical_only', T1, 0.5],
      [MEDIA_STORM, 'historical_only', T2, 1],
    ]);
  });

  it('[SEN-28] [SEN-37] [CL-SEN-18] [CL-SEN-19] writes each trend whole with its history and versions, and erases a trend left with no event with them', async () => {
    const trend = buildTrend({
      all: { validCount: 5, verdict: POSSIBLE_UP, reasons: ['dominant_player'] },
    });
    const first = await writeTrends(db, {
      trends: [
        { eventTypeId: MEDIA_STORM, trend: buildTrend({ all: { validCount: 3 } }) },
        { eventTypeId: TRADE_RUMOR, trend: buildTrend({ all: { validCount: 2 } }) },
      ],
      ...job(T1),
    });
    const second = await writeTrends(db, {
      trends: [
        { eventTypeId: MEDIA_STORM, trend },
        { eventTypeId: TRADE_RUMOR, trend: null },
      ],
      ...job(T2, { causeOf: () => 'parameter_change' }),
    });

    const unchanged = await writeTrends(db, {
      trends: [{ eventTypeId: MEDIA_STORM, trend }],
      ...job(T3),
    });

    const trends = await db.select().from(generalTrends).orderBy(asc(generalTrends.id));
    const history = await historyRows();
    const [defaultId, historicalId] = trends.map(({ id }) => id);
    expect([first, second, unchanged]).toStrictEqual([
      [MEDIA_STORM, TRADE_RUMOR],
      [MEDIA_STORM, TRADE_RUMOR],
      [],
    ]);
    expect(
      trends.map((row) => [
        row.view,
        row.validCount,
        row.distinctPlayerCount,
        row.topContributorValidCount,
        row.confidenceStepDownReasons,
        row.computedAt.getTime(),
      ]),
    ).toStrictEqual([
      ['all_cases', 5, 2, 5, ['dominant_player'], T3],
      ['historical_only', 5, 2, 5, ['dominant_player'], T3],
      ['tracked_only', 0, 0, 0, [], T3],
    ]);
    expect(
      history.map((entry) => [entry.generalTrendId, entry.sensitivityProfileId, entry.cause]),
    ).toStrictEqual([[defaultId, null, 'parameter_change']]);
    expect(await ownedVersions()).toStrictEqual([
      [null, historicalId, T1, 0.5],
      [null, historicalId, T2, 0.5],
    ]);
  });

  it('[CL-SEN-18] [CL-SUI-03] replaces every version of a changed historical-only trend by one, effective at the creation of the earliest tracked case of its type whose game has not started, whoever the player, and leaves the versions of the profiles alone', async () => {
    const trends = (meanGap: number) => [
      { eventTypeId: MEDIA_STORM, trend: buildTrend({ all: { validCount: 3, meanGap } }) },
    ];
    await writeProfiles([buildProfile(MEDIA_STORM, { all: { validCount: 3 } })], T1);
    await writeTrends(db, { trends: trends(0.5), ...job(T1) });
    await writeTrends(db, { trends: trends(0.75), ...job(T2) });
    const before = await ownedVersions();
    // At T3, another player's media storm case waits for a game and dates the version; his
    // earlier one, whose game started, and an earlier waiting trade rumor case date nothing.
    const trackedCases = [
      tracked({ playerId: PLAYER, eventTypeId: MEDIA_STORM }, -40, 0),
      tracked({ playerId: OTHER_PLAYER, eventTypeId: MEDIA_STORM }, -20),
      tracked({ playerId: OTHER_PLAYER, eventTypeId: TRADE_RUMOR }, -30, 5),
    ];
    const versions: VersionWrite = { kind: 'replace', trackedCases };

    const changed = await writeTrends(db, { trends: trends(0.25), ...job(T3, { versions }) });

    const profileId = await idOf('historical_only');
    expect([changed, before.length]).toStrictEqual([[MEDIA_STORM], 3]);
    // The trend's historical-only row shares his profile's identifier, which a delete by the
    // profiles' owner column would reach.
    expect(await ownedVersions()).toStrictEqual([
      [profileId, null, T1, 0.5],
      [null, profileId, at(-20), 0.25],
    ]);
  });

  it('[CL-SEN-18] [CL-SEN-26] erases a profile left with no event with its history and versions, keeps a pair with only exits, and the empty birthday profile until the birthday is recorded', async () => {
    await writeProfiles([buildProfile(TRADE_RUMOR, { all: { validCount: 3 } })], T1);
    await writeProfiles(
      [buildProfile(TRADE_RUMOR, { all: { validCount: 5, verdict: POSSIBLE_UP } })],
      T2,
    );
    const history = await historyRows();
    const pairs = await writeProfiles(evaluated(false), T3);
    const rows = await profileRows();
    const left = [await historyRows(), await profileVersions()];

    // His birthday recorded, his birthday profile goes; the media storm, not covered, stays.
    const later = await writeProfiles(
      evaluated(true).filter(({ eventTypeId }) => eventTypeId === BIRTHDAY),
      at(3),
      { eventTypeIds: [BIRTHDAY] },
    );

    const kept = await profileRows();
    expect([history.length, pairs.map(({ eventTypeId }) => eventTypeId), later]).toStrictEqual([
      1,
      [BIRTHDAY, MEDIA_STORM, TRADE_RUMOR],
      [{ playerId: PLAYER, eventTypeId: BIRTHDAY }],
    ]);
    expect(
      rows.map((row) => [row.eventTypeId, row.view, row.eventCount, row.exitCounts]),
    ).toStrictEqual([
      [BIRTHDAY, 'all_cases', 0, {}],
      [BIRTHDAY, 'historical_only', 0, {}],
      [BIRTHDAY, 'tracked_only', 0, {}],
      [MEDIA_STORM, 'all_cases', 0, { dismissed: 1 }],
      [MEDIA_STORM, 'historical_only', 0, {}],
      [MEDIA_STORM, 'tracked_only', 0, {}],
    ]);
    expect(left).toStrictEqual([
      [],
      [
        [BIRTHDAY, 'historical_only', T3, null],
        [MEDIA_STORM, 'historical_only', T3, null],
      ],
    ]);
    expect(kept.map(({ eventTypeId }) => eventTypeId)).toStrictEqual([
      MEDIA_STORM,
      MEDIA_STORM,
      MEDIA_STORM,
    ]);
  });
});
