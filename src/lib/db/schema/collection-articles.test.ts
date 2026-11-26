import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { pressSources } from './collection';
import {
  articles,
  articleSightings,
  dedupTraces,
  NOT_RELEVANT_REASONS,
} from './collection-articles';
import { taskRuns } from './scheduler';

import type { Database } from '../types';
import type { PgInsertValue } from 'drizzle-orm/pg-core';

// The tables of collection.md about the articles the sources bring.
const TABLES = ['article_sightings', 'articles', 'dedup_traces'];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'article_sightings.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'article_sightings.article_id integer NOT NULL',
  'article_sightings.press_source_id integer NOT NULL',
  'article_sightings.feed_item_id text',
  'article_sightings.first_seen_at timestamp with time zone NOT NULL',
  'articles.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'articles.title text NOT NULL',
  'articles.title_key text NOT NULL',
  'articles.outlet_name text NOT NULL',
  'articles.link text NOT NULL',
  'articles.retained_published_at timestamp with time zone NOT NULL',
  'articles.retained_published_at_precision text NOT NULL',
  'articles.first_collected_at timestamp with time zone NOT NULL',
  'articles.language text NOT NULL',
  'articles.excerpt text',
  "articles.processing_status text NOT NULL DEFAULT 'to_analyze'::text",
  "articles.not_relevant_reasons text[] NOT NULL DEFAULT '{}'::text[]",
  'articles.retention_clock_started_at timestamp with time zone',
  'articles.first_press_source_id integer NOT NULL',
  'articles.first_task_run_id integer',
  'articles.row_version integer NOT NULL DEFAULT 1',
  'dedup_traces.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'dedup_traces.link_sha256 bytea NOT NULL',
  'dedup_traces.first_collected_at timestamp with time zone NOT NULL',
  'dedup_traces.article_deleted_at timestamp with time zone NOT NULL',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE UNIQUE INDEX article_sightings_item_uq ON public.article_sightings USING btree (press_source_id, feed_item_id) WHERE (feed_item_id IS NOT NULL)',
  'CREATE UNIQUE INDEX article_sightings_pkey ON public.article_sightings USING btree (id)',
  'CREATE UNIQUE INDEX article_sightings_uq ON public.article_sightings USING btree (article_id, press_source_id)',
  "CREATE INDEX articles_excerpt_idx ON public.articles USING btree (first_collected_at) WHERE ((excerpt IS NOT NULL) AND (processing_status = 'attached'::text))",
  'CREATE UNIQUE INDEX articles_link_uq ON public.articles USING btree (link)',
  "CREATE INDEX articles_not_relevant_idx ON public.articles USING btree (retention_clock_started_at) WHERE (processing_status = 'not_relevant'::text)",
  'CREATE UNIQUE INDEX articles_pkey ON public.articles USING btree (id)',
  'CREATE INDEX articles_reasons_gin ON public.articles USING gin (not_relevant_reasons)',
  'CREATE INDEX articles_retained_idx ON public.articles USING btree (retained_published_at)',
  'CREATE INDEX articles_run_idx ON public.articles USING btree (first_task_run_id)',
  'CREATE INDEX articles_source_collected_idx ON public.articles USING btree (first_press_source_id, first_collected_at)',
  'CREATE INDEX articles_title_dedup_idx ON public.articles USING btree (outlet_name, title_key, retained_published_at)',
  "CREATE INDEX articles_to_analyze_idx ON public.articles USING btree (first_collected_at) WHERE (processing_status = 'to_analyze'::text)",
  'CREATE INDEX dedup_traces_deleted_idx ON public.dedup_traces USING btree (article_deleted_at)',
  'CREATE UNIQUE INDEX dedup_traces_link_uq ON public.dedup_traces USING btree (link_sha256)',
  'CREATE UNIQUE INDEX dedup_traces_pkey ON public.dedup_traces USING btree (id)',
];

// Their references: an article and its sightings outlive the run, never the source.
const FOREIGN_KEYS = [
  'article_sightings FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE',
  'article_sightings FOREIGN KEY (press_source_id) REFERENCES press_sources(id) ON DELETE RESTRICT',
  'articles FOREIGN KEY (first_press_source_id) REFERENCES press_sources(id) ON DELETE RESTRICT',
  'articles FOREIGN KEY (first_task_run_id) REFERENCES task_runs(id) ON DELETE SET NULL',
];

