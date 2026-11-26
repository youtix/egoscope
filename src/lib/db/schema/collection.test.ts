import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import {
  collectionGaps,
  collectionSourceReads,
  pressSourceDailyCounts,
  pressSourceDeactivations,
  pressSourceIncidents,
  pressSources,
} from './collection';
import { incidents } from './incidents';
import { taskRuns } from './scheduler';

import type { Database } from '../types';

// The tables of collection.md about the press sources and their reads.
const TABLES = [
  'collection_gaps',
  'collection_source_reads',
  'press_source_daily_counts',
  'press_source_deactivations',
  'press_source_incidents',
  'press_sources',
];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'collection_gaps.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'collection_gaps.press_source_id integer NOT NULL',
  'collection_gaps.gap_start_at timestamp with time zone NOT NULL',
  'collection_gaps.gap_end_at timestamp with time zone NOT NULL',
  'collection_gaps.detected_at timestamp with time zone NOT NULL',
  'collection_gaps.task_run_id integer',
  'collection_source_reads.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'collection_source_reads.task_run_id integer NOT NULL',
  'collection_source_reads.press_source_id integer NOT NULL',
  'collection_source_reads.read_at timestamp with time zone NOT NULL',
  'collection_source_reads.feed_url_read text NOT NULL',
  'collection_source_reads.outcome text NOT NULL',
  'collection_source_reads.failure_reason text',
  'collection_source_reads.read_attempts smallint NOT NULL',
  'collection_source_reads.items_read integer NOT NULL DEFAULT 0',
  'collection_source_reads.new_articles integer NOT NULL DEFAULT 0',
  'collection_source_reads.duplicates integer NOT NULL DEFAULT 0',
  'collection_source_reads.too_old integer NOT NULL DEFAULT 0',
  'collection_source_reads.incomplete integer NOT NULL DEFAULT 0',
  'collection_source_reads.unsupported_language integer NOT NULL DEFAULT 0',
  'collection_source_reads.date_anomalies integer NOT NULL DEFAULT 0',
  'collection_source_reads.catch_up_reference_at timestamp with time zone',
  'collection_source_reads.permanent_redirect_url text',
  'collection_source_reads.uncollected_period_start_at timestamp with time zone',
  'collection_source_reads.uncollected_period_end_at timestamp with time zone',
  'collection_source_reads.interruption_started_at timestamp with time zone',
  'press_source_daily_counts.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'press_source_daily_counts.press_source_id integer NOT NULL',
  'press_source_daily_counts.collected_on date NOT NULL',
  'press_source_daily_counts.new_articles integer NOT NULL DEFAULT 0',
  'press_source_daily_counts.prefilter_kept integer NOT NULL DEFAULT 0',
  'press_source_daily_counts.exactly_dated integer NOT NULL DEFAULT 0',
  'press_source_deactivations.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'press_source_deactivations.press_source_id integer NOT NULL',
  'press_source_deactivations.deactivated_at timestamp with time zone NOT NULL',
  'press_source_deactivations.reactivated_at timestamp with time zone',
  'press_source_incidents.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'press_source_incidents.incident_id integer NOT NULL',
  'press_source_incidents.press_source_id integer NOT NULL',
  'press_sources.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'press_sources.outlet_name text NOT NULL',
  'press_sources.feed_url text NOT NULL',
  'press_sources.feed_url_key text NOT NULL',
  'press_sources.language text NOT NULL',
  'press_sources.outlet_time_zone text',
  'press_sources.silence_period_days smallint',
  'press_sources.public_sports_press_attested_at timestamp with time zone NOT NULL',
  "press_sources.activation_status text NOT NULL DEFAULT 'active'::text",
  'press_sources.withdrawn_at timestamp with time zone',
  "press_sources.health_status text NOT NULL DEFAULT 'never_read'::text",
  'press_sources.health_status_changed_at timestamp with time zone NOT NULL',
  'press_sources.first_successful_read_at timestamp with time zone',
  'press_sources.last_successful_read_at timestamp with time zone',
  'press_sources.last_new_article_at timestamp with time zone',
  'press_sources.consecutive_failed_runs smallint NOT NULL DEFAULT 0',
  'press_sources.failure_streak_started_at timestamp with time zone',
  'press_sources.proposed_feed_url text',
  'press_sources.row_version integer NOT NULL DEFAULT 1',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX collection_gaps_pkey ON public.collection_gaps USING btree (id)',
  'CREATE INDEX collection_gaps_run_idx ON public.collection_gaps USING btree (task_run_id)',
  'CREATE INDEX collection_gaps_source_idx ON public.collection_gaps USING btree (press_source_id, detected_at)',
  'CREATE UNIQUE INDEX collection_source_reads_pkey ON public.collection_source_reads USING btree (id)',
  'CREATE INDEX collection_source_reads_source_idx ON public.collection_source_reads USING btree (press_source_id, read_at)',
  'CREATE UNIQUE INDEX collection_source_reads_uq ON public.collection_source_reads USING btree (task_run_id, press_source_id)',
  'CREATE UNIQUE INDEX press_source_daily_counts_pkey ON public.press_source_daily_counts USING btree (id)',
  'CREATE UNIQUE INDEX press_source_daily_counts_uq ON public.press_source_daily_counts USING btree (press_source_id, collected_on)',
  'CREATE UNIQUE INDEX press_source_deactivations_open_uq ON public.press_source_deactivations USING btree (press_source_id) WHERE (reactivated_at IS NULL)',
  'CREATE UNIQUE INDEX press_source_deactivations_pkey ON public.press_source_deactivations USING btree (id)',
  'CREATE INDEX press_source_deactivations_source_idx ON public.press_source_deactivations USING btree (press_source_id, reactivated_at)',
  'CREATE UNIQUE INDEX press_source_incidents_incident_uq ON public.press_source_incidents USING btree (incident_id)',
  'CREATE UNIQUE INDEX press_source_incidents_pkey ON public.press_source_incidents USING btree (id)',
  'CREATE INDEX press_source_incidents_source_idx ON public.press_source_incidents USING btree (press_source_id)',
  "CREATE UNIQUE INDEX press_sources_feed_url_key_uq ON public.press_sources USING btree (feed_url_key) WHERE (activation_status <> 'withdrawn'::text)",
  'CREATE UNIQUE INDEX press_sources_pkey ON public.press_sources USING btree (id)',
];

