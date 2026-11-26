import 'server-only';

import { and, asc, count, desc, eq, gte, lt, sql } from 'drizzle-orm';

import {
  articles,
  articleSightings,
  collectionGaps,
  pressSourceDailyCounts,
  pressSources,
} from '@/lib/db';
import { getParam, getParams } from '@/lib/params';
import { err, ok } from '@/lib/result';
import { now, startOfLocalDay, toEpochMs, userDay } from '@/lib/time';

import type { ArticleRow, ArticleSightingRow, CollectionGapRow, PressSourceRow } from './types';
import type { Database, Transaction } from '@/lib/db';
import type { Result } from '@/lib/result';
import type { EpochMs, IsoDate } from '@/lib/time';
import type { AnyColumn, SQL } from 'drizzle-orm';

/** A connection or the caller's transaction, to read through. */
type Reader = Database | Transaction;

const DAY_MS = 86_400_000;
const HALF_DAY_MS = DAY_MS / 2;

/** The instant of a `timestamptz` read back, in epoch milliseconds. */
const instant = (date: Date): EpochMs => toEpochMs(date.getTime());

// --- Sources ---------------------------------------------------------------------

/**
 * What tells the owner how useful a source is (COL-11, CL-COL-21): over the rolling window,
 * the new articles per day and the shares kept by the prefilter, attached now and exactly
 * dated, each null when the window brought no new article; then the last successful read,
 * and the health with the instant since which the source has had it (COL-40).
 */
export type SourceIndicators = Readonly<{
  newArticlesPerDay: number;
  prefilterKeptShare: number | null;
  attachedShare: number | null;
  exactlyDatedShare: number | null;
  lastSuccessfulReadAt: EpochMs | null;
  health: PressSourceRow['healthStatus'];
  healthSince: EpochMs;
}>;

/** A source with its indicators and its possible collection gaps, newest first (COL-46). */
export type SourceOverview = Readonly<{
  source: PressSourceRow;
  indicators: SourceIndicators;
  gaps: readonly CollectionGapRow[];
}>;

/** The owner's days that the indicators count: `days` of them, the first one starting at `start`. */
type IndicatorWindow = Readonly<{ days: number; firstDay: IsoDate; start: EpochMs }>;

/** The window's sums of a source's daily counters. */
type WindowCounts = Readonly<{ newArticles: number; prefilterKept: number; exactlyDated: number }>;

const NO_COUNTS: WindowCounts = { newArticles: 0, prefilterKept: 0, exactlyDated: 0 };

/**
 * The `days` owner's days that end with today in `zone`. The first one is the day of the
 * instant `days - 1` whole days before today's midday, which no clock change moves to
 * another day.
 */
function indicatorWindow(days: number, zone: string): IndicatorWindow {
  const today = userDay(now(), zone);
  const middayOfFirstDay = startOfLocalDay(today, zone) + HALF_DAY_MS - (days - 1) * DAY_MS;
  const firstDay = userDay(toEpochMs(middayOfFirstDay), zone);
  return { days, firstDay, start: startOfLocalDay(firstDay, zone) };
}

/** The sum of an integer column, as a number. */
const sumOf = (column: AnyColumn): SQL<number> => sql<number>`sum(${column})`.mapWith(Number);

/** Each source's sums of its daily counters from `firstDay` on (CL-COL-21). */
async function windowCounts(
  db: Reader,
  firstDay: IsoDate,
): Promise<ReadonlyMap<number, WindowCounts>> {
  const rows = await db
    .select({
      pressSourceId: pressSourceDailyCounts.pressSourceId,
      newArticles: sumOf(pressSourceDailyCounts.newArticles),
      prefilterKept: sumOf(pressSourceDailyCounts.prefilterKept),
      exactlyDated: sumOf(pressSourceDailyCounts.exactlyDated),
    })
    .from(pressSourceDailyCounts)
    .where(gte(pressSourceDailyCounts.collectedOn, firstDay))
    .groupBy(pressSourceDailyCounts.pressSourceId);
  return new Map(rows.map(({ pressSourceId, ...counts }) => [pressSourceId, counts]));
}