/** An instant of 2 December 2024, at `hour` UTC. */
const at = (hour: number): Date => new Date(toEpochMs(Date.UTC(2024, 11, 2, hour)));
const SOURCE_ID = 1;
const RUN_ID = 1;
const ARTICLE_ID = 1;
const SOURCE = {
  outletName: 'Harbor Daily',
  feedUrl: 'https://harbor.example.com/sports/feed',
  feedUrlKey: 'https://harbor.example.com/sports/feed',
  language: 'en',
  publicSportsPressAttestedAt: at(7),
  healthStatusChangedAt: at(7),
} as const;
// An article the first read of the run stored, waiting for analysis.
const ARTICLE = {
  title: 'Harbor Hawks guard misses practice after a family loss',
  titleKey: 'harbor hawks guard misses practice after a family loss',
  outletName: SOURCE.outletName,
  link: 'https://harbor.example.com/2024/12/02/guard-misses-practice',
  retainedPublishedAt: at(6),
  retainedPublishedAtPrecision: 'exact',
  firstCollectedAt: at(8),
  language: 'en',
  firstPressSourceId: SOURCE_ID,
  firstTaskRunId: RUN_ID,
} as const;
// An article set aside as not relevant, its retention clock started.
const NOT_RELEVANT: PgInsertValue<typeof articles> = {
  ...ARTICLE,
  processingStatus: 'not_relevant',
  notRelevantReasons: ['no_followed_player'],
  retentionClockStartedAt: at(9),
};
const SIGHTING = { articleId: ARTICLE_ID, pressSourceId: SOURCE_ID, firstSeenAt: at(8) } as const;
const HASH = new Uint8Array(32).fill(7);
const TRACE = { linkSha256: HASH, firstCollectedAt: at(8), articleDeletedAt: at(9) } as const;
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

