import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { toEpochMs } from '@/lib/time';

import { describeColumns, describeForeignKeys, describeIndexes } from '../catalog';
import { createTestDatabase } from '../test-database';
import { DETECTED_EVENT, insertParents, PARENTS } from '../test-parents';
import { pressSources } from './collection';
import { articles, articleSightings, dedupTraces } from './collection-articles';
import { articleParts, classificationResults } from './detection';
import { articleAttachments, classificationFacts } from './detection-facts';
import { events } from './events';

import type { Database } from '../types';
import type { PgInsertValue } from 'drizzle-orm/pg-core';

// The tables of detection.md about the facts a classification reports and the
// articles they attach.
const TABLES = ['article_attachments', 'classification_facts'];

// Their columns, table by table and each table's in the order of the model, with the
// type, the null and the default that the model gives each, in the words of SQL.
const COLUMNS = [
  'article_attachments.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'article_attachments.article_id integer NOT NULL',
  'article_attachments.player_event_id integer NOT NULL',
  'article_attachments.classification_fact_id integer NOT NULL',
  'article_attachments.attached_at timestamp with time zone NOT NULL',
  'article_attachments.is_reference boolean NOT NULL DEFAULT false',
  'classification_facts.id integer NOT NULL GENERATED ALWAYS AS IDENTITY',
  'classification_facts.classification_result_id integer NOT NULL',
  'classification_facts.kind text NOT NULL',
  'classification_facts.event_type_id text NOT NULL',
  'classification_facts.detection_confidence smallint',
  'classification_facts.description text',
  'classification_facts.novelty text',
  'classification_facts.designated_event_id integer',
  'classification_facts.timing_hint_on date',
  'classification_facts.injury_return text',
  'classification_facts.game_stakes text',
  'classification_facts.justification text',
  'classification_facts.suggested_type_name text',
  'classification_facts.suggested_type_definition text',
  'classification_facts.outcome text NOT NULL',
  'classification_facts.not_relevant_reason text',
  'classification_facts.matched_historical_event_id integer',
  'classification_facts.superseded_into_event_id integer',
];

// Their indexes, primary keys and unique constraints included, in the words of the catalog.
const INDEXES = [
  'CREATE INDEX article_attachments_event_idx ON public.article_attachments USING btree (player_event_id)',
  'CREATE UNIQUE INDEX article_attachments_fact_uq ON public.article_attachments USING btree (classification_fact_id)',
  'CREATE UNIQUE INDEX article_attachments_pkey ON public.article_attachments USING btree (id)',
  'CREATE UNIQUE INDEX article_attachments_reference_uq ON public.article_attachments USING btree (player_event_id) WHERE is_reference',
  'CREATE UNIQUE INDEX article_attachments_uq ON public.article_attachments USING btree (article_id, player_event_id)',
  "CREATE INDEX classification_facts_coverage_idx ON public.classification_facts USING btree (event_type_id) WHERE (not_relevant_reason = 'below_coverage_threshold'::text)",
  'CREATE INDEX classification_facts_designated_idx ON public.classification_facts USING btree (designated_event_id) WHERE (designated_event_id IS NOT NULL)',
  "CREATE INDEX classification_facts_linked_idx ON public.classification_facts USING btree (event_type_id) WHERE (outcome = 'linked_to_proposal'::text)",
  'CREATE INDEX classification_facts_matched_idx ON public.classification_facts USING btree (matched_historical_event_id) WHERE (matched_historical_event_id IS NOT NULL)',
  'CREATE UNIQUE INDEX classification_facts_pkey ON public.classification_facts USING btree (id)',
  'CREATE INDEX classification_facts_result_idx ON public.classification_facts USING btree (classification_result_id)',
  'CREATE INDEX classification_facts_superseded_idx ON public.classification_facts USING btree (superseded_into_event_id) WHERE (superseded_into_event_id IS NOT NULL)',
];

