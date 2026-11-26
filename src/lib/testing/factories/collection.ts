import { randomUUID } from 'node:crypto';

import {
  articles,
  articleSightings,
  collectionGaps,
  collectionSourceReads,
  pressSourceDailyCounts,
  pressSourceDeactivations,
  pressSources,
  taskRuns,
} from '@/lib/db';
import { now } from '@/lib/time';

import { firstRow } from '../rows';

import type { Database } from '@/lib/db';
import type { IsoDate } from '@/lib/time';
import type { InferInsertModel, InferSelectModel, Table } from 'drizzle-orm';

/** A row of a collection table, as the database holds it. */
type CollectionRow<T extends Table> = InferSelectModel<T>;

/** What a collection factory takes besides its parents: the columns to write otherwise. */
export type CollectionFactoryOptions<T extends Table> = Readonly<{
  overrides?: Partial<InferInsertModel<T>>;
}>;

// The invented outlet that every source and article names unless told otherwise.
const OUTLET = 'Harbor City Hoops Daily';
const TITLE = 'Harbor City guard sets a franchise record';
const TITLE_KEY = 'harbor city guard sets a franchise record';
// The pass that every started run of the factory belongs to.
const PASS_ID = '00000000-0000-4000-8000-0000000000c0';
const DAY_MS = 86_400_000;

/** The instant of the clock, as a column takes it. */
const nowDate = (): Date => new Date(now());

/**
 * Writes an active, never-read English press source of an invented outlet, attested and
 * dated now, its own feed address (COL-02, COL-05, COL-40); `overrides` replaces any column.
 */
export async function insertPressSource(
  db: Database,
  { overrides = {} }: CollectionFactoryOptions<typeof pressSources> = {},
): Promise<CollectionRow<typeof pressSources>> {
  const feedUrl = `https://feeds.example.test/hoops-${randomUUID()}.xml`;
  const rows = await db
    .insert(pressSources)
    .values({
      outletName: OUTLET,
      feedUrl,
      feedUrlKey: feedUrl,
      language: 'en',
      publicSportsPressAttestedAt: nowDate(),
      healthStatusChangedAt: nowDate(),
      ...overrides,
    })
    .returning();
  return firstRow(rows, 'the press source written');
}

/**
 * Writes a deactivation period of the source, begun now and still open (COL-09);
 * `overrides` replaces any column.
 */
export async function insertDeactivation(
  db: Database,
  {
    pressSourceId,
    overrides = {},
  }: CollectionFactoryOptions<typeof pressSourceDeactivations> &
    Readonly<{ pressSourceId: number }>,
): Promise<CollectionRow<typeof pressSourceDeactivations>> {
  const rows = await db
    .insert(pressSourceDeactivations)
    .values({ pressSourceId, deactivatedAt: nowDate(), ...overrides })
    .returning();
  return firstRow(rows, 'the deactivation period written');
}

/**
 * Writes a scheduled run of `news-collection`, started and succeeded now (TRV-26,
 * CL-COL-07); `overrides` replaces any column.
 */
export async function insertCollectionRun(
  db: Database,
  { overrides = {} }: CollectionFactoryOptions<typeof taskRuns> = {},
): Promise<CollectionRow<typeof taskRuns>> {
  const rows = await db
    .insert(taskRuns)
    .values({
      taskKey: 'news-collection',
      trigger: 'scheduled',
      dueAt: nowDate(),
      startedAt: nowDate(),
      finishedAt: nowDate(),
      result: 'succeeded',
      passId: PASS_ID,
      ...overrides,
    })
    .returning();
  return firstRow(rows, 'the collection run written');
}

/**
 * Writes a sighting of the article in the source, seen now and without a feed item
 * identifier (COL-31, CL-COL-01); `overrides` replaces any column.
 */
export async function insertSighting(
  db: Database,
  {
    articleId,
    pressSourceId,
    overrides = {},
  }: CollectionFactoryOptions<typeof articleSightings> &
    Readonly<{ articleId: number; pressSourceId: number }>,
): Promise<CollectionRow<typeof articleSightings>> {
  const rows = await db
    .insert(articleSightings)
    .values({ articleId, pressSourceId, firstSeenAt: nowDate(), ...overrides })
    .returning();
  return firstRow(rows, 'the sighting written');
}

/**
 * Writes an article to analyze that the source first recorded now, exactly dated now, with
 * its first sighting in that source (COL-25, COL-35, CL-COL-21); `overrides` replaces any
 * column of the article.
 */
export async function insertArticle(
  db: Database,
  {
    pressSourceId,
    overrides = {},
  }: CollectionFactoryOptions<typeof articles> & Readonly<{ pressSourceId: number }>,
): Promise<CollectionRow<typeof articles>> {
  const rows = await db
    .insert(articles)
    .values({
      title: TITLE,
      titleKey: TITLE_KEY,
      outletName: OUTLET,
      link: `https://news.example.test/stories/${randomUUID()}`,
      retainedPublishedAt: nowDate(),
      retainedPublishedAtPrecision: 'exact',
      firstCollectedAt: nowDate(),
      language: 'en',
      firstPressSourceId: pressSourceId,
      ...overrides,
    })
    .returning();
  const article = firstRow(rows, 'the article written');
  await insertSighting(db, {
    articleId: article.id,
    pressSourceId,
    overrides: { firstSeenAt: article.firstCollectedAt },
  });
  return article;
}

/**
 * Writes the successful read of the source in the run, made now at the first attempt
 * with every counter at zero (COL-13, COL-48); `overrides` replaces any column.
 */
export async function insertSourceRead(
  db: Database,
  {
    taskRunId,
    pressSourceId,
    overrides = {},
  }: CollectionFactoryOptions<typeof collectionSourceReads> &
    Readonly<{ taskRunId: number; pressSourceId: number }>,
): Promise<CollectionRow<typeof collectionSourceReads>> {
  const rows = await db
    .insert(collectionSourceReads)
    .values({
      taskRunId,
      pressSourceId,
      readAt: nowDate(),
      feedUrlRead: 'https://feeds.example.test/read.xml',
      outcome: 'success',
      readAttempts: 1,
      ...overrides,
    })
    .returning();
  return firstRow(rows, 'the source read written');
}

/**
 * Writes a possible collection gap of the source over the last day, found now by no run
 * (COL-46); `overrides` replaces any column.
 */
export async function insertGap(
  db: Database,
  {
    pressSourceId,
    overrides = {},
  }: CollectionFactoryOptions<typeof collectionGaps> & Readonly<{ pressSourceId: number }>,
): Promise<CollectionRow<typeof collectionGaps>> {
  const rows = await db
    .insert(collectionGaps)
    .values({
      pressSourceId,
      gapStartAt: new Date(now() - DAY_MS),
      gapEndAt: nowDate(),
      detectedAt: nowDate(),
      ...overrides,
    })
    .returning();
  return firstRow(rows, 'the collection gap written');
}

/**
 * Writes the counters of the source on the day `collectedOn`, all at zero unless
 * `overrides` sets them (CL-COL-21).
 */
export async function insertDailyCount(
  db: Database,
  {
    pressSourceId,
    collectedOn,
    overrides = {},
  }: CollectionFactoryOptions<typeof pressSourceDailyCounts> &
    Readonly<{ pressSourceId: number; collectedOn: IsoDate }>,
): Promise<CollectionRow<typeof pressSourceDailyCounts>> {
  const rows = await db
    .insert(pressSourceDailyCounts)
    .values({ pressSourceId, collectedOn, ...overrides })
    .returning();
  return firstRow(rows, 'the daily count written');
}
