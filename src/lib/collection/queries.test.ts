import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  articles,
  articleSightings,
  createTestDatabase,
  parameterOverrides,
  pressSourceDailyCounts,
} from '@/lib/db';
import {
  DATABASE_TEST_TIMEOUT_MS,
  insertArticle,
  insertCollectionRun,
  insertDailyCount,
  insertGap,
  insertPressSource,
  insertSighting,
} from '@/lib/testing';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import {
  article,
  articlesOfRun,
  articlesToAnalyze,
  countPrefilterKept,
  setArticleStatus,
  sources,
} from './queries';

import type { ArticleRow } from './types';
import type { Database } from '@/lib/db';
import type { ParameterKey } from '@/lib/params';
import type { CollectionFactoryOptions } from '@/lib/testing';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// 26 November 2026, 10:00 in New York (UTC-5), the owner's zone of most tests.
const NOW_MS = Date.UTC(2026, 10, 26, 15);
const at = (ms: number) => new Date(ms);
const NEW_YORK = 'America/New_York';
// The first instant of 20 November 2026 in New York: the start of a 7-day window that ends
// on the 26th.
const WINDOW_START_MS = Date.UTC(2026, 10, 20, 5);
// 27 October 2026, 00:30 in Paris (UTC+1): a 30-day window runs from 28 September.
const AFTER_AUTUMN_CHANGE = toEpochMs(Date.UTC(2026, 9, 26, 23, 30));
// 30 March 2026, 00:30 in Paris (UTC+2), the day after the 23-hour day of the clock change;
// 29 March starts at 23:00 UTC on the 28th.
const AFTER_SPRING_CHANGE = toEpochMs(Date.UTC(2026, 2, 29, 22, 30));
const SPRING_DAY_START_MS = Date.UTC(2026, 2, 28, 23);
const ATTACHED = { processingStatus: 'attached' } as const;
const NOT_RELEVANT = {
  status: 'not_relevant',
  reasons: ['no_fact', 'below_threshold', 'no_fact'],
  retentionClockStartedAt: toEpochMs(NOW_MS - DAY_MS),
} as const;

/** Gives `key` the owner's value `value`, as a saved setting does. */
async function setOwnerValue(db: Database, key: ParameterKey, value: unknown): Promise<void> {
  await db.insert(parameterOverrides).values({ parameterKey: key, value });
}

/** The article as the reads of the module give it: every column but the title key. */
function withoutTitleKey(row: ArticleRow): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'titleKey'));
}

/** The columns of an article first collected, and published, at `ms`. */
const collectedAt = (ms: number) => ({ firstCollectedAt: at(ms), retainedPublishedAt: at(ms) });

/** The article `id` as the database holds it. */
async function rowOf(db: Database, id: number): Promise<ArticleRow | undefined> {
  const [row] = await db.select().from(articles).where(eq(articles.id, id));
  return row;
}

/** An article to analyze of a new source. */
async function storedArticle(db: Database): Promise<ArticleRow> {
  const source = await insertPressSource(db);
  return insertArticle(db, { pressSourceId: source.id });
}

/** Writes the counters of `pressSourceId` on each day given. */
async function insertDays(
  db: Database,
  pressSourceId: number,
  days: readonly (readonly [string, number, number, number])[],
): Promise<void> {
  for (const [day, newArticles, prefilterKept, exactlyDated] of days) {
    await insertDailyCount(db, {
      pressSourceId,
      collectedOn: toIsoDate(day),
      overrides: { newArticles, prefilterKept, exactlyDated },
    });
  }
}