// Their references: a source is never deleted, and a read goes with its run.
const FOREIGN_KEYS = [
  'collection_gaps FOREIGN KEY (press_source_id) REFERENCES press_sources(id) ON DELETE RESTRICT',
  'collection_gaps FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE SET NULL',
  'collection_source_reads FOREIGN KEY (press_source_id) REFERENCES press_sources(id) ON DELETE RESTRICT',
  'collection_source_reads FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE',
  'press_source_daily_counts FOREIGN KEY (press_source_id) REFERENCES press_sources(id) ON DELETE RESTRICT',
  'press_source_deactivations FOREIGN KEY (press_source_id) REFERENCES press_sources(id) ON DELETE RESTRICT',
  'press_source_incidents FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE',
  'press_source_incidents FOREIGN KEY (press_source_id) REFERENCES press_sources(id) ON DELETE RESTRICT',
];

/** An instant of 2 December 2024, at `hour` UTC. */
const at = (hour: number): Date => new Date(toEpochMs(Date.UTC(2024, 11, 2, hour)));
// The source the tests register, and the collection run that reads it.
const SOURCE_ID = 1;
const RUN_ID = 1;
const SOURCE = {
  outletName: 'Harbor Daily',
  feedUrl: 'https://harbor.example.com/sports/feed',
  feedUrlKey: 'https://harbor.example.com/sports/feed',
  language: 'en',
  publicSportsPressAttestedAt: at(7),
  healthStatusChangedAt: at(7),
} as const;
const READ = {
  taskRunId: RUN_ID,
  pressSourceId: SOURCE_ID,
  readAt: at(8),
  feedUrlRead: SOURCE.feedUrl,
  outcome: 'success',
  readAttempts: 1,
} as const;
const FAILED_READ = { ...READ, outcome: 'failure', failureReason: 'unreachable' } as const;
const COUNT = { pressSourceId: SOURCE_ID, collectedOn: '2024-12-02' } as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

/** The error of a query that a unique index refused. */
const duplicateOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23505', constraint },
});

