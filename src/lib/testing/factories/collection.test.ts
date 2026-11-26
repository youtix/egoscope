import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { articleSightings, createTestDatabase } from '@/lib/db';
import { fixedClock, installFakeClock, toEpochMs, toIsoDate } from '@/lib/time';

import { DATABASE_TEST_TIMEOUT_MS } from '../timeouts';
import {
  insertArticle,
  insertCollectionRun,
  insertDailyCount,
  insertDeactivation,
  insertGap,
  insertPressSource,
  insertSighting,
  insertSourceRead,
} from './collection';

import type { Database } from '@/lib/db';

const NOW_MS = Date.UTC(2026, 10, 26, 15);
const DAY_MS = 86_400_000;
const now = new Date(NOW_MS);

describe('the collection factories', { timeout: DATABASE_TEST_TIMEOUT_MS }, () => {
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

  it('writes an active, never-read source of an invented outlet, each with its own feed', async () => {
    const first = await insertPressSource(db);
    const second = await insertPressSource(db, {
      overrides: { outletName: 'Atlantic Rim Hoops', language: 'fr' },
    });

    expect(first).toMatchObject({
      outletName: 'Harbor City Hoops Daily',
      language: 'en',
      activationStatus: 'active',
      healthStatus: 'never_read',
      publicSportsPressAttestedAt: now,
      healthStatusChangedAt: now,
    });
    expect(first.feedUrl).toMatch(/^https:\/\/feeds\.example\.test\/hoops-[\da-f-]{36}\.xml$/u);
    expect(first.feedUrlKey).toBe(first.feedUrl);
    expect(second).toMatchObject({ outletName: 'Atlantic Rim Hoops', language: 'fr' });
    expect(second.feedUrl).not.toBe(first.feedUrl);
  });

  it('writes an open deactivation period begun now, or the period given', async () => {
    const { id: pressSourceId } = await insertPressSource(db);
    const open = await insertDeactivation(db, { pressSourceId });
    const closed = await insertDeactivation(db, {
      pressSourceId,
      overrides: {
        deactivatedAt: new Date(NOW_MS - 2 * DAY_MS),
        reactivatedAt: new Date(NOW_MS - DAY_MS),
      },
    });

    expect(open).toMatchObject({ pressSourceId, deactivatedAt: now, reactivatedAt: null });
    expect(closed).toMatchObject({ reactivatedAt: new Date(NOW_MS - DAY_MS) });
  });

  it('writes a scheduled collection run that succeeded now, or the run given', async () => {
    const done = await insertCollectionRun(db);
    const running = await insertCollectionRun(db, {
      overrides: { finishedAt: null, result: null },
    });

    expect(done).toMatchObject({
      taskKey: 'news-collection',
      trigger: 'scheduled',
      startedAt: now,
      finishedAt: now,
      result: 'succeeded',
    });
    expect(running).toMatchObject({ finishedAt: null, result: null });
  });

  it('writes an article to analyze with its first sighting, and more sightings', async () => {
    const source = await insertPressSource(db);
    const other = await insertPressSource(db);
    const stored = await insertArticle(db, { pressSourceId: source.id });
    const dated = await insertArticle(db, {
      pressSourceId: source.id,
      overrides: {
        retainedPublishedAtPrecision: 'approximate',
        firstCollectedAt: new Date(NOW_MS + 1),
      },
    });
    const sighting = await insertSighting(db, { articleId: stored.id, pressSourceId: other.id });
    await insertSighting(db, {
      articleId: dated.id,
      pressSourceId: other.id,
      overrides: { feedItemId: 'item-1' },
    });

    const sightingsOfDated = await db
      .select()
      .from(articleSightings)
      .where(eq(articleSightings.articleId, dated.id));

    expect(stored).toMatchObject({
      title: 'Harbor City guard sets a franchise record',
      outletName: 'Harbor City Hoops Daily',
      retainedPublishedAt: now,
      retainedPublishedAtPrecision: 'exact',
      firstCollectedAt: now,
      processingStatus: 'to_analyze',
      firstPressSourceId: source.id,
    });
    expect(dated.link).not.toBe(stored.link);
    expect(
      sightingsOfDated.map((row) => [row.pressSourceId, row.feedItemId, row.firstSeenAt]),
    ).toStrictEqual([
      [source.id, null, new Date(NOW_MS + 1)],
      [other.id, 'item-1', now],
    ]);
    expect(sighting).toMatchObject({ pressSourceId: other.id, feedItemId: null, firstSeenAt: now });
  });

  it('writes a successful source read and a gap, or the values given', async () => {
    const { id: pressSourceId } = await insertPressSource(db);
    const { id: taskRunId } = await insertCollectionRun(db);
    const read = await insertSourceRead(db, { taskRunId, pressSourceId });
    const otherRun = await insertCollectionRun(db);
    const failed = await insertSourceRead(db, {
      taskRunId: otherRun.id,
      pressSourceId,
      overrides: { outcome: 'failure', failureReason: 'not_a_feed' },
    });
    const gap = await insertGap(db, { pressSourceId });
    const ofRun = await insertGap(db, { pressSourceId, overrides: { taskRunId } });
    expect(read).toMatchObject({
      outcome: 'success',
      failureReason: null,
      readAttempts: 1,
      readAt: now,
      itemsRead: 0,
    });
    expect(failed).toMatchObject({ outcome: 'failure', failureReason: 'not_a_feed' });
    expect(gap).toMatchObject({
      gapStartAt: new Date(NOW_MS - DAY_MS),
      gapEndAt: now,
      detectedAt: now,
      taskRunId: null,
    });
    expect(ofRun.taskRunId).toBe(taskRunId);
  });

  it('writes the counters of a day, at zero or as given', async () => {
    const { id: pressSourceId } = await insertPressSource(db);
    const counts = await insertDailyCount(db, {
      pressSourceId,
      collectedOn: toIsoDate('2026-11-26'),
    });
    const filled = await insertDailyCount(db, {
      pressSourceId,
      collectedOn: toIsoDate('2026-11-25'),
      overrides: { newArticles: 3, exactlyDated: 1 },
    });

    expect(counts).toMatchObject({
      collectedOn: '2026-11-26',
      newArticles: 0,
      prefilterKept: 0,
      exactlyDated: 0,
    });
    expect(filled).toMatchObject({ newArticles: 3, prefilterKept: 0, exactlyDated: 1 });
  });
});