/** Two sources with counters around a 7-day window in New York, and a withdrawn one without any. */
async function threeSources(db: Database) {
  await setOwnerValue(db, 'display.timeZone', NEW_YORK);
  await setOwnerValue(db, 'collection.indicatorWindowDays', 7);
  const bayside = await insertPressSource(db, {
    overrides: {
      outletName: 'Bayside Courtside Report',
      healthStatus: 'down',
      healthStatusChangedAt: at(NOW_MS - 2 * DAY_MS),
      firstSuccessfulReadAt: at(NOW_MS - 9 * DAY_MS),
      lastSuccessfulReadAt: at(NOW_MS - 3 * DAY_MS),
    },
  });
  const atlantic = await insertPressSource(db, { overrides: { outletName: 'Atlantic Rim Hoops' } });
  const westwind = await insertPressSource(db, {
    overrides: {
      outletName: 'Westwind Hardwood Gazette',
      activationStatus: 'withdrawn',
      withdrawnAt: at(NOW_MS),
    },
  });
  // The day before the window, which it does not count, then two days of the window.
  await insertDays(db, bayside.id, [
    ['2026-11-19', 50, 50, 50],
    ['2026-11-20', 10, 4, 6],
    ['2026-11-26', 4, 2, 1],
  ]);
  await insertDays(db, atlantic.id, [['2026-11-25', 2, 0, 2]]);
  // Attached and first collected at the window's first instant, and just before it.
  type ArticleOverrides = NonNullable<CollectionFactoryOptions<typeof articles>['overrides']>;
  const ofBayside = async (overrides: ArticleOverrides) =>
    insertArticle(db, { pressSourceId: bayside.id, overrides });
  await ofBayside({ ...ATTACHED, ...collectedAt(WINDOW_START_MS) });
  await ofBayside({ ...ATTACHED, ...collectedAt(WINDOW_START_MS - 1) });
  // Attached now, first recorded by Bayside and seen by Atlantic too: it counts for Bayside.
  const seenTwice = await ofBayside(ATTACHED);
  await insertSighting(db, { articleId: seenTwice.id, pressSourceId: atlantic.id });
  await ofBayside({
    processingStatus: 'not_relevant',
    notRelevantReasons: ['no_followed_player'],
    retentionClockStartedAt: at(NOW_MS),
  });
  await insertArticle(db, { pressSourceId: atlantic.id, overrides: ATTACHED });
  // Found last, the older gap comes after the newer one.
  const newer = await insertGap(db, { pressSourceId: bayside.id });
  const older = await insertGap(db, {
    pressSourceId: bayside.id,
    overrides: { detectedAt: at(NOW_MS - DAY_MS) },
  });
  const ofAtlantic = await insertGap(db, { pressSourceId: atlantic.id });
  return { bayside, atlantic, westwind, gaps: { older, newer, ofAtlantic } };
}

/** The kept counts by source and day, in insertion order. */
async function keptCounts(db: Database) {
  return db
    .select({
      pressSourceId: pressSourceDailyCounts.pressSourceId,
      collectedOn: pressSourceDailyCounts.collectedOn,
      prefilterKept: pressSourceDailyCounts.prefilterKept,
    })
    .from(pressSourceDailyCounts)
    .orderBy(asc(pressSourceDailyCounts.id));
}

/** Two sources in New York and their counters on the 25th and 26th, three new articles each. */
async function twoSourcesInNewYork(db: Database) {
  await setOwnerValue(db, 'display.timeZone', NEW_YORK);
  const first = await insertPressSource(db);
  const second = await insertPressSource(db);
  await insertDays(db, first.id, [
    ['2026-11-25', 3, 0, 0],
    ['2026-11-26', 3, 0, 0],
  ]);
  await insertDays(db, second.id, [['2026-11-25', 3, 0, 0]]);
  return { first, second };
}