describe('the tables of the press sources and their reads', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await db.insert(pressSources).values(SOURCE);
    await db
      .insert(taskRuns)
      .values({ taskKey: 'news-collection', trigger: 'on_demand', dueAt: sql`now()` });
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that collection.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[COL-02] [COL-09] [COL-10] [COL-40] registers a source active and never read, and keeps every value of its sets', async () => {
    await db.insert(pressSources).values([
      {
        ...SOURCE,
        feedUrl: 'https://bay.example.org/rss',
        feedUrlKey: 'https://bay.example.org/rss',
        language: 'fr',
        outletTimeZone: 'Europe/Paris',
        silencePeriodDays: 1,
        activationStatus: 'deactivated',
        healthStatus: 'working',
        firstSuccessfulReadAt: at(8),
        lastSuccessfulReadAt: at(8),
      },
      {
        ...SOURCE,
        silencePeriodDays: 30,
        activationStatus: 'withdrawn',
        withdrawnAt: at(9),
        healthStatus: 'down',
        consecutiveFailedRuns: 3,
        failureStreakStartedAt: at(8),
        proposedFeedUrl: 'https://harbor.example.com/feed',
      },
      {
        ...SOURCE,
        feedUrl: 'https://cove.example.net/feed',
        feedUrlKey: 'c',
        healthStatus: 'silent',
      },
    ]);

    const [first] = await db.select().from(pressSources).where(eq(pressSources.id, SOURCE_ID));

    expect(first).toStrictEqual({
      ...SOURCE,
      id: SOURCE_ID,
      outletTimeZone: null,
      silencePeriodDays: null,
      activationStatus: 'active',
      withdrawnAt: null,
      healthStatus: 'never_read',
      firstSuccessfulReadAt: null,
      lastSuccessfulReadAt: null,
      lastNewArticleAt: null,
      consecutiveFailedRuns: 0,
      failureStreakStartedAt: null,
      proposedFeedUrl: null,
      rowVersion: 1,
    });
    await expect(db.$count(pressSources)).resolves.toBe(4);
  });

  it.each([
    ['a blank outlet name', { outletName: ' \t' }, 'outlet_name'],
    ['a feed that is not a web address', { feedUrl: 'ftp://harbor.example.com/feed' }, 'feed_url'],
    ['a language outside the list', { language: OUTSIDE }, 'language'],
    ['a silence period of 0 days', { silencePeriodDays: 0 }, 'silence_period_days'],
    ['a silence period of 31 days', { silencePeriodDays: 31 }, 'silence_period_days'],
    ['an activation status outside the list', { activationStatus: OUTSIDE }, 'activation_status'],
    ['a withdrawal without its instant', { activationStatus: 'withdrawn' }, 'withdrawn'],
    ['an active source with a withdrawal instant', { withdrawnAt: at(9) }, 'withdrawn'],
    ['a health status outside the list', { healthStatus: OUTSIDE }, 'health_status'],
    [
      'a last successful read before the first',
      { firstSuccessfulReadAt: at(9), lastSuccessfulReadAt: at(8) },
      'reads',
    ],
    [
      'a negative count of failed runs',
      { consecutiveFailedRuns: -1, failureStreakStartedAt: at(8) },
      'consecutive_failed_runs',
    ],
    [
      'failed runs without the start of their streak',
      { consecutiveFailedRuns: 2 },
      'failure_streak',
    ],
    ['a streak start without a failed run', { failureStreakStartedAt: at(8) }, 'failure_streak'],
    [
      'a proposed feed that is not a web address',
      { proposedFeedUrl: 'harbor.example.com/feed' },
      'proposed_feed_url',
    ],
  ] as const)(
    '[COL-02] [COL-40] [CL-COL-05] [CL-COL-19] refuses a source with %s',
    async (_case, values, check) => {
      const insert = db.insert(pressSources).values({ ...SOURCE, feedUrlKey: 'other', ...values });

      await expect(insert).rejects.toMatchObject(violationOf(`press_sources_${check}_check`));
    },
  );

  it('[COL-10] [CL-COL-18] refuses an address that an active or deactivated source holds, and frees that of a withdrawn one', async () => {
    const again = db.insert(pressSources).values(SOURCE);
    await expect(again).rejects.toMatchObject(duplicateOf('press_sources_feed_url_key_uq'));
    await db
      .update(pressSources)
      .set({ activationStatus: 'deactivated' })
      .where(eq(pressSources.id, SOURCE_ID));
    const whileDeactivated = db.insert(pressSources).values(SOURCE);
    await expect(whileDeactivated).rejects.toMatchObject(
      duplicateOf('press_sources_feed_url_key_uq'),
    );

    await db
      .update(pressSources)
      .set({ activationStatus: 'withdrawn', withdrawnAt: at(9) })
      .where(eq(pressSources.id, SOURCE_ID));
    await db.insert(pressSources).values(SOURCE);

    await expect(db.$count(pressSources)).resolves.toBe(2);
  });

  it('[COL-10] never deletes a source that a row of the module names', async () => {
    await db
      .insert(pressSourceDeactivations)
      .values({ pressSourceId: SOURCE_ID, deactivatedAt: at(8) });

    const deletion = db.delete(pressSources).where(eq(pressSources.id, SOURCE_ID));

    await expect(deletion).rejects.toMatchObject({ cause: { code: '23001' } });
  });

  it('[COL-09] [CL-COL-04] keeps at most one open deactivation period per source, each ending after it began', async () => {
    const period = { pressSourceId: SOURCE_ID, deactivatedAt: at(8) } as const;
    await db.insert(pressSourceDeactivations).values(period);
    const second = db.insert(pressSourceDeactivations).values(period);
    await expect(second).rejects.toMatchObject(duplicateOf('press_source_deactivations_open_uq'));
    const backwards = db
      .insert(pressSourceDeactivations)
      .values({ ...period, reactivatedAt: at(8) });
    await expect(backwards).rejects.toMatchObject(
      violationOf('press_source_deactivations_reactivated_check'),
    );

    await db
      .update(pressSourceDeactivations)
      .set({ reactivatedAt: at(9) })
      .where(eq(pressSourceDeactivations.pressSourceId, SOURCE_ID));
    await db.insert(pressSourceDeactivations).values({ ...period, deactivatedAt: at(10) });

    await expect(db.$count(pressSourceDeactivations)).resolves.toBe(2);
  });

  it('[COL-11] [CL-COL-21] keeps one count per source and day, each count at zero by default', async () => {
    await db.insert(pressSourceDailyCounts).values(COUNT);
    await db.insert(pressSourceDailyCounts).values({
      ...COUNT,
      collectedOn: '2024-12-03',
      newArticles: 4,
      prefilterKept: 4,
      exactlyDated: 0,
    });

    const [first] = await db
      .select()
      .from(pressSourceDailyCounts)
      .orderBy(pressSourceDailyCounts.id);
    const again = db.insert(pressSourceDailyCounts).values(COUNT);

    expect(first).toStrictEqual({
      ...COUNT,
      id: 1,
      newArticles: 0,
      prefilterKept: 0,
      exactlyDated: 0,
    });
    await expect(again).rejects.toMatchObject(duplicateOf('press_source_daily_counts_uq'));
  });

  it.each([
    [
      'a negative number kept by the prefilter',
      { newArticles: 2, prefilterKept: -1 },
      'prefilter_kept',
    ],
    ['more kept by the prefilter than new', { newArticles: 2, prefilterKept: 3 }, 'prefilter_kept'],
    ['a negative number exactly dated', { newArticles: 2, exactlyDated: -1 }, 'exactly_dated'],
    ['more exactly dated than new', { newArticles: 2, exactlyDated: 3 }, 'exactly_dated'],
  ] as const)(
    '[COL-11] [CL-COL-21] refuses a daily count with %s',
    async (_case, values, check) => {
      const insert = db.insert(pressSourceDailyCounts).values({ ...COUNT, ...values });

      await expect(insert).rejects.toMatchObject(
        violationOf(`press_source_daily_counts_${check}_check`),
      );
    },
  );

  it('[COL-11] [CL-COL-21] refuses a negative number of new articles, which bounds the two other counts', async () => {
    const insert = db.insert(pressSourceDailyCounts).values({ ...COUNT, newArticles: -1 });

    await expect(insert).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('[COL-13] [COL-48] [CL-COL-09] [CL-COL-19] keeps one read per run and source, with every outcome and failure reason', async () => {
    const reasons = [
      'error_response',
      'requires_identification',
      'unreadable',
      'not_a_feed',
    ] as const;
    // Four more runs waiting to start, one per task since each task waits once.
    const taskKeys = ['detection', 'purge', 'backup', 'link-check'] as const;
    await db
      .insert(taskRuns)
      .values(
        taskKeys.map((taskKey) => ({ taskKey, trigger: 'on_demand', dueAt: sql`now()` }) as const),
      );
    await db.insert(collectionSourceReads).values([
      { ...FAILED_READ, readAttempts: 5 },
      ...reasons.map((failureReason, index) => ({
        ...FAILED_READ,
        taskRunId: RUN_ID + index + 1,
        failureReason,
      })),
    ]);
    const again = db.insert(collectionSourceReads).values(READ);
    await expect(again).rejects.toMatchObject(duplicateOf('collection_source_reads_uq'));

    await db.delete(collectionSourceReads).where(eq(collectionSourceReads.taskRunId, RUN_ID));
    await db.insert(collectionSourceReads).values({
      ...READ,
      uncollectedPeriodStartAt: at(1),
      uncollectedPeriodEndAt: at(7),
      permanentRedirectUrl: 'https://harbor.example.com/feed',
    });
    const [read] = await db
      .select()
      .from(collectionSourceReads)
      .where(eq(collectionSourceReads.taskRunId, RUN_ID));

    expect(read).toMatchObject({
      failureReason: null,
      itemsRead: 0,
      newArticles: 0,
      duplicates: 0,
      tooOld: 0,
      incomplete: 0,
      unsupportedLanguage: 0,
      dateAnomalies: 0,
      catchUpReferenceAt: null,
      interruptionStartedAt: null,
    });
    await expect(db.$count(collectionSourceReads)).resolves.toBe(5);
  });

  it.each([
    ['an outcome outside the list', { ...READ, outcome: OUTSIDE }, 'outcome'],
    [
      'a failure reason outside the list',
      { ...FAILED_READ, failureReason: OUTSIDE },
      'failure_reason',
    ],
    ['a failure without its reason', { ...READ, outcome: 'failure' }, 'failure'],
    ['a success with a failure reason', { ...READ, failureReason: 'unreachable' }, 'failure'],
    ['no read attempt', { ...READ, readAttempts: 0 }, 'read_attempts'],
    ['six read attempts', { ...READ, readAttempts: 6 }, 'read_attempts'],
    ['a negative number of items read', { ...READ, itemsRead: -1 }, 'counters'],
    ['a negative number of new articles', { ...READ, newArticles: -1 }, 'counters'],
    ['a negative number of duplicates', { ...READ, duplicates: -1 }, 'counters'],
    ['a negative number of articles too old', { ...READ, tooOld: -1 }, 'counters'],
    ['a negative number of incomplete items', { ...READ, incomplete: -1 }, 'counters'],
    ['a negative number in another language', { ...READ, unsupportedLanguage: -1 }, 'counters'],
    ['a negative number of date anomalies', { ...READ, dateAnomalies: -1 }, 'counters'],
    [
      'an uncollected period without its end',
      { ...READ, uncollectedPeriodStartAt: at(1) },
      'uncollected_period',
    ],
    [
      'an uncollected period without its start',
      { ...READ, uncollectedPeriodEndAt: at(7) },
      'uncollected_period',
    ],
  ] as const)(
    '[COL-13] [COL-48] [CL-COL-04] [CL-COL-09] refuses a read with %s',
    async (_case, read, check) => {
      const insert = db.insert(collectionSourceReads).values(read);

      await expect(insert).rejects.toMatchObject(
        violationOf(`collection_source_reads_${check}_check`),
      );
    },
  );

  it('[COL-46] [CL-COL-13] keeps a possible gap that ends after it starts, past the run that found it', async () => {
    const gap = {
      pressSourceId: SOURCE_ID,
      gapStartAt: at(1),
      detectedAt: at(8),
      taskRunId: RUN_ID,
    } as const;
    const empty = db.insert(collectionGaps).values({ ...gap, gapEndAt: at(1) });
    await expect(empty).rejects.toMatchObject(violationOf('collection_gaps_period_check'));
    await db.insert(collectionGaps).values({ ...gap, gapEndAt: at(7) });
    await db.insert(collectionSourceReads).values(READ);

    await db.delete(taskRuns).where(eq(taskRuns.id, RUN_ID));

    await expect(
      db.select({ run: collectionGaps.taskRunId }).from(collectionGaps),
    ).resolves.toStrictEqual([{ run: null }]);
    await expect(db.$count(collectionSourceReads)).resolves.toBe(0);
  });

  it('[COL-41] [COL-46] links an incident to one source, and the link goes with the incident', async () => {
    await db.insert(incidents).values({ kind: 'press_source_down', causeKey: 'press-source-1' });
    const link = { incidentId: 1, pressSourceId: SOURCE_ID } as const;
    await db.insert(pressSourceIncidents).values(link);
    const again = db.insert(pressSourceIncidents).values(link);
    await expect(again).rejects.toMatchObject(duplicateOf('press_source_incidents_incident_uq'));

    await db.delete(incidents).where(eq(incidents.id, link.incidentId));

    await expect(db.$count(pressSourceIncidents)).resolves.toBe(0);
  });
});