/** Each source's articles first collected from `start` on and attached now (CL-COL-21). */
async function attachedCounts(db: Reader, start: EpochMs): Promise<ReadonlyMap<number, number>> {
  const collectedSince = gte(articles.firstCollectedAt, new Date(start));
  const rows = await db
    .select({ pressSourceId: articles.firstPressSourceId, attached: count() })
    .from(articles)
    .where(and(eq(articles.processingStatus, 'attached'), collectedSince))
    .groupBy(articles.firstPressSourceId);
  return new Map(rows.map(({ pressSourceId, attached }) => [pressSourceId, attached]));
}

/** The indicators of `source` from its sums over a window of `days` days. */
function indicatorsOf(
  source: PressSourceRow,
  days: number,
  { newArticles, prefilterKept, exactlyDated, attached }: WindowCounts & { attached: number },
): SourceIndicators {
  const shareOf = (part: number): number | null => (newArticles === 0 ? null : part / newArticles);
  const { lastSuccessfulReadAt } = source;
  return {
    newArticlesPerDay: newArticles / days,
    prefilterKeptShare: shareOf(prefilterKept),
    attachedShare: shareOf(attached),
    exactlyDatedShare: shareOf(exactlyDated),
    lastSuccessfulReadAt: lastSuccessfulReadAt === null ? null : instant(lastSuccessfulReadAt),
    health: source.healthStatus,
    healthSince: instant(source.healthStatusChangedAt),
  };
}

/**
 * Every press source by outlet name, with its indicators over the last
 * `collection.indicatorWindowDays` owner's days (in `display.timeZone`), today included,
 * and its possible collection gaps, newest first (COL-11, COL-40, COL-46, CL-COL-21).
 * The figures come from the daily counters, which survive the purge, and each article
 * counts for the source that first recorded it; the attached share counts the articles
 * of the window that are attached now. Five queries.
 */
export async function sources(db: Reader): Promise<readonly SourceOverview[]> {
  const params = await getParams(db);
  const window = indicatorWindow(
    params.get('collection.indicatorWindowDays'),
    params.get('display.timeZone'),
  );
  const rows = await db
    .select()
    .from(pressSources)
    .orderBy(asc(pressSources.outletName), asc(pressSources.id));
  const counts = await windowCounts(db, window.firstDay);
  const attached = await attachedCounts(db, window.start);
  const gapRows = await db.select().from(collectionGaps).orderBy(desc(collectionGaps.detectedAt));
  const gaps = Map.groupBy(gapRows, (gap) => gap.pressSourceId);
  return rows.map((source) => ({
    source,
    indicators: indicatorsOf(source, window.days, {
      ...(counts.get(source.id) ?? NO_COUNTS),
      attached: attached.get(source.id) ?? 0,
    }),
    gaps: gaps.get(source.id) ?? [],
  }));
}

// --- Articles --------------------------------------------------------------------

/** A stored article as other modules see it: its title key stays inside the module. */
export type Article = Omit<ArticleRow, 'titleKey'>;

/** An article with the sources it was seen in, first seen first (COL-31). */
export type ArticleWithSightings = Article & Readonly<{ sightings: readonly ArticleSightingRow[] }>;

/** Every column of `articles` but the title key. */
const ARTICLE_COLUMNS = {
  id: articles.id,
  title: articles.title,
  outletName: articles.outletName,
  link: articles.link,
  retainedPublishedAt: articles.retainedPublishedAt,
  retainedPublishedAtPrecision: articles.retainedPublishedAtPrecision,
  firstCollectedAt: articles.firstCollectedAt,
  language: articles.language,
  excerpt: articles.excerpt,
  processingStatus: articles.processingStatus,
  notRelevantReasons: articles.notRelevantReasons,
  retentionClockStartedAt: articles.retentionClockStartedAt,
  firstPressSourceId: articles.firstPressSourceId,
  firstTaskRunId: articles.firstTaskRunId,
  rowVersion: articles.rowVersion,
};

/**
 * The articles that the collection run `taskRunId` recorded and the purge has not yet
 * deleted, in the order they were collected (COL-49).
 */
export async function articlesOfRun(db: Reader, taskRunId: number): Promise<readonly Article[]> {
  return db
    .select(ARTICLE_COLUMNS)
    .from(articles)
    .where(eq(articles.firstTaskRunId, taskRunId))
    .orderBy(asc(articles.firstCollectedAt), asc(articles.id));
}

