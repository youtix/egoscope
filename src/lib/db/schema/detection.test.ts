import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { insertParents, PARENTS } from '../test-parents';
import { pressSources } from './collection';
import { articles } from './collection-articles';
import { articleParts, classificationResults } from './detection';

import type { Database } from '../types';

// The tables of detection.md about the parts of an article and their classifications.
const TABLES = ['article_parts', 'classification_results'];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'article_parts.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'article_parts.article_id integer NOT NULL',
  'article_parts.player_id uuid NOT NULL',
  'article_parts.recognized_by text NOT NULL',
  'article_parts.recognized_at timestamp with time zone NOT NULL',
  "article_parts.status text NOT NULL DEFAULT 'pending'::text",
  'article_parts.queue_entry_kind text',
  'article_parts.queued_at timestamp with time zone',
  'article_parts.cycle_attempts smallint NOT NULL DEFAULT 0',
  'article_parts.classification_failed_at timestamp with time zone',
  'article_parts.not_relevant_reason text',
  'classification_results.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'classification_results.article_part_id integer NOT NULL',
  'classification_results.origin text NOT NULL',
  'classification_results.user_action text',
  'classification_results.classified_at timestamp with time zone NOT NULL',
  'classification_results.instructions_version text',
  'classification_results.model_id text',
  'classification_results.attempt_number smallint',
  'classification_results.validated_types jsonb NOT NULL',
  'classification_results.player_corrected_at timestamp with time zone',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  "CREATE INDEX article_parts_eligible_idx ON public.article_parts USING btree (queued_at) WHERE ((status = 'pending'::text) AND (classification_failed_at IS NULL))",
  'CREATE INDEX article_parts_failed_idx ON public.article_parts USING btree (article_id) WHERE (classification_failed_at IS NOT NULL)',
  'CREATE UNIQUE INDEX article_parts_pkey ON public.article_parts USING btree (id)',
  'CREATE INDEX article_parts_player_idx ON public.article_parts USING btree (player_id, status)',
  'CREATE UNIQUE INDEX article_parts_uq ON public.article_parts USING btree (article_id, player_id)',
  'CREATE INDEX classification_results_part_idx ON public.classification_results USING btree (article_part_id, classified_at)',
  'CREATE UNIQUE INDEX classification_results_pkey ON public.classification_results USING btree (id)',
];

// Their references: a part goes with its article, never with its followed player.
const FOREIGN_KEYS = [
  'article_parts FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE',
  'article_parts FOREIGN KEY (player_id) REFERENCES followed_players(id) ON DELETE RESTRICT',
  'classification_results FOREIGN KEY (article_part_id) REFERENCES article_parts(id) ON DELETE CASCADE',
];

/** An instant of 2 December 2024, at `hour` UTC. */
const at = (hour: number): Date => new Date(toEpochMs(Date.UTC(2024, 11, 2, hour)));
const ARTICLE_ID = 1;
const PART_ID = 1;
const SOURCE = {
  outletName: 'Harbor Daily',
  feedUrl: 'https://harbor.example.com/sports/feed',
  feedUrlKey: 'https://harbor.example.com/sports/feed',
  language: 'en',
  publicSportsPressAttestedAt: at(7),
  healthStatusChangedAt: at(7),
} as const;
const ARTICLE = {
  title: 'Harbor Hawks guard misses practice after a family loss',
  titleKey: 'harbor hawks guard misses practice after a family loss',
  outletName: SOURCE.outletName,
  link: 'https://harbor.example.com/2024/12/02/guard-misses-practice',
  retainedPublishedAt: at(6),
  retainedPublishedAtPrecision: 'exact',
  firstCollectedAt: at(8),
  language: 'en',
  firstPressSourceId: 1,
} as const;
// The part of the article about the first followed player, queued for classification.
const PENDING = {
  articleId: ARTICLE_ID,
  playerId: PARENTS.playerId,
  recognizedBy: 'prefilter',
  recognizedAt: at(8),
  queueEntryKind: 'first_classification',
  queuedAt: at(8),
} as const;
// The same part once classified, out of the queue.
const CLASSIFIED = {
  articleId: ARTICLE_ID,
  playerId: PARENTS.playerId,
  recognizedBy: 'owner',
  recognizedAt: at(8),
  status: 'classified',
} as const;
const MODEL_RESULT = {
  articlePartId: PART_ID,
  origin: 'model',
  classifiedAt: at(9),
  instructionsVersion: 'classification-v1',
  modelId: 'model-a',
  attemptNumber: 1,
  validatedTypes: [],
} as const;
const USER_RESULT = {
  articlePartId: PART_ID,
  origin: 'user',
  userAction: 'manual_classification',
  classifiedAt: at(9),
  validatedTypes: [],
} as const;
// A value that no stored set of the model holds.
const OUTSIDE = sql`'outside'`;

/** The error of a query that a CHECK constraint refused. */
const violationOf = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23514', constraint },
});

