import { eq, lt, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { EMPTY_CALCULATION, insertParents, PARENTS } from '../test-parents';
import { profileValueVersions, verdictHistoryEntries } from './sensitivity-history';
import { generalTrends, sensitivityProfiles } from './sensitivity-profiles';

import type { Database } from '../types';

// The histories of sensitivity-and-profiles.md.
const TABLES = ['profile_value_versions', 'verdict_history_entries'];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'profile_value_versions.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'profile_value_versions.sensitivity_profile_id integer',
  'profile_value_versions.general_trend_id integer',
  'profile_value_versions.effective_at timestamp with time zone NOT NULL',
  'profile_value_versions.valid_count integer NOT NULL',
  'profile_value_versions.mean_gap double precision',
  'profile_value_versions.verdict_level text NOT NULL',
  'profile_value_versions.verdict_direction text',
  'profile_value_versions.profile_confidence text NOT NULL',
  'profile_value_versions.valid_case_threshold smallint',
  'verdict_history_entries.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'verdict_history_entries.sensitivity_profile_id integer',
  'verdict_history_entries.general_trend_id integer',
  'verdict_history_entries.changed_at timestamp with time zone NOT NULL DEFAULT now()',
  'verdict_history_entries.old_verdict_level text NOT NULL',
  'verdict_history_entries.old_verdict_direction text',
  'verdict_history_entries.old_profile_confidence text NOT NULL',
  'verdict_history_entries.new_verdict_level text NOT NULL',
  'verdict_history_entries.new_verdict_direction text',
  'verdict_history_entries.new_profile_confidence text NOT NULL',
  'verdict_history_entries.cause text NOT NULL',
];

// Their indexes, primary keys included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX profile_value_versions_pkey ON public.profile_value_versions USING btree (id)',
  'CREATE INDEX profile_value_versions_profile_idx ON public.profile_value_versions USING btree (sensitivity_profile_id, effective_at)',
  'CREATE INDEX profile_value_versions_trend_idx ON public.profile_value_versions USING btree (general_trend_id, effective_at)',
  'CREATE UNIQUE INDEX verdict_history_entries_pkey ON public.verdict_history_entries USING btree (id)',
  'CREATE INDEX verdict_history_entries_profile_idx ON public.verdict_history_entries USING btree (sensitivity_profile_id, changed_at)',
  'CREATE INDEX verdict_history_entries_trend_idx ON public.verdict_history_entries USING btree (general_trend_id, changed_at)',
];

// Their references: a history goes with its profile or its trend.
const FOREIGN_KEYS = [
  'profile_value_versions FOREIGN KEY (general_trend_id) REFERENCES general_trends(id) ON DELETE CASCADE',
  'profile_value_versions FOREIGN KEY (sensitivity_profile_id) REFERENCES sensitivity_profiles(id) ON DELETE CASCADE',
  'verdict_history_entries FOREIGN KEY (general_trend_id) REFERENCES general_trends(id) ON DELETE CASCADE',
  'verdict_history_entries FOREIGN KEY (sensitivity_profile_id) REFERENCES sensitivity_profiles(id) ON DELETE CASCADE',
];