// Their references: a fact goes with its result, and an attachment blocks the
// deletion of its article, its event and its fact.
const FOREIGN_KEYS = [
  'article_attachments FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE RESTRICT',
  'article_attachments FOREIGN KEY (classification_fact_id) REFERENCES classification_facts(id) ON DELETE RESTRICT',
  'article_attachments FOREIGN KEY (player_event_id) REFERENCES events(id) ON DELETE RESTRICT',
  'classification_facts FOREIGN KEY (classification_result_id) REFERENCES classification_results(id) ON DELETE CASCADE',
  'classification_facts FOREIGN KEY (designated_event_id) REFERENCES events(id) ON DELETE SET NULL',
  'classification_facts FOREIGN KEY (event_type_id) REFERENCES event_types(id) ON DELETE RESTRICT',
  'classification_facts FOREIGN KEY (matched_historical_event_id) REFERENCES events(id) ON DELETE SET NULL',
  'classification_facts FOREIGN KEY (superseded_into_event_id) REFERENCES events(id) ON DELETE SET NULL',
];

/** An instant of 2 December 2024, at `hour` UTC. */
const at = (hour: number): Date => new Date(toEpochMs(Date.UTC(2024, 11, 2, hour)));
const ARTICLE_ID = 1;
const FACT_ID = 1;
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
  processingStatus: 'attached',
} as const;
const PART = {
  articleId: ARTICLE_ID,
  playerId: PARENTS.playerId,
  recognizedBy: 'prefilter',
  recognizedAt: at(8),
  status: 'classified',
} as const;
const RESULT = {
  articlePartId: 1,
  origin: 'model',
  classifiedAt: at(9),
  instructionsVersion: 'classification-v1',
  modelId: 'model-a',
  attemptNumber: 1,
  validatedTypes: [],
} as const;
// A fact of a validated type, attached to the parent event.
const VALIDATED = {
  classificationResultId: 1,
  kind: 'validated_type',
  eventTypeId: 'media-storm',
  detectionConfidence: 80,
  description: 'Every outlet covered the player on the same day.',
  novelty: 'new_fact',
  outcome: 'attached',
} as const;
// A fact of a proposed type, linked to its proposal.
const KNOWN_ENTRY = {
  classificationResultId: 1,
  kind: 'known_entry',
  eventTypeId: 'bereavement',
  justification: 'The article reports the loss of a parent.',
  outcome: 'linked_to_proposal',
} as const;
const NOT_RELEVANT = {
  ...VALIDATED,
  outcome: 'not_relevant',
  notRelevantReason: 'below_threshold',
} as const;
const ATTACHMENT = {
  articleId: ARTICLE_ID,
  playerEventId: PARENTS.eventId,
  classificationFactId: FACT_ID,
  attachedAt: at(9),
} as const;
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

/** The error of a deletion that a reference restricts. */
const restrictedBy = (constraint: string): Readonly<Record<string, unknown>> => ({
  cause: { code: '23001', constraint },
});