describe('the parts of an article and their classifications', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db.insert(pressSources).values(SOURCE);
    await db.insert(articles).values(ARTICLE);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that detection.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[DET-06] [DET-09] [DET-22] [CL-DET-01] [CL-DET-13] queues a pending part, one per article and player, with every value of its sets', async () => {
    await db
      .insert(articleParts)
      .values({ ...PENDING, cycleAttempts: 5, classificationFailedAt: at(9) });
    await db.insert(articles).values([
      { ...ARTICLE, link: 'https://harbor.example.com/b' },
      { ...ARTICLE, link: 'https://harbor.example.com/c' },
      { ...ARTICLE, link: 'https://harbor.example.com/d' },
      { ...ARTICLE, link: 'https://harbor.example.com/e' },
    ]);
    await db.insert(articleParts).values([
      { ...PENDING, articleId: 2, queueEntryKind: 'automatic_reclassification' },
      { ...PENDING, articleId: 3, queueEntryKind: 'owner_request' },
      { ...CLASSIFIED, articleId: 4, notRelevantReason: 'no_fact' },
      { ...CLASSIFIED, articleId: 5, status: 'closed', notRelevantReason: 'no_followed_player' },
      { ...CLASSIFIED, playerId: PARENTS.otherPlayerId },
    ]);
    const again = db.insert(articleParts).values(PENDING);
    await expect(again).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'article_parts_uq' },
    });

    const [first] = await db.select().from(articleParts).where(eq(articleParts.id, PART_ID));

    expect(first).toMatchObject({ status: 'pending', notRelevantReason: null, cycleAttempts: 5 });
    await expect(db.$count(articleParts)).resolves.toBe(6);
  });

  it.each([
    ['a recognition outside the list', { ...CLASSIFIED, recognizedBy: OUTSIDE }, 'recognized_by'],
    ['a status outside the list', { ...CLASSIFIED, status: OUTSIDE }, 'status'],
    ['a queue entry outside the list', { ...PENDING, queueEntryKind: OUTSIDE }, 'queue_entry_kind'],
    ['a pending part without its queue entry', { ...PENDING, queueEntryKind: null }, 'queue_entry'],
    [
      'a classified part with a queue entry',
      { ...CLASSIFIED, queueEntryKind: 'owner_request' },
      'queue_entry',
    ],
    ['a pending part without its queuing instant', { ...PENDING, queuedAt: null }, 'queued'],
    ['a classified part with a queuing instant', { ...CLASSIFIED, queuedAt: at(8) }, 'queued'],
    ['a negative number of attempts', { ...PENDING, cycleAttempts: -1 }, 'cycle_attempts'],
    ['six attempts in one cycle', { ...PENDING, cycleAttempts: 6 }, 'cycle_attempts'],
    ['a failure on a classified part', { ...CLASSIFIED, classificationFailedAt: at(9) }, 'failed'],
    [
      'a reason outside the list',
      { ...CLASSIFIED, notRelevantReason: OUTSIDE },
      'not_relevant_reason',
    ],
    ['a closed part without its reason', { ...CLASSIFIED, status: 'closed' }, 'closed'],
    [
      'a closed part for want of a fact',
      { ...CLASSIFIED, status: 'closed', notRelevantReason: 'no_fact' },
      'closed',
    ],
    [
      'a pending part already not relevant',
      { ...PENDING, notRelevantReason: 'no_fact' },
      'pending',
    ],
  ] as const)(
    '[DET-09] [DET-16] [DET-22] [CL-DET-01] [CL-DET-03] [CL-DET-23] refuses a part with %s',
    async (_case, part, check) => {
      const insert = db.insert(articleParts).values(part);

      await expect(insert).rejects.toMatchObject(violationOf(`article_parts_${check}_check`));
    },
  );

  it('[DET-13] [DET-47] [DET-53] keeps every classification of a part, model or owner, and each goes with its article', async () => {
    await db.insert(articleParts).values(CLASSIFIED);
    await db.insert(classificationResults).values([
      { ...MODEL_RESULT, attemptNumber: 5, validatedTypes: [{ id: 'media-storm', version: 1 }] },
      { ...USER_RESULT, playerCorrectedAt: at(10) },
      ...(['rescue', 'own_event', 'added_player'] as const).map((userAction) => ({
        ...USER_RESULT,
        userAction,
      })),
    ]);

    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));

    await expect(db.$count(articleParts)).resolves.toBe(0);
    await expect(db.$count(classificationResults)).resolves.toBe(0);
  });

  it.each([
    [
      'an origin outside the list',
      { articlePartId: PART_ID, origin: OUTSIDE, classifiedAt: at(9), validatedTypes: [] },
      'origin',
    ],
    ['an owner action outside the list', { ...USER_RESULT, userAction: OUTSIDE }, 'user_action'],
    ['an owner classification without its action', { ...USER_RESULT, userAction: null }, 'user'],
    [
      'a model classification with an owner action',
      { ...MODEL_RESULT, userAction: 'rescue' },
      'user',
    ],
    [
      'a model classification without its instructions',
      { ...MODEL_RESULT, instructionsVersion: null },
      'instructions',
    ],
    [
      'an owner classification with instructions',
      { ...USER_RESULT, instructionsVersion: 'v1' },
      'instructions',
    ],
    ['a model classification without its model', { ...MODEL_RESULT, modelId: null }, 'model'],
    ['an owner classification with a model', { ...USER_RESULT, modelId: 'model-a' }, 'model'],
    ['attempt 0', { ...MODEL_RESULT, attemptNumber: 0 }, 'attempt_number'],
    ['attempt 6', { ...MODEL_RESULT, attemptNumber: 6 }, 'attempt_number'],
    [
      'a model classification without its attempt',
      { ...MODEL_RESULT, attemptNumber: null },
      'attempt',
    ],
    ['an owner classification with an attempt', { ...USER_RESULT, attemptNumber: 1 }, 'attempt'],
  ] as const)(
    '[DET-13] [DET-22] [DET-53] [CL-DET-12] refuses a classification with %s',
    async (_case, result, check) => {
      await db.insert(articleParts).values(CLASSIFIED);

      const insert = db.insert(classificationResults).values(result);

      await expect(insert).rejects.toMatchObject(
        violationOf(`classification_results_${check}_check`),
      );
    },
  );
});