describe('the reads and writers of the collection', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    const restoreClock = installFakeClock(fixedClock(toEpochMs(NOW_MS)));
    return async () => {
      restoreClock();
      await database.close();
    };
  });

  describe('sources', () => {
    it('[COL-11] [CL-COL-21] gives each source its figures over the window, its last read, its health and since when', async () => {
      const { bayside, atlantic, westwind, gaps } = await threeSources(db);

      expect(await sources(db)).toStrictEqual([
        {
          source: atlantic,
          indicators: {
            newArticlesPerDay: 2 / 7,
            prefilterKeptShare: 0,
            attachedShare: 1 / 2,
            exactlyDatedShare: 1,
            lastSuccessfulReadAt: null,
            health: 'never_read',
            healthSince: NOW_MS,
          },
          gaps: [gaps.ofAtlantic],
        },
        {
          source: bayside,
          indicators: {
            newArticlesPerDay: 14 / 7,
            prefilterKeptShare: 6 / 14,
            attachedShare: 2 / 14,
            exactlyDatedShare: 7 / 14,
            lastSuccessfulReadAt: NOW_MS - 3 * DAY_MS,
            health: 'down',
            healthSince: NOW_MS - 2 * DAY_MS,
          },
          gaps: [gaps.newer, gaps.older],
        },
        {
          source: westwind,
          indicators: {
            newArticlesPerDay: 0,
            prefilterKeptShare: null,
            attachedShare: null,
            exactlyDatedShare: null,
            lastSuccessfulReadAt: null,
            health: 'never_read',
            healthSince: NOW_MS,
          },
          gaps: [],
        },
      ]);
    });

    it('[COL-11] lists two sources of one outlet in the order they were registered', async () => {
      const registered = [await insertPressSource(db), await insertPressSource(db)];

      const listed = await sources(db);

      expect(listed.map(({ source }) => source.id)).toStrictEqual(registered.map(({ id }) => id));
    });

    it('[COL-11] [CL-COL-21] keeps the figures once the purge has deleted the articles they counted', async () => {
      await threeSources(db);
      const before = await sources(db);

      await db.delete(articles).where(eq(articles.processingStatus, 'not_relevant'));

      expect(await sources(db)).toStrictEqual(before);
    });

    it('[COL-11] counts the default 30 days in Paris time when the owner set neither', async () => {
      const source = await insertPressSource(db);
      installFakeClock(fixedClock(AFTER_AUTUMN_CHANGE));
      await insertDays(db, source.id, [
        ['2026-09-27', 3, 0, 0],
        ['2026-09-28', 3, 0, 0],
        ['2026-10-27', 3, 0, 0],
      ]);

      const [overview] = await sources(db);

      expect(overview?.indicators).toMatchObject({ newArticlesPerDay: 6 / 30 });
    });

    it('[COL-11] starts the window on the right day when a clock change shortened one of its days', async () => {
      await setOwnerValue(db, 'collection.indicatorWindowDays', 2);
      const source = await insertPressSource(db);
      installFakeClock(fixedClock(AFTER_SPRING_CHANGE));
      await insertDays(db, source.id, [
        ['2026-03-28', 100, 0, 0],
        ['2026-03-29', 3, 0, 0],
        ['2026-03-30', 1, 0, 0],
      ]);
      for (const ms of [SPRING_DAY_START_MS, SPRING_DAY_START_MS - 1]) {
        await insertArticle(db, {
          pressSourceId: source.id,
          overrides: { ...ATTACHED, ...collectedAt(ms) },
        });
      }

      const [overview] = await sources(db);

      expect(overview?.indicators).toMatchObject({
        newArticlesPerDay: 4 / 2,
        attachedShare: 1 / 4,
      });
    });
  });

  describe('articles', () => {
    it('[COL-49] gives the articles that a run recorded and that are still kept, in the order collected', async () => {
      const source = await insertPressSource(db);
      const recording = await insertCollectionRun(db);
      const other = await insertCollectionRun(db);
      const ofRun = async (offsetMs: number) =>
        insertArticle(db, {
          pressSourceId: source.id,
          overrides: { firstTaskRunId: recording.id, ...collectedAt(NOW_MS - offsetMs) },
        });
      const later = await ofRun(HOUR_MS);
      const earlier = await ofRun(2 * HOUR_MS);
      const sameInstant = await ofRun(HOUR_MS);
      const purged = await ofRun(3 * HOUR_MS);
      await insertArticle(db, {
        pressSourceId: source.id,
        overrides: { firstTaskRunId: other.id },
      });
      await db.delete(articles).where(eq(articles.id, purged.id));

      expect(await articlesOfRun(db, recording.id)).toStrictEqual(
        [earlier, later, sameInstant].map((row) => withoutTitleKey(row)),
      );
    });

    it('[COL-35] gives the articles still to analyze, oldest first collection first', async () => {
      const source = await insertPressSource(db);
      const collectedAgo = async (offsetMs: number, status: ArticleRow['processingStatus']) =>
        insertArticle(db, {
          pressSourceId: source.id,
          overrides: { processingStatus: status, ...collectedAt(NOW_MS - offsetMs) },
        });
      const newest = await collectedAgo(HOUR_MS, 'to_analyze');
      const oldest = await collectedAgo(3 * HOUR_MS, 'to_analyze');
      const middle = await collectedAgo(2 * HOUR_MS, 'to_analyze');
      const middleTwin = await collectedAgo(2 * HOUR_MS, 'to_analyze');
      await collectedAgo(4 * HOUR_MS, 'awaiting_classification');
      await collectedAgo(4 * HOUR_MS, 'attached');

      expect(await articlesToAnalyze(db)).toStrictEqual(
        [oldest, middle, middleTwin, newest].map((row) => withoutTitleKey(row)),
      );
    });

    it('[COL-25] gives one article with the sources it was seen in, first seen first', async () => {
      const first = await insertPressSource(db);
      const second = await insertPressSource(db);
      const third = await insertPressSource(db);
      const stored = await insertArticle(db, { pressSourceId: first.id });
      const seenLast = await insertSighting(db, {
        articleId: stored.id,
        pressSourceId: second.id,
        overrides: { firstSeenAt: at(NOW_MS + 2 * HOUR_MS), feedItemId: 'item-77' },
      });
      const seenNext = await insertSighting(db, {
        articleId: stored.id,
        pressSourceId: third.id,
        overrides: { firstSeenAt: at(NOW_MS + HOUR_MS) },
      });
      const other = await insertArticle(db, { pressSourceId: second.id });
      const firstSeen = await db
        .select()
        .from(articleSightings)
        .where(
          and(
            eq(articleSightings.articleId, stored.id),
            eq(articleSightings.pressSourceId, first.id),
          ),
        );

      expect(await article(db, stored.id)).toStrictEqual({
        ...withoutTitleKey(stored),
        sightings: [...firstSeen, seenNext, seenLast],
      });
      expect(await article(db, other.id + 1)).toBeNull();
    });
  });

  describe('setArticleStatus', () => {
    it('[CL-DET-01] [CL-COL-08] writes a not-relevant state with each reason once and its retention clock', async () => {
      const stored = await storedArticle(db);

      const result = await db.transaction(async (tx) =>
        setArticleStatus(tx, stored.id, NOT_RELEVANT),
      );

      expect(result).toStrictEqual({ ok: true, value: 'not_relevant' });
      expect(await rowOf(db, stored.id)).toStrictEqual({
        ...stored,
        processingStatus: 'not_relevant',
        notRelevantReasons: ['no_fact', 'below_threshold'],
        retentionClockStartedAt: at(NOW_MS - DAY_MS),
        rowVersion: 2,
      });
    });

    it('[CL-DET-01] stops the retention clock of an article attached later, and keeps its reasons', async () => {
      const stored = await storedArticle(db);
      await db.transaction(async (tx) => setArticleStatus(tx, stored.id, NOT_RELEVANT));

      const result = await db.transaction(async (tx) =>
        setArticleStatus(tx, stored.id, { status: 'attached', reasons: ['below_threshold'] }),
      );

      expect(result).toStrictEqual({ ok: true, value: 'attached' });
      expect(await rowOf(db, stored.id)).toStrictEqual({
        ...stored,
        processingStatus: 'attached',
        notRelevantReasons: ['below_threshold'],
        retentionClockStartedAt: null,
        rowVersion: 3,
      });
    });

    it('[CL-DET-01] refuses a not-relevant state without a reason and changes nothing', async () => {
      const stored = await storedArticle(db);

      const result = await db.transaction(async (tx) =>
        setArticleStatus(tx, stored.id, { ...NOT_RELEVANT, reasons: [] }),
      );

      expect(result).toStrictEqual({ ok: false, error: 'reason_missing' });
      expect(await rowOf(db, stored.id)).toStrictEqual(stored);
    });

    it('[COL-35] writes in the caller transaction, so that its rollback undoes the change', async () => {
      const stored = await storedArticle(db);

      await expect(
        db.transaction(async (tx) => {
          await setArticleStatus(tx, stored.id, { status: 'awaiting_classification', reasons: [] });
          tx.rollback();
        }),
      ).rejects.toThrow('Rollback');
      expect(await rowOf(db, stored.id)).toStrictEqual(stored);
    });

    it('[COL-35] says when the article is no longer kept', async () => {
      const stored = await storedArticle(db);

      const result = await db.transaction(async (tx) =>
        setArticleStatus(tx, stored.id + 1, { status: 'attached', reasons: [] }),
      );

      expect(result).toStrictEqual({ ok: false, error: 'article_not_found' });
    });
  });

  describe('countPrefilterKept', () => {
    it('[COL-11] [CL-COL-21] counts each kept article once, for its first source, on its day of first collection', async () => {
      const { first, second } = await twoSourcesInNewYork(db);
      // 26 November, 03:00 UTC: still the 25th in New York.
      const lateOn25th = collectedAt(Date.UTC(2026, 10, 26, 3));
      const kept = await insertArticle(db, { pressSourceId: first.id, overrides: lateOn25th });
      await insertSighting(db, { articleId: kept.id, pressSourceId: second.id });
      const alsoKept = await insertArticle(db, { pressSourceId: first.id, overrides: lateOn25th });

      const results = await db.transaction(async (tx) => [
        await countPrefilterKept(tx, kept.id),
        await countPrefilterKept(tx, alsoKept.id),
      ]);

      expect(results).toStrictEqual([
        { ok: true, value: null },
        { ok: true, value: null },
      ]);
      expect(await keptCounts(db)).toStrictEqual([
        { pressSourceId: first.id, collectedOn: '2026-11-25', prefilterKept: 2 },
        { pressSourceId: first.id, collectedOn: '2026-11-26', prefilterKept: 0 },
        { pressSourceId: second.id, collectedOn: '2026-11-25', prefilterKept: 0 },
      ]);
    });

    it('[CL-COL-21] never counts more kept articles than the day brought, nor on a day without counters', async () => {
      const { first, second } = await twoSourcesInNewYork(db);
      const onThe26th = await insertArticle(db, { pressSourceId: first.id });
      await db
        .update(pressSourceDailyCounts)
        .set({ prefilterKept: 3 })
        .where(eq(pressSourceDailyCounts.collectedOn, '2026-11-26'));
      const withoutCounters = await insertArticle(db, { pressSourceId: second.id });

      const results = await db.transaction(async (tx) => [
        await countPrefilterKept(tx, onThe26th.id),
        await countPrefilterKept(tx, withoutCounters.id),
        await countPrefilterKept(tx, withoutCounters.id + 1),
      ]);
      const counts = await keptCounts(db);

      expect(results).toStrictEqual([
        { ok: false, error: 'no_daily_count' },
        { ok: false, error: 'no_daily_count' },
        { ok: false, error: 'article_not_found' },
      ]);
      expect(counts.map((row) => row.prefilterKept)).toStrictEqual([0, 3, 0]);
    });
  });
});