describe('the tables of the collected articles', { timeout: 60_000 }, () => {
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

  it('[COL-22] [COL-25] [COL-35] [CL-DET-01] stores an article to analyze, and every status, precision and reason of its sets', async () => {
    await db.insert(articles).values(ARTICLE);
    await db.insert(articles).values([
      {
        ...NOT_RELEVANT,
        link: 'https://harbor.example.com/a',
        notRelevantReasons: [...NOT_RELEVANT_REASONS],
        retainedPublishedAtPrecision: 'approximate',
        language: 'fr',
      },
      {
        ...ARTICLE,
        link: 'https://harbor.example.com/b',
        processingStatus: 'awaiting_classification',
      },
      {
        ...ARTICLE,
        link: 'https://harbor.example.com/c',
        processingStatus: 'attached',
        excerpt: 'A',
      },
      {
        ...ARTICLE,
        link: 'https://harbor.example.com/d',
        processingStatus: 'linked_to_proposal',
        retainedPublishedAt: ARTICLE.firstCollectedAt,
        retainedPublishedAtPrecision: 'none',
        excerpt: 'x'.repeat(1000),
      },
    ]);

    const [first] = await db.select().from(articles).where(eq(articles.id, ARTICLE_ID));

    expect(first).toStrictEqual({
      ...ARTICLE,
      id: ARTICLE_ID,
      excerpt: null,
      processingStatus: 'to_analyze',
      notRelevantReasons: [],
      retentionClockStartedAt: null,
      rowVersion: 1,
    });
    await expect(db.$count(articles)).resolves.toBe(5);
  });

  it.each<readonly [string, PgInsertValue<typeof articles>, string]>([
    ['a blank title', { ...ARTICLE, title: '\u{A0}' }, 'title'],
    [
      'a publication after its first collection',
      { ...ARTICLE, retainedPublishedAt: at(9) },
      'retained_published_at',
    ],
    [
      'a precision outside the list',
      { ...ARTICLE, retainedPublishedAtPrecision: OUTSIDE },
      'retained_published_at_precision',
    ],
    ['a language outside the list', { ...ARTICLE, language: OUTSIDE }, 'language'],
    ['an empty excerpt', { ...ARTICLE, excerpt: '' }, 'excerpt'],
    ['an excerpt of 1,001 characters', { ...ARTICLE, excerpt: 'x'.repeat(1001) }, 'excerpt'],
    ['a status outside the list', { ...ARTICLE, processingStatus: OUTSIDE }, 'processing_status'],
    [
      'a reason outside the list',
      { ...NOT_RELEVANT, notRelevantReasons: sql`ARRAY['no_fact', 'outside']` },
      'not_relevant_reasons',
    ],
    [
      'no reason for being not relevant',
      { ...NOT_RELEVANT, notRelevantReasons: [] },
      'not_relevant',
    ],
    [
      'no retention clock for being not relevant',
      { ...NOT_RELEVANT, retentionClockStartedAt: null },
      'retention_clock',
    ],
    [
      'a retention clock while to analyze',
      { ...ARTICLE, retentionClockStartedAt: at(9) },
      'retention_clock',
    ],
  ])(
    '[COL-19] [COL-25] [COL-35] [COL-36] [CL-DET-01] refuses an article with %s',
    async (_case, article, check) => {
      const insert = db.insert(articles).values(article);

      await expect(insert).rejects.toMatchObject(violationOf(`articles_${check}_check`));
    },
  );

  it('[COL-28] [COL-30] [COL-49] stores one article per link, and keeps it past the run that brought it', async () => {
    await db.insert(articles).values(ARTICLE);
    const again = db.insert(articles).values({ ...ARTICLE, title: 'Another title' });
    await expect(again).rejects.toMatchObject(duplicateOf('articles_link_uq'));

    await db.delete(taskRuns).where(eq(taskRuns.id, RUN_ID));

    await expect(db.select({ run: articles.firstTaskRunId }).from(articles)).resolves.toStrictEqual(
      [{ run: null }],
    );
  });

  it('[COL-30] [COL-31] [CL-COL-01] records each source that carried an article once, and each feed item once per source', async () => {
    await db.insert(articles).values(ARTICLE);
    await db
      .insert(pressSources)
      .values({ ...SOURCE, feedUrlKey: 'bay', outletName: 'Bay Courier' });
    await db.insert(articleSightings).values([
      { ...SIGHTING, feedItemId: 'item-1' },
      { ...SIGHTING, pressSourceId: 2 },
    ]);
    const sameSource = db.insert(articleSightings).values(SIGHTING);
    await expect(sameSource).rejects.toMatchObject(duplicateOf('article_sightings_uq'));
    await db.insert(articles).values({ ...ARTICLE, link: 'https://harbor.example.com/other' });
    const sameItem = db
      .insert(articleSightings)
      .values({ ...SIGHTING, articleId: 2, feedItemId: 'item-1' });
    await expect(sameItem).rejects.toMatchObject(duplicateOf('article_sightings_item_uq'));
    const emptyItem = db
      .insert(articleSightings)
      .values({ ...SIGHTING, articleId: 2, feedItemId: '' });
    await expect(emptyItem).rejects.toMatchObject(
      violationOf('article_sightings_feed_item_id_check'),
    );

    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));

    await expect(db.$count(articleSightings)).resolves.toBe(0);
  });

  it('[COL-34] keeps one trace of 32 bytes per deleted link, apart from any article', async () => {
    await db.insert(dedupTraces).values(TRACE);
    const again = db.insert(dedupTraces).values({ ...TRACE, articleDeletedAt: at(10) });
    await expect(again).rejects.toMatchObject(duplicateOf('dedup_traces_link_uq'));
    const short = db.insert(dedupTraces).values({ ...TRACE, linkSha256: new Uint8Array(31) });
    const long = db.insert(dedupTraces).values({ ...TRACE, linkSha256: new Uint8Array(33) });

    await expect(short).rejects.toMatchObject(violationOf('dedup_traces_link_sha256_check'));
    await expect(long).rejects.toMatchObject(violationOf('dedup_traces_link_sha256_check'));
    await expect(db.select().from(dedupTraces)).resolves.toStrictEqual([{ ...TRACE, id: 1 }]);
  });
});