describe('the facts of a classification and the articles they attach', { timeout: 60_000 }, () => {
  let db: Database;

  beforeEach(async () => {
    const database = await createTestDatabase();
    db = database.db;
    await insertParents(db);
    await db.insert(pressSources).values(SOURCE);
    await db.insert(articles).values(ARTICLE);
    await db.insert(articleParts).values(PART);
    await db.insert(classificationResults).values(RESULT);
    return database.close;
  }, 60_000);

  it('builds the columns, indexes and references that detection.md gives these tables', async () => {
    await expect(describeColumns(db, TABLES)).resolves.toStrictEqual(COLUMNS);
    await expect(describeIndexes(db, TABLES)).resolves.toStrictEqual(INDEXES);
    await expect(describeForeignKeys(db, TABLES)).resolves.toStrictEqual(FOREIGN_KEYS);
  });

  it('[DET-16] [DET-20] [DET-28] [CL-DET-02] [CL-DET-27] stores each kind of fact with each of its outcomes and reasons', async () => {
    const reasons = [
      'below_threshold',
      'below_coverage_threshold',
      'old_fact',
      'type_rejected_or_withdrawn',
      'proposal_rejected',
      'detached_by_user',
    ] as const;
    await db.insert(classificationFacts).values([
      {
        ...VALIDATED,
        novelty: 'known_event',
        designatedEventId: PARENTS.eventId,
        injuryReturn: 'yes',
        gameStakes: 'high',
      },
      { ...VALIDATED, timingHintOn: '2024-12-01', injuryReturn: 'no', gameStakes: 'normal' },
      {
        ...VALIDATED,
        novelty: 'old_fact',
        injuryReturn: 'unknown',
        gameStakes: 'unknown',
        detectionConfidence: 0,
      },
      {
        ...VALIDATED,
        detectionConfidence: 100,
        outcome: 'superseded',
        supersededIntoEventId: PARENTS.eventId,
      },
      KNOWN_ENTRY,
      {
        ...KNOWN_ENTRY,
        kind: 'new_type',
        suggestedTypeName: 'Trade request',
        suggestedTypeDefinition: 'The player asks to leave his team.',
      },
      ...reasons.map((notRelevantReason) => ({ ...NOT_RELEVANT, notRelevantReason })),
      {
        ...NOT_RELEVANT,
        notRelevantReason: 'already_reported_by_backtest',
        matchedHistoricalEventId: PARENTS.eventId,
      },
    ]);

    await expect(db.$count(classificationFacts)).resolves.toBe(13);
  });

  it.each<readonly [string, PgInsertValue<typeof classificationFacts>, string]>([
    [
      'a kind outside the list',
      {
        classificationResultId: 1,
        kind: OUTSIDE,
        eventTypeId: 'media-storm',
        outcome: 'not_relevant',
        notRelevantReason: 'old_fact',
      },
      'kind',
    ],
    ['a confidence below 0', { ...VALIDATED, detectionConfidence: -1 }, 'detection_confidence'],
    ['a confidence above 100', { ...VALIDATED, detectionConfidence: 101 }, 'detection_confidence'],
    ['a novelty outside the list', { ...VALIDATED, novelty: OUTSIDE }, 'novelty'],
    ['an injury return outside the list', { ...VALIDATED, injuryReturn: OUTSIDE }, 'injury_return'],
    ['game stakes outside the list', { ...VALIDATED, gameStakes: OUTSIDE }, 'game_stakes'],
    ['an outcome outside the list', { ...VALIDATED, outcome: OUTSIDE }, 'outcome'],
    [
      'a reason of a part, not of a fact',
      { ...NOT_RELEVANT, notRelevantReason: sql`'no_fact'` },
      'not_relevant_reason',
    ],
    [
      'a designated event of a new fact',
      { ...VALIDATED, designatedEventId: PARENTS.eventId },
      'designated',
    ],
    [
      'a designated event without a novelty',
      { ...VALIDATED, novelty: null, designatedEventId: PARENTS.eventId },
      'designated',
    ],
    [
      'no reason for being not relevant',
      { ...NOT_RELEVANT, notRelevantReason: null },
      'not_relevant',
    ],
    [
      'a reason on an attached fact',
      { ...VALIDATED, notRelevantReason: 'old_fact' },
      'not_relevant',
    ],
    [
      'a matched event for another reason',
      { ...NOT_RELEVANT, matchedHistoricalEventId: PARENTS.eventId },
      'matched',
    ],
    [
      'a matched event without a reason',
      { ...VALIDATED, matchedHistoricalEventId: PARENTS.eventId },
      'matched',
    ],
    [
      'a merged-into event on an attached fact',
      { ...VALIDATED, supersededIntoEventId: PARENTS.eventId },
      'superseded',
    ],
    [
      'a confidence on a known entry',
      { ...KNOWN_ENTRY, detectionConfidence: 80 },
      'validated_type',
    ],
    [
      'a description on a known entry',
      { ...KNOWN_ENTRY, description: 'A loss.' },
      'validated_type',
    ],
    ['a novelty on a known entry', { ...KNOWN_ENTRY, novelty: 'new_fact' }, 'validated_type'],
    [
      'a designated event on a known entry',
      { ...KNOWN_ENTRY, novelty: 'known_event', designatedEventId: PARENTS.eventId },
      'validated_type',
    ],
    [
      'a timing hint on a known entry',
      { ...KNOWN_ENTRY, timingHintOn: '2024-12-01' },
      'validated_type',
    ],
    ['an injury return on a known entry', { ...KNOWN_ENTRY, injuryReturn: 'no' }, 'validated_type'],
    ['game stakes on a known entry', { ...KNOWN_ENTRY, gameStakes: 'normal' }, 'validated_type'],
    [
      'a suggested name on a validated type',
      { ...VALIDATED, suggestedTypeName: 'Trade request' },
      'new_type',
    ],
    [
      'a suggested definition on a validated type',
      { ...VALIDATED, suggestedTypeDefinition: 'A request.' },
      'new_type',
    ],
    ['a known entry attached to an event', { ...KNOWN_ENTRY, outcome: 'attached' }, 'attached'],
    [
      'a validated type linked to a proposal',
      { ...VALIDATED, outcome: 'linked_to_proposal' },
      'linked',
    ],
  ])(
    '[DET-16] [DET-28] [DET-58] [CL-DET-02] [CL-DET-03] refuses a fact with %s',
    async (_case, fact, check) => {
      const insert = db.insert(classificationFacts).values(fact);

      await expect(insert).rejects.toMatchObject(
        violationOf(`classification_facts_${check}_check`),
      );
    },
  );

  it('[DET-27] [DET-30] [DET-31] attaches an article once per event, through one fact, and gives the event one reference article', async () => {
    await db.insert(classificationFacts).values([VALIDATED, VALIDATED, VALIDATED]);
    await db.insert(articles).values({ ...ARTICLE, link: 'https://harbor.example.com/other' });
    await db.insert(articleAttachments).values({ ...ATTACHMENT, isReference: true });
    const sameEvent = db
      .insert(articleAttachments)
      .values({ ...ATTACHMENT, classificationFactId: 2 });
    await expect(sameEvent).rejects.toMatchObject(duplicateOf('article_attachments_uq'));
    const sameFact = db.insert(articleAttachments).values({ ...ATTACHMENT, articleId: 2 });
    await expect(sameFact).rejects.toMatchObject(duplicateOf('article_attachments_fact_uq'));
    const secondReference = db
      .insert(articleAttachments)
      .values({ ...ATTACHMENT, articleId: 2, classificationFactId: 2, isReference: true });
    await expect(secondReference).rejects.toMatchObject(
      duplicateOf('article_attachments_reference_uq'),
    );

    await db
      .insert(articleAttachments)
      .values({ ...ATTACHMENT, articleId: 2, classificationFactId: 2 });

    await expect(
      db
        .select({ isReference: articleAttachments.isReference })
        .from(articleAttachments)
        .orderBy(articleAttachments.id),
    ).resolves.toStrictEqual([{ isReference: true }, { isReference: false }]);
  });

  it('[DSN-27] [DET-51] [COL-37] [CL-DSN-16] erases an article attached to a withdrawn event, its facts with it, and leaves no deduplication trace', async () => {
    await db
      .insert(articleSightings)
      .values({ articleId: ARTICLE_ID, pressSourceId: 1, firstSeenAt: at(8) });
    await db.insert(classificationFacts).values(VALIDATED);
    await db.insert(articleAttachments).values({ ...ATTACHMENT, isReference: true });
    const withdrawal = db.delete(events).where(eq(events.id, PARENTS.eventId));
    await expect(withdrawal).rejects.toMatchObject(
      restrictedBy('article_attachments_player_event_id_events_id_fk'),
    );
    const erasure = db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await expect(erasure).rejects.toMatchObject(
      restrictedBy('article_attachments_article_id_articles_id_fk'),
    );

    await db
      .delete(articleAttachments)
      .where(eq(articleAttachments.playerEventId, PARENTS.eventId));
    await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
    await db.delete(events).where(eq(events.id, PARENTS.eventId));

    const left = [
      articles,
      articleSightings,
      articleParts,
      classificationResults,
      classificationFacts,
      dedupTraces,
    ];
    await expect(Promise.all(left.map(async (table) => db.$count(table)))).resolves.toStrictEqual([
      0, 0, 0, 0, 0, 0,
    ]);
    await expect(db.$count(events)).resolves.toBe(0);
  });

  it('[DET-28] [CL-DET-02] keeps a fact when the event it names goes, without the name', async () => {
    await db.insert(events).values({ ...DETECTED_EVENT, description: 'A second storm.' });
    await db.insert(classificationFacts).values({
      ...VALIDATED,
      novelty: 'known_event',
      designatedEventId: 2,
      outcome: 'superseded',
      supersededIntoEventId: 2,
    });

    await db.delete(events).where(eq(events.id, 2));

    await expect(
      db
        .select({
          designated: classificationFacts.designatedEventId,
          into: classificationFacts.supersededIntoEventId,
        })
        .from(classificationFacts),
    ).resolves.toStrictEqual([{ designated: null, into: null }]);
  });
});