// The other player's profile of the death of a loved one and the type's trend, all of
// whose events were dismissed or deleted since: they keep showing those exits by reason,
// with their histories (CL-SEN-26). Their default view, whose changes the verdict history
// records, then their historical-only view, whose values the versions keep (CL-SEN-19):
// profiles and trends 1 and 2. The one dismissed event was a detected one, outside the
// historical-only view; the trend held the events of other players too.
const VIEWS = [
  {
    view: 'all_cases',
    profileExits: { dismissed: 1, deleted: 15 },
    trendExits: { dismissed: 2, deleted: 40 },
  },
  { view: 'historical_only', profileExits: { deleted: 15 }, trendExits: { deleted: 40 } },
] as const;
const OF_PROFILE = { sensitivityProfileId: 1 } as const;
const OF_TREND = { generalTrendId: 1 } as const;
const OF_HISTORICAL_PROFILE = { sensitivityProfileId: 2 } as const;
const OF_HISTORICAL_TREND = { generalTrendId: 2 } as const;
// A possible increase of medium confidence after an inconclusive verdict of low
// confidence, and the way back.
const RISE = {
  oldVerdictLevel: 'inconclusive',
  oldVerdictDirection: null,
  oldProfileConfidence: 'low',
  newVerdictLevel: 'possible',
  newVerdictDirection: 'increase',
  newProfileConfidence: 'medium',
} as const;
const FALL = {
  oldVerdictLevel: 'possible',
  oldVerdictDirection: 'increase',
  oldProfileConfidence: 'medium',
  newVerdictLevel: 'inconclusive',
  newVerdictDirection: null,
  newProfileConfidence: 'low',
} as const;
// Changes of one value alone, each of which SEN-37 records: a statistics correction
// reversing a possible increase of medium confidence into a decrease, new cases raising
// that decrease's confidence at fifteen valid cases (SEN-25), then its level, at a ratio
// of 3 (SEN-23).
const REVERSED = {
  oldVerdictLevel: 'possible',
  oldVerdictDirection: 'increase',
  oldProfileConfidence: 'medium',
  newVerdictLevel: 'possible',
  newVerdictDirection: 'decrease',
  newProfileConfidence: 'medium',
} as const;
const MORE_CONFIDENT = {
  ...REVERSED,
  oldVerdictDirection: 'decrease',
  newProfileConfidence: 'high',
} as const;
const TO_PROBABLE = {
  ...MORE_CONFIDENT,
  oldProfileConfidence: 'high',
  newVerdictLevel: 'probable',
} as const;
const ENTRY = { ...OF_PROFILE, ...RISE, cause: 'new_cases' } as const;
// The values of the historical-only profile in force from 16, 17 and 18 November 2026,
// 06:00 UTC, and the instant of the full job that followed a withdrawal, a day later.
const TWO_DAYS_BEFORE = new Date(toEpochMs(Date.UTC(2026, 10, 16, 6)));
const DAY_BEFORE = new Date(toEpochMs(Date.UTC(2026, 10, 17, 6)));
const EFFECTIVE_AT = new Date(toEpochMs(Date.UTC(2026, 10, 18, 6)));
const WITHDRAWAL_JOB_AT = new Date(toEpochMs(Date.UTC(2026, 10, 19, 6)));
// Seven valid cases at +0.40 give a ratio of 1.06 at most, inconclusive, and a low
// confidence below eight valid cases (SEN-22, SEN-23, SEN-25); five at +0.20 and six
// at +0.30 too.
const INCONCLUSIVE = {
  verdictLevel: 'inconclusive',
  verdictDirection: null,
  profileConfidence: 'low',
} as const;
const SEVEN_AT_040 = { ...INCONCLUSIVE, validCount: 7, meanGap: 0.4 } as const;
// The case threshold in force at a profile's calculation (SEN-31); a trend's version keeps none.
const THRESHOLD = 5;
const NO_THRESHOLD = { validCaseThreshold: null } as const;
// Ten valid cases at +0.85, up to a ratio of 2.69: a possible increase, medium from
// eight valid cases.
const VERSION = {
  ...OF_HISTORICAL_PROFILE,
  effectiveAt: EFFECTIVE_AT,
  validCount: 10,
  meanGap: 0.85,
  verdictLevel: 'possible',
  verdictDirection: 'increase',
  profileConfidence: 'medium',
  validCaseThreshold: THRESHOLD,
} as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the verdict history and the value versions', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db.insert(sensitivityProfiles).values(
      VIEWS.map(
        ({ view, profileExits }) =>
          ({
            ...EMPTY_CALCULATION,
            exitCounts: profileExits,
            playerId: PARENTS.otherPlayerId,
            eventTypeId: 'bereavement',
            view,
          }) as const,
      ),
    );
    await db.insert(generalTrends).values(
      VIEWS.map(
        ({ view, trendExits }) =>
          ({
            ...EMPTY_CALCULATION,
            exitCounts: trendExits,
            eventTypeId: 'bereavement',
            view,
            distinctPlayerCount: 0,
            topContributorValidCount: 0,
          }) as const,
      ),
    );
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that sensitivity-and-profiles.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[SEN-37] [CL-SEN-17] records each change of a profile or a trend with its cause', async () => {
    // Each cause once, the profile rising and falling back in turn, so that each change
    // starts from the values the one before it left; then the trend there and back, by
    // a change of its direction alone, of its confidence alone and of its level alone.
    const cycles = [
      ['new_cases', 'stats_correction'],
      ['baseline_updated', 'manual_decision'],
      ['event_dismissed', 'parameter_change'],
      ['recalculation', 'event_corrected_or_removed'],
      ['event_reinstated', 'taxonomy_changed'],
    ] as const;
    const fromProbable = {
      ...FALL,
      oldVerdictLevel: 'probable',
      oldVerdictDirection: 'decrease',
      oldProfileConfidence: 'high',
    } as const;
    await db.insert(verdictHistoryEntries).values([
      ...cycles.flatMap(
        ([rise, fall]) =>
          [
            { ...OF_PROFILE, ...RISE, cause: rise },
            { ...OF_PROFILE, ...FALL, cause: fall },
          ] as const,
      ),
      { ...OF_TREND, ...RISE, cause: 'new_cases' },
      { ...OF_TREND, ...REVERSED, cause: 'stats_correction' },
      { ...OF_TREND, ...MORE_CONFIDENT, cause: 'new_cases' },
      { ...OF_TREND, ...TO_PROBABLE, cause: 'new_cases' },
      { ...OF_TREND, ...fromProbable, cause: 'recalculation' },
    ]);

    const [first] = await db.select().from(verdictHistoryEntries).orderBy(verdictHistoryEntries.id);

    expect(first).toMatchObject({ ...ENTRY, generalTrendId: null });
    await expect(db.$count(verdictHistoryEntries)).resolves.toBe(15);
  });

  it.each([
    ['naming both a profile and a trend', { ...OF_TREND }, 'subject'],
    ['naming neither a profile nor a trend', { sensitivityProfileId: null }, 'subject'],
    [
      'that changes nothing',
      { newVerdictLevel: 'inconclusive', newVerdictDirection: null, newProfileConfidence: 'low' },
      'change',
    ],
    ['of a cause the glossary does not list', { cause: OUTSIDE }, 'cause'],
    ['from a level the glossary does not list', { oldVerdictLevel: OUTSIDE }, 'old_verdict_level'],
    [
      'from a direction the glossary does not list',
      { oldVerdictDirection: OUTSIDE },
      'old_verdict_direction',
    ],
    [
      'from a confidence the glossary does not list',
      { oldProfileConfidence: OUTSIDE },
      'old_profile_confidence',
    ],
    ['to a level the glossary does not list', { newVerdictLevel: OUTSIDE }, 'new_verdict_level'],
    [
      'to a direction the glossary does not list',
      { newVerdictDirection: OUTSIDE },
      'new_verdict_direction',
    ],
    [
      'to a confidence the glossary does not list',
      { newProfileConfidence: OUTSIDE },
      'new_profile_confidence',
    ],
  ] as const)('[SEN-37] refuses a verdict change %s', async (_case, change, check) => {
    const insert = db.insert(verdictHistoryEntries).values({ ...ENTRY, ...change });

    await expect(insert).rejects.toMatchObject(
      violationOf(`verdict_history_entries_${check}_check`),
    );
  });

  it('[CL-SEN-19] keeps the values of a historical-only profile or trend as they change', async () => {
    await db.insert(profileValueVersions).values([
      { ...VERSION, ...INCONCLUSIVE, effectiveAt: TWO_DAYS_BEFORE, validCount: 0, meanGap: null },
      { ...VERSION, ...SEVEN_AT_040, effectiveAt: DAY_BEFORE },
      VERSION,
      // Sixteen valid cases of the type at −1.00, up to a ratio of −4: a probable decrease,
      // high from fifteen valid cases.
      {
        ...OF_HISTORICAL_TREND,
        ...NO_THRESHOLD,
        effectiveAt: EFFECTIVE_AT,
        validCount: 16,
        meanGap: -1,
        verdictLevel: 'probable',
        verdictDirection: 'decrease',
        profileConfidence: 'high',
      },
    ]);

    await expect(
      db
        .select({ effectiveAt: profileValueVersions.effectiveAt })
        .from(profileValueVersions)
        .where(eq(profileValueVersions.sensitivityProfileId, 2))
        .orderBy(profileValueVersions.effectiveAt),
    ).resolves.toStrictEqual([
      { effectiveAt: TWO_DAYS_BEFORE },
      { effectiveAt: DAY_BEFORE },
      { effectiveAt: EFFECTIVE_AT },
    ]);
  });

  it.each([
    ['naming both a profile and a trend', { ...OF_HISTORICAL_TREND }, 'subject'],
    [
      'naming neither a profile nor a trend',
      { sensitivityProfileId: null, ...NO_THRESHOLD },
      'subject',
    ],
    ['of a profile without a case threshold', NO_THRESHOLD, 'threshold'],
    [
      'of a trend with a case threshold',
      { sensitivityProfileId: null, ...OF_HISTORICAL_TREND },
      'threshold',
    ],
    ['inconclusive with a direction', { verdictLevel: 'inconclusive' }, 'verdict'],
    ['possible without a direction', { verdictDirection: null }, 'verdict'],
    ['of a level the glossary does not list', { verdictLevel: OUTSIDE }, 'verdict_level'],
    [
      'of a direction the glossary does not list',
      { verdictDirection: OUTSIDE },
      'verdict_direction',
    ],
    [
      'of a confidence the glossary does not list',
      { profileConfidence: OUTSIDE },
      'profile_confidence',
    ],
  ] as const)('[SEN-24] [CL-SEN-19] refuses a value version %s', async (_case, change, check) => {
    const insert = db.insert(profileValueVersions).values({ ...VERSION, ...change });

    await expect(insert).rejects.toMatchObject(
      violationOf(`profile_value_versions_${check}_check`),
    );
  });

  it('[CL-SEN-18] lets the daily purge prune the versions, and a withdrawal replace them by one', async () => {
    // The pair has no tracked case waiting for its game: the purge keeps the latest
    // version, and the version that replaces them all takes effect at the job's instant.
    const version = {
      ...OF_HISTORICAL_PROFILE,
      ...INCONCLUSIVE,
      validCaseThreshold: THRESHOLD,
    } as const;
    await db.insert(profileValueVersions).values([
      { ...version, effectiveAt: DAY_BEFORE, validCount: 5, meanGap: 0.2 },
      { ...version, ...SEVEN_AT_040, effectiveAt: EFFECTIVE_AT },
      { ...OF_HISTORICAL_TREND, ...NO_THRESHOLD, ...SEVEN_AT_040, effectiveAt: EFFECTIVE_AT },
    ]);

    await db.delete(profileValueVersions).where(lt(profileValueVersions.effectiveAt, EFFECTIVE_AT));
    const pruned = await db
      .select({ effectiveAt: profileValueVersions.effectiveAt })
      .from(profileValueVersions)
      .where(eq(profileValueVersions.sensitivityProfileId, 2));
    // Seven valid cases at +0.40 before the withdrawal, six at +0.30 after it.
    await db.delete(profileValueVersions).where(eq(profileValueVersions.sensitivityProfileId, 2));
    await db
      .insert(profileValueVersions)
      .values({ ...version, effectiveAt: WITHDRAWAL_JOB_AT, validCount: 6, meanGap: 0.3 });

    expect(pruned).toStrictEqual([{ effectiveAt: EFFECTIVE_AT }]);
    await expect(
      db
        .select({
          effectiveAt: profileValueVersions.effectiveAt,
          validCount: profileValueVersions.validCount,
        })
        .from(profileValueVersions)
        .where(eq(profileValueVersions.sensitivityProfileId, 2)),
    ).resolves.toStrictEqual([{ effectiveAt: WITHDRAWAL_JOB_AT, validCount: 6 }]);
  });

  it('[CL-SEN-18] erases with a profile or a trend its whole verdict history and its versions', async () => {
    await db
      .insert(verdictHistoryEntries)
      .values([ENTRY, { ...OF_TREND, ...RISE, cause: 'new_cases' }]);
    await db
      .insert(profileValueVersions)
      .values([
        VERSION,
        { ...VERSION, sensitivityProfileId: null, ...OF_HISTORICAL_TREND, ...NO_THRESHOLD },
      ]);

    await db
      .delete(sensitivityProfiles)
      .where(eq(sensitivityProfiles.playerId, PARENTS.otherPlayerId));
    const left = await Promise.all(
      [verdictHistoryEntries, profileValueVersions].map(async (table) => db.$count(table)),
    );
    await db.delete(generalTrends).where(eq(generalTrends.eventTypeId, 'bereavement'));

    expect(left).toStrictEqual([1, 1]);
    await expect(
      Promise.all(
        [verdictHistoryEntries, profileValueVersions].map(async (table) => db.$count(table)),
      ),
    ).resolves.toStrictEqual([0, 0]);
  });
});