/** The articles still to analyze, oldest first collection first: the prefilter's input (COL-35, DET-01). */
export async function articlesToAnalyze(db: Reader): Promise<readonly Article[]> {
  return db
    .select(ARTICLE_COLUMNS)
    .from(articles)
    .where(eq(articles.processingStatus, 'to_analyze'))
    .orderBy(asc(articles.firstCollectedAt), asc(articles.id));
}

/** The article `articleId` with its sightings, first seen first; null when none is kept (COL-25, COL-31). */
export async function article(db: Reader, articleId: number): Promise<ArticleWithSightings | null> {
  const [row] = await db.select(ARTICLE_COLUMNS).from(articles).where(eq(articles.id, articleId));
  if (row === undefined) {
    return null;
  }
  const sightings = await db
    .select()
    .from(articleSightings)
    .where(eq(articleSightings.articleId, articleId))
    .orderBy(asc(articleSightings.firstSeenAt));
  return { ...row, sightings };
}

// --- Detection's writers ---------------------------------------------------------

/** A reason why an article, or a part or fact of it, is not relevant (CL-DET-01). */
export type NotRelevantReason = ArticleRow['notRelevantReasons'][number];

/**
 * The processing state that detection derives for an article (CL-DET-01): every distinct
 * reason of its parts and facts, and for a not-relevant article the start of its
 * retention clock (CL-COL-08).
 */
export type ArticleStatusChange =
  | Readonly<{
      status: 'not_relevant';
      reasons: readonly NotRelevantReason[];
      retentionClockStartedAt: EpochMs;
    }>
  | Readonly<{
      status: Exclude<ArticleRow['processingStatus'], 'not_relevant'>;
      reasons: readonly NotRelevantReason[];
    }>;

/** Why a status change was refused: a not-relevant state needs a reason; the article is gone. */
export type ArticleStatusRefusal = 'reason_missing' | 'article_not_found';

/**
 * Writes, in the caller's transaction, the processing status, the reasons and the
 * retention clock that detection derived for the article, each reason once, and counts
 * the change in its row version (COL-35, CL-DET-01, CL-COL-08, CL-IHM-18); refuses a
 * not-relevant state without a reason.
 */
export async function setArticleStatus(
  tx: Transaction,
  articleId: number,
  change: ArticleStatusChange,
): Promise<Result<ArticleRow['processingStatus'], ArticleStatusRefusal>> {
  if (change.status === 'not_relevant' && change.reasons.length === 0) {
    return err('reason_missing');
  }
  const [row] = await tx
    .update(articles)
    .set({
      processingStatus: change.status,
      notRelevantReasons: [...new Set(change.reasons)],
      retentionClockStartedAt:
        change.status === 'not_relevant' ? new Date(change.retentionClockStartedAt) : null,
      rowVersion: sql`${articles.rowVersion} + 1`,
    })
    .where(eq(articles.id, articleId))
    .returning({ status: articles.processingStatus });
  return row === undefined ? err('article_not_found') : ok(row.status);
}

/** Why the prefilter's count was not taken: the article is gone, or its day has no room. */
export type PrefilterCountRefusal = 'article_not_found' | 'no_daily_count';

/**
 * Counts the article as kept by the prefilter, once, on the counters of the source that
 * first recorded it, on its day of first collection in the owner's zone
 * (`display.timeZone`); the day's kept articles never pass its new articles (COL-11,
 * DET-06, CL-COL-21). Detection calls it once per article that it first keeps.
 */
export async function countPrefilterKept(
  tx: Transaction,
  articleId: number,
): Promise<Result<null, PrefilterCountRefusal>> {
  const [row] = await tx
    .select({ sourceId: articles.firstPressSourceId, collectedAt: articles.firstCollectedAt })
    .from(articles)
    .where(eq(articles.id, articleId));
  if (row === undefined) {
    return err('article_not_found');
  }
  const day = userDay(instant(row.collectedAt), await getParam(tx, 'display.timeZone'));
  const counted = await tx
    .update(pressSourceDailyCounts)
    .set({ prefilterKept: sql`${pressSourceDailyCounts.prefilterKept} + 1` })
    .where(
      and(
        eq(pressSourceDailyCounts.pressSourceId, row.sourceId),
        eq(pressSourceDailyCounts.collectedOn, day),
        lt(pressSourceDailyCounts.prefilterKept, pressSourceDailyCounts.newArticles),
      ),
    )
    .returning({ id: pressSourceDailyCounts.id });
  return counted.length === 0 ? err('no_daily_count') : ok(null);
}
