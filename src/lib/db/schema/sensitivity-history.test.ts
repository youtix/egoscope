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

// The first profile and the first trend, both of the media storm.
const OF_PROFILE = { sensitivityProfileId: 1 } as const;
const OF_TREND = { generalTrendId: 1 } as const;
// A first possible increase, after an inconclusive verdict of low confidence.
const ENTRY = {
  ...OF_PROFILE,
  oldVerdictLevel: 'inconclusive',
  oldProfileConfidence: 'low',
  newVerdictLevel: 'possible',
  newVerdictDirection: 'increase',
  newProfileConfidence: 'medium',
  cause: 'new_cases',
} as const;
// The values in force from 18 November 2026, 06:00 UTC: seven valid cases at +0.40.
const EFFECTIVE_AT = new Date(toEpochMs(Date.UTC(2026, 10, 18, 6)));
const VERSION = {
  ...OF_PROFILE,
  effectiveAt: EFFECTIVE_AT,
  validCount: 7,
  meanGap: 0.4,
  verdictLevel: 'possible',
  verdictDirection: 'increase',
  profileConfidence: 'medium',
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
    await db.insert(sensitivityProfiles).values({
      ...EMPTY_CALCULATION,
      playerId: PARENTS.playerId,
      eventTypeId: 'media-storm',
      view: 'historical_only',
    });
    await db.insert(generalTrends).values({
      ...EMPTY_CALCULATION,
      eventTypeId: 'media-storm',
      view: 'historical_only',
      distinctPlayerCount: 0,
      topContributorValidCount: 0,
    });
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that sensitivity-and-profiles.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[SEN-37] [CL-SEN-17] records each change of a profile or a trend with its cause', async () => {
    const causes = [
      'new_cases',
      'stats_correction',
      'baseline_updated',
      'manual_decision',
      'event_dismissed',
      'parameter_change',
      'recalculation',
      'event_corrected_or_removed',
      'event_reinstated',
      'taxonomy_changed',
    ] as const;
    await db.insert(verdictHistoryEntries).values([
      ...causes.map((cause) => ({ ...ENTRY, cause })),
      {
        ...ENTRY,
        sensitivityProfileId: null,
        ...OF_TREND,
        oldVerdictLevel: 'probable',
        oldVerdictDirection: 'decrease',
        oldProfileConfidence: 'high',
        newVerdictLevel: 'probable',
        newVerdictDirection: 'decrease',
      },
      {
        ...ENTRY,
        oldVerdictLevel: 'possible',
        oldVerdictDirection: 'increase',
        oldProfileConfidence: 'medium',
        newVerdictLevel: 'inconclusive',
        newVerdictDirection: null,
        newProfileConfidence: 'low',
      },
      { ...ENTRY, newProfileConfidence: 'high' },
    ]);

    const [first] = await db.select().from(verdictHistoryEntries).orderBy(verdictHistoryEntries.id);

    expect(first).toMatchObject({ ...ENTRY, generalTrendId: null, oldVerdictDirection: null });
    await expect(db.$count(verdictHistoryEntries)).resolves.toBe(13);
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

  it('[SUI-08] [SUI-09] [CL-SEN-19] keeps the values of a historical-only profile or trend as they change', async () => {
    await db.insert(profileValueVersions).values([
      {
        ...VERSION,
        validCount: 0,
        meanGap: null,
        verdictLevel: 'inconclusive',
        verdictDirection: null,
        profileConfidence: 'low',
      },
      VERSION,
      {
        ...VERSION,
        verdictLevel: 'probable',
        verdictDirection: 'decrease',
        profileConfidence: 'high',
      },
      { ...VERSION, sensitivityProfileId: null, ...OF_TREND },
    ]);

    await expect(
      db.$count(profileValueVersions, eq(profileValueVersions.sensitivityProfileId, 1)),
    ).resolves.toBe(3);
  });

  it.each([
    ['naming both a profile and a trend', { ...OF_TREND }, 'subject'],
    ['naming neither a profile nor a trend', { sensitivityProfileId: null }, 'subject'],
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
  ] as const)('[SUI-08] [SEN-24] refuses a value version %s', async (_case, change, check) => {
    const insert = db.insert(profileValueVersions).values({ ...VERSION, ...change });

    await expect(insert).rejects.toMatchObject(
      violationOf(`profile_value_versions_${check}_check`),
    );
  });

  it('[CL-SEN-18] lets the daily purge prune the versions, and a withdrawal replace them by one', async () => {
    const earlier = new Date(toEpochMs(Date.UTC(2026, 10, 17, 6)));
    await db
      .insert(profileValueVersions)
      .values([
        { ...VERSION, effectiveAt: earlier },
        VERSION,
        { ...VERSION, ...OF_TREND, sensitivityProfileId: null },
      ]);

    await db.delete(profileValueVersions).where(lt(profileValueVersions.effectiveAt, EFFECTIVE_AT));
    const pruned = await db
      .select({ effectiveAt: profileValueVersions.effectiveAt })
      .from(profileValueVersions)
      .where(eq(profileValueVersions.sensitivityProfileId, 1));
    await db.delete(profileValueVersions).where(eq(profileValueVersions.sensitivityProfileId, 1));
    await db.insert(profileValueVersions).values({ ...VERSION, validCount: 6, meanGap: 0.3 });

    expect(pruned).toStrictEqual([{ effectiveAt: EFFECTIVE_AT }]);
    await expect(
      db
        .select({ validCount: profileValueVersions.validCount })
        .from(profileValueVersions)
        .where(eq(profileValueVersions.sensitivityProfileId, 1)),
    ).resolves.toStrictEqual([{ validCount: 6 }]);
  });

  it('[CL-SEN-18] erases with a profile or a trend its whole verdict history and its versions', async () => {
    await db
      .insert(verdictHistoryEntries)
      .values([ENTRY, { ...ENTRY, sensitivityProfileId: null, ...OF_TREND }]);
    await db
      .insert(profileValueVersions)
      .values([VERSION, { ...VERSION, sensitivityProfileId: null, ...OF_TREND }]);

    await db.delete(sensitivityProfiles).where(eq(sensitivityProfiles.id, 1));
    const left = await Promise.all(
      [verdictHistoryEntries, profileValueVersions].map(async (table) => db.$count(table)),
    );
    await db.delete(generalTrends).where(eq(generalTrends.id, 1));

    expect(left).toStrictEqual([1, 1]);
    await expect(
      Promise.all(
        [verdictHistoryEntries, profileValueVersions].map(async (table) => db.$count(table)),
      ),
    ).resolves.toStrictEqual([0, 0]);
  });
});
